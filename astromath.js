// ---- Constants ----
const {PI, sin, cos, tan, atan2, sqrt, abs, max, min, round, floor, ceil, asin, pow} = Math;
const TAU = 2 * PI;
const DEG_TO_RAD = PI / 180;       // multiply degrees by this to get radians
const RAD_TO_DEG = 180 / PI;       // multiply radians by this to get degrees
const REFRACTION_ALT = -34 / 60 * DEG_TO_RAD;  // standard atmospheric refraction at horizon (radians)
const AU_PER_PC  = 206264.806247;
const AU_PER_LY  = 63241.077084;
const KM_PER_AU  = 149597870.7;
const LY_PER_PC  = AU_PER_PC / AU_PER_LY;  // 1 parsec in light years (≈3.26156)
const PC_PER_LY  = AU_PER_LY / AU_PER_PC;  // 1 light year in parsecs (≈0.306601)

const pad2 = v => String(v).padStart(2, '0');  // zero-pad a number to 2 digits

function mod360(deg) { return ((deg % 360) + 360) % 360; }
function mod2pi(rad) { return ((rad % TAU) + TAU) % TAU; }
function atan2pi(y, x) { return mod2pi(atan2(y, x)); }

/* ----------------------------------------------------------------
   Angle formatting and parsing utilities.
   All degree-based: RA in 0–360, Dec in -90–+90, DMS unsigned.
---------------------------------------------------------------- */

function formatRA(raDeg) {
    raDeg = ((raDeg % 360) + 360) % 360;
    var totalSec = Math.round(raDeg / 15 * 36000) / 10;
    if (totalSec >= 86400) totalSec = 0;
    var hh = Math.floor(totalSec / 3600);
    var mm = Math.floor((totalSec % 3600) / 60);
    var ss = (totalSec % 60).toFixed(1);
    return String(hh).padStart(2,'0') + 'h ' + String(mm).padStart(2,'0') + 'm ' + ss.padStart(4,'0') + 's';
}

function formatDec(decDeg) {
    var sign = decDeg < 0 ? '-' : '+';
    var totalArcsec = Math.round(Math.abs(decDeg) * 3600);
    var dd = Math.floor(totalArcsec / 3600);
    var mm = Math.floor((totalArcsec % 3600) / 60);
    var ss = totalArcsec % 60;
    return sign + String(dd).padStart(2,'0') + '° ' + String(mm).padStart(2,'0') + "' " + String(ss).padStart(2,'0') + '"';
}

// Unsigned only — deg must be >= 0. NOT for declination (which is signed,
// -90..+90): use formatDec() for that. Callers with a signed value (e.g.
// longitude) must take Math.abs() and prepend their own sign/hemisphere
// letter, as formatLonLat() does.
function formatDMS(deg) {
    var d = Math.floor(deg);
    var mf = (deg - d) * 60;
    var m = Math.floor(mf);
    var s = Math.round((mf - m) * 60);
    if (s >= 60) { s = 0; m += 1; }
    if (m >= 60) { m = 0; d += 1; }
    return d + '° ' + String(m).padStart(2,'0') + "' " + String(s).padStart(2,'0') + '"';
}

function parseDMS(str) {
    str = (str || '').trim();
    var m = str.match(/^(\d+(?:\.\d+)?)\s*°(?:\s*(\d+(?:\.\d+)?)\s*'(?:\s*(\d+(?:\.\d+)?)\"?)?)?$/);
    if (m) return parseFloat(m[1]) + (m[2] ? parseFloat(m[2]) / 60 : 0) + (m[3] ? parseFloat(m[3]) / 3600 : 0);
    m = str.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/);
    if (m) return parseFloat(m[1]) + parseFloat(m[2]) / 60 + (m[3] ? parseFloat(m[3]) / 3600 : 0);
    m = str.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?$/);
    if (m) return parseFloat(m[1]) + parseFloat(m[2]) / 60 + (m[3] ? parseFloat(m[3]) / 3600 : 0);
    var v = parseFloat(str);
    return isNaN(v) ? null : v;
}

