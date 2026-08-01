// satpass.js - Satellite pass computation
// Finds all passes of an artificial satellite above a horizon altitude threshold,
// as seen from a specific location on Earth, over a given Julian Date range.
// Uses SGP4/SDP4 propagation, WGS84 observer position, and Schlyter Sun position
// for eclipse detection.

// Compute satellite topocentric alt/az and eclipse status at a given JD.
// sat = parsed TLE satellite object (for sgp4Propagate)
// jd = Julian Date (UTC)
// latRad, lonRad = observer geodetic coordinates (radians)
// Returns { alt, az, eclipsed } where alt/az are in radians, or null if propagation fails.
function satState(sat, jd, latRad, lonRad) {
  const tsince = (jd - sat.epoch) * 1440;
  let rv;
  try { rv = sgp4Propagate(sat, tsince); } catch(e) { return null; }
  if (!rv) return null;
  const [gx, gy, gz] = rv.pos;

  // Observer geocentric position in Earth-radii (WGS84 ellipsoid),
  // oriented in the TEME frame using GMST + observer longitude.
  const gmstRad = gmst(jd);
  const lstR = gmstRad + lonRad;
  const [obsX, obsY, obsZ] = geocentricXYZ(lstR, latRad);

  // Topocentric vector in TEME frame
  const dx = gx - obsX, dy = gy - obsY, dz = gz - obsZ;
  const [topoRA, topoDec] = uxyz2sph(dx, dy, dz);

  // Alt/az using GMST-based LST (TEME ≈ true equatorial)
  const [alt, az] = eqToAltAz(topoRA, topoDec, lstR, latRad);

  // Sun direction in TEME for eclipse test.
  // Schlyter Sun gives ecliptic of-date; convert to equatorial of-date (≈ TEME).
  const d = jd - 2451543.5;
  const sunPos = sunPosition(d);
  const eps = obliquity((jd - JD2000) / 36525);
  const [sunRA, sunDec] = eclToEq(sunPos.lon, sunPos.lat, eps);
  const [sunTx, sunTy, sunTz] = sph2uxyz(sunRA, sunDec);

  // Cylindrical Earth-shadow test (Earth radius = 1 in SGP4 units)
  const eclipsed = inUmbralShadow(gx, gy, gz, sunTx, sunTy, sunTz, 1);

  // Apparent visual magnitude (Infinity if eclipsed or no McCants entry defaults to +6.0)
  const mag = satApparentMag(sat.norad, gx, gy, gz, obsX, obsY, obsZ, sunTx, sunTy, sunTz);

  return { alt, az, eclipsed, mag };
}

// Find the JD within [jd0, jd1] where satellite altitude is closest to altThresh.
// Searches at 1-second intervals for ~1 second precision.
function refineAltCrossing(sat, jd0, jd1, latRad, lonRad, altThresh) {
  const step = 1 / 86400;
  let bestJD = jd0;
  let bestDiff = Infinity;
  for (let jd = jd0; jd <= jd1; jd += step) {
    const s = satState(sat, jd, latRad, lonRad);
    if (!s) continue;
    const diff = abs(s.alt - altThresh);
    if (diff < bestDiff) { bestDiff = diff; bestJD = jd; }
  }
  return bestJD;
}

// Find the JD within [jd0, jd1] where satellite altitude is maximum.
// Searches at 1-second intervals for ~1 second precision.
function refineCulmination(sat, jd0, jd1, latRad, lonRad) {
  const step = 1 / 86400;
  let bestJD = jd0;
  let bestAlt = -HALFPI;
  for (let jd = jd0; jd <= jd1; jd += step) {
    const s = satState(sat, jd, latRad, lonRad);
    if (!s) continue;
    if (s.alt > bestAlt) { bestAlt = s.alt; bestJD = jd; }
  }
  return bestJD;
}

// Find the JD within [jd0, jd1] where eclipse status changes.
// Searches at 1-second intervals for ~1 second precision.
function refineEclipseTransition(sat, jd0, jd1, latRad, lonRad) {
  const step = 1 / 86400;
  let prev = null;
  for (let jd = jd0; jd <= jd1; jd += step) {
    const s = satState(sat, jd, latRad, lonRad);
    if (!s) continue;
    if (prev !== null && s.eclipsed !== prev) return jd;
    prev = s.eclipsed;
  }
  return jd0;
}

// Find all satellite passes over a Julian Date range.
//
// Parameters:
//   sat       - parsed TLE satellite object (from parseSatellites)
//   jdStart   - start of search range (Julian Date, UTC)
//   jdEnd     - end of search range (Julian Date, UTC)
//   latRad    - observer geodetic latitude (radians)
//   lonRad    - observer geodetic longitude (radians, east positive)
//   minAltDeg - minimum altitude threshold in degrees (default 0)
//
// Returns an array of pass objects, each containing:
//   riseJD, riseAz     - rise time and azimuth (radians)
//   culminJD, culminAlt - culmination time and maximum altitude (radians)
//   setJD, setAz       - set time and azimuth (radians)
//   eclipseEntryJD     - JD when satellite enters Earth's shadow (null if no entry)
//   eclipseExitJD      - JD when satellite exits Earth's shadow (null if no exit)
//
// A pass is defined as a continuous interval where the satellite's altitude
// exceeds the minAltDeg threshold. Eclipse events are recorded only during
// the pass. If the satellite is eclipsed for the entire pass, eclipseEntryJD
// equals riseJD and eclipseExitJD equals setJD.

