// ---- Planet/Sun/Moon orbital mechanics ----
// Source: Paul Schlyter, https://stjarnhimlen.se/comp/ppcomp.html
// All orbital elements are ecliptic of date. Day number d = JD - 2451543.5.
// Angles are in degrees in element tables, converted to radians for computation.
// Returned lon/lat are ecliptic of date in radians unless noted otherwise.

// ---- Constants ----

// Apparent diameters at 1 AU (arcseconds)
const PLANET_DIAM1AU = {
  Mercury: 6.74, Venus: 16.92, Mars: 9.36, Jupiter: 196.94,
  Saturn: 165.6, Uranus: 65.8, Neptune: 62.2, Pluto: 2.07
};
const SUN_DIAM1AU = 1919.26;        // arcseconds at 1 AU
const MOON_DIAM_FACTOR = 1873.7 * 60; // arcseconds × Earth-radii (divide by dist in ER)

// Orbital elements for each planet. elems(d) returns Schlyter elements in degrees:
// N = longitude of ascending node, i = inclination, w = argument of perihelion,
// a = semi-major axis (AU), e = eccentricity, M = mean anomaly.
const PLANETS = [
  {name:"Mercury", elems: d => ({
    N:( 48.3313 + 3.24587e-5*d), i:( 7.0047 + 5.00e-8*d), w:( 29.1241 + 1.01444e-5*d),
    a: 0.387098, e: 0.205635 + 5.59e-10*d, M:(168.6562 + 4.0923344368*d)})},
  {name:"Venus", elems: d => ({
    N:( 76.6799 + 2.46590e-5*d), i:( 3.3946 + 2.75e-8*d), w:( 54.8910 + 1.38374e-5*d),
    a: 0.723330, e: 0.006773 - 1.302e-9*d, M:( 48.0052 + 1.6021302244*d)})},
  {name:"Mars", elems: d => ({
    N:( 49.5574 + 2.11081e-5*d), i:( 1.8497 - 1.78e-8*d), w:(286.5016 + 2.92961e-5*d),
    a: 1.523688, e: 0.093405 + 2.516e-9*d, M:( 18.6021 + 0.5240207766*d)})},
  {name:"Jupiter", elems: d => ({
    N:(100.4542 + 2.76854e-5*d), i:( 1.3030 - 1.557e-7*d), w:(273.8777 + 1.64505e-5*d),
    a: 5.20256, e: 0.048498 + 4.469e-9*d, M:( 19.8950 + 0.0830853001*d)})},
  {name:"Saturn", elems: d => ({
    N:(113.6634 + 2.38980e-5*d), i:( 2.4886 - 1.081e-7*d), w:(339.3939 + 2.97661e-5*d),
    a: 9.55475, e: 0.055546 - 9.499e-9*d, M:(316.9670 + 0.0334442282*d)})},
  {name:"Uranus", elems: d => ({
    N:( 74.0005 + 1.3978e-5*d), i:( 0.7733 + 1.9e-8*d), w:( 96.6612 + 3.0565e-5*d),
    a: 19.18171 - 1.55e-8*d, e: 0.047318 + 7.45e-9*d, M:(142.5905 + 0.011725806*d)})},
  {name:"Neptune", elems: d => ({
    N:(131.7806 + 3.0173e-5*d), i:( 1.7700 - 2.55e-7*d), w:(272.8461 - 6.027e-6*d),
    a: 30.05826 + 3.313e-8*d, e: 0.008606 + 2.15e-9*d, M:(260.2471 + 0.005995147*d)})},
  {name:"Pluto", elems: d => ({
    N:(110.3038 + 1.4514e-5*d), i:( 17.1346 - 1.84e-7*d), w:(113.7630 + 3.0556e-6*d),
    a: 39.48168 - 7.68e-8*d, e: 0.248662 + 5.18e-10*d, M:( 14.8825 + 0.003964350*d)})},
];

// ---- Magnitude formulas ----

