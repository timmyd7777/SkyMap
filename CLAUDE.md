# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SkyMap is a browser-based interactive sky map that renders stars, constellations, deep sky objects, planets, Sun, Moon, asteroids, comets, and the Milky Way for any date/time (1500–2500 AD) and any location on Earth. It uses stereographic projection with six coordinate frame options (Horizon, Equatorial, Equatorial J2000, Ecliptic, Ecliptic J2000, Galactic).

**No build step, no dependencies, no server required.** Open `skymap.html` in a browser.

## Running

Open `skymap.html` directly in a browser. On desktop it loads `stars.js` (~130K stars to mag 9); on mobile it loads `stars_hr.js` (~9000 stars to mag 9) — the choice is made at runtime via user-agent detection. Asteroid and comet orbital elements are fetched from southernstars.com at init (cached in localStorage for 24 hours).

## Data Generation

The JS data files are pre-generated and checked in. To regenerate from source catalogs:

```
cd data
python3 gen_stars.py brightest.csv 6.0      # -> stars.js (bright catalog)
python3 gen_stars.py SKY2000.csv 8.0        # -> stars.js (extended catalog)
python3 gen_constellations.py               # -> constellations.js
python3 gen_deepsky.py                      # -> deepsky.js
python3 gen_cities.py                       # -> cities.js
python3 gen_milkyway.py                     # -> milkyway.js
```

Scripts auto-download source CSVs from [SSCore](https://github.com/timmyd7777/SSCore) if not present. Move generated `.js` files to the project root to update the app.

## Architecture

All code is vanilla JavaScript with no frameworks or bundling. The files load via `<script>` tags in `skymap.html`.

### Code Modules

- **`astromath.js`** — Foundation layer. Math constants (`DEG`, `RAD`, `TAU`), destructured `Math.*` functions, Julian date/sidereal time (with Julian/Gregorian calendar switchover at Oct 15, 1582), `calendarDate()` inverse (JD→calendar), IAU 1976 precession (`precessAngles()` returns Lieske arcsecond-based zetaA/zA/thetaA in radians), IAU 1980 nutation (3 dominant terms), mean/true obliquity, refraction (Bennett true→apparent, Saemundsson apparent→true), coordinate transforms (ecliptic↔equatorial, equatorial↔horizon), 3×3 matrix operations (row-major flat arrays), spherical↔Cartesian conversions, and `frameMatrix(frame, jd, latRad, lonDeg, j2000)` which builds the J2000→target-frame rotation matrix. When `j2000` is true, equatorial returns identity and ecliptic returns `rx(-obliquity(0))`. The J2000-to-galactic rotation matrix `mGalactic` is computed here.

- **`planets.js`** — Orbital mechanics using Schlyter elements. Sun/Moon/planet positions in ecliptic-of-date coordinates, Kepler equation solver (elliptical, parabolic, near-parabolic, hyperbolic), perturbation corrections (Jupiter/Saturn/Uranus), magnitude formulas (planets, asteroids via H/G system, comets via H/k), Saturn ring tilt, Moon topocentric parallax (`topocentricCorrection()`), `eclLonJ2000Corr(d)` for Schlyter's precession correction, `asteroidPosition()`/`cometPosition()` from MPC orbital elements, and `helioToGeo()` for heliocentric→geocentric conversion. Day number convention: `d = JD - 2451543.5` (Schlyter's epoch). Asteroid/comet positions are computed in ecliptic of-date (node precessed from J2000) or J2000 ecliptic (node unchanged), depending on the `j2000` flag; when J2000, the Sun's ecliptic longitude is also corrected via `eclLonJ2000Corr` so the geocentric conversion stays in a consistent coordinate system.

- **`mpc.js`** — Parsers for MPC (Minor Planet Center) orbital element files. `parseMPCComets(text)` parses Soft00Cmt format (perihelion time, q, e, ω, Ω, i, H, k). `parseMPCAsteroids(text)` parses MPCORB format (packed epoch, M, ω, Ω, i, e, n, a, H, G). `mpcUnpackEpoch(s)` decodes MPC packed epoch strings (century code I/J/K, hex-encoded month/day).

