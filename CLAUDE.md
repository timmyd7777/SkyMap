# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SkyMap is a browser-based interactive sky map that renders stars, constellations, deep sky objects, planets, Sun, Moon, asteroids, comets, satellites, and the Milky Way for any date/time (1500–2500 AD) and any location on Earth. Planet positions use Meeus's truncated VSOP87 for sub-arcminute accuracy; the Moon uses Meeus's truncated ELP2000. Satellite orbits use SGP4/SDP4. It uses stereographic projection with six coordinate frame options (Horizon, Equatorial, Equatorial J2000, Ecliptic, Ecliptic J2000, Galactic).

**No build step, no dependencies, no server required.** Open `index.html` in a browser.

## Running

Open `index.html` directly in a browser. On desktop it loads `stars.js` (~130K stars to mag 9) and `deepsky.js` (~12K NGC/IC objects); on mobile it loads `stars_hr.js` (~9000 stars to mag 9) and `deepsky_mc.js` (~223 Messier+Caldwell objects) — the choice is made at runtime via user-agent detection. Asteroid, comet, and satellite orbital elements are fetched from southernstars.com at init (cached in localStorage for 24 hours).

## Data Generation

The JS data files are pre-generated and checked in. To regenerate from source catalogs:

```
cd data
python3 gen_stars.py brightest.csv 99        # -> stars_hr.js (bright catalog, ~9K stars + DOUBLES index)
python3 gen_stars.py SKY2000.csv 9.0        # -> stars.js (extended catalog, ~130K stars + DOUBLES index)
python3 gen_constellations.py               # -> constellations.js
python3 gen_deepsky.py                      # -> deepsky.js + deepsky_mc.js
python3 gen_cities.py                       # -> cities.js
python3 gen_milkyway.py                     # -> milkyway.js
python3 gen_vsop87.py                       # -> vsop87.js
python3 gen_satmag.py                       # -> satmag.js
python3 gen_nebulae.py                      # -> nebulae.js
python3 gen_moondata.py                     # -> MOON_DATA table (from docs/jpl/ PDFs)
python3 gen_moondata.py --all               # -> MOON_DATA table (all 177 moons)
```