// Apparent magnitude of a planet.
// r = heliocentric distance (AU), R = geocentric distance (AU),
// FV = phase angle (degrees), ringMagn = Saturn ring correction (from saturnRingMagn).
function planetMag(name, r, R, FV, ringMagn) {
  switch (name) {
    case 'Mercury': return -0.36 + 5*Math.log10(r*R) + 0.027*FV + 2.2e-13*FV**6;
    case 'Venus':   return -4.34 + 5*Math.log10(r*R) + 0.013*FV + 4.2e-7*FV**3;
    case 'Mars':    return -1.51 + 5*Math.log10(r*R) + 0.016*FV;
    case 'Jupiter': return -9.25 + 5*Math.log10(r*R) + 0.014*FV;
    case 'Saturn':  return -9.0  + 5*Math.log10(r*R) + 0.044*FV + (ringMagn || 0);
    case 'Uranus':  return -7.15 + 5*Math.log10(r*R) + 0.001*FV;
    case 'Neptune': return -6.90 + 5*Math.log10(r*R) + 0.001*FV;
    case 'Pluto':   return -1.0  + 5*Math.log10(r*R);
    default: return 0;
  }
}

// Apparent magnitude of the Moon.
// r = Sun-Earth distance (AU), R = Moon distance (Earth radii), FV = phase angle (degrees).
function moonMag(r, R, FV) {
  return -21.62 + 5*Math.log10(r*R) + 0.026*FV + 4.0e-9*FV**4;
}

// Phase angle and elongation from three distances (law of cosines).
// s = Sun-Earth (AU), R = Earth-body (AU or ER), r = Sun-body (AU).
// Returns {elong, FV} in radians and degrees respectively.
function phaseElongation(s, R, r) {
  const elongArg = (s*s + R*R - r*r) / (2*s*R);
  const elong = Math.acos(max(-1, min(1, elongArg)));
  const fvArg = (r*r + R*R - s*s) / (2*r*R);
  const FV = Math.acos(max(-1, min(1, fvArg)));
  return { elong, FV };
}

// Saturn ring tilt magnitude correction.
// los/las = Saturn's geocentric ecliptic lon/lat (radians, of date), d = day number.
// Returns a magnitude offset to add to Saturn's base magnitude.
function saturnRingMagn(los, las, d) {
  const ir = 28.06 * DEG;
  const Nr = (169.51 + 3.82e-5 * d) * DEG;
  const B = asin(sin(las)*cos(ir) - cos(las)*sin(ir)*sin(los - Nr));
  return -2.6 * abs(sin(B)) + 1.2 * sin(B) * sin(B);
}

// ---- Orbital math utilities ----

// Solve Kepler's equation M = E - e·sin(E) for eccentric anomaly E.
// M in radians, e = eccentricity. Returns E in radians.
function solveKepler(M, e) {
  let E = M;
  for (let i = 0; i < 50; i++) {
    const dE = (E - e * sin(E) - M) / (1 - e * cos(E));
    E -= dE;
    if (abs(dE) < 1e-10) break;
  }
  return E;
}

// True anomaly from eccentric anomaly E (radians) and eccentricity e. Returns radians.
function trueAnomaly(E, e) {
  return 2 * atan2(sqrt(1+e)*sin(E/2), sqrt(1-e)*cos(E/2));
}

// Heliocentric ecliptic position from Schlyter orbital elements (of date).
// el = {N, i, w, M} in degrees, {a} in AU, {e} dimensionless.
// Returns {lon, lat, r}: ecliptic lon/lat in radians (of date), r in AU.
function planetHelioEcl(el) {
  const Nr = ((el.N % 360 + 360) % 360) * DEG;
  const ir = el.i * DEG;
  const wr = ((el.w % 360 + 360) % 360) * DEG;
  const Mr = ((el.M % 360 + 360) % 360) * DEG;
  const E = solveKepler(Mr, el.e);
  const xv = el.a * (cos(E) - el.e);
  const yv = el.a * sqrt(1 - el.e * el.e) * sin(E);
  const nu = atan2(yv, xv);
  const r = sqrt(xv * xv + yv * yv);
  const xh = r * (cos(Nr) * cos(nu + wr) - sin(Nr) * sin(nu + wr) * cos(ir));
  const yh = r * (sin(Nr) * cos(nu + wr) + cos(Nr) * sin(nu + wr) * cos(ir));
  const zh = r * sin(nu + wr) * sin(ir);
  const [lon, lat] = uxyz2sph(xh, yh, zh);
  return { lon, lat, r };
}

