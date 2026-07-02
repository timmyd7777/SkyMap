// ---- Constants ----
const {PI, sin, cos, tan, atan2, sqrt, abs, max, min, round, floor, ceil, asin, pow} = Math;
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

// Delta-T (TDT - UT) in seconds, from Espenak & Meeus (2006).
// y = decimal year. Valid 1500–2500; uses Morrison & Stephenson parabola outside.
function deltaT(y) {
  let dt, t, u;
  if (y < -500) {
    u = (y - 1820) / 100;
    dt = -20 + 32 * u * u;
  } else if (y < 500) {
    u = y / 100;
    dt = 10583.6 - 1014.41*u + 33.78311*u*u - 5.952053*u*u*u
      - 0.1798452*u**4 + 0.022174192*u**5 + 0.0090316521*u**6;
  } else if (y < 1600) {
    u = (y - 1000) / 100;
    dt = 1574.2 - 556.01*u + 71.23472*u*u + 0.319781*u*u*u
      - 0.8503463*u**4 - 0.005050998*u**5 + 0.0083572073*u**6;
  } else if (y < 1700) {
    t = y - 1600;
    dt = 120 - 0.9808*t - 0.01532*t*t + t*t*t/7129;
  } else if (y < 1800) {
    t = y - 1700;
    dt = 8.83 + 0.1603*t - 0.0059285*t*t + 0.00013336*t*t*t - t**4/1174000;
  } else if (y < 1860) {
    t = y - 1800;
    dt = 13.72 - 0.332447*t + 0.0068612*t*t + 0.0041116*t**3 - 0.00037436*t**4
      + 0.0000121272*t**5 - 0.0000001699*t**6 + 0.000000000875*t**7;
  } else if (y < 1900) {
    t = y - 1860;
    dt = 7.62 + 0.5737*t - 0.251754*t*t + 0.01680668*t**3
      - 0.0004473624*t**4 + t**5/233174;
  } else if (y < 1920) {
    t = y - 1900;
    dt = -2.79 + 1.494119*t - 0.0598939*t*t + 0.0061966*t**3 - 0.000197*t**4;
  } else if (y < 1941) {
    t = y - 1920;
    dt = 21.20 + 0.84493*t - 0.076100*t*t + 0.0020936*t**3;
  } else if (y < 1961) {
    t = y - 1950;
    dt = 29.07 + 0.407*t - t*t/233 + t**3/2547;
  } else if (y < 1986) {
    t = y - 1975;
    dt = 45.45 + 1.067*t - t*t/260 - t**3/718;
  } else if (y < 2005) {
    t = y - 2000;
    dt = 63.86 + 0.3345*t - 0.060374*t*t + 0.0017275*t**3
      + 0.000651814*t**4 + 0.00002373599*t**5;
  } else if (y < 2050) {
    t = y - 2000;
    dt = 62.92 + 0.32217*t + 0.005589*t*t;
  } else if (y < 2150) {
    u = (y - 1820) / 100;
    dt = -20 + 32*u*u - 0.5628*(2150 - y);
  } else {
    u = (y - 1820) / 100;
    dt = -20 + 32 * u * u;
  }
  return dt;
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

// IAU 1976 precession angles (Lieske 1979) for century T = (JD - J2000) / 36525.
// Returns {zetaA, zA, thetaA} in radians.
function precessAngles(T) {
  const a = DEG / 3600;
  const T2 = T * T, T3 = T2 * T;
  return {
    zetaA:  (2306.2181 * T + 0.30188 * T2 + 0.017998 * T3) * a,
    zA:     (2306.2181 * T + 1.09468 * T2 + 0.018203 * T3) * a,
    thetaA: (2004.3109 * T - 0.42665 * T2 - 0.041775 * T3) * a
  };
}

// Precess a single star from J2000 to date. ra0/dec0 in radians (J2000),
// pp from precessAngles(). Returns [ra, dec] in radians (of date).
function precessStar(ra0, dec0, pp) {
  const cosD = cos(dec0), sinD = sin(dec0);
  const cosT = cos(pp.thetaA), sinT = sin(pp.thetaA);
  const raZ = ra0 + pp.zetaA;
  const A = cosD * sin(raZ);
  const B = cosT * cosD * cos(raZ) - sinT * sinD;
  const C = sinT * cosD * cos(raZ) + cosT * sinD;
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

// Angular separation between two unit vectors using the haversine approach:
// chord = |v2 - v1|, sep = 2 * asin(chord / 2). Stable for small angles
// unlike acos(dot) which loses precision when vectors are nearly parallel.
function angSep(x1, y1, z1, x2, y2, z2) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  return 2 * asin(min(1, sqrt(dx * dx + dy * dy + dz * dz) / 2));
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
// j2000: if true, return J2000 mean frame (no precession/nutation) for equatorial/ecliptic.
// Returns a 3×3 rotation matrix (9-element row-major array).
function frameMatrix(frame, jd, latRad, lonDeg, j2000) {
  if (j2000 && frame === 'equatorial') return [1,0,0, 0,1,0, 0,0,1];
  if (j2000 && frame === 'ecliptic')   return rx(-obliquity(0));
  const T = (jd - 2451545.0) / 36525.0;
  const pp = precessAngles(T);
  const nut = nutation(T);
  const epsMean = obliquity(T);
  const epsTrue = epsMean + nut.dEps;
  const eqEq = nut.dPsi * cos(epsTrue);
  const lstR = (localSiderealTime(jd, lonDeg) + eqEq * RAD) * DEG;
  const cosT = cos(pp.thetaA), sinT = sin(pp.thetaA);
  const mPrecY = [cosT,0,-sinT, 0,1,0, sinT,0,cosT];
  const mPrecOnly = mmul(rz(pp.zA), mmul(mPrecY, rz(pp.zetaA)));
  const mNut = mmul(rx(-epsTrue), mmul(rz(-nut.dPsi), rx(epsMean)));
  const mPrecess = mmul(mNut, mPrecOnly);
  if (frame === 'horizon') {
    const mEqAz = mmul(rx(latRad - PI/2), rz(-PI/2 - lstR));
    return mmul(mEqAz, mPrecess);
  } else if (frame === 'equatorial') {
    return mPrecess;
  } else if (frame === 'ecliptic') {
    return mmul(rx(-epsTrue), mPrecess);
  } else {
    return mGalactic;
  }
}