Scripts auto-download source data (CSVs from [SSCore](https://github.com/timmyd7777/SSCore), VSOP87D files from CDS) if not present. Move generated `.js` files to the project root to update the app.

## Architecture

All code is vanilla JavaScript with no frameworks or bundling. The files load via `<script>` tags in `index.html`.

---

### `astromath.js` — Foundation layer

**Constants:** `TWOPI`, `HALFPI`, `DEG_TO_RAD`, `RAD_TO_DEG`, `JD2000` = 2451545.0, `SIDEREAL_DAY`, `AU_PER_PC`, `AU_PER_LY`, `KM_PER_AU` = 149597870.7, `LY_PER_PC`, `PC_PER_LY`, `GAUSS_K`, `EARTH_RADIUS_KM` = 6378.14, `EARTH_RADIUS_AU`, `SUN_RADIUS_AU`, `LIGHT_SPEED_KM_PER_SEC` = 299792.458, `LIGHT_SPEED_AU_PER_DAY` = 173.144632674, `OBLIQUITY_J2000`, `REFRACTION_ALT` (−34 arcmin), `NGP_RA`/`NGP_DEC`, `GCEN_RA`/`GCEN_DEC`. Also destructured `Math.*` functions.

**Angle utilities:**
- `mod360(deg)` / `mod2pi(rad)` — reduce angles to [0,360) or [0,2π).
- `atan2pi(y, x)` — like `atan2` but returns [0, 2π) instead of (−π, π]. Used internally by `eclToEq()` (whose returned RA is therefore already in [0, 2π)).

**Angle formatting/parsing** (degree-based, moved here from searchinfo.js since they're broadly useful):
- `formatRA(raDeg)` / `formatDec(decDeg)` — format RA as `HHh MMm SS.Ss` (0.1s precision) and signed Dec as `±DD° MM' SS"` (1" precision).
- `formatDMS(deg)` — unsigned equivalent (NOT for declination — use `formatDec()` for signed values; callers with a sign, like `formatLonLat()`, take `Math.abs()` and prepend their own sign/hemisphere letter). Includes the rounding-carry guard (59.9999" → 1' 0.0") that `formatDec()` avoids needing via a different construction (rounds total arcseconds once, then floors/mods the already-rounded value).
- `parseRA(str)` / `parseDec(str)` / `parseDMS(str)` — parse the reverse (several formats: `H M S`/`H:M:S`/`HhMmSs` for RA, plus signed `D° M' S"`/`D:M:S`/bare degrees for Dec and `parseDMS`). Return `null` on unparseable or out-of-range input.
- `formatLonLat(lonDeg, latDeg)` — formats observer position as `Lon D° M' S" E/W  Lat D° M' S" N/S`.

**Time functions:**
- `julianDate()` — with Julian/Gregorian calendar switchover at Oct 15, 1582.
- `calendarDate()` — inverse (JD→calendar).
- `deltaT(jd)` — ΔT in seconds (Espenak & Meeus polynomials, valid −1999 to +3000).
- `gmst(jd)` — Greenwich Mean Sidereal Time in radians.
- `localSiderealTime(jd, lonRad)` — LST in radians.

**Rise/transit/set:**
- `riseTransitSet(raRad, decRad, jd, latRad, lonRad, h0Rad, rtsFlag)` — Meeus Ch.15 for a single event (`rtsFlag`: −1 rise, 0 transit, +1 set). `jd` doubles as sidereal-time reference and anchor for the returned event (Newton-style convergence). Returns `{status, jd}`: `status` is `'normal'`, `'never-rises'`, or `'never-sets'`; `jd` is the event's JD (UT) or `null`.
- `riseTransitSetIterative(getRaDec, jd0, latRad, lonRad, h0Rad, rtsFlag, iterations)` — for fast movers (especially the Moon). Starts at local noon (`jd0 + 0.5`), re-evaluates position via the `getRaDec(jd)` callback each pass. Two-pass approach: if the converged result falls outside `[jd0, jd0+1)`, shifts by one sidereal day and re-iterates (handles rise at 9pm / set at 3am across transit cycles). When the Moon skips a rise or set on a given day (sidereal/solar day mismatch), the second pass also lands outside the day and `status: 'none'` is returned. Default `iterations` = 3 (sub-second convergence, verified numerically to sub-second residuals); pass 1 for near-fixed objects.

**Precession & nutation:**
- IAU 1976 precession (`precessAngles()` returns Lieske arcsecond-based zetaA/zA/thetaA in radians).
- IAU 1980 nutation (3 dominant terms).
- Mean/true obliquity.

**Refraction:**
- `refractionTrue2App()` — Bennett true→apparent.
- `refractionApp2True()` — Saemundsson apparent→true.

**Coordinate transforms:** `eclToEq()` (ecliptic→equatorial), `eqToAltAz()` (equatorial→horizon). One-way only; inverse transforms use matrix operations.

**3×3 matrix operations** (row-major flat arrays):
- `mmul(a, b)` — matrix multiply.
- `mvmul(m, x, y, z)` — matrix × vector.
- `mtranspose(m)` — transpose (= inverse for rotation matrices).
- `rz(a)`, `rx(a)`, `ry(a)` — rotation matrices.

**Spherical↔Cartesian:** `xyz2sph()` / `uxyz2sph()` return longitude via `atan2pi()` (already in [0, 2π)). `sph2xyz()` / `sph2uxyz()` for the reverse.

**Vector helpers:** `dot()`, `cross()` (returns `[x,y,z]`), `vmag()`, `angSep()` (haversine-based, stable for small angles), `posAng()` (position angle north through east).

**`frameMatrix(frame, jd, latRad, lonRad, j2000)`** — builds the J2000→target-frame rotation matrix. When `j2000` is true, equatorial returns identity and ecliptic returns `rx(-OBLIQUITY_J2000)`. The J2000-to-galactic matrix `mGalactic` is a file-level constant (IIFE) computed once from `NGP_RA`/`NGP_DEC`/`GCEN_RA`/`GCEN_DEC`.

**`ImageFrame(raRad, decRad, orient, width, height, fovX, fovY, mirror)`** — image frame for astrometry using gnomonic/tangent-plane projection.
- Center RA/Dec are J2000 mean equatorial radians; `orient` is position angle of image "up" (0 = toward NCP, increasing through east); `mirror` (default false) indicates horizontally flipped image, encoded as negative `scaleX`.
- Constructor builds rotation matrix `m = rz(-π/2 - orient) · ry(dec - π/2) · rz(-ra)` (J2000 → image frame) and transpose `mt`. The `−π/2` (not `+π/2`) is required for `orient = 0` to mean north-up; `solveImageFrame()` uses matching `rz(−π/2)` for consistency.
- `skyXYZtoPixelXY(jx, jy, jz)` — projects J2000 unit vector to `[px, py]` via gnomonic division with X negated (East = left, astronomical convention; negative `scaleX` cancels for mirrored images). Returns null if behind tangent plane.
- `pixelXYtoSkyXYZ(px, py)` — unprojects to J2000 unit vector.
- `raDecToPixelXY(ra, dec)` / `pixelXYtoRADec(px, py)` — spherical wrappers.
- `solveImageFrame(stars, width, height)` — fits an ImageFrame to N≥3 reference stars (each `{jx, jy, jz, px, py}`). Gnomonic-projects star positions onto the tangent plane, estimates boresight from mean star direction, solves affine mapping via 3×3 normal equations (Cramer's rule), detects mirroring from affine determinant sign (`a*d - b*c`: positive = standard, negative = mirrored), extracts scale (`scaleX = sqrt(a^2+b^2)`) and orientation (`orient = atan2pi(-b, -a)` for standard, `atan2pi(b, a)` for mirrored), refines boresight using the affine offset, and iterates twice for sub-milliarcsecond convergence. Returns `{frame, residuals}` or null on failure.
- `drawImageFrame(frame)` in skymap.js renders the frame as a quadrilateral (controlled by `params.imageFrame`).

---

### `vsop87.js` — Planetary ephemeris data

VSOP87 truncated planetary ephemeris (Bretagnon & Francou 1988), truncated to the level in Meeus "Astronomical Algorithms" 2nd ed. Appendix III (~2430 terms across 8 planets). Heliocentric ecliptic-of-date spherical coordinates (L, B, R) from VSOP87D. Each term is `[A, B, C]` where contribution = `A * cos(B + C * τ)`, with τ in Julian millennia from J2000. Generated by `data/gen_vsop87.py`.

---

### `planets.js` — Orbital mechanics

**Core position functions:**
- `vsop87Position(planet, tau)` — evaluates VSOP87 series for Mercury–Neptune (Sun computed via Earth in the caller `updateSSCache()`). High-accuracy path used for rendering.
- `moonPositionMeeus(d)` — Meeus ch.47 truncated ELP2000 lunar theory (`d` = days since J2000.0 in dynamical time).
- `asteroidPosition()` / `cometPosition()` — from MPC orbital elements.

**Schlyter position functions:**
- `sunPosition(d)` — Schlyter Sun position.
- `moonPosition(d, sunM, sunW)` — Schlyter Moon position with perturbation corrections, distinct from `moonPositionMeeus()`.
- `planetPerturbations(name, d, lon, lat, r)` — mutual perturbation corrections for Jupiter/Saturn/Uranus.

**Kepler equation solver:** elliptical, parabolic, near-parabolic, hyperbolic.

**Magnitude formulas:** `planetMag()` for planets, `moonMag()` for the Moon, asteroids (H/G system), comets (H/k). `phaseElongation(s, R, r)` computes phase angle and elongation from three distances. `inUmbralShadow()` tests whether a point lies inside a conical shadow (used by `satApparentMag()`).

**Saturn ring tilt** via `saturnRingMagn()`.

**Topocentric parallax** (two forms):
- `geocentricXYZ(lstR, latRad)` — observer WGS84 position in Earth-radii.
- `topocentricCorrectionXYZ(bx,by,bz, obsX,obsY,obsZ)` — returns `[ra, dec, dist]` from Cartesian inputs (for Moon and satellites, avoids redundant observer recomputation).
- `topocentricCorrection(ra, dec, distER, lstR, latRad, mObs)` — legacy wrapper.

**Schlyter functions:** `PLANETS[].elems()`, `planetHelioEcl()`, `saturnRingMagn()` use day number `d = JD − 2451543.5` (Schlyter's epoch, 1.5 days before J2000); callers in `skymap.js` pass `d + 1.5`. Schlyter elements exist for ALL planets Mercury–Pluto and are used by `solSysObjPosition()` for fast lower-accuracy computation (~1–2 arcminute); VSOP87 is used by `skymap.js` for high-accuracy rendering.

**`PLANET_PHYS`** (ESAA 3rd Ed. Tables 10.1/10.2 + IAU WGCCRE 2009 for the Moon) — physical parameters for Mercury–Pluto, Earth, and the Moon:
- Equatorial radius (km), geometric flattening.
- `poleRA(T)` / `poleDec(T)` — north pole direction in degrees (with periodic terms for Jupiter's J₁–J₅, Neptune's N, Moon's E₁–E₁₃).
- `W(t)` — prime meridian angle in degrees (with periodic terms for Mercury's M₁–M₅, Neptune's N, Moon's E₁–E₁₃).
- Jupiter uses System II (non-equatorial atmosphere, includes GRS); Saturn uses System I (atmospheric/visual); alternates retained as comments.
- T = Julian centuries, t = days from J2000.

**`planetOrientation(name, d, jx, jy, jz)`** — takes days since J2000.0 (dynamical time, light-time corrected) and observer-to-body J2000 unit vector. Returns `{ subObsLat, subObsLon, polePA }` where `polePA` is the J2000 position angle of the pole (via `posAng()`). Uses ESAA 3rd Ed. left-handed body frame (`y = w × n`, eq 10.24). The resulting `subObsLon` is in the ESAA convention (longitude increasing westward), which must be negated for display of retrograde rotators (Venus) and the Moon (selenographic longitude increases eastward).

**`shadowRadii(R, D, dSun)`** — umbral and penumbral shadow radii (in AU) for a sphere of radius R at distance D with Sun at dSun; umbra clamped to 0 for annular shadow.

**`solSysObjPosition(target, jd, latRad, lonRad)`** — computes of-date equatorial RA/Dec (radians) for any solar system body at an arbitrary JD using Schlyter formulae (~1–2 arcminute accuracy). Accepts Sun, Moon (with topocentric correction), Mercury–Pluto by name string, plus asteroids/comets as an already-resolved element object (distinguished by asteroid's `a` field vs. comet's `q`). Converts `jd` to JDE via `deltaT()` internally; Moon's topocentric correction uses `gmst(jd)` (UT-based). Used by `searchinfo.js` for fast iterative rise/transit/set computation without disturbing `ssCache`.

---

### `mpc.js` — MPC orbital element parsers

- `parseMPCComets(text)` — parses Soft00Cmt format (perihelion time, q, e, ω, Ω, i, H, k).
- `parseMPCAsteroids(text)` — parses MPCORB format (packed epoch, M, ω, Ω, i, e, n, a, H, G).
- `mpcUnpackEpoch(s)` — decodes MPC packed epoch strings (century code I/J/K, hex-encoded month/day).

---

### `sgp4.js` — TLE/CSV parser and SGP4/SDP4 orbit propagators

- `parseSatellites(text)` — auto-detects classic 3-line TLE vs CelesTrak OMM CSV format.
- SGP4 handles near-earth orbits (period < 225 min); SDP4 handles deep-space (GEO, GPS, Molniya) with lunar/solar perturbations and geopotential resonance.
- `sgp4Propagate(sat, tsince)` — dispatches automatically based on `sat.deep`. Output is TEME position/velocity in WGS72 Earth-radii and Earth-radii/min.
- Satellite epochs are UTC — use JD not JDE (no Delta-T).

---

### `moons.js` — Planetary moon positions

ESAA 3rd Ed. Chapter 9 analytical theories. Each function takes JDE (Julian Ephemeris Date in dynamical time) and returns an array of `{name, x, y, z}` where x,y,z are planetocentric J2000 equatorial coordinates in AU. Uses B1950→J2000 frame tie matrix (Standish 1982) for theories originally in B1950.

- `marsMoons(jde)` — Sinclair 1989: Phobos, Deimos.
- `jupiterMoons(jde)` — Lieske 1977/1987: Io, Europa, Ganymede, Callisto via ξ/ν/ζ perturbation method.
- `saturnMoons(jde)` — Kozai/Taylor & Shen for Mimas–Dione inner moons; Sinclair for Rhea, Titan, Hyperion, Iapetus; Zadunaisky for Phoebe (ESAA formula inaccurate, JPL elements preferred).
- `uranusMoons(jde)` — Laskar & Jacobson 1987: Miranda, Ariel, Umbriel, Titania, Oberon via complex exponential elements.
- `neptuneMoons(jde)` — Harris 1984 for Triton, Jacobson 1990 for Nereid (ESAA formula inaccurate, JPL elements preferred).
- `plutoMoons(jde)` — Tholen 1985 for Charon.

**Corrections:** Titan corrects a `sin(ns-ns)` bug present in the original C code; Triton and Nereid use the full spherical trig formula `orbitPosition()`.

**`MOON_DATA`** — JPL mean orbital elements and physical parameters (semi-major axis, eccentricity, inclination, argument of periapsis, mean anomaly, node, epoch, mean motion, precession periods, reference plane pole RA/Dec, radius, absolute magnitude H) for the 24 moons with analytical theories. Generated by `data/gen_moondata.py` from PDFs in `docs/jpl/`.
- `Pnode` sign encodes precession direction: negative for prograde orbits (i ≤ 90°, node regresses), positive for retrograde orbits (i > 90°, node advances).
- `Pw` is the argument-of-periapsis period (not longitude of periapsis — e.g. Moon's `Pw` ≈ 6.0 yr vs the well-known 8.85-yr longitude-of-perigee period which includes nodal regression).
- The PDF's `n` column is mean longitude rate, converted to mean anomaly rate by `gen_moondata.py` accounting for signed `Pnode`.

**`moonPositionKepler(name, jde)`** — computes planetocentric J2000 equatorial XYZ in AU from `MOON_DATA` Keplerian elements with secular node and periapsis precession; used by `skymap.js` for Phoebe and Nereid in place of their inaccurate ESAA theories.

**`planetMoonMagnitude(name, helioDist, geoDist)`** — apparent magnitude from `MOON_DATA[name].H`.

---

### `satmag.js` — Satellite magnitudes

McCants satellite standard magnitudes (`SATMAG` lookup by NORAD ID, at 1000 km range, half-phase) plus `satApparentMag()` which computes apparent magnitude from geocentric TEME position, observer TEME position, and Sun TEME direction. Includes cylindrical Earth-shadow eclipse test and diffuse-sphere phase-angle correction.

Generated by `data/gen_satmag.py`. **`satApparentMag()` is hand-written code appended after the generated lookup table — do not overwrite it when regenerating.**

---

### `skymap.js` — Rendering engine

Pure Canvas 2D rendering with no DOM dependencies.

#### Main function: `skymapDraw(canvas, params)`

Calls `frameMatrix()` to get rotation matrices, computes nutation/obliquity/LST directly, then draws all layers in z-order.

**Key params:**
- `showHorizon` — controls horizon fill independently of frame (the HTML UI ties it to `viewFrame === 'horizon'` but external callers can set it independently).
- `showHorizonLabels` — cardinal direction labels N/NE/E/.../NW, works in any frame via `horProject`/`horProjectRaw`.
- `showMeridian` — bold horizon-frame meridian, via its own checkbox independent of `showGrid`.
- `refraction` — when true, horizon line/mask/meridian endpoints sit at `REFRACTION_ALT` = −34 arcmin; when false, at exactly 0°. Computed once as `horizonAlt = refraction ? REFRACTION_ALT : 0`.
- `showSelection` — toggles selected-object marker and label.
- `flipH` / `flipV` — mirror the view. Implemented in `toScreen()` via sign factors `fX`/`fY`; inverse `viewUnproject()` divides them out.

#### Flipping

Local drawing functions (`drawPhaseDisc`, `drawPlanetGrid`, `drawSaturnRing`) apply `ctx.scale(fX, fY)` in their canvas transform stack. `j2kPAToScreen()` divides out flip factors from its screen-space delta. Galaxy ellipses apply `atan2(fY*sin(rot), fX*cos(rot))`. The `toSunAngle` Jacobian is unflipped — `ctx.scale(fX, fY)` handles it.

#### Global view state

Mutable view state (`viewLon`, `viewLat`, `viewFov`, `viewFrame`, `viewJ2000`, `viewRefraction`) is global so the HTML wrapper can read/write it.
- `viewRefraction` (boolean, default true) is set from the `refraction` param each `skymapDraw()` call; used by `refreshInfoPanel()` in `searchinfo.js` for apparent altitude and rise/transit/set h0.

#### Global projection closures

Assigned near the top of `skymapDraw()` (after `M`, `toScreen`, and `scale` are set up):
- `skyProject(jx, jy, jz)` — J2000 unit vector → canvas `[sx, sy]` (or null if behind hemisphere).
- `skyUnproject(sx, sy)` — canvas pixels → J2000 unit vector (or null).
- `skyIsVisible(jx, jy, jz)` — hemisphere visibility test.
- `radToPx(sx, sy, rad)` — angular size to pixels (accounts for stereographic distortion: `rad * scale * (4 + r²) / 4`).
- `pxToRad(sx, sy, px)` — inverse.
- `viewProject(lat, lon)` — frame coords → canvas pixels (converts to J2000 via `mFrameT` then `skyProjectRaw`).
- `viewUnproject(sx, sy)` — canvas → frame coords (calls `skyUnproject` then rotates via `mFrame`).
- `horProject(alt, az)` / `horProjectRaw(alt, az)` — local (not global) functions that always project horizon az/alt to screen correctly regardless of current view frame, using `mHorizonT`. Used by `drawHorizon()`, `drawCardinals()`, and `drawHorizonMeridian()`.

#### Solar system cache (`ssCache`)

Positions cached as J2000 equatorial unit vectors, recomputed when JD or observer location changes. After rebuilding, sorted by geocentric distance (farthest first) for painter's algorithm occlusion.

**`updateSSCache()`** converts JD to JDE via `deltaT()` and builds three rotation matrices:
- `mEcl2J2000 = P^T · Rx(ε_mean)` — ecliptic of-date → J2000 equatorial (for VSOP87 planets/Sun/Pluto).
- `mNP = N · P` — its transpose converts true equatorial of-date → J2000 (for Moon/satellites after topocentric correction).
- `mJ2kEcl2Eq = rx(OBLIQUITY_J2000)` — J2000 ecliptic → J2000 equatorial (for asteroids/comets with MPC J2000 elements).

**Light-time correction:** One-iteration for all planets, Pluto, asteroids, comets. Body position is recomputed at retarded time (`t − Δ/LIGHT_SPEED_AU_PER_DAY`) with Earth held at current time. Cheap Schlyter first pass estimates geocentric distance to avoid doubling the expensive VSOP87 series evaluation.

**Topocentric parallax:** Applied to Moon and satellites.

**Angular sizes:** Objects with a physical disc (Sun, planets/Pluto, Moon, planetary moons) cache `angRad` (angular radius in radians), computed once in `updateSSCache()` from the same catalog constants (`SUN_DIAM1AU`/`PLANET_DIAM1AU`/`MOON_DIAM_FACTOR`/`MOON_DATA[name].radius`) used elsewhere. `drawSolarSystem()` reuses `angRad` both to size the on-screen disc (`radToPx(sx, sy, obj.angRad)`) and to enlarge the visibility-cull rectangle so large discs aren't culled when their center falls off-canvas (Saturn gets extra ×2.27 for its ring). Comets, asteroids, and satellites have no `angRad` and are culled at the exact canvas bounds.

**Satellites:** Propagated via `sgp4Propagate()` using JD (UTC, not JDE). Observer TEME position computed from WGS84 ellipsoid. Each entry carries `norad` alongside `name` since rocket-body/debris objects frequently reuse generic names. Eclipsed satellites get `mag: Infinity` but are still pushed to `ssCache` (search panel can still find them, matching how planetary moons in shadow are handled); the `obj.mag > magLimit + 3` check keeps them off the map without a separate `=== Infinity` check. Satellites fainter than `magLimit` draw at faintest-star size. `NaN` magnitudes (`sgp4Propagate()` returning degenerate positions for decayed/invalid elements, since `sgp4.js` has no guards) are explicitly skipped (not pushed) — unlike `Infinity`, `NaN` compares false against every value and silently scrambles magnitude-sorted order. Satellites with no McCants entry default to a normal, finite +6.0 (unrelated to the `Infinity`/`NaN` cases).

#### Object tracking

`centerObject` holds the tracked object (set by double-click or `centerOnSelected()`). Each frame, its J2000 coords are looked up from `ssCache` (by `norad`+type for satellites, `name`+type otherwise) or stored directly (for stars/deep sky), transformed through `mFrame`, and used to set `viewLon`/`viewLat`. `updateSSCache()` is called early when tracking to avoid one-frame lag. Tracking is cleared by dragging, using lon/lat sliders, clicking empty space, or selecting a different object.

#### Star rendering

In dark mode with `showStarColors` on, stars are colored by B−V index via `bmvToRGB()` (piecewise linear: cyan for B−V < −0.3, white at 0, yellow at 1.0, red beyond 3.0; bmv=0 meaning missing data stays white). Star labels remain white regardless. `magBoost` is capped at 5 to prevent oversized stars at extreme zoom.

#### Planet rendering

Planets are drawn as phase-shaded discs when their apparent angular size exceeds the star-dot size. `drawPhaseDisc()` is shared by planets and the Moon; accepts optional `oblateness` and `polePA` for oblate planets. Oblateness = `flattening * cos(subObsLat)` (zero when viewed pole-on); flattening is looked up from `PLANET_PHYS` at draw time (not cached). Planet pole directions and sub-observer coordinates come from `planetOrientation()`.

**Planetographic grids:** `drawPlanetGrid()` overlays lat/lon grid (0/±30/±60° latitude, 30° longitude spacing) via orthographic projection when `showPlanetGrid` is on and disc radius ≥ 10px. Uses the same save/translate/rotate/scale canvas transform as `drawPhaseDisc`.

**Phase terminator:** `toSunAngle` is computed per-object via the stereographic projection Jacobian — the Sun's view-space direction is projected onto the tangent plane at the object's position, then transformed through the Jacobian for the correct screen-space angle (`atan2(jsDy, jsDx)` — note positive `jsDy`, because the chart Y axis (`-2*vy/d`) is inverted relative to canvas Y by `toScreen()`). This is frame-invariant. `phaseElongation()` produces the Sun-body-Earth angle stored for planets and asteroids.

**Saturn's ring:** Drawn as two filled half-ellipses (back half → disc → grid → shadows → front half) using `drawSaturnRing()`, with tilt from `subObsLat`. When `|sin(B)| < 0.003` (near edge-on), drawn as a single horizontal line on the front pass only (so it renders on top of the planet disc). Outer edge at 2.27 Saturn radii, inner edge at 1.24 Saturn radii.

**`j2kPAToScreen(j2kPA, vx, vy, vz, sx, sy)`** — converts any J2000 position angle to a screen angle by displacing the object ~1° toward the NCP, reprojecting, and taking the screen direction. Used for galaxy ellipse orientation and planet pole PA.

#### Moon shadows

`drawShadowDisc()` draws penumbra (25% opaque black) and umbra circle clipped to a body's disc; skips sub-pixel shadows. Shadow angular radii = physical radius / parent geocentric distance. `drawMoonShadows()` projects shadow center J2000 unit vectors to screen.

- **Earth's shadow on Moon:** Computed when `dot(moon, sun) < −0.9` (~154°+ elongation); umbra color is dark red (`rgba(64,0,0,0.5)`) for blood-moon effect.
- **Moon shadows on Jupiter** (Io, Europa, Ganymede, Callisto) and **Saturn** (Tethys, Dione, Rhea, Titan) are computed in `updateSSCache()` using `shadowRadii()`; shadow center = point in the same heliocentric direction as the moon at the parent's heliocentric distance; skipped when moon is farther from Sun than parent.

#### Planetary moons

Rendered as `type:'planetmoon'` in light gray (`#bbb`/`#555`). Shown automatically when `showPlanets` is on and FOV < 10°; labels follow `showPlanetNames`. When angular diameter exceeds star-dot size, drawn as a filled disc. Moons behind their parent's disc are skipped (occlusion check accounts for apparent oblateness via the ellipse equation). Moons in their parent's umbral shadow cone get `mag = Infinity` and are not rendered.

#### Horizon and grid rendering

At high zoom (FOV < 5°), filled polygons (milky way, horizon) may have all vertices off-screen while enclosing the view. Milky way uses `pointInPolygon` on the canvas center; horizon uses `mHorizon` to compute the view center's altitude and fills the entire canvas when looking below the horizon.

Grid pole labels (Zenith/Nadir, NCP/SCP, NEP/SEP, NGP/SGP) use the same bright color as their frame's reference line (via `frameColor('horizon')`, `frameColor('equatorial')`, `frameColor('ecliptic', 0.9)`, `frameColor('galactic')`) rather than the dim color used for numeric latitude labels, and match `drawCardinals()`'s bold font (divisor 80 vs regular grid labels' 85). `drawHorizonMeridian()` draws the local N/S meridian arc from `horizonAlt` through zenith to `horizonAlt` above the horizon only, in the same bold horizon color, on top of the regular (dim) grid meridian at the same great circle. Gated on its own `showMeridian` param (a checkbox in `index.html`, independent of `showGrid`).

#### Object colors

Hardcoded at draw time (not cached): `PLANET_COLORS` for planets, fixed hex values for Sun/Moon/comets/asteroids, dark/light mode–aware colors for satellites (bright green/dark green), asteroids (bright yellow/dark yellow), and all moons including Earth's (`#bbb`/`#555`).

#### Selection marker

`drawSelectionMarker()` highlights the selected object with an orange marker and label, toggled by `showSelection`. Marker shape matches object type: oriented ellipse for galaxies (5px larger than the drawn ellipse, using the already-flip-transformed `rot` from the `drawnObjects` entry), square for nebulae without contours, contour stroke for nebulae with contours, circle for everything else (radius = drawn object's pixel radius + 5).

The `drawnObjects` entry for stars wraps the raw STARS array in `data: {name, star}` so `data.name` is consistent across all object types.

#### Initialization: `skymapInit()`

Computes J2000 unit vectors for all star and deep-sky catalog entries (appended at `S_X`/`S_Y`/`S_Z` and `DS_X`/`DS_Y`/`DS_Z`), precesses constellation boundaries from B1875 to J2000, converts Milky Way polygons from galactic lon/lat to xyz `Float32Array`s, and builds `nebulaContourMap` / `dsContours[]` from `NEBULA_CONTOURS` / `NEBULA_INDEX`.

#### Other utilities

- `formatCoords()` — frame-aware coordinate display.
- `pickObject()` — object hit-testing.
- `changeFrame()` — frame switching.
- `viewProjectRaw(lat, lon)` — non-null variant of `viewProject`; clamps behind-hemisphere points to a large radius for continuous lines. Currently unused (dead code).
- `pointInPolygon(px, py, pts)` — ray-casting test (used by `pickObject()` and `drawMilkyWay()`). Milky way's canvas-center check is guarded against false positives from vertices near the view anticenter.
- `fetchCached(url, key, onSuccess)` — fetches remote data with 24-hour localStorage cache TTL and stale-cache fallback on network failure.
- `PLANET_SYMBOLS` — optional astrological symbol rendering.

---

### `skyobject.js` — SkyObject class

Wraps stars, deep sky objects, and solar system entries with uniform accessors.

**Two name fields:**
- `name` — common/proper name (empty string if none). E.g. `'Sirius'`, `'Orion Nebula'`, `'Jupiter'`.
- `ids` — catalog identifier strings, excluding the common name. E.g. `['Alpha CMa', 'HR 2491', 'HD 48915']` for stars, `['M 42', 'NGC 1976']` for DSOs, `['25544']` (NORAD number) for satellites, `[]` for planets/Sun/Moon.

**Getters:**
- `ra` / `dec` — J2000 degrees.
- `raStr` / `decStr` — formatted strings.
- `displayName` — `name` if set, else first `ids` entry, else `'(unnamed)'`.
- `typeLabel` — human-readable type (e.g. `'Globular Cluster'`, `'Planet'`). Sun returns `'Star'` (not `'Star (Sun)'`). Uses `STAR_TYPE_NAMES` / `DS_TYPE_NAMES` lookup tables.
- `ssData` — looks up matching entry in `ssCache` (by type + name or norad) for live ephemeris data.

**Methods:** `altAz(jd, latRad, lonRad)`, `distStr()`, `sizeStr()`, `phaseStr()`.

**Factory methods:**
- `fromStar(s)` — from a `STARS[]` array entry.
- `fromDeepSky(ds)` — from a `DEEPSKY[]` array entry.
- `fromSSEntry(entry)` — from an `ssCache` entry.
- `fromDrawnObject(obj)` — from a `drawnObjects` entry (click-to-select result).

**Serialization:**
- `toJSON()` — persists type, name, ids, coordinates, magnitude, norad, and elements (but not `data`).
- `fromJSON(j)` — reconstructs with `data: null`. Accepts `ids` or legacy `names` field for backward compatibility.
- All getters that access `this.data[...]` guard against null and return safe fallback strings.

Also stores `elements` (MPC orbital element object for asteroids/comets, null otherwise) for iterative rise/transit/set computation.

---

### `searchinfo.js` — Search, lists, and info panel

#### Search

- `_buildSearchData()` — lazily indexes all stars and deep sky objects (not ssCache; solar system objects are searched dynamically in `searchObjects()` since `ssCache` changes over time).
- `searchObjects(query)` — case-insensitive substring matching with relevance sorting (exact > starts-with > contains, then by brightness).
- Star search labels show `"designation - name"` when both exist (e.g. `"Alpha CMa - Sirius"`).

#### Object lists

`getObjectList(category, showTypes)` for 11 categories: Planets, Moons, Asteroids, Comets, Satellites, Named Stars, Bright Stars, Double Stars, Named Deep Sky Objects, Messier Objects, Caldwell Objects. (Search results come from `searchObjects()`, not `getObjectList()`.) 

- Category-specific sorting: alphabetical by default, planets by orbit order, asteroids by number, comets periodic-first then alphabetical, bright stars by Bayer designation, doubles alphabetical by Bayer/Flamsteed.
- Earth's Moon appears in the Moons list (not Planets).
- When `showTypes` is truthy, Messier/Caldwell/Named DSO labels append the object type in parentheses (e.g. `"M 1 - Crab Nebula (Bright Nebula)"`); SkyMap calls without `showTypes`, Pandora passes `true`.
- Lists can be re-sorted by magnitude via a radio button toggle.

#### Satellite identification

SS objects are identified by name+type since ssCache is rebuilt each frame — except satellites, identified by NORAD ID+type, since rocket-body/debris objects frequently reuse generic names. `norad` is threaded from `ssCache` through `drawnObjects`, list items (`ssNorad`), search results, `centerObject`, and `SkyObject`/`ssData`. Satellite list and search labels append `- norad` (e.g. "ISS (ZARYA) - 25544") for visual distinction.

#### Panel functions

`toggleSearchPanel()`, `doSearch()`, `loadObjectList()`, `populateListBox()`, `onObjectListSelect()`, `searchPanelDraw()` (called each frame from `draw()` to detect map clicks and refresh live data), `refreshInfoPanel()`, `clearInfoPanel()`, `centerOnSelected()` (enters tracking mode on the selected object), `skyObjectFromItem(item)` (converts search/list result items into SkyObject instances).

#### Info panel display

- **Staleness:** `ssValid` is true for star/deepsky (fixed catalog position, never stale) or any SS type currently found in `ssCache`; false only if an SS object has dropped from `ssCache` entirely (e.g. a satellite whose TLE has gone stale, or one dropped from a reloaded catalog — not eclipse, since eclipsed satellites are still pushed to `ssCache` with `mag: Infinity`). When `!ssValid`, magnitude/coordinates/distance/size/phase show `—`.
- **Magnitude formatting:** `null` → `—`, `Infinity` (eclipsed/backlit) → `Eclipsed`, real number → `±d.dd`.
- **Fields shown:** type, name (`obj.name`), catalog IDs (`obj.ids`, on separate lines; `info-catalog-label` is relabeled "NORAD ID" for satellites showing `obj.norad`), coordinates (in current frame, updated dynamically), magnitude, color index (B−V, stars only), distance, spectrum/morphology, angular size (hidden for point sources), illumination (planets/Moon), central lon/lat (planets/Moon with orientation data), rise/transit/set times.

#### Refraction in info panel

`refreshInfoPanel()` applies `refractionTrue2App()` to displayed altitude when in horizon frame and `viewRefraction` is on. Rise/transit/set `h0` respects `viewRefraction`:
- Refraction on: `REFRACTION_ALT` for point objects, `REFRACTION_ALT − 16'` for Sun, `REFRACTION_ALT − angRad` for Moon.
- Refraction off: `0` / `−16'` / `−angRad` respectively.
- Moon uses actual `ssData.angRad` (topocentric semidiameter, ~14.7'–16.8') rather than a fixed constant or Meeus's textbook shortcut (`0.7275*parallax − 34'`), because `solSysObjPosition()` already applies full topocentric correction. Using the textbook constant here would trigger on the lower limb rather than the upper limb.

#### Rise/transit/set computation

Calls `riseTransitSetIterative()` three times (once per event), passing a `getRaDec(jd)` callback:
- Sun, Moon, planets, asteroids, comets: callback wraps `solSysObjPosition()`, `iterations` = 2.
- Planetary moons: use parent planet's RTS.
- Stars and deep sky: callback over fixed of-date position, `iterations` = 1.
- Asteroids/comets: element object resolved once from `loadedAsteroids`/`loadedComets` before building callback.
- Satellites: Rise/Transit/Set rows (`info-rise-row`/`info-transit-row`/`info-set-row`) hidden entirely — LEO completes many passes/day, making single-instant values meaningless rather than merely imprecise.

`_rtsText(r)` formats results. `_formatJDLocal(jd)` formats JD as local time via `Intl.DateTimeFormat` with `selectedTZ`.

---

### `index.html` — UI wrapper

All DOM interaction, event handling (drag/pan/pinch-zoom/scroll-zoom/double-click tracking), time zone management via `Intl` (including historical LMT for pre-1884 dates), animation timer, sidebar controls, date stepping via Julian Date round-trip (correctly skips Oct 5–14, 1582 Gregorian gap), and the `init()`/`draw()` loop.

- `getLocation()` returns `{latRad, lonRad}` — observer position in radians only (no degree fields).
- FOV slider is piecewise-linear via `fovToSlider()`/`sliderToFov()`: positions 1–30 map from 1' to 1° (~2'/step), positions 30–209 map from 1° to 180° (1°/step).
- Double-click (or double-tap) enters tracking mode; `draw()` syncs sliders after `skymapDraw()` when tracking is active.
- Display checkboxes include a Refraction toggle (checked by default) that reads into the `refraction` param of `skymapDraw()`.
- Data loading via `fetchCached()` (defined in `skymap.js`) for asteroid, comet, and satellite orbital elements.
- Right-side search panel (visible by default, toggled by magnifying glass button) with search input, object list dropdown, sortable listbox, object info table, and "Center Object in Sky Map" tracking button.

---

### Generated Data Files

**`stars.js` / `stars_hr.js`** — Star arrays with named index constants (`S_TYPE=0,S_RA=1,...,S_Z=16`):
- Format: `[type, RA_rad, Dec_rad, mag, bmv, dist_pc, spec, HR, HD, HIP, dm, bayer, flamsteed, name]`.
- `type` is SSCore object type (SS=single, DS=double, VS=variable, DV=double variable).
- `spec` is spectral type string (e.g. `"A1Vm"`). `bmv` is B−V color index (0 if B magnitude missing).
- `dm` is Durchmusterung number (BD/CD/CP catalog, fallback identifier).
- `bayer` includes variable star designations (e.g. `"R And"`); Greek letters capitalized (e.g. `"Alpha Ori"`), Latin single-letter lowercase (e.g. `"d Psc"`). Catalog number prefixes (HR, HD, SAO, BD, CD, CP) are filtered from common names by `gen_stars.py`.
- Unit vectors `[x,y,z]` appended at runtime by `skymapInit()` at indices [S_X,S_Y,S_Z].
- `DOUBLES` — array of indices into `STARS[]` identifying ~154 curated showpiece doubles (from SSCore's Doubles.csv). Desktop 154 entries; mobile 153 (one lacks HR number).

**`constellations.js`** — `CONSTELLATIONS` (stick figures by HR number pairs), `CON_CENTERS` (label positions), `BOUNDARIES` (IAU boundaries in B1875 RA/Dec, precessed to J2000 at init).

**`deepsky.js` / `deepsky_mc.js`** — Deep sky objects with named index constants (`DS_TYPE=0,DS_RA=1,...,DS_Z=15`):
- Format: `[type, RA, Dec, mag, dist, major_arcmin, minor_arcmin, pa_deg, morph, M/C id, NGC/IC, NGC/IC2, name]`.
- `morph` is morphology/classification: spectral type for stars/GCs, Trumpler class for OCs, Hubble type for GXs.
- Desktop loads full NGC/IC (~12K); mobile loads Messier+Caldwell only (~223).
- Objects may have two NGC/IC identifiers (DS_NGC primary, DS_NGC2 secondary; ~686 objects). NGC/IC numbers may have extension letters (e.g. `IC 1318A`).
- ~1078 star-type entries (SS/DS/VS/DV) such as M 40. Nonexistent objects (type `NO`) excluded.
- Deep sky magnitude filtering: FOV > 45° shows M/C only; 10°–45° shows M/C + NGC/IC within `starMagLimit + 4`; < 10° shows all. Null-magnitude non-M/C treated as infinitely faint. BN objects with no contours, no magnitude, and size ≥ 60 arcmin are skipped.
- Labels: M/C and contour objects always labeled; others if within `dsMagLimit − 2` or FOV < 3°.
- Galaxies with both axes are rendered as oriented ellipses (PA via `j2kPAToScreen()`); those with only a major axis are drawn as circles. Visibility culling uses on-screen radius (major axis via `radToPx()`), so large ellipses aren't culled when their center is off-canvas.

**`cities.js`** — `[name, admin1, countryCode, lat, lon, timezone]` for ~4400 cities.

**`milkyway.js`** — Polygons in galactic lon/lat pairs, converted to xyz Float32Arrays at init. `COALSACK_INDEX` marks the Coal Sack dark nebula polygon.

**`nebulae.js`** — `NEBULA_CONTOURS` (127 hand-drawn contour polygons as `[ra_rad, dec_rad]` pairs, converted to Float32Array xyz at init by `skymapInit()`) and `NEBULA_INDEX` (parallel array of name arrays). `nebulaContourMap` and `dsContours[]` are built in `skymapInit()` (in `skymap.js`, not `nebulae.js`). Bright nebulae with contours render as outlined polygons instead of squares; open clusters with contours get both the contour and dashed circle. `skipContours` suppresses specific oversized contours (IC 434 extended, M 8 extended). Hit testing for contour objects uses `pointInPolygon()` on each ring independently; open clusters with contours also fall through to radius-based check. Generated by `data/gen_nebulae.py` from SSCore.

**`vsop87.js`** — VSOP87D truncated series: `VSOP87.MERCURY` through `VSOP87.NEPTUNE`, each with `{L, B, R}` arrays. ~2430 terms, ~149KB.

**`satmag.js`** — `SATMAG` object (NORAD ID → standard visual magnitude) from McCants, plus hand-written `satApparentMag()`. Generator only produces the lookup table; the function must be preserved across regeneration.

---

## Key Conventions

### Coordinates

`viewLon` holds the *display* longitude — azimuth for Horizon, RA/ecliptic-lon/galactic-lon for the other frames. The projection math (`mView`, `viewProject`, `viewUnproject`) uses azimuth-style `atan2(x, y)` (north-referenced); `skymapDraw()` derives `vLon` via a frame-conditional: identity for Horizon, `90° − viewLon` otherwise. All readers/writers of `viewLon` apply the same per-frame `atan2` argument order.

### Angles

All computation in radians. Schlyter orbital elements are in degrees, converted immediately. `DEG_TO_RAD` = π/180, `RAD_TO_DEG` = 180/π (renamed from old `DEG`/`RAD` — shorter names were easy to mix up). Observer lat/lon passed as radians throughout. `gmst()` and `localSiderealTime()` return radians.

### Matrices

3×3 row-major flat arrays (9 elements). `mvmul(m, x, y, z)` multiplies matrix by vector. Transpose = inverse for rotation matrices.

### Delta-T

`deltaT(jd)` converts UT (JD) to dynamical time (JDE = JD + ΔT/86400). VSOP87, Moon, and all solar system computations use JDE; sidereal time uses JD (UT). Day number `d = jde − JD2000`.

### Precession & Nutation

IAU 1976 precession + IAU 1980 nutation (3 dominant terms: Ω, 2L☉, 2L☽). In `updateSSCache()`, three rotation matrices handle all coordinate conversions (see skymap.js section). Equation of the equinoxes added to GMST for apparent sidereal time. Constellation boundaries stored in B1875, precessed to J2000 once at init. J2000 frame options bypass precession/nutation entirely.

### Light-time correction

One-iteration for planets, Pluto, asteroids, comets. VSOP87 planets use a cheap Schlyter first pass for the distance estimate. Planet pole directions and prime meridians also evaluated at retarded time. Not applied to Sun, Moon, or satellites (negligible).

### Satellites

SGP4 (near-earth, period < 225 min) and SDP4 (deep-space). Epochs are UTC — use JD, not JDE. Apparent magnitude uses McCants standard magnitudes (at 1000 km range, half-phase) with topocentric scaling, diffuse-sphere phase-angle correction, and cylindrical Earth-shadow model; eclipsed satellites hidden. No McCants entry defaults to +6.0. Magnitude filter is `magLimit + 3`. Satellites fainter than `magLimit` draw at faintest-star size.

### Phase angle

All `phaseAngle` values in `ssCache` are radians (0 = fully illuminated, π = fully dark). Moon's phase angle derived from elongation: `abs(π − elongation)`. `drawPhaseDisc()` renders terminator via `k = −cos(FV)` for the ellipse.

### Planet apparent size

`PLANET_DIAM1AU` gives equatorial diameter at 1 AU in arcseconds. Angular size = `PLANET_DIAM1AU[name] / geoDist / 60` arcminutes. Nonzero-flattening planets drawn as oblate ellipsoids with apparent oblateness = `flattening * cos(subObsLat)`. J2000 PAs converted to screen angles by `j2kPAToScreen()`.

### Planetary moons

ESAA 3rd Ed. ch.9 analytical theories for 23 moons. Moon functions take JDE, return planetocentric J2000 equatorial AU. In `updateSSCache()`, offsets added to parent's geocentric position. Phoebe and Nereid overridden with `moonPositionKepler()` (JPL elements). Conical shadow tapers from planet radius to zero at `L = R × D_sun / (R_sun − R)`.

### Distance sorting

`ssCache` sorted farthest-first. Sort key `_d` is in AU: `geoDist` for planets/comets/asteroids/planetmoons, `dist` (AU) for Sun, `dist` (km) ÷ `KM_PER_AU` for Moon/satellites.

### Calendar

`julianDate()` and `calendarDate()` handle Julian/Gregorian switchover at Oct 15, 1582 (JD 2299161). Date stepping uses JD round-trip so Oct 4→Oct 15 is one step.

### Projection

Stereographic from antipode. Points within 90° of center → `r < 2` in normalized coords. `clipR = 2 * scale` clips to the visible hemisphere. `toScreen(cX, cY)` converts stereographic chart coords to canvas pixels (applying flip factors). Global projection closures (`skyProject`/`skyUnproject`/`skyIsVisible`/`viewProject`/`viewProjectRaw`/`viewUnproject`/`radToPx`/`pxToRad`) are assigned near the top of `skymapDraw()` so they're available to all drawing code and external callers. Internal drawing code uses `skyProject` directly for constellation centers, deep sky objects, and shadow projections rather than reimplementing the projection math. During drag/zoom, cached SS positions are transformed through the frame matrix like stars.

## License

Public domain (Unlicense).