// Mutual-perturbation corrections for Jupiter, Saturn, and Uranus.
// d = day number, lon/lat in radians (of date), r in AU.
// Returns corrected {lon, lat, r}.
function planetPerturbations(name, d, lon, lat, r) {
  const Mj = ((19.8950 + 0.0830853001 * d) % 360 + 360) % 360 * DEG;
  const Ms = ((316.9670 + 0.0334442282 * d) % 360 + 360) % 360 * DEG;
  const Mu = ((142.5905 + 0.011725806 * d) % 360 + 360) % 360 * DEG;
  let dlon = 0, dlat = 0;
  if (name === 'Jupiter') {
    dlon = -0.332*sin(2*Mj - 5*Ms - 67.6*DEG)
           -0.056*sin(2*Mj - 2*Ms + 21*DEG)
           +0.042*sin(3*Mj - 5*Ms + 21*DEG)
           -0.036*sin(Mj - 2*Ms)
           +0.022*cos(Mj - Ms)
           +0.023*sin(2*Mj - 3*Ms + 52*DEG)
           -0.016*sin(Mj - 5*Ms - 69*DEG);
  } else if (name === 'Saturn') {
    dlon = +0.812*sin(2*Mj - 5*Ms - 67.6*DEG)
           -0.229*cos(2*Mj - 4*Ms - 2*DEG)
           +0.119*sin(Mj - 2*Ms - 3*DEG)
           +0.046*sin(2*Mj - 6*Ms - 69*DEG)
           +0.014*sin(Mj - 3*Ms + 32*DEG);
    dlat = -0.020*cos(2*Mj - 4*Ms - 2*DEG)
           +0.018*sin(2*Mj - 6*Ms - 49*DEG);
  } else if (name === 'Uranus') {
    dlon = +0.040*sin(Ms - 2*Mu + 6*DEG)
           +0.035*sin(Ms - 3*Mu + 33*DEG)
           -0.015*sin(Mj - Mu + 20*DEG);
  }
  return { lon: lon + dlon * DEG, lat: lat + dlat * DEG, r };
}

// Sun ecliptic position (of date).
// d = day number. Returns {lon, lat, r, M, w}: lon/lat in radians, r in AU,
// M (mean anomaly) and w (argument of perihelion) in radians — needed by moonPosition.
function sunPosition(d) {
  const w = ((282.9404 + 4.70935e-5 * d) % 360 + 360) % 360 * DEG;
  const e = 0.016709 - 1.151e-9 * d;
  const M = ((356.0470 + 0.9856002585 * d) % 360 + 360) % 360 * DEG;
  const E = solveKepler(M, e);
  const xv = cos(E) - e;
  const yv = sqrt(1 - e * e) * sin(E);
  const nu = atan2(yv, xv);
  const r = sqrt(xv * xv + yv * yv);
  return { lon: nu + w, lat: 0, r, M, w };
}

