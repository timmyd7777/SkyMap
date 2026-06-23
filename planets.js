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
// ra/dec in radians, distER in Earth radii. lstR = apparent LST (radians), latRad = observer latitude.
// Returns [topoRA, topoDec] in radians.
function topocentricCorrection(ra, dec, distER, lstR, latRad) {
  const R_EARTH_AU = 6378.0 / 149597870.7;
  const distAU = distER * R_EARTH_AU;
  const [geoX, geoY, geoZ] = sph2xyz(ra, dec, distAU);
  const [obsX, obsY, obsZ] = sph2xyz(lstR, latRad, R_EARTH_AU);
  const tx = geoX - obsX, ty = geoY - obsY, tz = geoZ - obsZ;
  return [atan2(ty, tx), atan2(tz, sqrt(tx * tx + ty * ty))];
}
