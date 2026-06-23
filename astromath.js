// ---- Constants ----
const {PI, sin, cos, tan, atan2, sqrt, abs, max, min, round, floor, ceil, asin} = Math;
const TAU = 2 * PI;
const DEG = PI / 180;       // multiply degrees by this to get radians
const RAD = 180 / PI;       // multiply radians by this to get degrees
const REFRACTION_ALT = -34 / 60 * DEG;  // standard atmospheric refraction at horizon (radians)
const p2 = v => String(v).padStart(2, '0');  // zero-pad a number to 2 digits

// 3×3 rotation matrix (row-major flat array) from J2000 equatorial to galactic coordinates.
// Galactic north pole: RA 192.85948°, Dec +27.12825° (J2000)
// Galactic center:     RA 266.405°,   Dec -28.936°  (J2000)
const mGalactic = (function() {
  const pRA = 192.85948 * DEG, pDec = 27.12825 * DEG;
  const cRA = 266.405 * DEG, cDec = -28.936 * DEG;
  const pz = [cos(pDec)*cos(pRA), cos(pDec)*sin(pRA), sin(pDec)];
  const gc = [cos(cDec)*cos(cRA), cos(cDec)*sin(cRA), sin(cDec)];
  const px = [gc[0] - pz[0]*(pz[0]*gc[0]+pz[1]*gc[1]+pz[2]*gc[2]),
              gc[1] - pz[1]*(pz[0]*gc[0]+pz[1]*gc[1]+pz[2]*gc[2]),
              gc[2] - pz[2]*(pz[0]*gc[0]+pz[1]*gc[1]+pz[2]*gc[2])];
  const pxLen = sqrt(px[0]*px[0]+px[1]*px[1]+px[2]*px[2]);
  px[0] /= pxLen; px[1] /= pxLen; px[2] /= pxLen;
  const py = [pz[1]*px[2]-pz[2]*px[1], pz[2]*px[0]-pz[0]*px[2], pz[0]*px[1]-pz[1]*px[0]];
  return [px[0],px[1],px[2], py[0],py[1],py[2], pz[0],pz[1],pz[2]];
})();

// ---- Time and date ----

// Calendar date → Julian Date. y/m/d are integers, ut is decimal hours UTC.
// Applies Gregorian correction for dates on or after 15 Oct 1582; Julian calendar before.
function julianDate(y, m, d, ut) {
  if (m <= 2) { y--; m += 12; }
  const A = floor(y / 100);
  const gregorian = (y > 1582) || (y === 1582 && (m > 10 || (m === 10 && d >= 15)));
  const B = gregorian ? 2 - A + floor(A / 4) : 0;
  return floor(365.25 * (y + 4716)) + floor(30.6001 * (m + 1)) + d + ut / 24.0 + B - 1524.5;
}

// Julian Date → calendar date. Returns {y, m, d, ut} where y/m/d are integers
// and ut is decimal hours UTC. Handles both Julian and Gregorian calendars.
function calendarDate(jd) {
  const z = floor(jd + 0.5);
  const f = jd + 0.5 - z;
  const a = z >= 2299161 ? z + 1 + floor((z - 1867216.25) / 36524.25) - floor((z - 1867216.25) / 36524.25 / 4) : z;
  const b = a + 1524;
  const c = floor((b - 122.1) / 365.25);
  const d = floor(365.25 * c);
  const e = floor((b - d) / 30.6001);
  const day = b - d - floor(30.6001 * e);
  const m = e < 14 ? e - 1 : e - 13;
  const y = m > 2 ? c - 4716 : c - 4715;
  const ut = f * 24;
  return {y, m, d: day, ut};
}

// Greenwich Mean Sidereal Time from Julian Date. Returns degrees [0, 360).
function gmst(jd) {
  const T = (jd - 2451545.0) / 36525.0;
  let g = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - T * T * T / 38710000;
  return ((g % 360) + 360) % 360;
}

// Local Sidereal Time. jd = Julian Date, lonDeg = observer longitude (degrees east).
// Returns degrees [0, 360).
function localSiderealTime(jd, lonDeg) {
  return ((gmst(jd) + lonDeg) % 360 + 360) % 360;
}

// ---- IAU 1976 Precession ----