// Moon ecliptic position (of date) with perturbation corrections.
// d = day number, sunM = Sun's mean anomaly (radians), sunW = Sun's arg of perihelion (radians).
// Returns {lon, lat, dist}: ecliptic lon/lat in radians (of date), dist in Earth radii.
function moonPosition(d, sunM, sunW) {
  const mN = ((125.1228 - 0.0529538083 * d) % 360 + 360) % 360 * DEG;
  const mI = 5.1454 * DEG;
  const mw = ((318.0634 + 0.1643573223 * d) % 360 + 360) % 360 * DEG;
  const mA = 60.2666;
  const mE = 0.054900;
  const mM = ((115.3654 + 13.0649929509 * d) % 360 + 360) % 360 * DEG;

  const moonEcc = solveKepler(mM, mE);
  const xv = mA * (cos(moonEcc) - mE);
  const yv = mA * sqrt(1 - mE * mE) * sin(moonEcc);
  const moonNu = atan2(yv, xv);
  const moonR = sqrt(xv * xv + yv * yv);

  const xh = moonR * (cos(mN) * cos(moonNu + mw) - sin(mN) * sin(moonNu + mw) * cos(mI));
  const yh = moonR * (sin(mN) * cos(moonNu + mw) + cos(mN) * sin(moonNu + mw) * cos(mI));
  const zh = moonR * sin(moonNu + mw) * sin(mI);

  let [lon, lat] = uxyz2sph(xh, yh, zh);
  let dist = moonR;

  const Ls = sunM + sunW;
  const Lm = mM + mw + mN;
  const mD = Lm - Ls;
  const F = Lm - mN;

  lon += (-1.274*sin(mM - 2*mD) + 0.658*sin(2*mD) - 0.186*sin(sunM)
    - 0.059*sin(2*mM - 2*mD) - 0.057*sin(mM - 2*mD + sunM)
    + 0.053*sin(mM + 2*mD) + 0.046*sin(2*mD - sunM)
    + 0.041*sin(mM - sunM) - 0.035*sin(mD) - 0.031*sin(mM + sunM)
    - 0.015*sin(2*F - 2*mD) + 0.011*sin(mM - 4*mD)) * DEG;
  lat += (-0.173*sin(F - 2*mD) - 0.055*sin(mM - F - 2*mD)
    - 0.046*sin(mM + F - 2*mD) + 0.033*sin(F + 2*mD)
    + 0.017*sin(2*mM + F)) * DEG;
  dist += -0.58*cos(mM - 2*mD) - 0.46*cos(2*mD);

  return { lon, lat, dist };
}

// Geocentric → topocentric equatorial coordinates.
// Geocentric → topocentric equatorial coordinates using WGS84 ellipsoid.
// ra/dec in radians, distER in Earth equatorial radii.
// lstR = apparent LST (radians), latRad = observer geodetic latitude.
// mObs = optional matrix to precess observer position (for J2000 mode).
// Returns [topoRA, topoDec] in radians.
function topocentricCorrection(ra, dec, distER, lstR, latRad, mObs) {
  const A_AU = 6378.137 / 149597870.7;   // WGS84 equatorial radius in AU
  const F = 1 / 298.257223563;           // WGS84 flattening
  const E2 = F * (2 - F);
  const distAU = distER * A_AU;
  const [geoX, geoY, geoZ] = sph2xyz(ra, dec, distAU);
  // Observer's geocentric position on the WGS84 ellipsoid (sea level).
  // N = radius of curvature in the prime vertical.
  const sinLat = sin(latRad), cosLat = cos(latRad);
  const N = A_AU / sqrt(1 - E2 * sinLat * sinLat);
  let obsX = N * cosLat * cos(lstR);
  let obsY = N * cosLat * sin(lstR);
  let obsZ = N * (1 - E2) * sinLat;
  if (mObs) [obsX, obsY, obsZ] = mvmul(mObs, obsX, obsY, obsZ);
  const tx = geoX - obsX, ty = geoY - obsY, tz = geoZ - obsZ;
  return [atan2(ty, tx), atan2(tz, sqrt(tx * tx + ty * ty))];
}

// Ecliptic longitude precession correction from of-date to J2000 (Schlyter, ppcomp section 8).
// d = Schlyter day number (JD - 2451543.5). Returns correction in radians.
function eclLonJ2000Corr(d) {
  return -3.82394e-5 * d * DEG;
}

// ---- Asteroid & Comet orbit computation ----
// Reference: Schlyter, ppcomp.html sections 6, 7, 16-20

const GAUSS_K = 0.01720209895;

// Parabolic orbit solver (e = 1). ppcomp section 18.
// dT = days since perihelion, q = perihelion distance (AU).
// Returns {v, r}: true anomaly (radians), heliocentric distance (AU).
function solveParabolic(dT, q) {
  const H = dT * (GAUSS_K / sqrt(2)) / (q * sqrt(q));
  const h = 1.5 * H;
  const g = sqrt(1 + h * h);
  const s = Math.cbrt(g + h) - Math.cbrt(g - h);
  return { v: 2 * Math.atan(s), r: q * (1 + s * s) };
}