function parseRA(str) {
    str = str.trim();
    var hours = null;
    var m = str.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+(?:\.\d+)?)\s*m(?:\s*(\d+(?:\.\d+)?)\s*s?)?)?$/i);
    if (m) hours = parseFloat(m[1]) + (m[2] ? parseFloat(m[2]) / 60 : 0) + (m[3] ? parseFloat(m[3]) / 3600 : 0);
    if (hours === null) {
        m = str.match(/^(\d+(?:\.\d+)?)[:\s](\d+(?:\.\d+)?)(?:[:\s](\d+(?:\.\d+)?))?$/);
        if (m) hours = parseFloat(m[1]) + parseFloat(m[2]) / 60 + (m[3] ? parseFloat(m[3]) / 3600 : 0);
    }
    if (hours === null) {
        m = str.match(/^(\d+(?:\.\d+)?)\s*h?$/i);
        if (m) hours = parseFloat(m[1]);
    }
    if (hours === null || isNaN(hours) || hours < 0 || hours >= 24) return null;
    return hours * 15;
}

function parseDec(str) {
    str = str.trim();
    var deg = null;
    var sign = str.startsWith('-') ? -1 : 1;
    var abs = str.replace(/^[+-]/, '');
    var m = abs.match(/^(\d+(?:\.\d+)?)\s*°(?:\s*(\d+(?:\.\d+)?)\s*'(?:\s*(\d+(?:\.\d+)?)\s*"?)?)?$/);
    if (m) deg = sign * (parseFloat(m[1]) + (m[2] ? parseFloat(m[2]) / 60 : 0) + (m[3] ? parseFloat(m[3]) / 3600 : 0));
    if (deg === null) {
        m = abs.match(/^(\d+(?:\.\d+)?)[:\s](\d+(?:\.\d+)?)(?:[:\s](\d+(?:\.\d+)?))?$/);
        if (m) deg = sign * (parseFloat(m[1]) + parseFloat(m[2]) / 60 + (m[3] ? parseFloat(m[3]) / 3600 : 0));
    }
    if (deg === null) {
        m = abs.match(/^(\d+(?:\.\d+)?)°?$/);
        if (m) deg = sign * parseFloat(m[1]);
    }
    if (deg === null || isNaN(deg) || deg < -90 || deg > 90) return null;
    return deg;
}

function formatLonLat(lonDeg, latDeg) {
    if (lonDeg == null || latDeg == null) return null;
    var ew = lonDeg >= 0 ? 'E' : 'W';
    var ns = latDeg >= 0 ? 'N' : 'S';
    // Reuses formatDMS's rounding-carry guard (59.9999" must become 1' 0.0", not
    // display as an invalid "60"") instead of re-deriving D/M/S inline.
    return 'Lon ' + formatDMS(Math.abs(lonDeg)) + ' ' + ew +
         '  Lat ' + formatDMS(Math.abs(latDeg)) + ' ' + ns;
}

// ---- Vector helpers ----

// Dot product of two 3-vectors.
function dot(x1, y1, z1, x2, y2, z2) {
  return x1 * x2 + y1 * y2 + z1 * z2;
}

// Cross product of two 3-vectors. Returns [x, y, z].
function cross(x1, y1, z1, x2, y2, z2) {
  return [y1 * z2 - z1 * y2, z1 * x2 - x1 * z2, x1 * y2 - y1 * x2];
}

// Magnitude (length) of a 3-vector.
function vmag(x, y, z) {
  return sqrt(x * x + y * y + z * z);
}

// Angular separation between two unit vectors using the haversine approach:
// chord = |v2 - v1|, sep = 2 * asin(chord / 2). Stable for small angles
// unlike acos(dot) which loses precision when vectors are nearly parallel.
function angSep(x1, y1, z1, x2, y2, z2) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  return 2 * asin(min(1, vmag(dx, dy, dz) / 2));
}

// Position angle from unit vector (x1,y1,z1) to unit vector (x2,y2,z2),
// measured north through east in radians. z-axis is the pole.
function posAng(x1, y1, z1, x2, y2, z2) {
  const nz = sqrt(1 - z1 * z1);
  if (nz === 0) return 0;
  const ex = -y1 / nz, ey = x1 / nz;
  const nx = -x1 * z1 / nz, ny = -y1 * z1 / nz;
  return atan2(ex * x2 + ey * y2, nx * x2 + ny * y2 + nz * z2);
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
// Cartesian → spherical. Returns [lon, lat, r] in radians; lon is already in [0, 2π) (see atan2pi).
function xyz2sph(x, y, z) {
  return [atan2pi(y, x), atan2(z, sqrt(x * x + y * y)), vmag(x, y, z)];
}
// Unit-sphere inverse: Cartesian → [lon, lat] in radians (ignores radius); lon is already in [0, 2π).
function uxyz2sph(x, y, z) {
  return [atan2pi(y, x), atan2(z, sqrt(x * x + y * y))];
}

// ---- Matrix helpers ----
// All matrices are 3×3, stored as 9-element flat arrays in row-major order.

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

// Greenwich Mean Sidereal Time from Julian Date. Returns radians [0, 2π).
function gmst(jd) {
  const T = (jd - 2451545.0) / 36525.0;
  let g = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - T * T * T / 38710000;
  return mod360(g) * DEG_TO_RAD;
}

// Local Sidereal Time. jd = Julian Date, lonRad = observer longitude (radians east).
// Returns radians [0, 2π).
function localSiderealTime(jd, lonRad) {
  return mod2pi(gmst(jd) + lonRad);
}

// ---- Rise / Transit / Set ----

// Compute a single rise, transit, or set time, anchored near a given time.
// Meeus "Astronomical Algorithms" Ch.15, adapted so the anchor time doubles as
// the point the returned event is chosen nearest to (Newton-style): calling
// this repeatedly, each time re-evaluating raRad/decRad and re-anchoring at the
// previous result, converges on the true event time even for fast movers like
// the Moon. See riseTransitSetIterative() below, which does exactly that.
//   raRad, decRad: apparent (of-date) equatorial coordinates (radians), evaluated
//     at (or near) `jd`
//   jd: anchor time (Julian Date, UT) — both the sidereal-time reference and the
//     point the returned event time is chosen nearest to
//   latRad: observer geodetic latitude in radians
//   lonRad: observer longitude in radians (east positive)
//   h0Rad: altitude of the geometric center at rise/set (radians); ignored for
//     transit (rtsFlag === 0)
//   rtsFlag: -1 = rise, 0 = transit, +1 = set
// Returns { status, jd }: jd is the event's JD (UT) when status is 'normal',
// else null. status: 'normal', 'never-rises', or 'never-sets' (circumpolar).
function riseTransitSet(raRad, decRad, jd, latRad, lonRad, h0Rad, rtsFlag) {
  const cosPhi = cos(latRad), sinPhi = sin(latRad);
  const cosDec = cos(decRad), sinDec = sin(decRad);
  const denom = cosPhi * cosDec;
  if (abs(denom) < 1e-15)
    return { status: decRad * sinPhi >= 0 ? 'never-sets' : 'never-rises', jd: null };

  // Hour angle magnitude at rise/set (the object crosses h0Rad at ±HA from
  // transit). Only needed for rise/set — transit is always at HA = 0 regardless
  // of h0Rad, so it's skipped (and computed even when the object is circumpolar,
  // since a circumpolar object still transits once per sidereal day).
  let HA = 0;
  if (rtsFlag !== 0) {
    const cosHA = (sin(h0Rad) - sinPhi * sinDec) / denom;
    if (cosHA <= -1) return { status: 'never-sets', jd: null };
    if (cosHA >= 1) return { status: 'never-rises', jd: null };
    HA = Math.acos(cosHA);
  }

  const SRATE = TAU * 1.00273790935;
  const SID_DAY = TAU / SRATE;
  let m0 = (raRad - lonRad - gmst(jd)) / SRATE;
  // Wrap to the transit nearest `jd` (within half a sidereal day) rather than to
  // some fixed reference, so repeated calls converge on the occurrence closest
  // to the current guess instead of snapping to an arbitrary cycle.
  m0 = ((m0 + SID_DAY / 2) % SID_DAY + SID_DAY) % SID_DAY - SID_DAY / 2;

  return { status: 'normal', jd: jd + m0 + rtsFlag * HA / SRATE };
}

// Iteratively refine a rise/transit/set time by re-evaluating the object's
// position at each pass's current best guess — needed because a fast mover's
// (the Moon especially) RA/Dec can't be treated as fixed for the whole day the
// way a star's can. Starts from local noon; each pass feeds the previous
// result's time back into getRaDec() and riseTransitSet(). The final time is
// checked against the local calendar day's bounds, since a fast mover
// occasionally has no rise/transit/set at all on a given day (or two, on the
// day it happens twice) — a real consequence of the sidereal/solar day mismatch.
//   getRaDec(jd): callback returning {ra, dec} (radians, of-date apparent) for
//     the body at the given JD
//   jd0: JD (UT) of local midnight (start of the local calendar day queried)
//   iterations: refinement passes (default 3; use 1 for near-fixed objects like
//     stars/deep-sky, where a single pass already converges)
// Returns { status, jd }: status adds 'none' to riseTransitSet()'s statuses,
// for "does not occur within this local calendar day".
function riseTransitSetIterative(getRaDec, jd0, latRad, lonRad, h0Rad, rtsFlag, iterations) {
  if (iterations === undefined) iterations = 3;
  const SID_DAY = 1 / 1.00273790935;
  let t = jd0 + 0.5;
  let result;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < iterations; i++) {
      const pos = getRaDec(t);
      result = riseTransitSet(pos.ra, pos.dec, t, latRad, lonRad, h0Rad, rtsFlag);
      if (result.status !== 'normal') return result;
      t = result.jd;
    }
    if (result.jd >= jd0 && result.jd < jd0 + 1) return result;
    // Nearest-transit heuristic locked onto the adjacent sidereal cycle.
    // Shift toward the day and re-iterate; for genuinely absent events (Moon)
    // the second pass also lands outside the day.
    t = result.jd + (result.jd < jd0 ? SID_DAY : -SID_DAY);
  }
  return { status: 'none', jd: null };
}