// Precession parameters for century T = (JD - J2000) / 36525.
// Returns {zetaA, zA, cosT, sinT} — angles in radians, trig of thetaA precomputed.
function precessParams(T) {
  const zetaA = (0.6406161 * T + 0.0000839 * T*T + 0.0000050 * T*T*T) * DEG;
  const zA    = (0.6406161 * T + 0.0003041 * T*T + 0.0000051 * T*T*T) * DEG;
  const thetaA= (0.5567530 * T - 0.0001185 * T*T - 0.0000116 * T*T*T) * DEG;
  return { zetaA, zA, cosT: cos(thetaA), sinT: sin(thetaA) };
}

// Precess a single star from J2000 to date. ra0/dec0 in radians (J2000),
// pp from precessParams(). Returns [ra, dec] in radians (of date).
function precessStar(ra0, dec0, pp) {
  const cosD = cos(dec0), sinD = sin(dec0);
  const raZ = ra0 + pp.zetaA;
  const A = cosD * sin(raZ);
  const B = pp.cosT * cosD * cos(raZ) - pp.sinT * sinD;
  const C = pp.sinT * cosD * cos(raZ) + pp.cosT * sinD;
  return [atan2(A, B) + pp.zA, asin(max(-1, min(1, C)))];
}

// Mean obliquity of the ecliptic for century T. Returns radians.
function obliquity(T) {
  return (23.439291 - 0.013004 * T) * DEG;
}

// IAU 1980 nutation, 3 dominant terms (~arcsecond accuracy).
// T = Julian centuries from J2000. Returns {dPsi, dEps} in radians.
function nutation(T) {
  const Om    = (125.04452 - 1934.136261 * T) * DEG;
  const Lsun  = (280.46646 + 36000.76983 * T) * DEG;
  const Lmoon = (218.31654 + 481267.88134 * T) * DEG;
  const dPsi = (-17.1996 * sin(Om) - 1.3187 * sin(2*Lsun) - 0.2274 * sin(2*Lmoon)) / 3600 * DEG;
  const dEps = ( 9.2025 * cos(Om) + 0.5736 * cos(2*Lsun) + 0.0977 * cos(2*Lmoon)) / 3600 * DEG;
  return { dPsi, dEps };
}

// Bennett's formula: true geometric alt → apparent alt (degrees).
function refractionTrue2App(altDeg) {
  if (altDeg < -0.5) return altDeg;
  return altDeg + 1 / tan((altDeg + 7.31 / (altDeg + 4.4)) * DEG) / 60;
}

// Saemundsson's formula: apparent alt → true geometric alt (degrees).
function refractionApp2True(altDeg) {
  if (altDeg < -0.5) return altDeg;
  return altDeg - 1.02 / tan((altDeg + 10.3 / (altDeg + 5.11)) * DEG) / 60;
}

// ---- Coordinate transforms ----

// Ecliptic → equatorial. lam/beta/eps all in radians (of date).
// Returns [ra, dec] in radians.
function eclToEq(lam, beta, eps) {
  const ce = cos(eps), se = sin(eps);
  const cb = cos(beta), sb = sin(beta);
  const cl = cos(lam), sl = sin(lam);
  const x = cb * cl;
  const y = cb * sl * ce - sb * se;
  const z = cb * sl * se + sb * ce;
  return [atan2(y, x), asin(max(-1, min(1, z)))];
}

// Equatorial → horizon. ra/dec/lstRad/latRad all in radians.
// Returns [alt, az] in radians; az measured from north through east [0, 2π).
function eqToAltAz(ra, dec, lstRad, latRad) {
  const ha = lstRad - ra;
  const sinLat = sin(latRad), cosLat = cos(latRad);
  const sinDec = sin(dec), cosDec = cos(dec);
  const cosHA = cos(ha), sinHA = sin(ha);
  const alt = asin(sinLat * sinDec + cosLat * cosDec * cosHA);
  const az = atan2(-cosDec * sinHA, sinDec * cosLat - cosDec * sinLat * cosHA);
  return [alt, ((az + TAU) % TAU)];
}

// ---- Matrix helpers ----
// All matrices are 3×3, stored as 9-element flat arrays in row-major order.

// Rotation about z-axis by angle a (radians).
function rz(a) {
  const c = cos(a), s = sin(a);
  return [c,-s,0, s,c,0, 0,0,1];
}
// Rotation about y-axis by angle a (radians).
function ry(a) {
  const c = cos(a), s = sin(a);
  return [c,0,s, 0,1,0, -s,0,c];
}
// Rotation about x-axis by angle a (radians).
function rx(a) {
  const c = cos(a), s = sin(a);
  return [1,0,0, 0,c,-s, 0,s,c];
}