// Near-parabolic orbit solver (0.98 <= e <= 1.02). ppcomp section 19.
// dT = days since perihelion, q = perihelion distance (AU), e = eccentricity.
// Returns {v, r}: true anomaly (radians), heliocentric distance (AU).
function solveNearParabolic(dT, q, e) {
  const a0 = 0.75 * dT * GAUSS_K * sqrt((1 + e) / (q * q * q));
  const b = sqrt(1 + a0 * a0);
  const W = Math.cbrt(b + a0) - Math.cbrt(b - a0);
  const f = (1 - e) / (1 + e);
  const a1 = 2/3 + 2/5 * W * W;
  const a2 = 7/5 + 33/35 * W * W + 37/175 * W**4;
  const a3 = W * W * (432/175 + 956/1125 * W * W + 84/1575 * W**4);
  const C = W * W / (1 + W * W);
  const g = f * C * C;
  const w = W * (1 + f * C * (a1 + a2 * g + a3 * g * g));
  return { v: 2 * Math.atan(w), r: q * (1 + w * w) / (1 + w * w * f) };
}

// Hyperbolic orbit solver (e > 1.02). ppcomp section 20.
// dT = days since perihelion, q = perihelion distance (AU), e = eccentricity.
// Returns {v, r}: true anomaly (radians), heliocentric distance (AU).
function solveHyperbolic(dT, q, e) {
  const a = q / (1 - e);
  const M = dT / ((-a) * sqrt(-a));
  let F = M;
  for (let i = 0; i < 50; i++) {
    const dF = (M + F - e * Math.sinh(F)) / (e * Math.cosh(F) - 1);
    F += dF;
    if (abs(dF) < 1e-10) break;
  }
  const v = 2 * Math.atan(sqrt((e + 1) / (e - 1)) * Math.tanh(F / 2));
  const r = a * (1 - e * e) / (1 + e * cos(v));
  return { v, r };
}

// Heliocentric ecliptic position from orbital elements and true anomaly/distance.
// node, inc, w in radians; v = true anomaly (radians), r = helio distance (AU).
// Returns {lon, lat, r}: ecliptic lon/lat in radians, r in AU.
function orbitToEcliptic(node, inc, w, v, r) {
  const xh = r * (cos(node) * cos(v + w) - sin(node) * sin(v + w) * cos(inc));
  const yh = r * (sin(node) * cos(v + w) + cos(node) * sin(v + w) * cos(inc));
  const zh = r * sin(v + w) * sin(inc);
  const [lon, lat] = uxyz2sph(xh, yh, zh);
  return { lon, lat, r };
}

// Asteroid heliocentric ecliptic position.
// ast = parsed MPC asteroid: {epoch, M, w, node, inc, e, n, a, H, G} (angles in degrees).
// d = Schlyter day number, j2000 = true to stay in J2000 ecliptic.
// Returns {lon, lat, r} in radians.
function asteroidPosition(ast, d, j2000) {
  const dEpoch = julianDate(ast.epoch.y, ast.epoch.m, ast.epoch.d, 0) - 2451543.5;
  const M = ((ast.M + ast.n * (d - dEpoch)) % 360 + 360) % 360 * DEG;
  const node = (ast.node + (j2000 ? 0 : 3.82394e-5 * d)) * DEG;
  const inc = ast.inc * DEG;
  const w = ast.w * DEG;
  const E = solveKepler(M, ast.e);
  const xv = ast.a * (cos(E) - ast.e);
  const yv = ast.a * sqrt(1 - ast.e * ast.e) * sin(E);
  const v = atan2(yv, xv);
  const r = sqrt(xv * xv + yv * yv);
  return orbitToEcliptic(node, inc, w, v, r);
}

