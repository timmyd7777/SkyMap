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

// Objects drawn in the last frame, for hit-testing by pickObject().
// Each entry: {x, y, r, type, data, ...} in canvas pixel coordinates.
let drawnObjects = [];

// Currently selected (picked) object, or null.
let selectedObject = null;

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
  Saturn:'#c8a830', Uranus:'#40b8c0', Neptune:'#3040d0', Pluto:'#a07050'
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
  return viewFrame === 'horizon' ? ((deg % 360) + 360) % 360 : ((90 - deg) % 360 + 360) % 360;
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

function formatSelection(obj) {
  const d = obj.data;
  const ids = [];
  let type = '', name = '', mag = null;
  if (obj.type === 'star') {
    type = 'Star';
    name = d.name || '';
    if (d.bayer) ids.push(d.bayer);
    if (d.flamsteed) ids.push(d.flamsteed);
    if (obj.hr) ids.push(`HR ${obj.hr}`);
    if (d.hd) ids.push(`HD ${d.hd}`);
    if (d.hip) ids.push(`HIP ${d.hip}`);
    mag = d.mag;
  } else if (obj.type === 'deepsky') {
    const DS_TYPES = {OC:'Open Cluster',GC:'Globular Cluster',BN:'Bright Nebula',
      DN:'Dark Nebula',PN:'Planetary Nebula',GX:'Galaxy'};
    type = DS_TYPES[d[0]] || d[0];
    name = d[8] || '';
    if (d[6]) ids.push(d[6]);
    if (d[7]) ids.push(d[7]);
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
  }
  let s = type + ': ';
  const parts = [];
  if (name) parts.push(name);
  parts.push(...ids);
  s += parts.join(', ');
  if (obj.coords) s += ` - ${obj.coords}`;
  if (mag != null) s += `  Mag ${mag >= 0 ? '+' : ''}${mag.toFixed(2)}`;
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
    showPlanets, showPlanetSymbols, showPlanetNames, j2000,
    showComets, showCometNames, showAsteroids, showAsteroidNames,
    showDeepSky, showDeepSkyNames, showDeepSkyIds,
    showMilkyWay, showEcliptic, showCelEq, showGalEq,
    showGrid, showHeader,
  } = params;

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
  const magBoost = Math.log2(180 / vWidthDeg);       // faint-star boost for zoom level
  const minFontSize = 12;                            // minimum label font size (pixels)
  const starMagLimit = 5.05 + magBoost;              // faintest star magnitude to draw
  const clipR = 2 * scale;                           // clip circle radius (180° hemisphere, pixels)

  // ---- Rotation matrices ----
  // M = mView · mFrame maps J2000 equatorial unit vectors to view coordinates.
  // mFrame: J2000 equatorial → current coordinate frame.
  // mView: current frame → stereographic projection (view center at +Z).
  const mFrame = frameMatrix(viewFrame, jd, loc.latRad, loc.lonDeg, j2000);
  const mPrecess = frameMatrix('equatorial', jd, loc.latRad, loc.lonDeg, j2000);
  curMFrame = mFrame;
  const mView = mmul(rx(vTheta), rz(vLon));                             // frame coords → view coords
  const M = mmul(mView, mFrame);       // combined: J2000 equatorial → view
  const mPT = mtranspose(mPrecess);    // inverse precession: of-date → J2000

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
  function arcminToPx(sx, sy, arcmin) {
    const cX = (sx - cx) / scale, cY = (cy - sy) / scale;
    const r2 = cX * cX + cY * cY;
    return arcmin * DEG / 60 * scale * (4 + r2) / 4;
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
    const uLen = sqrt(ux*ux + uy*uy + uz*uz);
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
      let anyVisible = false;
      for (let j = 0; j < nv; j++) {
        const [vx, vy, vz] = mvmul(M, ring[j*3], ring[j*3+1], ring[j*3+2]);
        const d = max(1 + vz, 0.1);
        const pt = toScreen(2*vx/d, -2*vy/d);
        if (vz > -1e-10 && pt[0] >= 0 && pt[0] <= W && pt[1] >= 0 && pt[1] <= H) anyVisible = true;
        pts.push(pt);
      }
      if (!anyVisible) return;
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
      const labelLon = viewFrame === 'horizon' ? ((90 - nextDisp) % 360 + 360) % 360 : nextDisp;
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
      const hr = s[4];
      if (s[2] > starMagLimit && !hr) { starPositions.push(null); continue; }
      const x0 = s[10], y0 = s[11], z0 = s[12];
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
      const p = {sx, sy, mag: s[2], hr, hd: s[5], hip: s[6], bayer: s[7], flamsteed: s[8], name: s[9], inView, jx: x0, jy: y0, jz: z0};
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
    const dsPositions = [];
    for (let dsi = 0; dsi < DEEPSKY.length; dsi++) { const ds = DEEPSKY[dsi];
      const x0 = ds[9], y0 = ds[10], z0 = ds[11];
      const [x1, vy, vz] = mvmul(M, x0, y0, z0);
      if (vz < -1e-10) { dsPositions.push(null); continue; }
      const d = 1 + vz;
      const pt = toScreen(2 * x1 / d, -2 * vy / d);
      if (pt[0] < 0 || pt[0] > W || pt[1] < 0 || pt[1] > H) { dsPositions.push(null); continue; }
      const dsSize = ds[5];
      const r = dsSize ? max(5, arcminToPx(pt[0], pt[1], dsSize) / 2) : 5;
      dsPositions.push({x: pt[0], y: pt[1], r});
      drawnObjects.push({x: pt[0], y: pt[1], r, type: 'deepsky', idx: dsi, data: ds, jx: x0, jy: y0, jz: z0});
      const typ = ds[0];
      ctx.strokeStyle = dsColor;
      if (typ === 'OC') {
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(pt[0], pt[1], r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      } else if (typ === 'GC') {
        ctx.beginPath(); ctx.arc(pt[0], pt[1], r, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pt[0] - r, pt[1]); ctx.lineTo(pt[0] + r, pt[1]); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pt[0], pt[1] - r); ctx.lineTo(pt[0], pt[1] + r); ctx.stroke();
      } else if (typ === 'BN') {
        ctx.strokeRect(pt[0] - r, pt[1] - r, 2 * r, 2 * r);
      } else if (typ === 'DN') {
        ctx.beginPath();
        ctx.moveTo(pt[0], pt[1] - r); ctx.lineTo(pt[0] + r, pt[1]);
        ctx.lineTo(pt[0], pt[1] + r); ctx.lineTo(pt[0] - r, pt[1]);
        ctx.closePath(); ctx.stroke();
      } else if (typ === 'PN') {
        ctx.beginPath(); ctx.arc(pt[0], pt[1], r, 0, TAU); ctx.stroke();
        const t = 2 * r;
        ctx.beginPath(); ctx.moveTo(pt[0] - t, pt[1]); ctx.lineTo(pt[0] - r, pt[1]); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pt[0] + r, pt[1]); ctx.lineTo(pt[0] + t, pt[1]); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pt[0], pt[1] - t); ctx.lineTo(pt[0], pt[1] - r); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pt[0], pt[1] + r); ctx.lineTo(pt[0], pt[1] + t); ctx.stroke();
      } else if (typ === 'GX') {
        ctx.beginPath(); ctx.ellipse(pt[0], pt[1], r, r * 0.5, 0, 0, TAU); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(pt[0], pt[1], r, 0, TAU); ctx.stroke();
      }
    }
    if (showDeepSkyNames || showDeepSkyIds) {
      ctx.font = `${max(minFontSize,round(min(W,H)/85))}px sans-serif`;
      ctx.fillStyle = dsColor;
      ctx.textAlign = 'left';
      for (let i = 0; i < DEEPSKY.length; i++) {
        if (!dsPositions[i]) continue;
        const p = dsPositions[i];
        const mcId = DEEPSKY[i][6];
        const name = DEEPSKY[i][8];
        if (showDeepSkyIds && mcId) placeLabel(p.x, p.y, p.r + 3, mcId);
        if (showDeepSkyNames && name) placeLabel(p.x, p.y, p.r + 3, name);
      }
    }
  }

  // Draw star dots and optional name/designation labels.
  // Dot radius scales with magnitude and canvas size. Adds each visible star
  // to drawnObjects for hit-testing. Labels only for stars brighter than ~mag 2.
  function drawStars(starPositions) {
    const starC = darkMode ? '#fff' : '#000';
    for (const p of starPositions) {
      if (!p || !p.inView || p.mag > starMagLimit) continue;
      const r = max(0.5, (5.5 + magBoost - p.mag) * min(W, H) / 1000);
      ctx.fillStyle = starC;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, TAU); ctx.fill();
      drawnObjects.push({x: p.sx, y: p.sy, r, type: 'star', hr: p.hr, data: p, jx: p.jx, jy: p.jy, jz: p.jz});
    }
    if (showNames || showStarIds) {
      ctx.font = `${max(minFontSize,round(min(W,H)/85))}px sans-serif`;
      ctx.fillStyle = darkMode ? '#fff' : '#000';
      ctx.textAlign = 'left';
      for (const p of starPositions) {
        if (!p || !p.inView || p.mag > 2.02 + 1.5 * magBoost) continue;
        const r = max(0.5, (5.5 + magBoost - p.mag) * min(W, H) / 1000);
        const desig = showStarIds ? formatDesignation(p.bayer, p.flamsteed) : '';
        if (desig) placeLabel(p.sx, p.sy, r + 3, desig);
        if (showNames && p.name) placeLabel(p.sx, p.sy, r + 3, p.name);
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
    const sunLon = ((earth.L + PI) % TAU + TAU) % TAU;
    const sunLat = -earth.B;
    const sunR = earth.R;
    const [sx, sy, sz] = mvmul(mEcl2J2000, ...sph2uxyz(sunLon, sunLat));
    ssCache.push({ type:'sun', name:'Sun', x:sx, y:sy, z:sz,
      mag:-26.74, color:'#fd0', angSize:(SUN_DIAM1AU / sunR) / 60, dist:sunR });

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
      const lt = sqrt((sx-earthX)**2 + (sy-earthY)**2 + (sz-earthZ)**2) * LIGHT_TIME_AU;
      // Accurate VSOP87 position at retarded time
      const h = vsop87Position(vsopKey, tau - lt / 365250);
      const hx = h.R * cos(h.B) * cos(h.L);
      const hy = h.R * cos(h.B) * sin(h.L);
      const hz = h.R * sin(h.B);
      const px = hx - earthX, py = hy - earthY, pz = hz - earthZ;
      const [geoLon, geoLat] = uxyz2sph(px, py, pz);
      const geoDist = sqrt(px*px + py*py + pz*pz);
      const { FV } = phaseElongation(sunR, geoDist, h.R);
      const FVdeg = FV * RAD;
      // d + 1.5: Schlyter functions use epoch JD 2451543.5 (1.5 days before J2000)
      const ringMagn = name === 'Saturn' ? saturnRingMagn(geoLon, geoLat, d + 1.5) : 0;
      const [jx, jy, jz] = mvmul(mEcl2J2000, ...sph2uxyz(geoLon, geoLat));
      ssCache.push({ type:'planet', name, x:jx, y:jy, z:jz,
        mag: planetMag(name, h.R, geoDist, FVdeg, ringMagn),
        color: PLANET_COLORS[name], symbol: PLANET_SYMBOLS[name],
        helioDist:h.R, geoDist, phaseAngle:FVdeg });
    }

    // Pluto via Schlyter (not in VSOP87)
    const plutoH0 = planetHelioEcl(PLANETS[7].elems(d + 1.5));
    const [p0x, p0y, p0z] = sph2xyz(plutoH0.lon, plutoH0.lat, plutoH0.r);
    const plutoLt = sqrt((p0x-earthX)**2 + (p0y-earthY)**2 + (p0z-earthZ)**2) * LIGHT_TIME_AU;
    const plutoH = planetHelioEcl(PLANETS[7].elems(d + 1.5 - plutoLt));
    const [phx, phy, phz] = sph2xyz(plutoH.lon, plutoH.lat, plutoH.r);
    const ppx = phx - earthX, ppy = phy - earthY, ppz = phz - earthZ;
    const [plutoGeoLon, plutoGeoLat] = uxyz2sph(ppx, ppy, ppz);
    const plutoDist = sqrt(ppx*ppx + ppy*ppy + ppz*ppz);
    const { FV: plutoFV } = phaseElongation(sunR, plutoDist, plutoH.r);
    const [pjx, pjy, pjz] = mvmul(mEcl2J2000, ...sph2uxyz(plutoGeoLon, plutoGeoLat));
    ssCache.push({ type:'planet', name:'Pluto', x:pjx, y:pjy, z:pjz,
      mag: planetMag('Pluto', plutoH.r, plutoDist, plutoFV * RAD, 0),
      color: PLANET_COLORS['Pluto'], symbol: PLANET_SYMBOLS['Pluto'],
      helioDist:plutoH.r, geoDist:plutoDist, phaseAngle:plutoFV*RAD });

    // Moon: ecliptic of-date → true equatorial → topocentric → J2000
    const moonPos = moonPositionMeeus(d);
    const moonAngArcmin = (MOON_DIAM_FACTOR / moonPos.dist) / 60;
    const [moonGRA, moonGDec] = eclToEq(moonPos.lon, moonPos.lat, epsTrue);
    const [topoRA, topoDec] = topocentricCorrection(moonGRA, moonGDec, moonPos.dist, lstR, loc.latRad, null);
    const [mx, my, mz] = mvmul(mtranspose(mNP), ...sph2uxyz(topoRA, topoDec));
    const moonPhase = ((moonPos.lon - sunLon) % TAU + TAU) % TAU;
    const moonFVdeg = abs((PI - moonPhase) * RAD);
    ssCache.push({ type:'moon', name:'Moon', x:mx, y:my, z:mz,
      mag: moonMag(sunR, moonPos.dist, moonFVdeg),
      color: '#ddd', angSize: moonAngArcmin, dist: moonPos.dist, phase: moonPhase });

    // Comets: J2000 ecliptic elements → J2000 equatorial via Cartesian subtraction
    if (params.comets) {
      for (const c of params.comets) {
        const ch0 = cometPosition(c, d + 1.5, true);
        const [c0x, c0y, c0z] = mvmul(mJ2kEcl2Eq, ...sph2xyz(ch0.lon, ch0.lat, ch0.r));
        const lt = sqrt((c0x-earthEqX)**2 + (c0y-earthEqY)**2 + (c0z-earthEqZ)**2) * LIGHT_TIME_AU;
        const h = cometPosition(c, d + 1.5 - lt, true);
        const [hEqX, hEqY, hEqZ] = mvmul(mJ2kEcl2Eq, ...sph2xyz(h.lon, h.lat, h.r));
        const gx = hEqX - earthEqX, gy = hEqY - earthEqY, gz = hEqZ - earthEqZ;
        const geoDist = sqrt(gx*gx + gy*gy + gz*gz);
        const cmag = cometMagnitude(c.H, c.k, h.r, geoDist);
        ssCache.push({ type:'comet', name:c.name,
          x:gx/geoDist, y:gy/geoDist, z:gz/geoDist,
          mag:cmag, color:'#4de', helioDist:h.r, geoDist });
      }
    }

    // Asteroids: J2000 ecliptic elements → J2000 equatorial via Cartesian subtraction
    if (params.asteroids) {
      for (const a of params.asteroids) {
        const ah0 = asteroidPosition(a, d + 1.5, true);
        const [a0x, a0y, a0z] = mvmul(mJ2kEcl2Eq, ...sph2xyz(ah0.lon, ah0.lat, ah0.r));
        const lt = sqrt((a0x-earthEqX)**2 + (a0y-earthEqY)**2 + (a0z-earthEqZ)**2) * LIGHT_TIME_AU;
        const h = asteroidPosition(a, d + 1.5 - lt, true);
        const [hEqX, hEqY, hEqZ] = mvmul(mJ2kEcl2Eq, ...sph2xyz(h.lon, h.lat, h.r));
        const gx = hEqX - earthEqX, gy = hEqY - earthEqY, gz = hEqZ - earthEqZ;
        const geoDist = sqrt(gx*gx + gy*gy + gz*gz);
        const { FV } = phaseElongation(sunR, geoDist, h.r);
        const amag = asteroidMagnitude(a.H, a.G, h.r, geoDist, FV);
        ssCache.push({ type:'asteroid', name:a.name,
          x:gx/geoDist, y:gy/geoDist, z:gz/geoDist,
          mag:amag, color:'#a96', helioDist:h.r, geoDist, phaseAngle:FV*RAD });
      }
    }
  }

  // Render solar system from cached positions.
  function drawSolarSystem() {
    updateSSCache();
    const symFontSize = `${max(minFontSize,round(min(W,H)/42))}px sans-serif`;
    const labelFont = `${max(minFontSize,round(min(W,H)/85))}px sans-serif`;
    const magLimit = 5.05 + magBoost;

    // Project Sun position for Moon phase orientation (even if Sun is off-screen)
    const sunObj = ssCache.find(o => o.type === 'sun');
    const [sunVx, sunVy, sunVz] = mvmul(M, sunObj.x, sunObj.y, sunObj.z);
    const sunD = 1 + sunVz;
    const [sunSx, sunSy] = toScreen(2 * sunVx / sunD, -2 * sunVy / sunD);

    for (const obj of ssCache) {
      const [vx, vy, vz] = mvmul(M, obj.x, obj.y, obj.z);
      if (vz < -1e-10) continue;
      const d = 1 + vz;
      const [sx, sy] = toScreen(2 * vx / d, -2 * vy / d);
      if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) continue;

      if (obj.type === 'sun' && showPlanets) {
        const r = max(4, min(W, H) / 100, arcminToPx(sx, sy, obj.angSize) / 2);
        if (showPlanetSymbols) {
          ctx.fillStyle = obj.color; ctx.font = symFontSize;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(PLANET_SYMBOLS.Sun, sx, sy);
        } else {
          ctx.fillStyle = obj.color;
          ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        }
        drawnObjects.push({x:sx, y:sy, r, type:'sun', data:{name:'Sun', mag:obj.mag, dist:obj.dist}, jx:obj.x, jy:obj.y, jz:obj.z});
        if (showPlanetNames) {
          ctx.fillStyle = darkMode ? '#fff' : '#000'; ctx.font = labelFont;
          ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
          placeLabel(sx, sy, r + 4, 'Sun');
        }
      } else if (obj.type === 'planet' && showPlanets) {
        const drawMag = max(-1.46, min(magLimit, obj.mag));
        const r = max(1.5, (5.5 + magBoost - drawMag) * min(W, H) / 1000);
        if (showPlanetSymbols) {
          ctx.fillStyle = obj.color; ctx.font = symFontSize;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(obj.symbol, sx, sy);
        } else {
          ctx.fillStyle = obj.color;
          ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        }
        drawnObjects.push({x:sx, y:sy, r, type:'planet', data:{name:obj.name, mag:obj.mag, helioDist:obj.helioDist, geoDist:obj.geoDist, phaseAngle:obj.phaseAngle}, jx:obj.x, jy:obj.y, jz:obj.z});
        if (showPlanetNames) {
          ctx.fillStyle = darkMode ? '#ccc' : '#222'; ctx.font = labelFont;
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          placeLabel(sx, sy, r + 3, obj.name);
        }
      } else if (obj.type === 'moon' && showPlanets) {
        const phaseR = max(4, min(W, H) / 100, arcminToPx(sx, sy, obj.angSize) / 2);
        drawnObjects.push({x:sx, y:sy, r:phaseR, type:'moon', data:{name:'Moon', mag:obj.mag, dist:obj.dist, phase:obj.phase}, jx:obj.x, jy:obj.y, jz:obj.z});
        if (showPlanetSymbols) {
          ctx.fillStyle = darkMode ? '#ddd' : '#444'; ctx.font = symFontSize;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(PLANET_SYMBOLS.Moon, sx, sy);
        } else {
          ctx.fillStyle = darkMode ? '#333' : '#555';
          ctx.beginPath(); ctx.arc(sx, sy, phaseR, 0, TAU); ctx.fill();
          if (obj.phase > 0.05 && obj.phase < TAU - 0.05) {
            const toSunAngle = atan2(sy - sunSy, sunSx - sx);
            const k = cos(obj.phase);
            ctx.fillStyle = 'rgba(240,240,220,0.95)';
            ctx.beginPath();
            for (let i = 0; i <= 24; i++) {
              const t = PI/2 - i*PI/24;
              const bx = phaseR*cos(t), by = phaseR*sin(t);
              const rx = sx + bx*cos(toSunAngle) - by*sin(toSunAngle);
              const ry = sy - bx*sin(toSunAngle) - by*cos(toSunAngle);
              if (i===0) ctx.moveTo(rx,ry); else ctx.lineTo(rx,ry);
            }
            for (let i = 0; i <= 24; i++) {
              const t = -PI/2 + i*PI/24;
              const bx = phaseR*k*cos(t), by = phaseR*sin(t);
              const rx = sx + bx*cos(toSunAngle) - by*sin(toSunAngle);
              const ry = sy - bx*sin(toSunAngle) - by*cos(toSunAngle);
              ctx.lineTo(rx,ry);
            }
            ctx.closePath(); ctx.fill();
          }
          ctx.strokeStyle = darkMode ? '#666' : '#888'; ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.arc(sx, sy, phaseR, 0, TAU); ctx.stroke();
        }
        if (showPlanetNames) {
          ctx.fillStyle = darkMode ? '#fff' : '#000'; ctx.font = labelFont;
          ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
          placeLabel(sx, sy, phaseR + 4, 'Moon');
        }
      } else if (obj.type === 'comet') {
        if (!showComets || (vWidthDeg > 10 && obj.mag > starMagLimit + 5)) continue;
        const drawMag = min(magLimit, obj.mag);
        const r = max(1, (5.5 + magBoost - drawMag) * min(W, H) / 1000);
        ctx.fillStyle = obj.color;
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
        const r = max(1, (5.5 + magBoost - drawMag) * min(W, H) / 1000);
        ctx.fillStyle = obj.color;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        drawnObjects.push({x:sx, y:sy, r, type:'asteroid', data:{name:obj.name, mag:obj.mag, helioDist:obj.helioDist, geoDist:obj.geoDist}, jx:obj.x, jy:obj.y, jz:obj.z});
        if (showAsteroidNames) {
          ctx.fillStyle = darkMode ? '#ccc' : '#222'; ctx.font = labelFont;
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
      const fmtFov = v => v >= 100 ? round(v) + '°' : v.toFixed(1) + '°';
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
  if (showPlanets || showComets || showAsteroids) drawSolarSystem();
  if (viewFrame === 'horizon') drawHorizon();

  ctx.restore();

  // Outside clip: hemisphere boundary, cardinals, header/selection text
  if (clipR < max(W, H)) {
    ctx.strokeStyle = darkMode ? 'rgba(120,120,120,0.6)' : 'rgba(100,100,100,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, clipR, 0, TAU); ctx.stroke();
  }

  if (viewFrame === 'horizon') drawCardinals();
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
    const dx = canvasX - obj.x, dy = canvasY - obj.y;
    const limit = obj.r + PICK_TOL;
    if (dx*dx + dy*dy <= limit*limit) hits.push(obj);
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
    viewLonPrecise = ((atan2(nx, ny) * RAD) % 360 + 360) % 360;
    viewLatPrecise = max(-90, min(90, asin(max(-1, min(1, nz))) * RAD));
  }
  viewFrame = newFrame;
  viewJ2000 = j2000;
}