- **`skymap.js`** — Rendering engine. Pure Canvas 2D rendering with no DOM dependencies. The main function `skymapDraw(canvas, params)` calls `frameMatrix()` to get rotation matrices, computes nutation/obliquity/LST directly, then draws all layers in z-order. Solar system positions (Sun, Moon, planets, asteroids, comets) are cached as J2000 equatorial unit vectors in `ssCache` and only recomputed when the Julian date changes — during drag/zoom, cached positions are transformed through the frame matrix like stars. Contains stereographic projection, inverse projection (`viewUnproject`), label collision avoidance, `formatCoords()` for frame-aware coordinate display, object hit-testing (`pickObject`), frame switching (`changeFrame`), and optional astrological symbol rendering for solar system bodies (`PLANET_SYMBOLS`). Mutable view state (`viewLonPrecise`, `viewLatPrecise`, `viewFovPrecise`, `viewFrame`, `viewJ2000`) is global so the HTML wrapper can read/write it.

- **`skymap.html`** — UI wrapper. All DOM interaction, event handling (drag/pan/pinch-zoom/scroll-zoom), time zone management via `Intl` (including historical LMT for pre-1884 dates), animation timer, sidebar controls, date stepping via Julian Date round-trip (correctly skips the Oct 5–14, 1582 Gregorian gap), `fetchCached()` for downloading and caching orbital elements from southernstars.com (24-hour localStorage TTL with stale-cache fallback), and the `init()`/`draw()` loop. Calls `skymapDraw()` on every state change.

### Generated Data Files

- **`stars.js` / `stars_hr.js`** — Star arrays: `[RA_rad, Dec_rad, mag, dist_pc, HR, HD, HIP, bayer, flamsteed, name]`. Unit vectors `[x,y,z]` appended at runtime by `skymapInit()`.
- **`constellations.js`** — `CONSTELLATIONS` (stick figures by HR number pairs), `CON_CENTERS` (label positions), `BOUNDARIES` (IAU boundaries in B1875 RA/Dec, precessed to J2000 at init).
- **`deepsky.js`** — Messier + Caldwell objects: `[type, RA, Dec, mag, dist, size, M/C id, NGC/IC, name]`.
- **`cities.js`** — `[name, admin1, countryCode, lat, lon, timezone]` for ~4400 cities.
- **`milkyway.js`** — Polygons in galactic lon/lat pairs, converted to xyz Float32Arrays at init. `COALSACK_INDEX` marks the Coal Sack dark nebula polygon.

## Key Conventions

- **Coordinate system**: Internally, longitude = `atan2(x, y)`. For non-horizon frames, display longitude = `90° - internal` (RA increases leftward). The `azToDisp()` function handles this.
- **Angles**: All computation in radians. Schlyter orbital elements are in degrees, converted to radians immediately. `DEG` = π/180, `RAD` = 180/π.
- **Matrices**: 3×3 row-major flat arrays (9 elements). `mvmul(m, x, y, z)` multiplies matrix by vector. Transpose = inverse for rotation matrices.
- **Precession & Nutation**: IAU 1976 precession (Lieske 1979, arcsecond coefficients) + IAU 1980 nutation (3 dominant terms: Ω, 2L☉, 2L☽). Combined matrix `mPrecess = N · P` transforms J2000→true equatorial of date. Equation of the equinoxes (Δψ·cos ε_true) is added to GMST for apparent sidereal time. Constellation boundaries are stored in B1875 and precessed to J2000 once at init; star positions are J2000 and precessed to date each frame via the combined rotation matrix `M`. J2000 frame options bypass precession/nutation entirely (identity matrix for equatorial, mean obliquity rotation for ecliptic); planet ecliptic longitudes get Schlyter's precession correction (`eclLonJ2000Corr`) to shift from of-date to J2000.
- **Calendar**: `julianDate()` and `calendarDate()` handle the Julian/Gregorian switchover at Oct 15, 1582 (JD 2299161). Date stepping uses JD round-trip so Oct 4→Oct 15 is one step.
- **Projection**: Stereographic from antipode. Points within 90° of center → `r < 2` in normalized coords. `clipR = 2 * scale` clips to the visible hemisphere.

## License

Public domain (Unlicense).