// Comet heliocentric ecliptic position.
// comet = parsed MPC comet: {Ty, Tm, Td, q, e, w, node, inc, H, k} (angles in degrees).
// d = Schlyter day number, j2000 = true to stay in J2000 ecliptic.
// Returns {lon, lat, r} in radians.
function cometPosition(comet, d, j2000) {
  const dT = julianDate(comet.Ty, comet.Tm, comet.Td, 0) - 2451543.5;
  const dt = d - dT;
  const node = (comet.node + (j2000 ? 0 : 3.82394e-5 * d)) * DEG;
  const inc = comet.inc * DEG;
  const w = comet.w * DEG;
  let v, r;
  if (comet.e < 0.98) {
    const a = comet.q / (1 - comet.e);
    const P = 365.2568984 * a * sqrt(a);
    const M = ((360 * dt / P) % 360 + 360) % 360 * DEG;
    const E = solveKepler(M, comet.e);
    const xv = a * (cos(E) - comet.e);
    const yv = a * sqrt(1 - comet.e * comet.e) * sin(E);
    v = atan2(yv, xv);
    r = sqrt(xv * xv + yv * yv);
  } else if (comet.e > 1.02) {
    ({ v, r } = solveHyperbolic(dt, comet.q, comet.e));
  } else if (comet.e === 1.0) {
    ({ v, r } = solveParabolic(dt, comet.q));
  } else {
    ({ v, r } = solveNearParabolic(dt, comet.q, comet.e));
  }
  return orbitToEcliptic(node, inc, w, v, r);
}

// Heliocentric ecliptic → geocentric ecliptic.
// body = {lon, lat, r} of the body, sun = {lon, r} of the Sun.
// Returns {lon, lat, r}: geocentric ecliptic lon/lat (radians), distance (AU).
function helioToGeo(body, sun) {
  const xh = body.r * cos(body.lon) * cos(body.lat);
  const yh = body.r * sin(body.lon) * cos(body.lat);
  const zh = body.r * sin(body.lat);
  const xs = sun.r * cos(sun.lon);
  const ys = sun.r * sin(sun.lon);
  const xg = xh + xs, yg = yh + ys, zg = zh;
  const R = sqrt(xg * xg + yg * yg + zg * zg);
  return { lon: atan2(yg, xg), lat: atan2(zg, sqrt(xg * xg + yg * yg)), r: R };
}

// Asteroid apparent magnitude (H,G system, Bowell et al. 1989).
// H = absolute magnitude, G = slope parameter, r = helio dist (AU),
// R = geocentric dist (AU), phaseAngle = Sun-body-Earth angle (radians).
function asteroidMagnitude(H, G, r, R, phaseAngle) {
  const tanHalf = tan(phaseAngle / 2);
  if (!isFinite(tanHalf) || tanHalf < 0) return H + 5 * Math.log10(r * R);
  const phi1 = Math.exp(-3.33 * tanHalf ** 0.63);
  const phi2 = Math.exp(-1.87 * tanHalf ** 1.22);
  return H + 5 * Math.log10(r * R) - 2.5 * Math.log10((1 - G) * phi1 + G * phi2);
}

// Comet apparent magnitude.
// H = absolute magnitude, k = activity slope, r = helio dist (AU), R = geocentric dist (AU).
function cometMagnitude(H, k, r, R) {
  return H + 5 * Math.log10(R) + 2.5 * k * Math.log10(r);
}