// ---- Spherical / Cartesian conversions ----
// Convention: x = r·cos(lat)·cos(lon), y = r·cos(lat)·sin(lon), z = r·sin(lat).
// lon/lat in radians. lon = atan2(y, x), lat = atan2(z, √(x²+y²)).

// Spherical (lon, lat, r) → Cartesian [x, y, z]. All angles in radians.
function sph2xyz(lon, lat, r) {
  const cd = r * cos(lat);
  return [cd * cos(lon), cd * sin(lon), r * sin(lat)];
}
// Unit-sphere version: (lon, lat) → [x, y, z] with r = 1.
function sph2uxyz(lon, lat) {
  const cd = cos(lat);
  return [cd * cos(lon), cd * sin(lon), sin(lat)];
}
// Cartesian → spherical. Returns [lon, lat, r] in radians.
function xyz2sph(x, y, z) {
  return [atan2(y, x), atan2(z, sqrt(x * x + y * y)), sqrt(x * x + y * y + z * z)];
}
// Unit-sphere inverse: Cartesian → [lon, lat] in radians (ignores radius).
function uxyz2sph(x, y, z) {
  return [atan2(y, x), atan2(z, sqrt(x * x + y * y))];
}

// ---- Matrix helpers ----

// Transpose a 3×3 matrix (row-major). For rotation matrices, transpose = inverse.
function mtranspose(m) {
  return [m[0],m[3],m[6], m[1],m[4],m[7], m[2],m[5],m[8]];
}
// Multiply 3×3 matrix m by column vector (x, y, z). Returns [x', y', z'].
function mvmul(m, x, y, z) {
  return [m[0]*x+m[1]*y+m[2]*z, m[3]*x+m[4]*y+m[5]*z, m[6]*x+m[7]*y+m[8]*z];
}
// Multiply two 3×3 matrices. Returns a new 9-element row-major array.
function mmul(a, b) {
  return [
    a[0]*b[0]+a[1]*b[3]+a[2]*b[6], a[0]*b[1]+a[1]*b[4]+a[2]*b[7], a[0]*b[2]+a[1]*b[5]+a[2]*b[8],
    a[3]*b[0]+a[4]*b[3]+a[5]*b[6], a[3]*b[1]+a[4]*b[4]+a[5]*b[7], a[3]*b[2]+a[4]*b[5]+a[5]*b[8],
    a[6]*b[0]+a[7]*b[3]+a[8]*b[6], a[6]*b[1]+a[7]*b[4]+a[8]*b[7], a[6]*b[2]+a[7]*b[5]+a[8]*b[8],
  ];
}

// ---- Frame rotation matrices ----

// Build the J2000 equatorial → target frame rotation matrix.
// frame: 'horizon', 'equatorial', 'ecliptic', or 'galactic'.
// jd: Julian Date. latRad: observer latitude (radians). lonDeg: observer longitude (degrees east).
// Returns {mPrecess, mFrame, epsTrue, lstR}: mPrecess = J2000 → true equatorial of date,
// mFrame = J2000 → target frame, epsTrue = true obliquity (radians),
// lstR = apparent local sidereal time (radians).
function frameMatrix(frame, jd, latRad, lonDeg) {
  const T = (jd - 2451545.0) / 36525.0;
  const pp = precessParams(T);
  const nut = nutation(T);
  const epsMean = obliquity(T);
  const epsTrue = epsMean + nut.dEps;
  const eqEq = nut.dPsi * cos(epsTrue);
  const lstR = (localSiderealTime(jd, lonDeg) + eqEq * RAD) * DEG;
  const mPrecY = [pp.cosT,0,-pp.sinT, 0,1,0, pp.sinT,0,pp.cosT];
  const mPrecOnly = mmul(rz(pp.zA), mmul(mPrecY, rz(pp.zetaA)));
  const mNut = mmul(rx(-epsTrue), mmul(rz(-nut.dPsi), rx(epsMean)));
  const mPrecess = mmul(mNut, mPrecOnly);
  let mFrame;
  if (frame === 'horizon') {
    const mEqAz = mmul(rx(latRad - PI/2), rz(-PI/2 - lstR));
    mFrame = mmul(mEqAz, mPrecess);
  } else if (frame === 'equatorial') {
    mFrame = mPrecess;
  } else if (frame === 'ecliptic') {
    mFrame = mmul(rx(-epsTrue), mPrecess);
  } else {
    mFrame = mGalactic;
  }
  return { mPrecess, mFrame, epsTrue, lstR };
}

