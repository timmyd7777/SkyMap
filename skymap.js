// ---- Sky map rendering engine ----
// Pure rendering module with no DOM dependencies. All display state comes via
// the params object passed to skymapDraw(). View state (viewLonPrecise, etc.)
// is global so that the HTML wrapper and drag/zoom handlers can read/write it.
//
// Coordinate convention: internally, longitude is the atan2(x,y) angle in the
// current frame. For non-horizon frames, display_lon = 90° - internal_lon
// (because RA increases leftward on the sky). For horizon, display_az = internal_lon.
// The azToDisp() function handles this conversion.
//
// Projection: stereographic from the antipode of the view center. Points on the
// front hemisphere (within 90° of center) project to r < 2 in normalized coords.
// Points behind the hemisphere are clipped or clamped depending on context.
"use strict";

// ---- View state (mutable, shared with HTML wrapper) ----

// View center in current frame's internal coordinates (degrees).
// viewLonPrecise: internal longitude (see azToDisp for display conversion).
// viewLatPrecise: latitude, -90 to +90.
// viewFovPrecise: horizontal field of view width, 10 to 180.
let viewLonPrecise = 180, viewLatPrecise = 90, viewFovPrecise = 180;

// Current coordinate frame: 'horizon', 'equatorial', 'ecliptic', or 'galactic'.
let viewFrame = 'horizon';
let viewJ2000 = false;

// Inverse projection function, set by skymapDraw() each frame.
// (sx, sy) in canvas pixels → [lat, lon] in current frame (radians), or null.
let viewUnproject = null;

// Nebula contour name → NEBULA_CONTOURS index lookup, built by skymapInit().
const nebulaContourMap = {};
// DEEPSKY index → array of contour indices (or null), built by skymapInit().
const dsContours = [];

// Objects drawn in the last frame, for hit-testing by pickObject().
// Each entry: {x, y, r, type, data, ...} in canvas pixel coordinates.
let drawnObjects = [];

// Currently selected (picked) object, or null.
let selectedObject = null;

// Object the view is tracking (stays centered). Set by double-click, cleared by drag/slider.
// {type, name, jx, jy, jz} — type+name identify SS objects in ssCache; jx/jy/jz are J2000 coords.
let centerObject = null;

// Frame rotation matrix from last draw (J2000 equatorial → current frame).
// Used by changeFrame() to convert the view center between frames.
let curMFrame = null;

// Solar system position cache. Each entry holds a J2000 equatorial unit vector
// (x, y, z) plus magnitude, color, name, etc. Recomputed when JD or observer
// location changes; during drag/zoom these are just transformed through the
// frame matrix like stars, avoiding expensive orbit recomputation every frame.
let ssCache = [];
let ssCacheJD = -1;
let ssCacheLat = null;  // observer latitude at last computation
let ssCacheLon = null;  // observer longitude at last computation (Moon topocentric)

// ---- Constants ----

// Drawing colors for solar system bodies (not from orbital element data).
const PLANET_COLORS = {
  Mercury:'#b0b0b0', Venus:'#e8d060', Mars:'#e04020', Jupiter:'#d89040',
  Saturn:'#c8a830', Uranus:'#40b8c0', Neptune:'#7090f0', Pluto:'#a07050'
};
const PLANET_SYMBOLS = {
  Sun:'☉', Moon:'☽', Mercury:'☿', Venus:'♀', Mars:'♂',
  Jupiter:'♃', Saturn:'♄', Uranus:'♅', Neptune:'♆', Pluto:'♇'
};

// UI labels for the two coordinate axes in each frame.
const FRAME_LABELS = {
  horizon:    ['Azimuth', 'Altitude'],
  equatorial: ['Right Ascension', 'Declination'],
  ecliptic:   ['Ecliptic Longitude', 'Ecliptic Latitude'],
  galactic:   ['Galactic Longitude', 'Galactic Latitude'],
};

// Convert internal longitude (degrees) to display value (degrees).
// Horizon: display = internal (azimuth). Others: display = 90 - internal
// (because RA/ecliptic-lon/galactic-lon increase leftward on the sky,
// opposite to the internal atan2(x,y) convention).
function azToDisp(deg) {
  return viewFrame === 'horizon' ? mod360(deg) : mod360(90 - deg);
}

// Ray-casting point-in-polygon test. pts is an array of [x, y] pairs.
function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i][1] > py) !== (pts[j][1] > py) &&
        px < (pts[j][0] - pts[i][0]) * (py - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0])
      inside = !inside;
  }
  return inside;
}

// Bayer letter names → Unicode Greek, for star designation labels.
const GREEK_MAP = {
  alpha:'α', beta:'β', gamma:'γ', delta:'δ', epsilon:'ε',
  zeta:'ζ', eta:'η', theta:'θ', iota:'ι', kappa:'κ',
  lambda:'λ', mu:'μ', nu:'ν', xi:'ξ', omicron:'ο',
  pi:'π', rho:'ρ', sigma:'σ', tau:'τ', upsilon:'υ',
  phi:'φ', chi:'χ', psi:'ψ', omega:'ω'
};
// Digit → Unicode superscript, for multi-component Bayer designations (e.g. π¹ Ori).
const SUPER_DIGITS = {0:'⁰',1:'¹',2:'²',3:'³',4:'⁴',
  5:'⁵',6:'⁶',7:'⁷',8:'⁸',9:'⁹'};

// Format a star's Bayer or Flamsteed designation for display.
// Returns a short string like "α", "α²", "47", or "" if neither is available.
// bayer: e.g. "alpha1 Ori", flamsteed: e.g. "58 Ori" (from star catalog).
function formatDesignation(bayer, flamsteed) {
  if (bayer) {
    const part = bayer.split(' ')[0];
    const m = part.match(/^([a-z]+)([0-9]*)$/);
    if (m && GREEK_MAP[m[1]]) {
      let s = GREEK_MAP[m[1]];
      if (m[2]) s += [...m[2]].map(c => SUPER_DIGITS[c] || c).join('');
      return s;
    }
  }
  if (flamsteed) return flamsteed.split(' ')[0];
  return '';
}

// Format a picked object into a one-line description string for display.
// obj: an entry from drawnObjects (has .type, .data, optionally .hr).
// Format (lonDeg, latDeg) in the current frame's display convention.
// lonDeg is already display-converted (via azToDisp). Returns a string.
function formatCoords(lonDeg, latDeg) {
  if (viewFrame === 'equatorial') {
    const raH = ((lonDeg / 15) % 24 + 24) % 24;
    const raHi = floor(raH), raMin = (raH - raHi) * 60;
    const decAbs = abs(latDeg), decD = floor(decAbs), decM = round((decAbs - decD) * 60);
    return `RA ${p2(raHi)}h ${raMin < 10 ? '0' : ''}${raMin.toFixed(1)}m  Dec ${latDeg >= 0 ? '+' : '-'}${p2(decD)}° ${p2(decM)}'`;
  } else if (viewFrame === 'ecliptic') {
    const latSign = latDeg >= 0 ? '+' : '';
    return `Ecl Lon ${lonDeg.toFixed(1)}° Lat ${latSign}${latDeg.toFixed(1)}°`;
  } else if (viewFrame === 'galactic') {
    const latSign = latDeg >= 0 ? '+' : '';
    return `Gal Lon ${lonDeg.toFixed(1)}° Lat ${latSign}${latDeg.toFixed(1)}°`;
  } else {
    const altSign = latDeg >= 0 ? '+' : '';
    return `Azm ${lonDeg.toFixed(1)}° Alt ${altSign}${latDeg.toFixed(1)}°`;
  }
}

function formatDist(d) {
  const LY_PER_PC = 3.26156;
  if (d.type === 'star') {
    const pc = d.data[4];
    if (!pc || pc <= 0) return '';
    const ly = pc * LY_PER_PC;
    return ly >= 1000 ? `${(ly/1000).toFixed(1)} kly` : `${ly.toFixed(1)} ly`;
  } else if (d.type === 'deepsky') {
    const pc = d.data[4];
    if (!pc || pc <= 0) return '';
    const ly = pc * LY_PER_PC;
    if (d.data[0] === 'GX') return `${(ly/1e6).toFixed(1)} Mly`;
    return ly >= 1000 ? `${(ly/1000).toFixed(1)} kly` : `${ly.toFixed(1)} ly`;
  } else if (d.type === 'moon' || d.type === 'satellite') {
    const km = d.data.dist;
    if (!km || km <= 0) return '';
    return `${round(km).toLocaleString()} km`;
  } else if (d.type === 'sun' || d.type === 'planet' || d.type === 'comet' || d.type === 'asteroid' || d.type === 'planetmoon') {
    const au = d.data.geoDist || d.data.dist;
    if (!au || au <= 0) return '';
    return `${au.toFixed(3)} AU`;
  }
  return '';
}

function formatSelection(obj) {
  const d = obj.data;
  const ids = [];
  let type = '', name = '', mag = null;
  if (obj.type === 'star') {
    type = 'Star';
    const bayer = d[8], flamsteed = d[9], starName = d[10], dm = d[11];
    name = starName || '';
    if (bayer) ids.push(bayer);
    if (flamsteed) ids.push(flamsteed);
    if (obj.hr) ids.push(`HR ${obj.hr}`);
    if (d[6]) ids.push(`HD ${d[6]}`);
    if (d[7]) ids.push(`HIP ${d[7]}`);
    if (dm) ids.push(dm);
    mag = d[2];
  } else if (obj.type === 'deepsky') {
    const DS_TYPES = {OC:'Open Cluster',GC:'Globular Cluster',BN:'Bright Nebula',
      DN:'Dark Nebula',PN:'Planetary Nebula',GX:'Galaxy'};
    type = DS_TYPES[d[0]] || d[0];
    name = d[11] || '';
    if (d[8]) ids.push(d[8]);
    if (d[9]) ids.push(d[9]);
    if (d[10]) ids.push(d[10]);
    mag = d[3];
  } else if (obj.type === 'planet') {
    type = 'Planet';
    name = d.name;
    mag = d.mag;
  } else if (obj.type === 'sun') {
    type = 'Star';
    name = 'Sun';
    mag = d.mag;
  } else if (obj.type === 'moon') {
    type = 'Moon';
    name = 'Moon';
    mag = d.mag;
  } else if (obj.type === 'asteroid') {
    type = 'Asteroid';
    name = d.name;
    mag = d.mag;
  } else if (obj.type === 'comet') {
    type = 'Comet';
    name = d.name;
    mag = d.mag;
  } else if (obj.type === 'satellite') {
    type = 'Satellite';
    name = d.name;
    mag = d.mag;
  } else if (obj.type === 'planetmoon') {
    type = d.parent + ' moon';
    name = d.name;
    mag = d.mag;
  }
  if (centerObject) type = 'Tracking ' + type;
  let s = type + ': ';
  const parts = [];
  if (name) parts.push(name);
  parts.push(...ids);
  s += parts.join(', ');
  if (obj.coords) s += ` - ${obj.coords}`;
  if (mag != null) s += `  Mag ${mag >= 0 ? '+' : ''}${mag.toFixed(2)}`;
  const dist = formatDist(obj);
  if (dist) s += `  Dist ${dist}`;
  return s;
}

// ---- Initialization ----

// Precompute J2000 unit vectors for all catalog objects. Call once after
// loading star/constellation/deep-sky/milky-way/boundary data files.
// Appends [x, y, z] to each star and deep-sky entry (J2000 equatorial).
// Converts Milky Way polygons from [lon,lat] pairs to flat Float32Array of xyz.
// Converts constellation boundaries from B1875 RA/Dec pairs to J2000 xyz.
function skymapInit() {
  for (let i = 0; i < STARS.length; i++) {
    const s = STARS[i];
    s.push(...sph2uxyz(s[0], s[1]));
  }
  for (const c of CON_CENTERS) {
    c.push(...sph2uxyz(c[0], c[1]));
  }
  for (let i = 0; i < DEEPSKY.length; i++) {
    const ds = DEEPSKY[i];
    ds.push(...sph2uxyz(ds[1], ds[2]));
  }
  for (let i = 0; i < MILKYWAY.length; i++) {
    const ring = MILKYWAY[i];
    const xyz = new Float32Array(ring.length * 3);
    for (let j = 0; j < ring.length; j++) {
      const v = sph2uxyz(ring[j][0], ring[j][1]);
      xyz[j*3] = v[0]; xyz[j*3+1] = v[1]; xyz[j*3+2] = v[2];
    }
    MILKYWAY[i] = xyz;
  }
  for (let i = 0; i < NEBULA_CONTOURS.length; i++) {
    const ring = NEBULA_CONTOURS[i];
    const xyz = new Float32Array(ring.length * 3);
    for (let j = 0; j < ring.length; j++) {
      const v = sph2uxyz(ring[j][0], ring[j][1]);
      xyz[j*3] = v[0]; xyz[j*3+1] = v[1]; xyz[j*3+2] = v[2];
    }
    NEBULA_CONTOURS[i] = xyz;
  }
  for (let i = 0; i < NEBULA_INDEX.length; i++)
    for (const name of NEBULA_INDEX[i])
      (nebulaContourMap[name] ??= []).push(i);
  for (let i = 0; i < DEEPSKY.length; i++)
    dsContours[i] = nebulaContourMap[DEEPSKY[i][8]] || nebulaContourMap[DEEPSKY[i][9]]
      || nebulaContourMap[DEEPSKY[i][10]] || nebulaContourMap[DEEPSKY[i][11]] || null;
  // Precess constellation boundary vertices from B1875 to J2000
  const T1875 = (2405889.25 - 2451545.0) / 36525.0;
  const pp1875 = precessAngles(T1875);
  const cosT1875 = cos(pp1875.thetaA), sinT1875 = sin(pp1875.thetaA);
  const mPrecY1875 = [cosT1875,0,-sinT1875, 0,1,0, sinT1875,0,cosT1875];
  const mJ2000toB1875 = mmul(rz(pp1875.zA), mmul(mPrecY1875, rz(pp1875.zetaA)));
  const mB1875toJ2000 = mtranspose(mJ2000toB1875);
  for (const con of Object.keys(BOUNDARIES)) {
    const verts = BOUNDARIES[con];
    const xyz = [];
    for (let i = 0; i < verts.length; i += 2) {
      const ra = verts[i], dec = verts[i+1];
      xyz.push(...mvmul(mB1875toJ2000, ...sph2uxyz(ra, dec)));
    }
    BOUNDARIES[con] = xyz;
  }
}