// ---- IAU 1976 Precession ----

// IAU 1976 precession angles (Lieske 1979) for century T = (JD - J2000) / 36525.
// Returns {zetaA, zA, thetaA} in radians.
function precessAngles(T) {
  const a = DEG_TO_RAD / 3600;
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
  return (23.439291 - 0.013004 * T) * DEG_TO_RAD;
}

// IAU 1980 nutation, 3 dominant terms (~arcsecond accuracy).
// T = Julian centuries from J2000. Returns {dPsi, dEps} in radians.
function nutation(T) {
  const Om    = (125.04452 - 1934.136261 * T) * DEG_TO_RAD;
  const Lsun  = (280.46646 + 36000.76983 * T) * DEG_TO_RAD;
  const Lmoon = (218.31654 + 481267.88134 * T) * DEG_TO_RAD;
  const dPsi = (-17.1996 * sin(Om) - 1.3187 * sin(2*Lsun) - 0.2274 * sin(2*Lmoon)) / 3600 * DEG_TO_RAD;
  const dEps = ( 9.2025 * cos(Om) + 0.5736 * cos(2*Lsun) + 0.0977 * cos(2*Lmoon)) / 3600 * DEG_TO_RAD;
  return { dPsi, dEps };
}

// Bennett's formula: true geometric alt → apparent alt (degrees).
function refractionTrue2App(altDeg) {
  if (altDeg < -0.5) return altDeg;
  return altDeg + 1 / tan((altDeg + 7.31 / (altDeg + 4.4)) * DEG_TO_RAD) / 60;
}