// Meeus "Astronomical Algorithms" ch.47 — truncated ELP2000 lunar theory (~10" accuracy).
// d = Schlyter day number (JD - 2451543.5).
// Returns {lon, lat, dist}: ecliptic of date in radians, distance in Earth radii.
function moonPositionMeeus(d) {
  const T = (d - 1.5) / 36525;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;

  // Fundamental arguments (degrees)
  const Lp = 218.3164477 + 481267.88123421*T - 0.0015786*T2 + T3/538841 - T4/65194000;
  const D  = 297.8501921 + 445267.1114034*T  - 0.0018819*T2 + T3/545868 - T4/113065000;
  const M  = 357.5291092 + 35999.0502909*T   - 0.0001536*T2 + T3/24490000;
  const Mp = 134.9633964 + 477198.8675055*T   + 0.0087414*T2 + T3/69699  - T4/14712000;
  const F  = 93.2720950  + 483202.0175233*T   - 0.0036539*T2 - T3/3526000 + T4/863310000;

  const A1 = 119.75 + 131.849*T;
  const A2 = 53.09 + 479264.290*T;
  const A3 = 313.45 + 481266.484*T;

  const E = 1 - 0.002516*T - 0.0000074*T2;
  const E2 = E * E;

  const Dr = D*DEG, Mr = M*DEG, Mpr = Mp*DEG, Fr = F*DEG;
  const Lpr = Lp*DEG, A1r = A1*DEG, A2r = A2*DEG, A3r = A3*DEG;

  // Table 47.A: longitude (Σl, 1e-6 deg) and distance (Σr, 1e-3 km)
  let Sl = 0, Sr = 0;
  for (const [cd, cm, cmp, cf, lc, rc] of [
    [0,0,1,0,      6288774,-20905355],
    [2,0,-1,0,     1274027,-3699111],
    [2,0,0,0,       658314,-2955968],
    [0,0,2,0,       213618,-569925],
    [0,1,0,0,      -185116,48888],
    [0,0,0,2,      -114332,-3149],
    [2,0,-2,0,       58793,246158],
    [2,-1,-1,0,      57066,-152138],
    [2,0,1,0,        53322,-170733],
    [2,-1,0,0,       45758,-204586],
    [0,1,-1,0,      -40923,-129620],
    [1,0,0,0,       -34720,108743],
    [0,1,1,0,       -30383,104755],
    [2,0,0,-2,       15327,10321],
    [0,0,1,2,       -12528,0],
    [0,0,1,-2,       10980,79661],
    [4,0,-1,0,       10675,-34782],
    [0,0,3,0,        10034,-23210],
    [4,0,-2,0,        8548,-21636],
    [2,1,-1,0,       -7888,24208],
    [2,1,0,0,        -6766,30824],
    [1,0,-1,0,       -5163,-8379],
    [1,1,0,0,         4987,-16675],
    [2,-1,1,0,        4036,-12831],
    [2,0,2,0,         3994,-10445],
    [4,0,0,0,         3861,-11650],
    [2,0,-3,0,        3665,14403],
    [0,1,-2,0,       -2689,-7003],
    [2,0,-1,2,       -2602,0],
    [2,-1,-2,0,       2390,10056],
    [1,0,1,0,        -2348,6322],
    [2,-2,0,0,        2236,-9884],
    [0,1,2,0,        -2120,5751],
    [0,2,0,0,        -2069,0],
    [2,-2,-1,0,       2048,-4950],
    [2,0,1,-2,       -1773,4130],
    [2,0,0,2,        -1595,0],
    [4,-1,-1,0,       1215,-3958],
    [0,0,2,2,        -1110,0],
    [3,0,-1,0,        -892,3258],
    [2,1,1,0,         -810,2616],
    [4,-1,-2,0,        759,-1897],
    [0,2,-1,0,        -713,-2117],
    [2,2,-1,0,        -700,2354],
    [2,1,-2,0,         691,0],
    [2,-1,0,-2,        596,0],
    [4,0,1,0,          549,-1423],
    [0,0,4,0,          537,-1117],
    [4,-1,0,0,         520,-1571],
    [1,0,-2,0,        -487,-1739],
    [2,1,0,-2,        -399,0],
    [0,0,2,-2,        -381,-4421],
    [1,1,1,0,          351,0],
    [3,0,-2,0,        -340,0],
    [4,0,-3,0,         330,0],
    [2,-1,2,0,         327,0],
    [0,2,1,0,         -323,1165],
    [1,1,-1,0,         299,0],
    [2,0,3,0,          294,0],
    [2,0,-1,-2,          0,8752],
  ]) {
    const arg = cd*Dr + cm*Mr + cmp*Mpr + cf*Fr;
    const ec = abs(cm) === 2 ? E2 : abs(cm) === 1 ? E : 1;
    Sl += lc * ec * sin(arg);
    Sr += rc * ec * cos(arg);
  }

  // Table 47.B: latitude (Σb, 1e-6 deg)
  let Sb = 0;
  for (const [cd, cm, cmp, cf, bc] of [
    [0,0,0,1,    5128122],
    [0,0,1,1,     280602],
    [0,0,1,-1,    277693],
    [2,0,0,-1,    173237],
    [2,0,-1,1,     55413],
    [2,0,-1,-1,    46271],
    [2,0,0,1,      32573],
    [0,0,2,1,      17198],
    [2,0,1,-1,      9266],
    [0,0,2,-1,      8822],
    [2,-1,0,-1,     8216],
    [2,0,-2,-1,     4324],
    [2,0,1,1,       4200],
    [2,1,0,-1,     -3359],
    [2,-1,-1,1,     2463],
    [2,-1,0,1,      2211],
    [2,-1,-1,-1,    2065],
    [0,1,-1,-1,    -1870],
    [4,0,-1,-1,     1828],
    [0,1,0,1,      -1794],
    [0,0,0,3,      -1749],
    [0,1,-1,1,     -1565],
    [1,0,0,1,      -1491],
    [0,1,1,1,      -1475],
    [0,1,1,-1,     -1410],
    [0,1,0,-1,     -1344],
    [1,0,0,-1,     -1335],
    [0,0,3,1,       1107],
    [4,0,0,-1,      1021],
    [4,0,-1,1,       833],
    [0,0,1,-3,       777],
    [4,0,-2,1,       671],
    [2,0,0,-3,       607],
    [2,0,2,-1,       596],
    [2,-1,1,-1,      491],
    [2,0,-2,1,      -451],
    [0,0,3,-1,       439],
    [2,0,2,1,        422],
    [2,0,-3,-1,      421],
    [2,1,-1,1,      -366],
    [2,1,0,1,       -351],
    [4,0,0,1,        331],
    [2,-1,1,1,       315],
    [2,-2,0,-1,      302],
    [0,0,1,3,       -283],
    [2,1,1,-1,      -229],
    [1,1,0,-1,       223],
    [1,1,0,1,        223],
    [0,1,-2,-1,     -220],
    [2,1,-1,-1,     -220],
    [1,0,1,1,       -185],
    [2,-1,-2,-1,     181],
    [0,1,2,1,       -177],
    [4,0,-2,-1,      176],
    [4,-1,-1,-1,     166],
    [1,0,1,-1,      -164],
    [4,0,1,-1,       132],
    [1,0,-1,-1,     -119],
    [4,-1,0,-1,      115],
    [2,-2,0,1,       107],
  ]) {
    const arg = cd*Dr + cm*Mr + cmp*Mpr + cf*Fr;
    const ec = abs(cm) === 2 ? E2 : abs(cm) === 1 ? E : 1;
    Sb += bc * ec * sin(arg);
  }

  // Additional corrections (Venus, Jupiter, Earth flattening)
  Sl += 3958*sin(A1r) + 1962*sin(Lpr - Fr) + 318*sin(A2r);
  Sb += -2235*sin(Lpr) + 382*sin(A3r) + 175*sin(A1r - Fr)
      + 175*sin(A1r + Fr) + 127*sin(Lpr - Mpr) - 115*sin(Lpr + Mpr);

  const lonDeg = ((Lp + Sl * 1e-6) % 360 + 360) % 360;
  const lon = lonDeg * DEG;
  const lat = Sb * 1e-6 * DEG;
  const dist = (385000.56 + Sr * 0.001) / 6378.14;

  return { lon, lat, dist };
}

// ---- VSOP87 planetary positions (Meeus, Astronomical Algorithms ch.32) ----
// Evaluates the truncated VSOP87 series from vsop87.js.
// tau = Julian millennia from J2000: (JDE - 2451545.0) / 365250.
// Returns {L, B, R}: heliocentric ecliptic of-date, L/B in radians, R in AU.
function vsop87Position(planet, tau) {
  const data = VSOP87[planet];
  let L = 0, B = 0, R = 0, tp = 1;
  for (const s of data.L) {
    let sum = 0;
    for (const t of s) sum += t[0] * cos(t[1] + t[2] * tau);
    L += sum * tp; tp *= tau;
  }
  tp = 1;
  for (const s of data.B) {
    let sum = 0;
    for (const t of s) sum += t[0] * cos(t[1] + t[2] * tau);
    B += sum * tp; tp *= tau;
  }
  tp = 1;
  for (const s of data.R) {
    let sum = 0;
    for (const t of s) sum += t[0] * cos(t[1] + t[2] * tau);
    R += sum * tp; tp *= tau;
  }
  L = ((L % TAU) + TAU) % TAU;
  return { L, B, R };
}