// ---- Main draw ----

// Render the sky map onto a canvas element. No DOM access; all state via params.
//
// canvas: an HTMLCanvasElement (only .width, .height, and .getContext used).
// params: {
//   dt:   {y,m,d,h,mi,s} in UTC, plus {localY,localM,localD,localH,localMi,localS,tzAbbr,tzOffMin},
//   loc:  {latRad, lonRad, latDeg, lonDeg} — observer position,
//   darkMode, showStars, showNames, showStarIds, showConst, showConstNames,
//   showBounds, showPlanets, showPlanetNames, showDeepSky, showDeepSkyNames,
//   showDeepSkyIds, showMilkyWay, showEcliptic, showCelEq, showGalEq,
//   showGrid, showHeader: booleans
// }
//
// Side effects: updates viewUnproject, drawnObjects, curMFrame globals.
function skymapDraw(canvas, params) {
  const {
    dt, loc, darkMode,
    showStars, showNames, showStarIds,
    showConst, showConstNames, showBounds,
    showPlanets, showPlanetSymbols, showPlanetNames, showPlanetGrid, j2000,
    showComets, showCometNames, showAsteroids, showAsteroidNames,
    showSatellites, showSatelliteNames,
    showDeepSky, showDeepSkyNames, showDeepSkyIds,
    showMilkyWay, showEcliptic, showCelEq, showGalEq,
    showGrid, showHeader,
  } = params;
  const showStarColors = true;

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // ---- Astronomical parameters for current instant ----
  const utHours = dt.h + dt.mi / 60 + dt.s / 3600;
  const jd = julianDate(dt.y, dt.m, dt.d, utHours);
  const T = (jd - 2451545.0) / 36525.0;           // Julian centuries from J2000
  const daysSinceJ2000 = jd - 2451545.0;
  const nut = nutation(T);
  const epsTrue = obliquity(T) + nut.dEps;
  const lstR = (localSiderealTime(jd, loc.lonDeg) + nut.dPsi * cos(epsTrue) * RAD) * DEG;

  // ---- Frame matrix (computed before view params for object centering) ----
  const mFrame = frameMatrix(viewFrame, jd, loc.latRad, loc.lonDeg, j2000);
  const mPrecess = frameMatrix('equatorial', jd, loc.latRad, loc.lonDeg, j2000);
  curMFrame = mFrame;
  const mPT = mtranspose(mPrecess);

  // ---- Center on tracked object ----
  if (centerObject) {
    if (centerObject.type !== 'star' && centerObject.type !== 'deepsky') {
      updateSSCache();
      const fresh = ssCache.find(o => o.type === centerObject.type && o.name === centerObject.name);
      if (fresh) { centerObject.jx = fresh.x; centerObject.jy = fresh.y; centerObject.jz = fresh.z; }
    }
    const [fx, fy, fz] = mvmul(mFrame, centerObject.jx, centerObject.jy, centerObject.jz);
    viewLonPrecise = mod360(atan2(fx, fy) * RAD);
    viewLatPrecise = max(-90, min(90, asin(max(-1, min(1, fz))) * RAD));
  }

  // ---- View projection parameters ----
  const cx = W / 2, cy = H / 2;                     // canvas center (pixels)
  const chartR = (min(W, H) / 2) - 1;               // radius of chart area (pixels)
  const vLonDeg = viewLonPrecise;                    // view center longitude (degrees, internal)
  const vLatDeg = viewLatPrecise;                    // view center latitude (degrees)
  const vWidthDeg = viewFovPrecise;                  // horizontal FOV (degrees)
  const vLonDisp = azToDisp(vLonDeg);                // view center longitude (degrees, display)
  const vLon = vLonDeg * DEG, vLat = vLatDeg * DEG, vWidth = vWidthDeg * DEG;
  const vCosL = cos(vLon), vSinL = sin(vLon);
  const vTheta = PI / 2 - vLat;                     // co-latitude of view center
  const vCosT = cos(vTheta), vSinT = sin(vTheta);
  const rEdge = 2 * tan(vWidth / 4);                // stereographic radius at FOV edge
  const scale = chartR / rEdge;                      // pixels per unit stereographic radius
  const magBoost = min(5, Math.log2(180 / vWidthDeg));
  const minFontSize = 12;                            // minimum label font size (pixels)
  const starMagLimit = 5.05 + magBoost;              // faintest star magnitude to draw
  const clipR = 2 * scale;                           // clip circle radius (180° hemisphere, pixels)

  // ---- Rotation matrices (continued) ----
  const mView = mmul(rx(vTheta), rz(vLon));                             // frame coords → view coords
  const M = mmul(mView, mFrame);       // combined: J2000 equatorial → view

  // ---- Projection helpers ----
  // All projection functions operate in the view coordinate system where
  // the view center is at +Z, +X is right, +Y is up on screen.

  // Stereographic chart coords (cX right, cY up) → canvas pixels.
  function toScreen(cX, cY) { return [cx + cX * scale, cy - cY * scale]; }

  // CSS color string for a coordinate frame's overlay elements.
  function frameColor(frame, alpha) {
    const a = alpha || 0.7;
    if (frame === 'horizon') return darkMode ? `rgba(60,160,80,${a})` : `rgba(40,120,55,${a})`;
    if (frame === 'equatorial') return darkMode ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    if (frame === 'ecliptic') return darkMode ? `rgba(140,100,25,${a+0.2})` : `rgba(178,128,25,${a+0.2})`;
    return darkMode ? `rgba(0,220,220,${a})` : `rgba(0,130,130,${a})`;
  }

  // Convert angular size in arcminutes to pixels at a given screen position.
  // Accounts for stereographic projection distortion (objects near edge appear larger).
  function radToPx(sx, sy, rad) {
    const cX = (sx - cx) / scale, cY = (cy - sy) / scale;
    const r2 = cX * cX + cY * cY;
    return rad * scale * (4 + r2) / 4;
  }

  // Project a point in the current frame (lat/lon in radians) to canvas pixels.
  // Returns [sx, sy] or null if the point is behind the projection hemisphere.
  function viewProject(alt, az) {
    const px = cos(alt) * sin(az), py = cos(alt) * cos(az), pz = sin(alt);
    const x1 = vCosL * px - vSinL * py;
    const y1 = vSinL * px + vCosL * py;
    const vy = vCosT * y1 - vSinT * pz;
    const vz = vSinT * y1 + vCosT * pz;
    if (vz < -1e-10) return null;
    const d = 1 + vz;
    return toScreen(2 * x1 / d, -2 * vy / d);
  }

  // Like viewProject but never returns null. Points behind the hemisphere are
  // clamped to a large radius in the correct direction (for drawing continuous
  // lines across the hemisphere boundary, e.g. horizon shading).
  function viewProjectRaw(alt, az) {
    const px = cos(alt) * sin(az), py = cos(alt) * cos(az), pz = sin(alt);
    const x1 = vCosL * px - vSinL * py;
    const y1 = vSinL * px + vCosL * py;
    const vy = vCosT * y1 - vSinT * pz;
    const vz = vSinT * y1 + vCosT * pz;
    const d = 1 + vz;
    if (d < 0.1) {
      const len = sqrt(x1 * x1 + vy * vy);
      if (len < 0.001) return toScreen(0, 0);
      const maxR = 3 * rEdge;
      return toScreen(maxR * x1 / len, -maxR * vy / len);
    }
    return toScreen(2 * x1 / d, -2 * vy / d);
  }

  // Draw a meridian arc in the current frame's grid.
  // mV: view rotation matrix (frame → view). lon: grid longitude (radians).
  // maxLat: arc extends from -maxLat to +maxLat (degrees). Strokes the current path style.
  function drawMeridian(mV, lon, maxLat) {
    const cl = cos(lon), sl = sin(lon);
    let prevPt = null, prevFront = false;
    ctx.beginPath();
    const i0 = round((90 - maxLat) / 5), i1 = 36 - i0;
    for (let i = i0; i <= i1; i++) {
      const lat = PI/2 - i * 5 * DEG;
      const cLat = cos(lat);
      const [qx, qy, qz] = mvmul(mV, cLat * cl, cLat * sl, sin(lat));
      const front = qz > -1e-10;
      const d = max(1 + qz, 0.1);
      const pt = toScreen(2 * qx / d, -2 * qy / d);
      if (prevPt && (front || prevFront)) ctx.lineTo(pt[0], pt[1]);
      else ctx.moveTo(pt[0], pt[1]);
      prevPt = pt; prevFront = front;
    }
    ctx.stroke();
  }

  // Draw a small circle at angular distance `colat` from pole (px,py,pz) in view coords.
  // Used for latitude parallels and reference circles (equator, ecliptic, galactic plane).
  // colat in radians (PI/2 for a great circle). Strokes the current path style.
  function drawGreatCircle(px, py, pz, colat) {
    let ux, uy, uz;
    if (abs(pz) < 0.9) { ux = -py; uy = px; uz = 0; }
    else { ux = 0; uy = -pz; uz = py; }
    const uLen = vmag(ux, uy, uz);
    ux /= uLen; uy /= uLen; uz /= uLen;
    const vx = py*uz - pz*uy, vy = pz*ux - px*uz, vz2 = px*uy - py*ux;
    const sc = sin(colat), cc = cos(colat);
    let prevPt = null, prevFront = false;
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const phi = i * 5 * DEG;
      const cp = cos(phi), sp = sin(phi);
      const qx = cc*px + sc*(cp*ux + sp*vx);
      const qy = cc*py + sc*(cp*uy + sp*vy);
      const qz = cc*pz + sc*(cp*uz + sp*vz2);
      const front = qz > -1e-10;
      const d = max(1 + qz, 0.1);
      const pt = toScreen(2 * qx / d, -2 * qy / d);
      if (prevPt && (front || prevFront)) ctx.lineTo(pt[0], pt[1]);
      else ctx.moveTo(pt[0], pt[1]);
      prevPt = pt; prevFront = front;
    }
    ctx.stroke();
  }

  // Project current-epoch (of-date) RA/Dec to canvas pixels.
  // ra, dec in radians (of date). Un-precesses to J2000, then through full M matrix.
  // Returns [sx, sy] or null if behind the hemisphere.
  function projectEpochRaDec(ra, dec) {
    const [vx, vy, vz] = mvmul(M, ...mvmul(mPT, ...sph2uxyz(ra, dec)));
    if (vz < -1e-10) return null;
    const d = 1 + vz;
    return toScreen(2 * vx / d, -2 * vy / d);
  }

  // Convert a J2000 position angle to a screen angle at a given position.
  // j2kPA: radians, measured from J2000 celestial north through east.
  // vx,vy,vz: object direction in view frame. sx,sy: screen coordinates.
  // Returns the screen angle (canvas coords) of the direction at j2kPA.
  function j2kPAToScreen(j2kPA, vx, vy, vz, sx, sy) {
    const ncpX = M[2], ncpY = M[5], ncpZ = M[8];
    const dp = dot(vx, vy, vz, ncpX, ncpY, ncpZ);
    const t = DEG / sqrt(1 - dp*dp || 1e-20);
    const nx = vx + t*(ncpX - dp*vx);
    const ny = vy + t*(ncpY - dp*vy);
    const nz = vz + t*(ncpZ - dp*vz);
    if (nz <= -1) return -j2kPA;
    const nd = 1 + nz;
    const np = toScreen(2*nx/nd, -2*ny/nd);
    return atan2(np[1] - sy, np[0] - sx) - j2kPA;
  }

  // Inverse stereographic projection: canvas pixels → current frame coordinates.
  // Returns [lat, lon] in radians, or null if the point is outside the hemisphere (r² > 4).
  viewUnproject = function(sx, sy) {
    const cX = (sx - cx) / scale, cY = (cy - sy) / scale;
    const r2 = cX * cX + cY * cY;
    if (r2 > 4) return null;
    const vz = (4 - r2) / (4 + r2);
    const f = 4 / (4 + r2);
    const x1 = f * cX;
    const vy = -f * cY;
    const y1 = vCosT * vy + vSinT * vz;
    const pz = -vSinT * vy + vCosT * vz;
    const px = vCosL * x1 + vSinL * y1;
    const py = -vSinL * x1 + vCosL * y1;
    return [asin(max(-1, min(1, pz))), ((atan2(px, py) + TAU) % TAU)];
  };

  // ---- Label collision avoidance ----
  // Shared across all drawing sub-functions. Labels are placed in the first
  // non-overlapping quadrant (lower-right preferred). labelRects accumulates
  // bounding boxes of all placed labels for the current frame.

  const labelRects = [];
  const LABEL_PAD = 2;
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Place a label near (objX, objY) at distance `radius` from center.
  // Tries four quadrants (LR, UR, UL, LL) and picks the first that doesn't
  // overlap existing labels. Uses the current ctx font and fillStyle.
  function placeLabel(objX, objY, radius, text) {
    const m = ctx.measureText(text);
    const lw = m.width;
    const asc = m.actualBoundingBoxAscent || 10;
    const desc = m.actualBoundingBoxDescent || 2;
    const lh = asc + desc;
    const quadrants = [
      { ang: 315, ox: 0, oy: 0 },
      { ang: 45,  ox: 0, oy: -lh },
      { ang: 135, ox: -lw, oy: -lh },
      { ang: 225, ox: -lw, oy: 0 },
    ];
    let bestRect = null;
    for (let i = 0; i < quadrants.length; i++) {
      const q = quadrants[i];
      const rad = q.ang * DEG;
      const px = objX + radius * cos(rad);
      const py = objY - radius * sin(rad);
      const rect = {
        x: px + q.ox - LABEL_PAD, y: py + q.oy - LABEL_PAD,
        w: lw + 2 * LABEL_PAD, h: lh + 2 * LABEL_PAD
      };
      let overlaps = false;
      for (const r of labelRects) {
        if (rectsOverlap(rect, r)) { overlaps = true; break; }
      }
      if (!overlaps || i === quadrants.length - 1) {
        bestRect = rect;
        break;
      }
    }
    labelRects.push(bestRect);
    const sa = ctx.textAlign, sb = ctx.textBaseline;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, bestRect.x + LABEL_PAD, bestRect.y + LABEL_PAD + asc);
    ctx.textAlign = sa;
    ctx.textBaseline = sb;
  }

  // Place a label centered at (lx, ly). Reserves the bounding box for collision.
  function placeLabelCentered(lx, ly, text) {
    const m = ctx.measureText(text);
    const lw = m.width;
    const asc = m.actualBoundingBoxAscent || 10;
    const desc = m.actualBoundingBoxDescent || 2;
    const lh = asc + desc;
    const rect = {
      x: lx - lw / 2 - LABEL_PAD, y: ly - lh / 2 - LABEL_PAD,
      w: lw + 2 * LABEL_PAD, h: lh + 2 * LABEL_PAD
    };
    labelRects.push(rect);
    const sa = ctx.textAlign, sb = ctx.textBaseline;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx, ly);
    ctx.textAlign = sa;
    ctx.textBaseline = sb;
  }

  // ==== Drawing sub-functions ====
  // Each function draws one layer of the sky map. They close over the local
  // variables above (ctx, M, scale, darkMode, etc.) and share the labelRects
  // array for collision avoidance. Rendering order matters for z-layering.

  // Draw Milky Way band as filled polygons (J2000 galactic coordinates).
  // The Coal Sack (COALSACK_INDEX) is drawn in sky-background color on top.
  function drawMilkyWay() {
    function drawMWPoly(ring) {
      const nv = ring.length / 3;
      if (nv < 3) return;
      const pts = [];
      let anyVisible = false, nearAnticenter = false;
      for (let j = 0; j < nv; j++) {
        const [vx, vy, vz] = mvmul(M, ring[j*3], ring[j*3+1], ring[j*3+2]);
        const d = max(1 + vz, 0.1);
        const pt = toScreen(2*vx/d, -2*vy/d);
        if (vz < -0.9) nearAnticenter = true;
        if (vz > -1e-10 && pt[0] >= 0 && pt[0] <= W && pt[1] >= 0 && pt[1] <= H) anyVisible = true;
        pts.push(pt);
      }
      if (!anyVisible) {
        // At high zoom, all vertices may project off-screen even though the polygon
        // encloses the view center. Screen-space point-in-polygon is only reliable
        // when no vertex is near the view anticenter; vertices with vz < -0.9 project
        // to extreme screen coordinates that wrap around and cause false positives.
        if (!nearAnticenter && pointInPolygon(cx, cy, pts)) ctx.fillRect(0, 0, W, H);
        return;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = darkMode ? '#1a1a1a' : '#e0e0e0';
    for (let i = 0; i < MILKYWAY.length; i++) {
      if (i === COALSACK_INDEX) continue;
      drawMWPoly(MILKYWAY[i]);
    }
    ctx.fillStyle = darkMode ? '#000' : '#fff';
    drawMWPoly(MILKYWAY[COALSACK_INDEX]);
  }

  // Draw the coordinate grid for the current frame: latitude parallels,
  // longitude meridians, and labels for both. Grid spacing adapts to FOV.
  // Longitude labels are placed along the equator (or nearest visible parallel).
  // Latitude labels are placed along the prime meridian if a pole is visible,
  // otherwise along the first meridian visible from the left screen edge.
  function drawGrid() {
    ctx.strokeStyle = frameColor(viewFrame, 0.5);
    ctx.lineWidth = 1;
    const gridPoleX = mView[2], gridPoleY = mView[5], gridPoleZ = mView[8];
    const latStep = vWidthDeg < 20 ? 5 : vWidthDeg < 60 ? 10 : 30;
    const lonStep = vWidthDeg < 20 ? 5 : vWidthDeg < 60 ? 15 : 45;
    // Latitude parallels
    for (let lat = -90 + latStep; lat <= 90 - latStep; lat += latStep) {
      drawGreatCircle(gridPoleX, gridPoleY, gridPoleZ, PI/2 - lat * DEG);
    }
    // Longitude meridians (cardinal meridians extend pole-to-pole)
    const merMaxLat = 90 - latStep;
    for (let lon = 0; lon < 360; lon += lonStep) {
      drawMeridian(mView, lon * DEG, lon % 90 === 0 ? 90 : merMaxLat);
    }
    // Longitude labels along the nearest visible parallel to the equator
    const glfs = max(minFontSize, round(min(W, H) / 85));
    ctx.font = `${glfs}px sans-serif`;
    ctx.fillStyle = frameColor(viewFrame, 0.5);
    const rTop = abs((0 - cy) / scale), rBot = abs((H - cy) / scale);
    const halfFovV = (atan2(rTop, 2) + atan2(rBot, 2)) / DEG;
    const lat = vLatDeg;
    let lonLabelLat;
    if ((lat > 0 && lat - halfFovV < 0) || (lat < 0 && lat + halfFovV > 0) || lat === 0) {
      lonLabelLat = 0;
    } else if (lat > 0) {
      lonLabelLat = ceil((lat - halfFovV) / latStep) * latStep;
    } else {
      lonLabelLat = floor((lat + halfFovV) / latStep) * latStep;
    }
    {
      const llR = lonLabelLat * DEG;
      const cLL = cos(llR), sLL = sin(llR);
      for (let lon = 0; lon < 360; lon += lonStep) {
        const lonR = lon * DEG;
        const cl = cos(lonR), sl = sin(lonR);
        const [qx, qy, qz] = mvmul(mView, cLL * cl, cLL * sl, sLL);
        if (qz < 0) continue;
        const d = 1 + qz;
        const pt = toScreen(2 * qx / d, -2 * qy / d);
        if (pt[0] < 0 || pt[0] > W || pt[1] < 0 || pt[1] > H) continue;
        const dispLon = viewFrame === 'horizon' ? (90 - lon + 360) % 360 : lon;
        let label;
        if (viewFrame === 'equatorial') {
          const totalMin = dispLon * 4;
          const h = floor(totalMin / 60), m = totalMin % 60;
          label = m === 0 ? `${h}h` : `${h}h${p2(m)}m`;
        } else {
          label = `${dispLon}°`;
        }
        placeLabel(pt[0], pt[1], glfs * 0.5, label);
      }
    }
    // Latitude labels along a chosen meridian
    const POLE_NAMES = { horizon: ['Nadir','Zenith'], equatorial: ['SCP','NCP'], ecliptic: ['SEP','NEP'], galactic: ['SGP','NGP'] };
    const poles = POLE_NAMES[viewFrame];
    let poleVisible = false;
    for (const pz of [1, -1]) {
      const qx = mView[2]*pz, qy = mView[5]*pz, qz = mView[8]*pz;
      if (qz < 0) continue;
      const d = 1 + qz;
      const pt = toScreen(2 * qx / d, -2 * qy / d);
      if (pt[0] >= 0 && pt[0] <= W && pt[1] >= 0 && pt[1] <= H) poleVisible = true;
    }
    // Choose meridian: prime (0h / 0°) if pole visible, else first from left screen edge.
    // For horizon frame, prime = 90° internal (= 0° azimuth display).
    // For non-horizon, RA increases leftward so floor() picks first visible from left.
    let labelLonR;
    if (poleVisible) {
      const primeLon = viewFrame === 'horizon' ? 90 : 0;
      labelLonR = primeLon * DEG;
    } else {
      const corner = viewUnproject(0, lat >= 0 ? H : 0);
      const cornerDisp = corner ? azToDisp(corner[1] * RAD) : azToDisp(vLonDeg);
      const nextDisp = viewFrame === 'horizon'
        ? (ceil(cornerDisp / lonStep) * lonStep) % 360
        : (floor(cornerDisp / lonStep) * lonStep + 360) % 360;
      const labelLon = viewFrame === 'horizon' ? mod360(90 - nextDisp) : nextDisp;
      labelLonR = labelLon * DEG;
    }
    // Walk from -90° to +90° (and wrap through the far pole) to label both hemispheres
    const cl = cos(labelLonR), sl = sin(labelLonR);
    for (let lat = -90; lat < 270; lat += latStep) {
      const effLat = lat > 90 ? 180 - lat : lat;
      const latR = lat * DEG;
      const cLat = cos(latR), sLat = sin(latR);
      const [qx, qy, qz] = mvmul(mView, cLat * cl, cLat * sl, sLat);
      if (qz < 0) continue;
      const d = 1 + qz;
      const pt = toScreen(2 * qx / d, -2 * qy / d);
      if (pt[0] < 0 || pt[0] > W || pt[1] < 0 || pt[1] > H) continue;
      const label = effLat === -90 ? poles[0] : effLat === 90 ? poles[1] : `${effLat >= 0 ? '+' : ''}${effLat}°`;
      placeLabel(pt[0], pt[1], glfs * 0.5, label);
    }
  }

  // Draw reference great circles: ecliptic, celestial equator (of date), galactic equator.
  // Each is drawn as a great circle around its respective pole, transformed to view coords.
  function drawRefLines() {
    if (showEcliptic) {
      ctx.strokeStyle = frameColor('ecliptic', 0.9);
      ctx.lineWidth = 2;
      // Ecliptic pole: rotate equatorial pole (0,0,1) by obliquity around X
      const epsRef = j2000 ? obliquity(0) : epsTrue;
      const se = sin(epsRef), ce = cos(epsRef);
      const ejx = mPrecess[3]*(-se) + mPrecess[6]*ce;
      const ejy = mPrecess[4]*(-se) + mPrecess[7]*ce;
      const ejz = mPrecess[5]*(-se) + mPrecess[8]*ce;
      drawGreatCircle(...mvmul(M, ejx, ejy, ejz), PI/2);
    }
    if (showCelEq) {
      ctx.strokeStyle = frameColor('equatorial');
      ctx.lineWidth = 1.5;
      // Celestial pole (of date) = third row of precession matrix
      const cpx = mPrecess[6], cpy = mPrecess[7], cpz = mPrecess[8];
      drawGreatCircle(...mvmul(M, cpx, cpy, cpz), PI/2);
    }
    if (showGalEq) {
      ctx.strokeStyle = frameColor('galactic');
      ctx.lineWidth = 1.5;
      // Galactic north pole (J2000): RA 192.85948°, Dec +27.12825°
      const gRA = 192.85948 * DEG, gDec = 27.12825 * DEG;
      const [gx0, gy0, gz0] = sph2uxyz(gRA, gDec);
      drawGreatCircle(...mvmul(M, gx0, gy0, gz0), PI/2);
    }
  }

  // Transform all catalog stars from J2000 unit vectors to screen positions.
  // Stars fainter than starMagLimit are skipped unless they have an HR number
  // (needed for constellation stick figures). Stars behind the hemisphere are
  // projected but flagged inView=false.
  // Returns {starPositions, spos}: parallel array to STARS, and HR→position map.
  function transformStars() {
    const spos = {};
    const starPositions = [];
    for (const s of STARS) {
      const hr = s[5];
      if (s[2] > starMagLimit && !hr) { starPositions.push(null); continue; }
      const x0 = s[12], y0 = s[13], z0 = s[14];
      const [x1, vy, vz] = mvmul(M, x0, y0, z0);
      let sx, sy;
      const d = 1 + vz;
      if (d < 0.1) {
        const len = sqrt(x1*x1 + vy*vy);
        if (len < 0.001) { sx = cx; sy = cy; }
        else { const maxR = 3 * rEdge; const sc = maxR / len; [sx, sy] = toScreen(sc * x1, -sc * vy); }
      } else {
        [sx, sy] = toScreen(2 * x1 / d, -2 * vy / d);
      }
      const inView = vz > -1e-10 && sx >= 0 && sx <= W && sy >= 0 && sy <= H;
      const p = {sx, sy, inView};
      starPositions.push(p);
      if (hr) spos[hr] = p;
    }
    return {starPositions, spos};
  }

  // Draw constellation stick figures, names, and IAU boundary lines.
  // spos: HR→screen-position map (from transformStars). Lines connect stars by HR number.
  // Boundaries were pre-converted from B1875 to J2000 in skymapInit().
  function drawConstellations(starPositions, spos) {
    if (showConst) {
      ctx.strokeStyle = darkMode ? 'rgba(100,130,180,0.7)' : 'rgba(115,140,184,0.7)';
      ctx.lineWidth = 1;
      for (const con of Object.keys(CONSTELLATIONS)) {
        for (const [h1, h2] of CONSTELLATIONS[con].lines) {
          const p1 = spos[h1], p2 = spos[h2];
          if (!p1 || !p2 || (!p1.inView && !p2.inView)) continue;
          ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
        }
      }
    }
    if (showConstNames) {
      ctx.font = `italic ${max(minFontSize,round(min(W,H)/70))}px sans-serif`;
      ctx.fillStyle = darkMode ? 'rgba(130,140,210,0.75)' : 'rgba(60,60,130,0.75)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const c of CON_CENTERS) {
        const ccx = c[4], ccy = c[5], ccz = c[6];
        const [x1, vy, vz] = mvmul(M, ccx, ccy, ccz);
        if (vz < -1e-10) continue;
        const d = 1 + vz;
        const pt = toScreen(2 * x1 / d, -2 * vy / d);
        if (pt[0] < 0 || pt[0] > W || pt[1] < 0 || pt[1] > H) continue;
        placeLabelCentered(pt[0], pt[1], c[2]);
      }
      ctx.textBaseline = 'alphabetic';
    }
    if (showBounds) {
      ctx.strokeStyle = darkMode ? 'rgba(100,130,180,0.7)' : 'rgba(115,140,184,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (const con of Object.keys(BOUNDARIES)) {
        const verts = BOUNDARIES[con];
        const nv = verts.length / 3;
        let anyInView = false;
        const pts = [];
        for (let i = 0; i < nv; i++) {
          const x0 = verts[i*3], y0 = verts[i*3+1], z0 = verts[i*3+2];
          const [x1, vy, vz] = mvmul(M, x0, y0, z0);
          const d = 1 + vz;
          if (d < 0.5) { pts.push(null); continue; }
          const pt = toScreen(2 * x1 / d, -2 * vy / d);
          const inView = pt[0] >= 0 && pt[0] <= W && pt[1] >= 0 && pt[1] <= H;
          if (inView) anyInView = true;
          pts.push(pt);
        }
        if (!anyInView) continue;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= nv; i++) {
          const pt = pts[i % nv];
          if (!pt) { started = false; continue; }
          if (!started) { ctx.moveTo(pt[0], pt[1]); started = true; }
          else ctx.lineTo(pt[0], pt[1]);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  // Draw deep sky objects with type-specific symbols and optional labels.
  // Symbols: OC=dashed circle, GC=circle+cross, BN=square, DN=diamond,
  // PN=circle+ticks, GX=ellipse. Size from catalog (arcmin) or 5px default.
  // Adds each visible object to drawnObjects for hit-testing.
  function drawDeepSky() {
    const dsColor = darkMode ? 'rgba(200,200,200,0.8)' : 'rgba(80,80,80,0.8)';
    ctx.strokeStyle = dsColor;
    ctx.lineWidth = 1;
    const skipContours = new Set([37, 79]); // IC 434 extended, M 8 extended
    function drawDSContours(cis) {
      const rings = [];
      for (const ci of cis) {
        if (skipContours.has(ci)) continue;
        const ring = NEBULA_CONTOURS[ci];
        const nv = ring.length / 3;
        if (nv < 3) continue;
        const pts = [];
        ctx.beginPath();
        for (let j = 0; j < nv; j++) {
          const [cx, cy, cz] = mvmul(M, ring[j*3], ring[j*3+1], ring[j*3+2]);
          const cd = max(1 + cz, 0.1);
          const cp = toScreen(2*cx/cd, -2*cy/cd);
          pts.push(cp);
          if (j === 0) ctx.moveTo(cp[0], cp[1]); else ctx.lineTo(cp[0], cp[1]);
        }
        ctx.closePath(); ctx.stroke();
        rings.push(pts);
      }
      return rings;
    }
    const dsPositions = [];
    const dsMagLimit = starMagLimit + 4;
    for (let dsi = 0; dsi < DEEPSKY.length; dsi++) { const ds = DEEPSKY[dsi];
      if (vWidthDeg > 45 && !ds[8]) { dsPositions.push(null); continue; }
      if (vWidthDeg >= 10 && !ds[8] && (ds[3] == null || ds[3] > dsMagLimit)) { dsPositions.push(null); continue; }
      const x0 = ds[12], y0 = ds[13], z0 = ds[14];
      const [x1, vy, vz] = mvmul(M, x0, y0, z0);
      if (vz < -1e-10) { dsPositions.push(null); continue; }
      const d = 1 + vz;
      const pt = toScreen(2 * x1 / d, -2 * vy / d);
      const dsSize = ds[5];
      const r = dsSize ? max(5, radToPx(pt[0], pt[1], dsSize * DEG / 60) / 2) : 5;
      // Enlarge the cull rectangle by the object's radius (major axis) so
      // extended objects aren't culled just because their center is off-canvas.
      if (pt[0] < -r || pt[0] > W + r || pt[1] < -r || pt[1] > H + r) { dsPositions.push(null); continue; }
      dsPositions.push({x: pt[0], y: pt[1], r});
      const dObj = {x: pt[0], y: pt[1], r, type: 'deepsky', idx: dsi, data: ds, jx: x0, jy: y0, jz: z0};
      const typ = ds[0];
      ctx.strokeStyle = dsColor;
      if (typ === 'OC') {
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(pt[0], pt[1], r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        if (dsContours[dsi]) dObj.contourPts = drawDSContours(dsContours[dsi]);
      } else if (typ === 'GC') {
        ctx.beginPath(); ctx.arc(pt[0], pt[1], r, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pt[0] - r, pt[1]); ctx.lineTo(pt[0] + r, pt[1]); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pt[0], pt[1] - r); ctx.lineTo(pt[0], pt[1] + r); ctx.stroke();
      } else if (typ === 'BN') {
        if (dsContours[dsi]) dObj.contourPts = drawDSContours(dsContours[dsi]);
        else if (ds[3] != null || !dsSize || dsSize < 60) ctx.strokeRect(pt[0] - r, pt[1] - r, 2 * r, 2 * r);
      } else if (typ === 'DN') {
        if (dsContours[dsi]) dObj.contourPts = drawDSContours(dsContours[dsi]);
        else {
          ctx.beginPath();
          ctx.moveTo(pt[0], pt[1] - r); ctx.lineTo(pt[0] + r, pt[1]);
          ctx.lineTo(pt[0], pt[1] + r); ctx.lineTo(pt[0] - r, pt[1]);
          ctx.closePath(); ctx.stroke();
        }
      } else if (typ === 'PN') {
        ctx.beginPath(); ctx.arc(pt[0], pt[1], r, 0, TAU); ctx.stroke();
        const t = 2 * r;
        ctx.beginPath(); ctx.moveTo(pt[0] - t, pt[1]); ctx.lineTo(pt[0] - r, pt[1]); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pt[0] + r, pt[1]); ctx.lineTo(pt[0] + t, pt[1]); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pt[0], pt[1] - t); ctx.lineTo(pt[0], pt[1] - r); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pt[0], pt[1] + r); ctx.lineTo(pt[0], pt[1] + t); ctx.stroke();
      } else if (typ === 'GX') {
        const minorSize = ds[6];
        if (minorSize) {
          const rMinor = max(3, radToPx(pt[0], pt[1], minorSize * DEG / 60) / 2);
          const pa = ds[7];
          const rot = pa != null ? j2kPAToScreen(pa * DEG, x1, vy, vz, pt[0], pt[1]) : 0;
          ctx.beginPath(); ctx.ellipse(pt[0], pt[1], r, rMinor, rot, 0, TAU); ctx.stroke();
          dObj.rMinor = rMinor; dObj.rot = rot;
        } else {
          ctx.beginPath(); ctx.arc(pt[0], pt[1], r, 0, TAU); ctx.stroke();
        }
      } else {
        ctx.beginPath(); ctx.arc(pt[0], pt[1], r, 0, TAU); ctx.stroke();
      }
      drawnObjects.push(dObj);
    }
    if (showDeepSkyNames || showDeepSkyIds) {
      ctx.font = `${max(minFontSize,round(min(W,H)/85))}px sans-serif`;
      ctx.fillStyle = dsColor;
      ctx.textAlign = 'left';
      const dsLabelMagLimit = dsMagLimit - 2;
      for (let i = 0; i < DEEPSKY.length; i++) {
        if (!dsPositions[i]) continue;
        const p = dsPositions[i];
        const mcId = DEEPSKY[i][8];
        const ngcic = DEEPSKY[i][9];
        const name = DEEPSKY[i][11];
        const isMC = !!mcId;
        const labelOk = isMC || dsContours[i] || vWidthDeg < 3 || (DEEPSKY[i][3] != null && DEEPSKY[i][3] <= dsLabelMagLimit);
        if (showDeepSkyIds && labelOk) placeLabel(p.x, p.y, p.r + 3, mcId || ngcic || '');
        if (showDeepSkyNames && labelOk && name) placeLabel(p.x, p.y, p.r + 3, name);
      }
    }
  }

  // Piecewise linear B-V to RGB: cyan → white → yellow → red.
  function bmvToRGB(bv) {
    if (bv === 0) return '#fff';
    let R, G, B;
    if (bv < -0.3) {
      R = 0; G = 255; B = 255;
    } else if (bv < 0) {
      const t = (bv + 0.3) / 0.3;
      R = round(255 * t); G = 255; B = round(255 * (1 - t) + 255 * t);
    } else if (bv < 1.0) {
      const t = bv;
      R = 255; G = 255; B = round(255 * (1 - t));
    } else if (bv < 3.0) {
      const t = (bv - 1.0) / 2.0;
      R = 255; G = round(255 * (1 - t)); B = 0;
    } else {
      R = 255; G = 0; B = 0;
    }
    return `rgb(${R},${G},${B})`;
  }

  // Draw star dots and optional name/designation labels.
  // Dot radius scales with magnitude and canvas size. Adds each visible star
  // to drawnObjects for hit-testing. Labels only for stars brighter than ~mag 2.
  function drawStars(starPositions) {
    for (let i = 0; i < starPositions.length; i++) {
      const p = starPositions[i];
      if (!p || !p.inView) continue;
      const s = STARS[i];
      const mag = s[2], bmv = s[3], hr = s[5];
      if (mag > starMagLimit) continue;
      const r = max(0.5, (5.5 + magBoost - mag) * min(W, H) / 1000);
      ctx.fillStyle = darkMode && showStarColors ? bmvToRGB(bmv) : darkMode ? '#fff' : '#000';
      ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, TAU); ctx.fill();
      drawnObjects.push({x: p.sx, y: p.sy, r, type: 'star', name: s[10], hr, data: s, jx: s[12], jy: s[13], jz: s[14]});
    }
    if (showNames || showStarIds) {
      ctx.font = `${max(minFontSize,round(min(W,H)/85))}px sans-serif`;
      ctx.fillStyle = darkMode ? '#fff' : '#000';
      ctx.textAlign = 'left';
      for (let i = 0; i < starPositions.length; i++) {
        const p = starPositions[i];
        if (!p || !p.inView) continue;
        const s = STARS[i];
        const mag = s[2], bayer = s[8], flamsteed = s[9], name = s[10];
        if (mag > 2.02 + 1.5 * magBoost) continue;
        const r = max(0.5, (5.5 + magBoost - mag) * min(W, H) / 1000);
        const desig = showStarIds ? formatDesignation(bayer, flamsteed) : '';
        if (desig) placeLabel(p.sx, p.sy, r + 3, desig);
        if (showNames && name) placeLabel(p.sx, p.sy, r + 3, name);
      }
    }
  }

  // Update the solar system position cache. Called when JD or observer location changes.
  // Computes J2000 equatorial unit vectors for all solar system bodies.
  function updateSSCache() {
    if (jd === ssCacheJD && loc.latRad === ssCacheLat && loc.lonDeg === ssCacheLon) return;
    ssCacheJD = jd;
    ssCacheLat = loc.latRad;
    ssCacheLon = loc.lonDeg;
    ssCache = [];

    // JDE = Julian Ephemeris Date (dynamical time). VSOP87 and Meeus lunar theory
    // use JDE; sidereal time uses JD (UT). Delta-T is TDT - UT in seconds.
    const decYear = 2000 + daysSinceJ2000 / 365.25;
    const jde = jd + deltaT(decYear) / 86400;
    const d = jde - 2451545.0;                     // days since J2000.0 in dynamical time
    const tau = d / 365250;                        // Julian millennia from J2000 (VSOP87)

    // Three rotation matrices convert solar system positions to J2000 equatorial:
    //
    // mEcl2J2000 = P^T · Rx(ε_mean)
    //   Ecliptic of-date → J2000 equatorial. Used for VSOP87 planets, Sun, Pluto.
    //   Rx(ε_mean) rotates ecliptic of-date to mean equatorial of-date;
    //   P^T (inverse IAU 1976 precession) rotates mean equatorial of-date to J2000.
    //
    // mNP = N · P (nutation · precession)
    //   Its transpose (N·P)^T converts true equatorial of-date → J2000 equatorial.
    //   Used for the Moon after topocentric correction (which operates in
    //   true equatorial of-date using apparent sidereal time).
    //
    // mJ2kEcl2Eq = Rx(ε_J2000)
    //   J2000 ecliptic → J2000 equatorial. A constant rotation by J2000 mean
    //   obliquity (23.439°). Used for asteroids/comets whose MPC orbital elements
    //   are referred to the J2000 ecliptic.
    const epsMean = obliquity(T);
    const sspp = precessAngles(T);
    const cTheta = cos(sspp.thetaA), sTheta = sin(sspp.thetaA);
    const mPY = [cTheta,0,-sTheta, 0,1,0, sTheta,0,cTheta];
    const mP = mmul(rz(sspp.zA), mmul(mPY, rz(sspp.zetaA)));
    const mEcl2J2000 = mmul(mtranspose(mP), rx(epsMean));
    const mNP = mmul(mmul(rx(-epsTrue), mmul(rz(-nut.dPsi), rx(epsMean))), mP);
    const mJ2kEcl2Eq = rx(obliquity(0));

    // Sun position from VSOP87 Earth
    const earth = vsop87Position('EARTH', tau);
    const sunLon = mod2pi(earth.L + PI);
    const sunLat = -earth.B;
    const sunR = earth.R;
    const [sx, sy, sz] = mvmul(mEcl2J2000, ...sph2uxyz(sunLon, sunLat));
    ssCache.push({ type:'sun', name:'Sun', x:sx, y:sy, z:sz,
      mag:-26.74, angRad:(SUN_DIAM1AU / sunR) / 3600 * DEG / 2, dist:sunR });

    // Earth heliocentric Cartesian (ecliptic of-date) for planet geocentric conversion
    const earthX = earth.R * cos(earth.B) * cos(earth.L);
    const earthY = earth.R * cos(earth.B) * sin(earth.L);
    const earthZ = earth.R * sin(earth.B);

    // Earth heliocentric J2000 equatorial (for asteroid/comet geocentric conversion)
    const [earthEqX, earthEqY, earthEqZ] = mvmul(mEcl2J2000, ...sph2xyz(earth.L, earth.B, earth.R));

    // Light-time correction: compute geometric geocentric distance, then recompute
    // body position at retarded time (t - Δ/c). One iteration is sufficient.
    const LIGHT_TIME_AU = 0.0057755183;  // days per AU (499.005 seconds)

    // VSOP87 planets (Mercury through Neptune)
    // Schlyter index used for cheap first-pass distance estimate (light-time)
    const VSOP_PLANETS = [
      ['MERCURY','Mercury',0], ['VENUS','Venus',1], ['MARS','Mars',2],
      ['JUPITER','Jupiter',3], ['SATURN','Saturn',4], ['URANUS','Uranus',5], ['NEPTUNE','Neptune',6]
    ];
    for (const [vsopKey, name, si] of VSOP_PLANETS) {
      // Cheap Schlyter position for light-time estimate
      const s0 = planetHelioEcl(PLANETS[si].elems(d + 1.5));
      const [sx, sy, sz] = sph2xyz(s0.lon, s0.lat, s0.r);
      const lt = vmag(sx-earthX, sy-earthY, sz-earthZ) * LIGHT_TIME_AU;
      // Accurate VSOP87 position at retarded time
      const h = vsop87Position(vsopKey, tau - lt / 365250);
      const hx = h.R * cos(h.B) * cos(h.L);
      const hy = h.R * cos(h.B) * sin(h.L);
      const hz = h.R * sin(h.B);
      const px = hx - earthX, py = hy - earthY, pz = hz - earthZ;
      const [geoLon, geoLat] = uxyz2sph(px, py, pz);
      const geoDist = vmag(px, py, pz);
      const { FV } = phaseElongation(sunR, geoDist, h.R);
      const FVdeg = FV * RAD;
      // d + 1.5: Schlyter functions use epoch JD 2451543.5 (1.5 days before J2000)
      const ringMagn = name === 'Saturn' ? saturnRingMagn(geoLon, geoLat, d + 1.5) : 0;
      const [jx, jy, jz] = mvmul(mEcl2J2000, ...sph2uxyz(geoLon, geoLat));
      const entry = { type:'planet', name, x:jx, y:jy, z:jz,
        mag: planetMag(name, h.R, geoDist, FVdeg, ringMagn),
        symbol: PLANET_SYMBOLS[name],
        helioDist:h.R, geoDist, phaseAngle:FV,
        angRad: (PLANET_DIAM1AU[name] || 0) / geoDist / 3600 * DEG / 2 };
      const ori = planetOrientation(name, d - lt, jx, jy, jz);
      if (ori) {
        entry.subObsLat = ori.subObsLat;
        entry.subObsLon = ori.subObsLon;
        entry.polePA = ori.polePA;
      }
      ssCache.push(entry);
    }

    // Pluto via Schlyter (not in VSOP87)
    const plutoH0 = planetHelioEcl(PLANETS[7].elems(d + 1.5));
    const [p0x, p0y, p0z] = sph2xyz(plutoH0.lon, plutoH0.lat, plutoH0.r);
    const plutoLt = vmag(p0x-earthX, p0y-earthY, p0z-earthZ) * LIGHT_TIME_AU;
    const plutoH = planetHelioEcl(PLANETS[7].elems(d + 1.5 - plutoLt));
    const [phx, phy, phz] = sph2xyz(plutoH.lon, plutoH.lat, plutoH.r);
    const ppx = phx - earthX, ppy = phy - earthY, ppz = phz - earthZ;
    const [plutoGeoLon, plutoGeoLat] = uxyz2sph(ppx, ppy, ppz);
    const plutoDist = vmag(ppx, ppy, ppz);
    const { FV: plutoFV } = phaseElongation(sunR, plutoDist, plutoH.r);
    const [pjx, pjy, pjz] = mvmul(mEcl2J2000, ...sph2uxyz(plutoGeoLon, plutoGeoLat));
    const plutoEntry = { type:'planet', name:'Pluto', x:pjx, y:pjy, z:pjz,
      mag: planetMag('Pluto', plutoH.r, plutoDist, plutoFV * RAD, 0),
      symbol: PLANET_SYMBOLS['Pluto'],
      helioDist:plutoH.r, geoDist:plutoDist, phaseAngle:plutoFV,
      angRad: (PLANET_DIAM1AU['Pluto'] || 0) / plutoDist / 3600 * DEG / 2 };
    const plutoOri = planetOrientation('Pluto', d - plutoLt, pjx, pjy, pjz);
    if (plutoOri) {
      plutoEntry.subObsLat = plutoOri.subObsLat;
      plutoEntry.subObsLon = plutoOri.subObsLon;
      plutoEntry.polePA = plutoOri.polePA;
    }
    ssCache.push(plutoEntry);

    // Observer geocentric position in Earth-radii (WGS84 ellipsoid)
    const [obsX, obsY, obsZ] = geocentricXYZ(lstR, loc.latRad);

    // Moon: ecliptic of-date → true equatorial → topocentric → J2000
    const moonPos = moonPositionMeeus(d);
    const moonAngArcmin = (MOON_DIAM_FACTOR / moonPos.dist) / 60;
    const [moonGRA, moonGDec] = eclToEq(moonPos.lon, moonPos.lat, epsTrue);
    const [moonBx, moonBy, moonBz] = sph2xyz(moonGRA, moonGDec, moonPos.dist);
    const [topoRA, topoDec, topoDistER] = topocentricCorrectionXYZ(moonBx, moonBy, moonBz, obsX, obsY, obsZ);
    const [mx, my, mz] = mvmul(mtranspose(mNP), ...sph2uxyz(topoRA, topoDec));
    const moonElong = mod2pi(moonPos.lon - sunLon);
    const moonFV = abs(PI - moonElong);
    const moonEntry = { type:'moon', name:'Moon', x:mx, y:my, z:mz,
      mag: moonMag(sunR, moonPos.dist, moonFV * RAD),
      angRad: moonAngArcmin / 60 * DEG / 2, dist: topoDistER * 6378.14, phaseAngle: moonFV };
    const moonOri = planetOrientation('Moon', d, mx, my, mz);
    if (moonOri) {
      moonEntry.subObsLat = moonOri.subObsLat;
      moonEntry.subObsLon = moonOri.subObsLon;
      moonEntry.polePA = moonOri.polePA;
    }

    // Earth's shadow on the Moon (only when Moon is near the antisolar point)
    if (dot(mx, my, mz, sx, sy, sz) < -0.9) {
      const EARTH_RAD_AU = 6378.14 / KM_PER_AU;
      const moonGeoDistAU = moonPos.dist * EARTH_RAD_AU;
      // Umbral/penumbral radii (AU) at Moon's geocentric distance
      const shadow = shadowRadii(EARTH_RAD_AU, moonGeoDistAU, sunR);
      // Angular radii (radians) as seen from Earth
      moonEntry.umbraAngRad = shadow.umbra / moonGeoDistAU;
      moonEntry.penumbraAngRad = shadow.penumbra / moonGeoDistAU;
      // Shadow center: antisolar direction in equatorial of-date, at Moon's
      // geocentric distance (Earth-radii), with topocentric correction applied
      // the same way as the Moon itself, then converted to J2000 unit vector.
      const [sunEqRA, sunEqDec] = eclToEq(sunLon, sunLat, epsTrue);
      const [shBx, shBy, shBz] = sph2xyz(sunEqRA + PI, -sunEqDec, moonPos.dist);
      const [shTopoRA, shTopoDec] = topocentricCorrectionXYZ(shBx, shBy, shBz, obsX, obsY, obsZ);
      const [shx, shy, shz] = mvmul(mtranspose(mNP), ...sph2uxyz(shTopoRA, shTopoDec));
      moonEntry.shadowX = shx;
      moonEntry.shadowY = shy;
      moonEntry.shadowZ = shz;
    }

    ssCache.push(moonEntry);

    // Comets: J2000 ecliptic elements → J2000 equatorial via Cartesian subtraction
    if (params.comets) {
      for (const c of params.comets) {
        const ch0 = cometPosition(c, d + 1.5, true);
        const [c0x, c0y, c0z] = mvmul(mJ2kEcl2Eq, ...sph2xyz(ch0.lon, ch0.lat, ch0.r));
        const lt = vmag(c0x-earthEqX, c0y-earthEqY, c0z-earthEqZ) * LIGHT_TIME_AU;
        const h = cometPosition(c, d + 1.5 - lt, true);
        const [hEqX, hEqY, hEqZ] = mvmul(mJ2kEcl2Eq, ...sph2xyz(h.lon, h.lat, h.r));
        const gx = hEqX - earthEqX, gy = hEqY - earthEqY, gz = hEqZ - earthEqZ;
        const geoDist = vmag(gx, gy, gz);
        const cmag = cometMagnitude(c.H, c.k, h.r, geoDist);
        ssCache.push({ type:'comet', name:c.name,
          x:gx/geoDist, y:gy/geoDist, z:gz/geoDist,
          mag:cmag, helioDist:h.r, geoDist });
      }
    }

    // Asteroids: J2000 ecliptic elements → J2000 equatorial via Cartesian subtraction
    if (params.asteroids) {
      for (const a of params.asteroids) {
        const ah0 = asteroidPosition(a, d + 1.5, true);
        const [a0x, a0y, a0z] = mvmul(mJ2kEcl2Eq, ...sph2xyz(ah0.lon, ah0.lat, ah0.r));
        const lt = vmag(a0x-earthEqX, a0y-earthEqY, a0z-earthEqZ) * LIGHT_TIME_AU;
        const h = asteroidPosition(a, d + 1.5 - lt, true);
        const [hEqX, hEqY, hEqZ] = mvmul(mJ2kEcl2Eq, ...sph2xyz(h.lon, h.lat, h.r));
        const gx = hEqX - earthEqX, gy = hEqY - earthEqY, gz = hEqZ - earthEqZ;
        const geoDist = vmag(gx, gy, gz);
        const { FV } = phaseElongation(sunR, geoDist, h.r);
        const amag = asteroidMagnitude(a.H, a.G, h.r, geoDist, FV);
        ssCache.push({ type:'asteroid', name:a.name,
          x:gx/geoDist, y:gy/geoDist, z:gz/geoDist,
          mag:amag, helioDist:h.r, geoDist, phaseAngle:FV });
      }
    }

    // Satellites: SGP4 gives TEME (equatorial of date) in Earth-radii.
    // Use JD (UTC), not JDE — satellite epochs are UTC.
    if (params.satellites) {
      const [sunTx, sunTy, sunTz] = mvmul(mNP, sx, sy, sz);
      for (const sat of params.satellites) {
        const tsince = (jd - sat.epoch) * 1440;
        if (abs(tsince) > 40320) continue;
        try {
          const rv = sgp4Propagate(sat, tsince);
          const [gx, gy, gz] = rv.pos;
          const mag = satApparentMag(sat.norad, gx, gy, gz,
            obsX, obsY, obsZ, sunTx, sunTy, sunTz);
          if (!isFinite(mag)) continue;
          const [satTopoRA, satTopoDec, satTopoER] = topocentricCorrectionXYZ(gx, gy, gz, obsX, obsY, obsZ);
          const [jx, jy, jz] = mvmul(mtranspose(mNP), ...sph2uxyz(satTopoRA, satTopoDec));
          ssCache.push({ type:'satellite', name:sat.name, mag,
            // WGS72 radius (6378.135 km), not WGS84 — SGP4 assumes WGS72; using WGS84 shifts positions by tens of meters at GEO range.
            x:jx, y:jy, z:jz, dist:satTopoER * 6378.135 });
        } catch(e) {}
      }
    }

    // Planetary moons: ESAA3 ch.9 theories return planetocentric J2000 equatorial AU.
    // Add to parent's geocentric J2000 Cartesian position, convert to unit vector.
    // Phoebe and Nereid use Keplerian orbits (ESAA formulae are inaccurate for these).
    const KEPLER_MOONS = ['Phoebe', 'Nereid'];
    const MOON_FUNCS = [
      ['Mars', marsMoons], ['Jupiter', jupiterMoons], ['Saturn', saturnMoons],
      ['Uranus', uranusMoons], ['Neptune', neptuneMoons], ['Pluto', plutoMoons]
    ];
    for (const [parentName, moonFunc] of MOON_FUNCS) {
      const primary = ssCache.find(o => o.type === 'planet' && o.name === parentName);
      if (!primary) continue;
      const pgx = primary.x * primary.geoDist;
      const pgy = primary.y * primary.geoDist;
      const pgz = primary.z * primary.geoDist;
      const ltJde = jde - primary.geoDist * LIGHT_TIME_AU;
      const pmoons = moonFunc(ltJde);
      const psx = sx * sunR - pgx, psy = sy * sunR - pgy, psz = sz * sunR - pgz;
      const psd = vmag(psx, psy, psz);
      const psux = psx / psd, psuy = psy / psd, psuz = psz / psd;
      const phys = PLANET_PHYS[parentName];
      const planetR = phys ? phys.radius / KM_PER_AU : 0;
      for (const pm of pmoons) {
        if (KEPLER_MOONS.includes(pm.name)) Object.assign(pm, moonPositionKepler(pm.name, ltJde));
        const gx = pgx + pm.x, gy = pgy + pm.y, gz = pgz + pm.z;
        const gd = vmag(gx, gy, gz);
        let mag = planetMoonMagnitude(pm.name, primary.helioDist, gd);
        if (inUmbralShadow(pm.x, pm.y, pm.z, psux, psuy, psuz, planetR, SUN_RADIUS_AU, psd))
          mag = Infinity;
        const pmd = MOON_DATA[pm.name];
        ssCache.push({ type:'planetmoon', name:pm.name, parent:parentName,
          x:gx/gd, y:gy/gd, z:gz/gd, geoDist:gd, mag,
          angRad: pmd && pmd.radius ? pmd.radius / (gd * KM_PER_AU) : 0 });
      }
    }

    // Moon shadows on planets: compute shadow center and angular radii for
    // each moon. Shadow center = point in the same heliocentric direction as
    // the moon, at the parent planet's heliocentric distance.
    const SHADOW_MOONS = { Jupiter: ['Io', 'Europa', 'Ganymede', 'Callisto'], Saturn: ['Tethys', 'Dione', 'Rhea', 'Titan'] };
    for (const parentName of Object.keys(SHADOW_MOONS)) {
      const primary = ssCache.find(o => o.type === 'planet' && o.name === parentName);
      if (!primary) continue;
      const filter = SHADOW_MOONS[parentName];
      const moons = ssCache.filter(o => o.type === 'planetmoon' && o.parent === parentName
        && (!filter || filter.includes(o.name)));
      primary.shadows = [];
      for (const moon of moons) {
        const md = MOON_DATA[moon.name];
        if (!md || !md.radius) continue;
        const moonRadAU = md.radius / KM_PER_AU;
        // Planetocentric offset (AU) = moon geocentric - planet geocentric
        const pmx = moon.x * moon.geoDist - primary.x * primary.geoDist;
        const pmy = moon.y * moon.geoDist - primary.y * primary.geoDist;
        const pmz = moon.z * moon.geoDist - primary.z * primary.geoDist;
        const D = vmag(pmx, pmy, pmz);
        const sh = shadowRadii(moonRadAU, D, primary.helioDist);
        // Moon heliocentric J2000 (AU) = geocentric - Sun geocentric
        const mhx = moon.x * moon.geoDist - sx * sunR;
        const mhy = moon.y * moon.geoDist - sy * sunR;
        const mhz = moon.z * moon.geoDist - sz * sunR;
        const mhd = vmag(mhx, mhy, mhz);
        // Shadow only falls on planet if moon is closer to Sun than planet
        if (mhd >= primary.helioDist) continue;
        // Shadow center heliocentric = normalize(moonHelio) * planetHelioDist;
        // convert back to geocentric by adding Sun geocentric position
        const scale = primary.helioDist / mhd;
        const sgx = mhx * scale + sx * sunR;
        const sgy = mhy * scale + sy * sunR;
        const sgz = mhz * scale + sz * sunR;
        const sgd = vmag(sgx, sgy, sgz);
        // Store as J2000 unit vector; angular radii = physical radius / geocentric dist
        primary.shadows.push({
          x: sgx / sgd, y: sgy / sgd, z: sgz / sgd,
          umbraAngRad: sh.umbra / primary.geoDist,
          penumbraAngRad: sh.penumbra / primary.geoDist
        });
      }
    }

    // Sort farthest first for correct painter's algorithm occlusion.
    for (const o of ssCache) o._d = o.geoDist ?? (o.type === 'sun' ? o.dist : o.dist / KM_PER_AU);
    ssCache.sort((a, b) => b._d - a._d);
  }

  // Draw one half of Saturn's ring (front=true or back=false).
  // Ring is the area between two concentric ellipses (outer/inner radii),
  // rotated by position angle pa, flattened by sin(|B|).
  // When B>0 (north face visible), back=top half, front=bottom half; B<0 reverses.
  function drawSaturnRing(sx, sy, outerR, innerR, subObsLat, pa, color, front) {
    const sinB = abs(sin(subObsLat));
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-pa);
    // Near edge-on, the filled ellipse collapses to sub-pixel height.
    // Draw a single line across the full ring diameter instead; only on
    // the front pass so it renders on top of the planet disc.
    if (sinB < 0.003) {
      if (!front) { ctx.restore(); return; }
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-outerR, 0); ctx.lineTo(outerR, 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }
    const backIsTop = subObsLat > 0;
    const drawTop = front !== backIsTop;
    const startA = drawTop ? 0 : PI, endA = drawTop ? PI : TAU;
    const steps = 32;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = startA + (endA - startA) * i / steps;
      const x = outerR * cos(a), y = outerR * sinB * sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = steps; i >= 0; i--) {
      const a = startA + (endA - startA) * i / steps;
      ctx.lineTo(innerR * cos(a), innerR * sinB * sin(a));
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Draw a phase-shaded disc: dark side first, then lit crescent/gibbous.
  // FVrad = phase angle in radians (0 = full, PI = new). litColor = color for lit side.
  // toSunAngle = screen-space angle from planet toward Sun (radians, math convention).
  // Optional oblateness (0–1) and polePA (radians) for oblate planets.
  function drawPhaseDisc(sx, sy, r, FVrad, toSunAngle, litColor, oblateness, polePA) {
    const ob = oblateness || 0;
    const pa = polePA || 0;
    const yScale = 1 - ob;
    if (ob > 0) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-pa);
      ctx.scale(1, yScale);
    }
    const cx0 = ob > 0 ? 0 : sx, cy0 = ob > 0 ? 0 : sy;
    let toSun;
    if (ob > 0) {
      const sdx = cos(toSunAngle), sdy = -sin(toSunAngle);
      const lsx = cos(pa)*sdx - sin(pa)*sdy;
      const lsy = (sin(pa)*sdx + cos(pa)*sdy) / yScale;
      toSun = atan2(-lsy, lsx);
    } else {
      toSun = toSunAngle;
    }
    ctx.fillStyle = darkMode ? '#333' : '#555';
    ctx.beginPath(); ctx.arc(cx0, cy0, r, 0, TAU); ctx.fill();
    if (FVrad < PI - 0.05) {
      const cs = cos(toSun), sn = sin(toSun), k = -cos(FVrad);
      ctx.fillStyle = litColor;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const t = PI/2 - i*PI/24;
        const bx = r*cos(t), by = r*sin(t);
        const px = cx0 + bx*cs - by*sn, py = cy0 - bx*sn - by*cs;
        if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      for (let i = 0; i <= 24; i++) {
        const t = -PI/2 + i*PI/24;
        const bx = r*k*cos(t), by = r*sin(t);
        const px = cx0 + bx*cs - by*sn, py = cy0 - bx*sn - by*cs;
        ctx.lineTo(px,py);
      }
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = darkMode ? '#666' : '#888'; ctx.lineWidth = ob > 0 ? 0.5 / yScale : 0.5;
    ctx.beginPath(); ctx.arc(cx0, cy0, r, 0, TAU); ctx.stroke();
    if (ob > 0) ctx.restore();
  }

  // Draw a planetographic lat/lon grid on a planet's disc via orthographic projection.
  // sx, sy = planet screen center (pixels). r = equatorial disc radius (pixels).
  // polePA = screen angle of the planet's north pole (radians, from j2kPAToScreen).
  // oblateness = apparent flattening (0–1, already scaled by cos(subObsLat)).
  // subObsLat = sub-observer planetographic latitude (radians).
  // subObsLon = sub-observer planetographic longitude (degrees).
  function drawPlanetGrid(sx, sy, r, polePA, oblateness, subObsLat, subObsLon) {
    const ob = oblateness || 0;
    const pa = polePA || 0;
    const yScale = 1 - ob;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-pa);
    ctx.scale(1, yScale);
    ctx.lineWidth = 0.5 / yScale;

    const phi0 = -subObsLat, lam0 = subObsLon;
    const sinPhi0 = sin(phi0), cosPhi0 = cos(phi0);

    function gridLine(points) {
      ctx.beginPath();
      let started = false;
      for (const [xd, yd, zc] of points) {
        if (zc > 0.001) {
          if (!started) { ctx.moveTo(xd * r, -yd * r); started = true; }
          else ctx.lineTo(xd * r, -yd * r);
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }

    // Latitude lines at ±30, ±60
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    for (const latDeg of [30, 60, -30, -60]) {
      const phi = latDeg * DEG;
      const sinPhi = sin(phi), cosPhi = cos(phi);
      const pts = [];
      for (let i = 0; i <= 72; i++) {
        const dLam = i * 5 * DEG - lam0;
        pts.push([cosPhi * sin(dLam),
                  cosPhi0 * sinPhi - sinPhi0 * cosPhi * cos(dLam),
                  sinPhi0 * sinPhi + cosPhi0 * cosPhi * cos(dLam)]);
      }
      gridLine(pts);
    }
    // Equator: thicker
    ctx.lineWidth = 1.0 / yScale;
    const eqPts = [];
    for (let i = 0; i <= 72; i++) {
      const dLam = i * 5 * DEG - lam0;
      eqPts.push([sin(dLam),
                  -sinPhi0 * cos(dLam),
                  cosPhi0 * cos(dLam)]);
    }
    gridLine(eqPts);

    // Longitude lines every 30°
    ctx.lineWidth = 0.5 / yScale;
    for (let lonDeg = 0; lonDeg < 360; lonDeg += 30) {
      const dLam = lonDeg * DEG - lam0;
      const sinDLam = sin(dLam), cosDLam = cos(dLam);
      const pts = [];
      for (let i = 0; i <= 36; i++) {
        const phi = (-90 + i * 5) * DEG;
        const sinPhi = sin(phi), cosPhi = cos(phi);
        pts.push([cosPhi * sinDLam,
                  cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosDLam,
                  sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosDLam]);
      }
      if (lonDeg === 0) ctx.lineWidth = 1.0 / yScale;
      gridLine(pts);
      if (lonDeg === 0) ctx.lineWidth = 0.5 / yScale;
    }

    ctx.restore();
  }

  // Draw a shadow (penumbra + umbra) on a celestial body's disc.
  // bx, by = body screen center (pixels). bodyR = body disc radius (pixels).
  // shx, shy = shadow center screen position (pixels). penR, umbR = shadow radii (pixels).
  // umbraColor = CSS color string for the umbra fill (e.g. 'rgba(0,0,0,0.5)').
  // Penumbra is always 25% opaque black. Both circles are clipped to the body disc.
  function drawShadowDisc(bx, by, bodyR, shx, shy, penR, umbR, umbraColor) {
    if (penR < 1) return;
    const ddx = shx - bx, ddy = shy - by;
    const centerDist = sqrt(ddx*ddx + ddy*ddy);
    if (centerDist >= penR + bodyR) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, bodyR, 0, TAU);
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(shx, shy, penR, 0, TAU);
    ctx.fill();
    if (umbR > 0 && centerDist < umbR + bodyR) {
      ctx.fillStyle = umbraColor;
      ctx.beginPath();
      ctx.arc(shx, shy, umbR, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // Draw all moon shadows from obj.shadows onto a planet's disc.
  // obj = ssCache entry with .shadows array of {x, y, z, umbraAngRad, penumbraAngRad}
  //   where x,y,z = shadow center J2000 unit vector, angular radii in radians.
  // px, py = planet screen center (pixels). discR = planet disc radius (pixels).
  function drawMoonShadows(obj, px, py, discR) {
    if (!obj.shadows) return;
    for (const sh of obj.shadows) {
      const [svx, svy, svz] = mvmul(M, sh.x, sh.y, sh.z);
      if (svz > -1) {
        const sd = 1 + svz;
        const [ssx, ssy] = toScreen(2*svx/sd, -2*svy/sd);
        const penR = radToPx(ssx, ssy, sh.penumbraAngRad);
        const umbR = radToPx(ssx, ssy, sh.umbraAngRad);
        drawShadowDisc(px, py, discR, ssx, ssy, penR, umbR, 'rgba(0,0,0,0.5)');
      }
    }
  }

  // Render solar system from cached positions.
  function drawSolarSystem() {
    updateSSCache();
    const symFontSize = `${max(minFontSize,round(min(W,H)/42))}px sans-serif`;
    const labelFont = `${max(minFontSize,round(min(W,H)/85))}px sans-serif`;
    const magLimit = 5.05 + magBoost;

    // Sun view-space direction for phase orientation
    const sunObj = ssCache.find(o => o.type === 'sun');
    const [sunVx, sunVy, sunVz] = mvmul(M, sunObj.x, sunObj.y, sunObj.z);

    for (const obj of ssCache) {
      const [vx, vy, vz] = mvmul(M, obj.x, obj.y, obj.z);
      if (vz < -1e-10) continue;
      const d = 1 + vz;
      const [sx, sy] = toScreen(2 * vx / d, -2 * vy / d);
      // Enlarge the cull rectangle by the object's angular radius (converted to
      // pixels here, since the stereographic distortion factor depends on screen
      // position) so extended discs aren't culled just because their center is
      // off-canvas. Saturn's ring extends well beyond its disc.
      const angRad = obj.angRad ? (obj.name === 'Saturn' ? obj.angRad * 2.27 : obj.angRad) : 0;
      const margin = radToPx(sx, sy, angRad);
      if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) continue;
      // Sun direction at this object's position via stereographic Jacobian
      const dpS = dot(vx, vy, vz, sunVx, sunVy, sunVz);
      const tsx = sunVx - dpS*vx, tsy = sunVy - dpS*vy, tsz = sunVz - dpS*vz;
      const jsDx = 2*tsx/d - 2*vx*tsz/(d*d);
      const jsDy = -2*tsy/d + 2*vy*tsz/(d*d);
      const toSunAngle = atan2(jsDy, jsDx);

      if (obj.type === 'sun' && showPlanets) {
        const r = max(4, min(W, H) / 100, radToPx(sx, sy, obj.angRad));
        if (showPlanetSymbols) {
          ctx.fillStyle = '#fd0'; ctx.font = symFontSize;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(PLANET_SYMBOLS.Sun, sx, sy);
        } else {
          ctx.fillStyle = '#fd0';
          ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        }
        drawnObjects.push({x:sx, y:sy, r, type:'sun', data:{name:'Sun', mag:obj.mag, dist:obj.dist}, jx:obj.x, jy:obj.y, jz:obj.z});
        if (showPlanetNames) {
          ctx.fillStyle = '#fd0'; ctx.font = labelFont;
          ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
          placeLabel(sx, sy, r + 4, 'Sun');
        }
      } else if (obj.type === 'planet' && showPlanets) {
        const drawMag = max(-1.46, min(magLimit, obj.mag));
        const starR = max(1.5, (5.5 + magBoost - drawMag) * min(W, H) / 1000);
        const discR = radToPx(sx, sy, obj.angRad);
        const r = max(starR, discR);
        const pColor = PLANET_COLORS[obj.name];
        const phys = PLANET_PHYS[obj.name];
        const ob = phys && phys.flattening && obj.subObsLat !== undefined
          ? phys.flattening * cos(obj.subObsLat) : 0;
        let polePA = 0;
        if (obj.polePA !== undefined && discR > starR)
          polePA = PI/2 - j2kPAToScreen(obj.polePA, vx, vy, vz, sx, sy);
        if (showPlanetSymbols) {
          ctx.fillStyle = pColor; ctx.font = symFontSize;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(obj.symbol, sx, sy);
        } else if (obj.name === 'Saturn' && discR > starR) {
          const ringOuter = discR * 2.27, ringInner = discR * 1.24;
          const ringColor = darkMode ? '#d8d0c0' : '#a09880';
          drawSaturnRing(sx, sy, ringOuter, ringInner, obj.subObsLat, polePA, ringColor, false);
          drawPhaseDisc(sx, sy, discR, obj.phaseAngle, toSunAngle, pColor, ob, polePA);
          if (showPlanetGrid && discR >= 10 && obj.subObsLat !== undefined)
            drawPlanetGrid(sx, sy, discR, polePA, ob, obj.subObsLat, obj.subObsLon);
          drawMoonShadows(obj, sx, sy, discR);
          drawSaturnRing(sx, sy, ringOuter, ringInner, obj.subObsLat, polePA, ringColor, true);
        } else if (discR > starR) {
          drawPhaseDisc(sx, sy, r, obj.phaseAngle, toSunAngle, pColor, ob, polePA);
          if (showPlanetGrid && discR >= 10 && obj.subObsLat !== undefined)
            drawPlanetGrid(sx, sy, discR, polePA, ob, obj.subObsLat, obj.subObsLon);
          drawMoonShadows(obj, sx, sy, discR);
        } else {
          ctx.fillStyle = pColor;
          ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        }
        const hitR = obj.name === 'Saturn' && discR > starR ? discR * 2.27 : r;
        drawnObjects.push({x:sx, y:sy, r:hitR, type:'planet', data:{name:obj.name, mag:obj.mag, helioDist:obj.helioDist, geoDist:obj.geoDist, phaseAngle:obj.phaseAngle}, jx:obj.x, jy:obj.y, jz:obj.z});
        if (showPlanetNames) {
          ctx.fillStyle = pColor; ctx.font = labelFont;
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          placeLabel(sx, sy, r + 3, obj.name);
        }
      } else if (obj.type === 'moon' && showPlanets) {
        const phaseR = max(4, min(W, H) / 100, radToPx(sx, sy, obj.angRad));
        drawnObjects.push({x:sx, y:sy, r:phaseR, type:'moon', data:{name:'Moon', mag:obj.mag, dist:obj.dist, phaseAngle:obj.phaseAngle}, jx:obj.x, jy:obj.y, jz:obj.z});
        if (showPlanetSymbols) {
          ctx.fillStyle = darkMode ? '#bbb' : '#555'; ctx.font = symFontSize;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(PLANET_SYMBOLS.Moon, sx, sy);
        } else {
          drawPhaseDisc(sx, sy, phaseR, obj.phaseAngle, toSunAngle, 'rgba(187,187,187,0.95)');
          if (showPlanetGrid && phaseR >= 10 && obj.polePA !== undefined && obj.subObsLat !== undefined)
            drawPlanetGrid(sx, sy, phaseR, PI/2 - j2kPAToScreen(obj.polePA, vx, vy, vz, sx, sy), 0, obj.subObsLat, obj.subObsLon);
          // Earth's shadow on Moon
          if (obj.shadowX !== undefined) {
            const [svx, svy, svz] = mvmul(M, obj.shadowX, obj.shadowY, obj.shadowZ);
            if (svz > -1) {
              const sd = 1 + svz;
              const [ssx, ssy] = toScreen(2*svx/sd, -2*svy/sd);
              const penR = radToPx(ssx, ssy, obj.penumbraAngRad);
              const umbR = radToPx(ssx, ssy, obj.umbraAngRad);
              drawShadowDisc(sx, sy, phaseR, ssx, ssy, penR, umbR, 'rgba(64,0,0,0.5)');
            }
          }
        }
        if (showPlanetNames) {
          ctx.fillStyle = darkMode ? '#bbb' : '#555'; ctx.font = labelFont;
          ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
          placeLabel(sx, sy, phaseR + 4, 'Moon');
        }
      } else if (obj.type === 'comet') {
        if (!showComets || (vWidthDeg > 10 && obj.mag > starMagLimit + 5)) continue;
        const drawMag = min(magLimit, obj.mag);
        const r = max(1.5, (5.5 + magBoost - drawMag) * min(W, H) / 1000);
        ctx.fillStyle = '#4de';
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        drawnObjects.push({x:sx, y:sy, r, type:'comet', data:{name:obj.name, mag:obj.mag, helioDist:obj.helioDist, geoDist:obj.geoDist}, jx:obj.x, jy:obj.y, jz:obj.z});
        if (showCometNames) {
          ctx.fillStyle = darkMode ? '#ccc' : '#222'; ctx.font = labelFont;
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          placeLabel(sx, sy, r + 3, obj.name);
        }
      } else if (obj.type === 'asteroid') {
        if (!showAsteroids || (vWidthDeg > 10 && obj.mag > starMagLimit + 5)) continue;
        const drawMag = min(magLimit, obj.mag);
        const r = max(1.5, (5.5 + magBoost - drawMag) * min(W, H) / 1000);
        const astColor = darkMode ? '#ff0' : '#996600';
        ctx.fillStyle = astColor;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        drawnObjects.push({x:sx, y:sy, r, type:'asteroid', data:{name:obj.name, mag:obj.mag, helioDist:obj.helioDist, geoDist:obj.geoDist}, jx:obj.x, jy:obj.y, jz:obj.z});
        if (showAsteroidNames) {
          ctx.fillStyle = astColor; ctx.font = labelFont;
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          placeLabel(sx, sy, r + 3, obj.name);
        }
      } else if (obj.type === 'satellite') {
        if (!showSatellites || obj.mag > magLimit + 3) continue;
        const drawMag = min(magLimit, obj.mag);
        const r = max(1.5, (5.5 + magBoost - drawMag) * min(W, H) / 1000);
        const satColor = darkMode ? '#0f0' : '#060';
        ctx.fillStyle = satColor;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        drawnObjects.push({x:sx, y:sy, r, type:'satellite', data:{name:obj.name, mag:obj.mag, dist:obj.dist}, jx:obj.x, jy:obj.y, jz:obj.z});
        if (showSatelliteNames) {
          ctx.fillStyle = satColor; ctx.font = labelFont;
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          placeLabel(sx, sy, r + 3, obj.name);
        }
      } else if (obj.type === 'planetmoon') {
        if (!showPlanets || vWidthDeg >= 10) continue;
        if (obj.mag === Infinity) continue;
        // Skip moons occluded behind their parent planet's disc. Some browsers
        // don't reliably paint over earlier arc fills, so we can't rely on the
        // painter's algorithm alone for correct occlusion.
        const primary = ssCache.find(o => o.type === 'planet' && o.name === obj.parent);
        if (primary && obj._d > primary._d) {
          const eqR = primary.angRad;
          const sep = angSep(obj.x, obj.y, obj.z, primary.x, primary.y, primary.z);
          const phys = PLANET_PHYS[obj.parent];
          if (phys && phys.flattening && primary.polePA !== undefined && primary.subObsLat !== undefined) {
            const pa = posAng(primary.x, primary.y, primary.z, obj.x, obj.y, obj.z);
            const dEq = sep * sin(pa - primary.polePA);
            const dPo = sep * cos(pa - primary.polePA);
            const ob = phys.flattening * cos(primary.subObsLat);
            const polR = eqR * (1 - ob);
            if (dEq * dEq / (eqR * eqR) + dPo * dPo / (polR * polR) < 1) continue;
          } else {
            if (sep < eqR) continue;
          }
        }
        const drawMag = min(magLimit, obj.mag);
        const starR = max(1.5, (5.5 + magBoost - drawMag) * min(W, H) / 1000);
        const discR = radToPx(sx, sy, obj.angRad);
        const r = max(starR, discR);
        const pmColor = darkMode ? '#bbb' : '#555';
        if (discR > starR) {
          ctx.fillStyle = pmColor;
          ctx.beginPath(); ctx.arc(sx, sy, discR, 0, TAU); ctx.fill();
        } else {
          ctx.fillStyle = pmColor;
          ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        }
        drawnObjects.push({x:sx, y:sy, r, type:'planetmoon', data:{name:obj.name, parent:obj.parent, mag:obj.mag, geoDist:obj.geoDist}, jx:obj.x, jy:obj.y, jz:obj.z});
        if (showPlanetNames) {
          ctx.fillStyle = pmColor; ctx.font = labelFont;
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          placeLabel(sx, sy, r + 3, obj.name);
        }
      }
    }
  }

  // Fill below-horizon area with a semi-transparent overlay and draw the horizon line.
  // Only called in horizon frame. The horizon is at alt = REFRACTION_ALT (standard
  // atmospheric refraction of -34'). Below-horizon is filled in 5°×5° quad patches,
  // using viewProjectRaw for continuous coverage across the hemisphere boundary.
  function drawHorizon() {
    ctx.fillStyle = frameColor('horizon', 0.15);
    // At high zoom (FOV < 5°), the 5°×5° quad patches may all project off-screen
    // even though the view is below the horizon. Fill from the horizon line
    // (or canvas top, if the horizon is above the canvas) down to the bottom.
    const botAlt = viewLatPrecise - 2 * atan2(cy, 2 * scale) * RAD;
    if (vWidthDeg < 5 && botAlt < REFRACTION_ALT * RAD) {
      const hp = viewProjectRaw(REFRACTION_ALT, vLon);
      const top = max(0, hp[1]);
      ctx.fillRect(0, top, W, H - top);
      return;
    }
    const hStep = 5;
    const hPatch = 30;
    for (let az0 = 0; az0 < 360; az0 += hPatch) {
      for (let alt0 = -90; alt0 < 0; alt0 += hPatch) {
        const altTop = alt0 + hPatch >= 0 ? REFRACTION_ALT / DEG : alt0 + hPatch;
        let anyVis = false;
        for (let a = az0; !anyVis && a <= az0 + hPatch; a += hStep) {
          for (let b = alt0; !anyVis && b < altTop; b += hStep) {
            if (viewProject(b * DEG, a * DEG)) anyVis = true;
          }
          if (!anyVis && viewProject(altTop * DEG, a * DEG)) anyVis = true;
        }
        if (!anyVis) continue;
        for (let a = az0; a < az0 + hPatch; a += hStep) {
          for (let b = alt0; b < altTop; b += hStep) {
            const bNext = min(b + hStep, altTop);
            const p00 = viewProjectRaw(b * DEG, a * DEG);
            const p10 = viewProjectRaw(bNext * DEG, a * DEG);
            const p11 = viewProjectRaw(bNext * DEG, (a + hStep) * DEG);
            const p01 = viewProjectRaw(b * DEG, (a + hStep) * DEG);
            const bnd = 2 * max(W, H);
            if (abs(p00[0]-cx) > bnd || abs(p00[1]-cy) > bnd ||
                abs(p10[0]-cx) > bnd || abs(p10[1]-cy) > bnd ||
                abs(p11[0]-cx) > bnd || abs(p11[1]-cy) > bnd ||
                abs(p01[0]-cx) > bnd || abs(p01[1]-cy) > bnd) continue;
            ctx.beginPath();
            ctx.moveTo(p00[0], p00[1]);
            ctx.lineTo(p10[0], p10[1]);
            ctx.lineTo(p11[0], p11[1]);
            ctx.lineTo(p01[0], p01[1]);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
    }

    ctx.strokeStyle = frameColor('horizon');
    ctx.lineWidth = 1.5;
    const zenX = mView[2], zenY = mView[5], zenZ = mView[8];
    drawGreatCircle(zenX, zenY, zenZ, PI/2 - REFRACTION_ALT);
  }

  // Draw compass direction labels (N, NE, E, ...) just above the horizon line.
  // Only called in horizon frame. Drawn outside the clip region so labels
  // aren't cut off at the hemisphere edge.
  function drawCardinals() {
    const dirs = [[0,'N'],[45,'NE'],[90,'E'],[135,'SE'],[180,'S'],[225,'SW'],[270,'W'],[315,'NW']];
    const dirFont = max(minFontSize, round(min(W, H) / 80));
    ctx.fillStyle = frameColor('horizon');
    ctx.font = `bold ${dirFont}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const dirAltOffset = dirFont * 0.8 * vWidthDeg / min(W, H) * DEG;
    for (const [azDeg, label] of dirs) {
      const azR = azDeg * DEG;
      const labelAlt = REFRACTION_ALT + dirAltOffset;
      if (!viewProject(labelAlt, azR)) continue;
      const pt = viewProjectRaw(labelAlt, azR);
      if (pt[0] < 0 || pt[0] > W || pt[1] < 0 || pt[1] > H) continue;
      ctx.fillText(label, pt[0], pt[1]);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // Draw header text (top corners) and selected-object info (bottom center).
  // Top-left: title, location, date, time. Top-right: coordinates, FOV size.
  // Bottom: one-line description of the currently picked object, if any.
  function drawHeader() {
    const sfs = max(minFontSize, round(min(W, H) / 50));
    if (showHeader) {
      const dateStr = `${dt.localY}-${p2(dt.localM)}-${p2(dt.localD)}`;
      const timeStr = `${p2(dt.localH)}:${p2(dt.localMi)}:${p2(dt.localS)} ${dt.tzAbbr}`;
      const latAbs = abs(loc.latDeg);
      const lonAbs = abs(loc.lonDeg);
      const latStr = `${latAbs.toFixed(1)}° ${loc.latDeg >= 0 ? 'N' : 'S'}`;
      const lonStr = `${lonAbs.toFixed(1)}° ${loc.lonDeg >= 0 ? 'E' : 'W'}`;
      const hfs = max(minFontSize, round(min(W, H) / 38));
      ctx.textAlign = 'left';
      ctx.font = `bold ${hfs}px sans-serif`;
      ctx.fillStyle = darkMode ? '#fff' : '#000';
      const hdrX = 48;
      ctx.fillText('Sky Map', hdrX, hfs * 1.2);
      ctx.font = `${sfs}px sans-serif`;
      ctx.fillText(`${lonStr}, ${latStr}`, hdrX, hfs * 1.2 + sfs * 1.4);
      ctx.fillText(dateStr, hdrX, hfs * 1.2 + sfs * 2.8);
      ctx.fillText(timeStr, hdrX, hfs * 1.2 + sfs * 4.2);
      const rLeft = abs((0 - cx) / scale), rRight = abs((W - cx) / scale);
      const rTop = abs((0 - cy) / scale), rBot = abs((H - cy) / scale);
      const fovW = min(180, (2 * atan2(rLeft, 2) + 2 * atan2(rRight, 2)) / DEG);
      const fovH = min(180, (2 * atan2(rTop, 2) + 2 * atan2(rBot, 2)) / DEG);
      const useArcmin = min(fovW, fovH) < 1;
      const fmtFov = v => useArcmin
        ? (v * 60 >= 100 ? round(v * 60) + "'" : (v * 60).toFixed(1) + "'")
        : (v >= 100 ? round(v) + '°' : v.toFixed(1) + '°');
      ctx.textAlign = 'right';
      const hdrR = W - 16;
      ctx.fillText(formatCoords(vLonDisp, vLatDeg), hdrR, sfs * 1.4);
      ctx.fillText(`Size ${fmtFov(fovW)} × ${fmtFov(fovH)}`, hdrR, sfs * 2.8);
      ctx.textAlign = 'left';
    }
    if (selectedObject) {
      if (selectedObject.jx !== undefined) {
        const [fx, fy, fz] = mvmul(mFrame, selectedObject.jx, selectedObject.jy, selectedObject.jz);
        const latDeg = asin(max(-1, min(1, fz))) * RAD;
        const lonDeg = azToDisp(((atan2(fx, fy) + TAU) % TAU) * RAD);
        selectedObject.coords = formatCoords(lonDeg, latDeg);
      }
      ctx.font = `${sfs}px sans-serif`;
      ctx.fillStyle = darkMode ? '#fff' : '#000';
      ctx.textAlign = 'center';
      ctx.fillText(formatSelection(selectedObject), W / 2, H - sfs);
    }
  }

  // ==== Render orchestration ====
  // Clear canvas, set up clip region for the 180° hemisphere, draw all layers
  // in z-order, then overlay elements outside the clip.

  ctx.fillStyle = darkMode ? '#000' : '#fff';
  ctx.fillRect(0, 0, W, H);
  drawnObjects = [];

  // Clip to 180° hemisphere circle
  ctx.fillStyle = darkMode ? '#000' : '#fff';
  ctx.beginPath(); ctx.arc(cx, cy, min(clipR, max(W, H)), 0, TAU); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, clipR + 1, 0, TAU); ctx.clip();

  // Inside clip: sky layers in z-order (back to front)
  if (showMilkyWay) drawMilkyWay();
  if (showGrid) drawGrid();
  drawRefLines();
  const {starPositions, spos} = transformStars();
  drawConstellations(starPositions, spos);
  if (showDeepSky) drawDeepSky();
  if (showStars) drawStars(starPositions);
  if (showPlanets || showComets || showAsteroids || showSatellites) drawSolarSystem();
  if (viewFrame === 'horizon') drawHorizon();

  ctx.restore();

  // Outside clip: hemisphere boundary, cardinals, header/selection text
  if (clipR < max(W, H)) {
    ctx.strokeStyle = darkMode ? 'rgba(120,120,120,0.6)' : 'rgba(100,100,100,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, clipR, 0, TAU); ctx.stroke();
  }

  if (viewFrame === 'horizon') drawCardinals();
  if (selectedObject && selectedObject.data.name) {
    const sel = selectedObject;
    const fresh = ssCache.find(o => o.type === sel.type && o.name === sel.data.name);
    if (fresh) {
      sel.jx = fresh.x; sel.jy = fresh.y; sel.jz = fresh.z;
      sel.data.mag = fresh.mag;
      if (fresh.dist !== undefined) sel.data.dist = fresh.dist;
      if (fresh.helioDist !== undefined) sel.data.helioDist = fresh.helioDist;
      if (fresh.geoDist !== undefined) sel.data.geoDist = fresh.geoDist;
      if (fresh.phaseAngle !== undefined) sel.data.phaseAngle = fresh.phaseAngle;
    }
  }
  drawHeader();
}

// ---- Object picking ----

let lastPickX = -999, lastPickY = -999, lastPickIdx = 0, lastPickList = [];
const PICK_TOL = 5;  // extra pixels beyond object radius for hit-testing

// Hit-test canvas coordinates against drawnObjects from the last frame.
// Clicking the same spot cycles through overlapping objects.
// Updates and returns selectedObject (or null if nothing hit). Does NOT redraw.
function pickObject(canvasX, canvasY) {
  const hits = [];
  for (const obj of drawnObjects) {
    if (obj.contourPts) {
      if (obj.contourPts.some(pts => pointInPolygon(canvasX, canvasY, pts)))
        hits.push(obj);
    } else if (obj.rMinor !== undefined) {
      // Galaxy ellipse: rotate click point into ellipse frame and test
      const dx = canvasX - obj.x, dy = canvasY - obj.y;
      const cs = cos(obj.rot), sn = sin(obj.rot);
      const ex = dx * cs + dy * sn, ey = -dx * sn + dy * cs;
      const a = obj.r + PICK_TOL, b = obj.rMinor + PICK_TOL;
      if (ex*ex / (a*a) + ey*ey / (b*b) <= 1) hits.push(obj);
    } else {
      const dx = canvasX - obj.x, dy = canvasY - obj.y;
      const limit = obj.r + PICK_TOL;
      if (dx*dx + dy*dy <= limit*limit) hits.push(obj);
    }
  }
  if (hits.length === 0) { selectedObject = null; return selectedObject; }
  if (abs(canvasX - lastPickX) < 2 && abs(canvasY - lastPickY) < 2 && hits.length === lastPickList.length) {
    lastPickIdx = (lastPickIdx + 1) % hits.length;
  } else {
    lastPickIdx = 0;
  }
  lastPickX = canvasX; lastPickY = canvasY; lastPickList = hits;
  selectedObject = hits[lastPickIdx];
  return selectedObject;
}

// ---- Frame switching ----

// Convert the view center from the current frame to a new frame, preserving
// the direction the user is looking at. Recomputes viewLonPrecise/viewLatPrecise
// by round-tripping through J2000 equatorial coordinates.
// newFrame: 'horizon', 'equatorial', 'ecliptic', or 'galactic'.
// dt: {y,m,d,h,mi,s} in UTC. loc: {latRad, lonRad, latDeg, lonDeg}.
// Updates viewLonPrecise, viewLatPrecise, viewFrame globals. Does NOT redraw.
function changeFrame(newFrame, j2000, dt, loc) {
  if (newFrame === viewFrame && j2000 === viewJ2000) return;
  if (curMFrame) {
    // Current view center → J2000 equatorial unit vector
    const lon = viewLonPrecise * DEG, lat = viewLatPrecise * DEG;
    const cd = cos(lat), x = cd * sin(lon), y = cd * cos(lon), z = sin(lat);
    const [jx, jy, jz] = mvmul(mtranspose(curMFrame), x, y, z);
    // Build new frame's rotation matrix
    const utH = dt.h + dt.mi / 60 + dt.s / 3600;
    const jd = julianDate(dt.y, dt.m, dt.d, utH);
    const mNew = frameMatrix(newFrame, jd, loc.latRad, loc.lonDeg, j2000);
    // J2000 equatorial → new frame → internal lon/lat
    const [nx, ny, nz] = mvmul(mNew, jx, jy, jz);
    viewLonPrecise = mod360(atan2(nx, ny) * RAD);
    viewLatPrecise = max(-90, min(90, asin(max(-1, min(1, nz))) * RAD));
  }
  viewFrame = newFrame;
  viewJ2000 = j2000;
}