// Saemundsson's formula: apparent alt → true geometric alt (degrees).
function refractionApp2True(altDeg) {
  if (altDeg < -0.5) return altDeg;
  return altDeg - 1.02 / tan((altDeg + 10.3 / (altDeg + 5.11)) * DEG_TO_RAD) / 60;
}

// ---- Coordinate transforms ----

// Ecliptic → equatorial. lam/beta/eps all in radians (of date).
// Returns [ra, dec] in radians; ra is already in [0, 2π) (see atan2pi).
function eclToEq(lam, beta, eps) {
  const ce = cos(eps), se = sin(eps);
  const cb = cos(beta), sb = sin(beta);
  const cl = cos(lam), sl = sin(lam);
  const x = cb * cl;
  const y = cb * sl * ce - sb * se;
  const z = cb * sl * se + sb * ce;
  return [atan2pi(y, x), asin(max(-1, min(1, z)))];
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

// 3×3 rotation matrix (row-major flat array) from J2000 equatorial to galactic coordinates.
// Galactic north pole: RA 192.85948°, Dec +27.12825° (J2000)
// Galactic center:     RA 266.405°,   Dec -28.936°  (J2000)
const mGalactic = (function() {
  const pRA = 192.85948 * DEG_TO_RAD, pDec = 27.12825 * DEG_TO_RAD;
  const cRA = 266.405 * DEG_TO_RAD, cDec = -28.936 * DEG_TO_RAD;
  const pz = [cos(pDec)*cos(pRA), cos(pDec)*sin(pRA), sin(pDec)];
  const gc = [cos(cDec)*cos(cRA), cos(cDec)*sin(cRA), sin(cDec)];
  const d = dot(pz[0],pz[1],pz[2], gc[0],gc[1],gc[2]);
  const px = [gc[0] - pz[0]*d, gc[1] - pz[1]*d, gc[2] - pz[2]*d];
  const pxLen = vmag(px[0], px[1], px[2]);
  px[0] /= pxLen; px[1] /= pxLen; px[2] /= pxLen;
  const py = cross(pz[0],pz[1],pz[2], px[0],px[1],px[2]);
  return [px[0],px[1],px[2], py[0],py[1],py[2], pz[0],pz[1],pz[2]];
})();

// ---- Frame rotation matrices ----

// Build the J2000 equatorial → target frame rotation matrix.
// frame: 'horizon', 'equatorial', 'ecliptic', or 'galactic'.
// jd: Julian Date. latRad: observer latitude (radians). lonRad: observer longitude (radians east).
// j2000: if true, return J2000 mean frame (no precession/nutation) for equatorial/ecliptic.
// Returns a 3×3 rotation matrix (9-element row-major array).
function frameMatrix(frame, jd, latRad, lonRad, j2000) {
  if (j2000 && frame === 'equatorial') return [1,0,0, 0,1,0, 0,0,1];
  if (j2000 && frame === 'ecliptic')   return rx(-obliquity(0));
  const T = (jd - 2451545.0) / 36525.0;
  const pp = precessAngles(T);
  const nut = nutation(T);
  const epsMean = obliquity(T);
  const epsTrue = epsMean + nut.dEps;
  const eqEq = nut.dPsi * cos(epsTrue);
  const lstR = localSiderealTime(jd, lonRad) + eqEq;
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

// ---- Image frame (gnomonic/tangent-plane projection) ----

// Create an image frame for astrometry.
// raRad, decRad: center J2000 mean equatorial (radians).
// orient: position angle of image "up" at center (radians, 0 = toward NCP, increasing through east).
// width, height: image dimensions in pixels.
// fovX, fovY: angular field of view corresponding to width/height (radians).
// mirror: if true, the image is horizontally flipped (East increases to the right in pixel coords,
//   as produced by some telescope/camera configurations). Default false (standard: East = left).
//   Encoded as a negative scaleX so the projection formulas work unchanged.
function ImageFrame(raRad, decRad, orient, width, height, fovX, fovY, mirror) {
  this.ra = raRad;
  this.dec = decRad;
  this.orient = orient;
  this.width = width;
  this.height = height;
  this.fovX = fovX;
  this.fovY = fovY;
  this.scaleX = width / fovX * (mirror ? -1 : 1);
  this.scaleY = height / fovY;
  this.mirror = mirror || false;

  // J2000 → image frame: rz(-ra) aligns center to xz plane,
  // ry(dec - π/2) tips center to z-axis, rz(-π/2 - orient) rotates about boresight.
  this.m = mmul(rz(-PI / 2 - orient), mmul(ry(decRad - PI / 2), rz(-raRad)));
  this.mt = mtranspose(this.m);
}

// Project J2000 mean equatorial unit vector to image pixel coordinates.
// Returns [px, py] with (0,0) at top-left, or null if behind the tangent plane.
// X is negated so East maps to decreasing pixel X (left); a negative scaleX (mirror) cancels this.
ImageFrame.prototype.skyXYZtoPixelXY = function(jx, jy, jz) {
  const [ix, iy, iz] = mvmul(this.m, jx, jy, jz);
  if (iz <= 0) return null;
  return [this.width / 2 - ix / iz * this.scaleX, this.height / 2 - iy / iz * this.scaleY];
};

// Unproject image pixel coordinates to J2000 mean equatorial unit vector.
// Returns [jx, jy, jz].
ImageFrame.prototype.pixelXYtoSkyXYZ = function(px, py) {
  const tx = (this.width / 2 - px) / this.scaleX;
  const ty = (this.height / 2 - py) / this.scaleY;
  const [x, y, z] = mvmul(this.mt, tx, ty, 1);
  const r = sqrt(x * x + y * y + z * z);
  return [x / r, y / r, z / r];
};

// Project J2000 (ra, dec) in radians to image pixel coordinates.
// Returns [px, py] with (0,0) at top-left, or null if behind the tangent plane.
ImageFrame.prototype.raDecToPixelXY = function(raRad, decRad) {
  const p = sph2uxyz(raRad, decRad);
  return this.skyXYZtoPixelXY(p[0], p[1], p[2]);
};

// Unproject image pixel coordinates to J2000 (ra, dec) in radians.
// Returns [ra, dec] in radians.
ImageFrame.prototype.pixelXYtoRADec = function(px, py) {
  const p = this.pixelXYtoSkyXYZ(px, py);
  return uxyz2sph(p[0], p[1], p[2]);
};

// Solve for an ImageFrame from N reference stars with known sky positions and pixel positions.
// stars: array of {jx, jy, jz, px, py} where (jx,jy,jz) is a J2000 unit vector
//        and (px,py) is the corresponding image pixel position.
// width, height: image dimensions in pixels.
// Requires at least 3 stars. With exactly 3, the solution is exact; with more,
// it is a least-squares fit that minimizes the sum of squared pixel residuals.
//
// Returns {frame, residuals} where frame is an ImageFrame and residuals is an array
// of per-star pixel errors (distance in pixels between observed and predicted position).
// Returns null if the solve fails (e.g. fewer than 3 stars, or degenerate geometry).
//
// Method:
// 1. Estimate the boresight (image center direction) from the mean of all star unit vectors.
// 2. Project each star onto the tangent plane at that boresight using gnomonic projection,
//    giving standard coordinates (xi, eta) in radians.
// 3. Solve two independent least-squares problems for the affine mapping from standard
//    coordinates to pixel coordinates:
//      px = a*xi + b*eta + e
//      py = c*xi + d*eta + f
//    using the normal equations (A^T A x = A^T b) where A is the Nx3 matrix [xi, eta, 1].
// 4. Detect mirroring from the sign of the affine determinant (a·d - b·c):
//      positive = standard (East = left), negative = mirrored (East = right).
//    Extract plate scale and orientation from the affine coefficients:
//      scaleX = sqrt(a^2 + b^2)   pixels per radian in the image-x direction
//      scaleY = sqrt(c^2 + d^2)   pixels per radian in the image-y direction
//      orient = atan2(-b, -a) for standard, atan2(b, a) for mirrored
// 5. Refine the boresight: the affine offsets (e, f) give the pixel position where the
//    tangent point (initial boresight estimate) projects. The true image center is at
//    (width/2, height/2), so the offset tells us how far off the initial estimate was.
//    Unproject (width/2, height/2) through the affine inverse back to the tangent plane,
//    then rotate from the tangent plane back to J2000 to get the refined boresight.
// 6. Compute per-star residuals by projecting each star through the resulting ImageFrame
//    and measuring the pixel distance from the observed position.

function solveImageFrame(stars, width, height) {
  if (!stars || stars.length < 3) return null;
  const n = stars.length;

  // Step 1: estimate boresight as the mean direction of all star unit vectors.
  let bx = 0, by = 0, bz = 0;
  for (let i = 0; i < n; i++) { bx += stars[i].jx; by += stars[i].jy; bz += stars[i].jz; }
  let bLen = sqrt(bx * bx + by * by + bz * bz);
  if (bLen < 1e-10) return null;
  bx /= bLen; by /= bLen; bz /= bLen;

  // Iterate: project stars onto the tangent plane at the current boresight estimate,
  // solve the affine mapping, refine the boresight from the affine offset, and repeat.
  // The first pass uses the mean-direction estimate; subsequent passes use the refined
  // center. Two iterations converge to sub-milliarcsecond / sub-millipixel accuracy.
  let refRA, refDec, orient, scaleX, scaleY, mirror;
  for (let iter = 0; iter < 2; iter++) {

    // Build a rotation matrix from J2000 to the tangent plane at the current boresight.
    // Same decomposition as ImageFrame with orient=0: rz(-π/2) · ry(dec-π/2) · rz(-ra).
    const [bRA, bDec] = uxyz2sph(bx, by, bz);
    const mBore = mmul(rz(-PI / 2), mmul(ry(bDec - PI / 2), rz(-bRA)));

    // Project each star onto the tangent plane via gnomonic projection.
    // Rotate into the boresight frame, then divide by iz to get
    // standard coordinates (xi, eta) in radians on the tangent plane.
    const xi = new Array(n), eta = new Array(n);
    let bad = false;
    for (let i = 0; i < n; i++) {
      const [ix, iy, iz] = mvmul(mBore, stars[i].jx, stars[i].jy, stars[i].jz);
      if (iz <= 0) { bad = true; break; }  // star is behind the tangent plane
      xi[i] = ix / iz;
      eta[i] = iy / iz;
    }
    if (bad) return null;

    // Solve two least-squares problems via normal equations.
    // Affine model:  px = a·ξ + b·η + e
    //                py = c·ξ + d·η + f
    // Build the 3×3 normal matrix AᵀA and the right-hand-side vectors Aᵀpx, Aᵀpy.
    // AᵀA is the same for both; only the right-hand side differs.
    let s00 = 0, s01 = 0, s02 = 0, s11 = 0, s12 = 0, s22 = 0;
    let rpx0 = 0, rpx1 = 0, rpx2 = 0;
    let rpy0 = 0, rpy1 = 0, rpy2 = 0;
    for (let i = 0; i < n; i++) {
      const x = xi[i], e2 = eta[i];
      s00 += x * x;    s01 += x * e2;  s02 += x;
      s11 += e2 * e2;  s12 += e2;      s22 += 1;
      rpx0 += x * stars[i].px;   rpx1 += e2 * stars[i].px;  rpx2 += stars[i].px;
      rpy0 += x * stars[i].py;   rpy1 += e2 * stars[i].py;  rpy2 += stars[i].py;
    }

    // Solve the 3×3 symmetric system using Cramer's rule.
    const det = s00 * (s11 * s22 - s12 * s12)
              - s01 * (s01 * s22 - s12 * s02)
              + s02 * (s01 * s12 - s11 * s02);
    if (abs(det) < 1e-30) return null;  // singular — stars are collinear or coincident
    const invDet = 1 / det;

    // Cofactor matrix (transposed = inverse × det, since M is symmetric).
    const c00 = s11 * s22 - s12 * s12;
    const c01 = s02 * s12 - s01 * s22;
    const c02 = s01 * s12 - s02 * s11;
    const c11 = s00 * s22 - s02 * s02;
    const c12 = s01 * s02 - s00 * s12;
    const c22 = s00 * s11 - s01 * s01;

    // Affine coefficients for px = a·ξ + b·η + e
    const a = (c00 * rpx0 + c01 * rpx1 + c02 * rpx2) * invDet;
    const b = (c01 * rpx0 + c11 * rpx1 + c12 * rpx2) * invDet;
    const e = (c02 * rpx0 + c12 * rpx1 + c22 * rpx2) * invDet;

    // Affine coefficients for py = c·ξ + d·η + f
    const c = (c00 * rpy0 + c01 * rpy1 + c02 * rpy2) * invDet;
    const d = (c01 * rpy0 + c11 * rpy1 + c12 * rpy2) * invDet;
    const f = (c02 * rpy0 + c12 * rpy1 + c22 * rpy2) * invDet;

    // Extract plate scale and orientation from affine coefficients.
    // The affine matrix [[a, b], [c, d]] maps tangent-plane (ξ, η) to pixels.
    // For standard images (East = left, affDet > 0):
    //   a = -cos(orient) · scaleX,  b = -sin(orient) · scaleX
    // For mirrored images (East = right, affDet < 0):
    //   a =  cos(orient) · scaleX,  b =  sin(orient) · scaleX
    const affDet = a * d - b * c;
    if (abs(affDet) < 1e-30) return null;
    mirror = affDet < 0;
    scaleX = sqrt(a * a + b * b);
    scaleY = sqrt(c * c + d * d);
    if (scaleX < 1e-10 || scaleY < 1e-10) return null;
    orient = mirror ? atan2pi(b, a) : atan2pi(-b, -a);

    // Refine the boresight.
    // The affine offset (e, f) is where the current boresight estimate lands in pixel space.
    // The true image center is at (width/2, height/2). Invert the affine transform to find
    // the tangent-plane coordinates of the true center, then rotate back to J2000.
    const ctrPx = width / 2 - e;
    const ctrPy = height / 2 - f;
    const ctrXi  = ( d * ctrPx - b * ctrPy) / affDet;
    const ctrEta = (-c * ctrPx + a * ctrPy) / affDet;

    // Convert tangent-plane offset back to a J2000 unit vector.
    // The tangent-plane point (ctrXi, ctrEta) in the boresight frame is direction (ctrXi, ctrEta, 1).
    // Rotate back to J2000 via the transpose of mBore and normalize.
    const mBoreT = mtranspose(mBore);
    const [rx, ry2, rz2] = mvmul(mBoreT, ctrXi, ctrEta, 1);
    const rLen = sqrt(rx * rx + ry2 * ry2 + rz2 * rz2);
    bx = rx / rLen; by = ry2 / rLen; bz = rz2 / rLen;
    [refRA, refDec] = uxyz2sph(bx, by, bz);
  }

  // Build the final ImageFrame and compute per-star residuals.
  const fovX = width / scaleX;
  const fovY = height / scaleY;
  const frame = new ImageFrame(refRA, refDec, orient, width, height, fovX, fovY, mirror);

  const residuals = new Array(n);
  for (let i = 0; i < n; i++) {
    const pred = frame.skyXYZtoPixelXY(stars[i].jx, stars[i].jy, stars[i].jz);
    if (!pred) { residuals[i] = Infinity; continue; }
    const dx = pred[0] - stars[i].px, dy = pred[1] - stars[i].py;
    residuals[i] = sqrt(dx * dx + dy * dy);
  }

  return { frame, residuals };
}