function findSatellitePasses(sat, jdStart, jdEnd, latRad, lonRad, minAltDeg) {
  if (minAltDeg === undefined) minAltDeg = 0;
  const altThresh = minAltDeg * DEG_TO_RAD;
  const coarseStep = 1 / 1440;   // 1 minute in JD

  const passes = [];
  let inPass = false;
  let passRiseJD, passRiseAz;
  let maxAlt, maxAltJD;
  let bestMag;
  let eclipseEntryJD, eclipseExitJD;
  let prevEclipsed, eclipsedEntirePass;

  let prevState = null;
  let prevJD = jdStart;

  for (let jd = jdStart; jd <= jdEnd + coarseStep; jd += coarseStep) {
    const clampedJD = min(jd, jdEnd);
    const s = satState(sat, clampedJD, latRad, lonRad);

    if (!s) {
      if (inPass && prevState) {
        passes.push(closePass(sat, passRiseJD, passRiseAz, maxAlt, maxAltJD, bestMag,
          prevJD, prevState.az, eclipseEntryJD, eclipseExitJD,
          prevEclipsed, eclipsedEntirePass, coarseStep, latRad, lonRad));
        inPass = false;
      }
      prevState = null;
      prevJD = clampedJD;
      continue;
    }

    if (prevState) {
      // Rise: altitude crosses above threshold
      if (!inPass && prevState.alt < altThresh && s.alt >= altThresh) {
        const riseJD = refineAltCrossing(sat, prevJD, clampedJD, latRad, lonRad, altThresh);
        const riseState = satState(sat, riseJD, latRad, lonRad);
        passRiseJD = riseJD;
        passRiseAz = riseState ? riseState.az : s.az;
        inPass = true;
        maxAlt = s.alt;
        maxAltJD = clampedJD;
        bestMag = s.mag;
        eclipseEntryJD = null;
        eclipseExitJD = null;
        prevEclipsed = riseState ? riseState.eclipsed : s.eclipsed;
        eclipsedEntirePass = prevEclipsed;
        if (prevEclipsed) eclipseEntryJD = passRiseJD;
      }

      if (inPass) {
        // Track highest coarse sample for culmination refinement
        if (s.alt > maxAlt) {
          maxAlt = s.alt;
          maxAltJD = clampedJD;
        }
        if (s.mag < bestMag) bestMag = s.mag;

        // Eclipse transitions
        if (s.eclipsed && !prevEclipsed) {
          eclipseEntryJD = refineEclipseTransition(sat, prevJD, clampedJD, latRad, lonRad);
          eclipsedEntirePass = false;
        }
        if (!s.eclipsed && prevEclipsed) {
          eclipseExitJD = refineEclipseTransition(sat, prevJD, clampedJD, latRad, lonRad);
          eclipsedEntirePass = false;
        }
        prevEclipsed = s.eclipsed;

        // Set: altitude crosses below threshold
        if (s.alt < altThresh) {
          const setJD = refineAltCrossing(sat, prevJD, clampedJD, latRad, lonRad, altThresh);
          const setState = satState(sat, setJD, latRad, lonRad);
          passes.push(closePass(sat, passRiseJD, passRiseAz, maxAlt, maxAltJD, bestMag,
            setJD, setState ? setState.az : s.az, eclipseEntryJD, eclipseExitJD,
            prevEclipsed, eclipsedEntirePass, coarseStep, latRad, lonRad));
          inPass = false;
        }
      }
    }

    prevState = s;
    prevJD = clampedJD;
    if (clampedJD >= jdEnd) break;
  }

  // Close out a pass still in progress at end of range
  if (inPass && prevState) {
    passes.push(closePass(sat, passRiseJD, passRiseAz, maxAlt, maxAltJD, bestMag,
      prevJD, prevState.az, eclipseEntryJD, eclipseExitJD,
      prevEclipsed, eclipsedEntirePass, coarseStep, latRad, lonRad));
  }

  return passes;
}

// Finalize a pass: refine culmination, settle eclipse end state, build result object.
function closePass(sat, riseJD, riseAz, maxAlt, maxAltJD, bestMag, setJD, setAz,
    eclipseEntryJD, eclipseExitJD, eclipsedAtEnd, eclipsedEntirePass,
    coarseStep, latRad, lonRad) {
  // Refine culmination: search ±1 coarse step around highest sample, clamped to pass
  const culmJD0 = max(riseJD, maxAltJD - coarseStep);
  const culmJD1 = min(setJD, maxAltJD + coarseStep);
  const culminJD = refineCulmination(sat, culmJD0, culmJD1, latRad, lonRad);
  const culmState = satState(sat, culminJD, latRad, lonRad);

  // Settle eclipse end state
  if (eclipsedAtEnd && !eclipseExitJD) eclipseExitJD = setJD;
  if (eclipsedEntirePass) { eclipseEntryJD = riseJD; eclipseExitJD = setJD; }

  return {
    riseJD, riseAz,
    culminJD, culminAlt: culmState ? culmState.alt : maxAlt,
    setJD, setAz,
    eclipseEntryJD, eclipseExitJD,
    bestMag
  };
}
