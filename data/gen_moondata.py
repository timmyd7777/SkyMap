#!/usr/bin/env python3
"""Parse JPL 'Planetary Satellite Mean Orbital Parameters' and 'Physical Parameters'
PDFs and generate a JavaScript table for moons.js.

Usage:
    cd data
    python3 gen_moondata.py [--all]

Requires pdftotext (from poppler-utils). Reads PDFs from ../docs/jpl/.
Output goes to stdout as a JavaScript const declaration.
By default, only moons with analytical theories in moons.js are included.
Use --all to include all 177 moons.
"""

import sys, re, math, subprocess, os

# --- Configuration ---

# Moons with analytical theories in moons.js
ANALYTICAL_MOONS = {
    'Moon', 'Phobos', 'Deimos',
    'Io', 'Europa', 'Ganymede', 'Callisto',
    'Mimas', 'Enceladus', 'Tethys', 'Dione', 'Rhea',
    'Titan', 'Hyperion', 'Iapetus', 'Phoebe',
    'Ariel', 'Umbriel', 'Titania', 'Oberon', 'Miranda',
    'Triton', 'Nereid', 'Charon',
}

# Reference plane poles
ECL_POLE_RA = 270.0
ECL_POLE_DEC = 66.561

# Planet equatorial poles for equatorial-frame sections
URANUS_POLE_RA = 77.311     # south pole convention (matches GUST86)
URANUS_POLE_DEC = 15.175
PLUTO_POLE_RA = 132.993     # IAU north pole
PLUTO_POLE_DEC = -6.163

# Mean heliocentric distances (AU) for V0 -> H conversion
PLANET_AU = {
    'earth': 1.0, 'mars': 1.5237, 'jupiter': 5.2026, 'saturn': 9.5549,
    'uranus': 19.2184, 'neptune': 30.1104, 'pluto': 39.48,
}
MOON_DIST_AU = 384400.0 / 149597870.7


def julian_date(y, m, d):
    """Compute Julian Date from calendar date (Gregorian)."""
    if m <= 2:
        y -= 1
        m += 12
    A = int(y / 100)
    B = 2 - A + int(A / 4)
    return int(365.25 * (y + 4716)) + int(30.6001 * (m + 1)) + d + B - 1524.5


def v0_to_H(v0, planet):
    """Convert mean opposition magnitude V0 to absolute magnitude H."""
    r = PLANET_AU.get(planet, 1.0)
    delta = MOON_DIST_AU if planet == 'earth' else r - 1.0
    return v0 - 5.0 * math.log10(r * delta)


def parse_orbits(text):
    """Parse pdftotext output of the orbital elements PDF.
    Returns list of dicts with orbital elements for each moon."""
    lines = text.split('\n')
    moons = []
    current_planet = None
    current_type = None   # 'laplace', 'ecliptic', 'equatorial'
    header_cols = None
    epoch_jde = 2451545.0

    i = 0
    while i < len(lines):
        line = lines[i]

        # Detect planet (reset epoch to J2000 default for each new planet section,
        # since not all sections state an explicit epoch — e.g. Pluto)
        prev_planet = current_planet
        if 'Satellites of Earth' in line:
            current_planet = 'earth'
        elif 'Satellites of Mars' in line:
            current_planet = 'mars'
        elif 'Satellites of Jupiter' in line:
            current_planet = 'jupiter'
        elif 'Satellites of Saturn' in line:
            current_planet = 'saturn'
        elif 'Satellites of Uranus' in line:
            current_planet = 'uranus'
        elif 'Satellites of Neptune' in line:
            current_planet = 'neptune'
        elif 'Satellites of Pluto' in line:
            current_planet = 'pluto'
        if current_planet != prev_planet:
            epoch_jde = 2451545.0
            header_cols = None

        # Detect reference frame
        if 'ecliptic' in line.lower() and ('orbital' in line.lower() or 'mean' in line.lower()):
            current_type = 'ecliptic'
        elif 'laplace' in line.lower():
            current_type = 'laplace'
        elif 'equatorial' in line.lower() and ('orbital' in line.lower() or 'mean' in line.lower()):
            current_type = 'equatorial'

        # Detect epoch
        epoch_match = re.search(r'Epoch\s+(\d{4})\s+(\w+)\.?\s+(\d+\.?\d*)\s+T', line)
        if epoch_match:
            year = int(epoch_match.group(1))
            month_name = epoch_match.group(2)
            day = float(epoch_match.group(3))
            months = {'Jan':1,'Feb':2,'Mar':3,'Apr':4,'May':5,'Jun':6,
                       'Jul':7,'Aug':8,'Sep':9,'Oct':10,'Nov':11,'Dec':12}
            epoch_jde = julian_date(year, months.get(month_name, 1), day)

        # Detect header line
        if re.match(r'\s*Sat\.?\s+a\s+e\s+w\s+M\s+i\s+node', line):
            has_laplace = 'R.A.' in line or 'Tilt' in line
            if has_laplace:
                header_cols = 'laplace'
            elif current_type == 'equatorial':
                header_cols = 'equatorial'
            else:
                header_cols = 'ecliptic'
            i += 2  # skip units line
            continue

        # Parse data lines
        if current_planet and header_cols:
            stripped = line.strip()
            if not stripped or stripped.startswith('(') or 'jump to' in stripped:
                i += 1
                continue
            if stripped.startswith('Sat') or stripped.startswith('Common') or stripped.startswith('Heading'):
                header_cols = None
                i += 1
                continue
            if 'Epoch' in stripped or 'Solution' in stripped or 'Mean' in stripped:
                i += 1
                continue
            if stripped.startswith('Site Manager') or stripped.startswith('Webmaster'):
                break

            name_match = re.match(r'\s*(S/\d{4}\s+\w+\s+\d+|[A-Z][a-z]+(?:\s+[A-Z]\s+\d+)?)\s+', stripped)
            if name_match:
                name = name_match.group(1).strip()
                rest = stripped[name_match.end():].strip()
                nums = re.findall(r'-?[\d]+\.[\d]*(?:E[+-]?\d+)?|-?[\d]+', rest)
                if len(nums) < 8:
                    i += 1
                    continue
                try:
                    nf = [float(x) for x in nums]
                except ValueError:
                    i += 1
                    continue

                moon = {'name': name, 'planet': current_planet, 'epoch': epoch_jde}

                if header_cols == 'laplace' and len(nf) >= 14:
                    moon.update(a=nf[0], e=nf[1], w=nf[2], M=nf[3], i=nf[4], node=nf[5],
                                n=nf[6], P=nf[7], Pw=nf[8], Pnode=nf[9],
                                RA=nf[10], Dec=nf[11])
                elif (header_cols in ('ecliptic', 'equatorial')) and len(nf) >= 10:
                    moon.update(a=nf[0], e=nf[1], w=nf[2], M=nf[3], i=nf[4], node=nf[5],
                                n=nf[6], P=nf[7],
                                Pw=nf[8] if len(nf) > 9 else 0,
                                Pnode=nf[9] if len(nf) > 10 else 0)
                    if header_cols == 'equatorial' and current_planet == 'uranus':
                        moon.update(RA=URANUS_POLE_RA, Dec=URANUS_POLE_DEC)
                    elif header_cols == 'equatorial' and current_planet == 'pluto':
                        moon.update(RA=PLUTO_POLE_RA, Dec=PLUTO_POLE_DEC)
                    else:
                        moon.update(RA=ECL_POLE_RA, Dec=ECL_POLE_DEC)
                else:
                    i += 1
                    continue

                moon['ref_type'] = header_cols

                # Prograde orbits (i <= 90): node regresses; retrograde (i > 90): node advances.
                # moonPositionKepler() uses node + nRate*dt, so negate Pnode for prograde.
                if moon['i'] <= 90.0:
                    moon['Pnode'] = -moon['Pnode']

                # Mean motion: PDF "n" is mean longitude rate, convert to mean anomaly rate.
                # moonPositionKepler() computes L = (node + nRate*dt) + (w + wRate*dt) + M,
                # so dL/dt = nRate + wRate + n. Solving: n = n_pdf - wRate - nRate.
                wrate = 360.0 / moon['Pw'] if moon['Pw'] else 0.0
                Nrate = 360.0 / moon['Pnode'] if moon['Pnode'] else 0.0
                moon['n'] = moon['n'] - (wrate + Nrate) / 365.25

                # The GUST86 analytical theory for Uranus's 5 classical moons uses
                # a south-pole equatorial frame where the x-axis points to the
                # descending node, while the JPL elements measure the longitude
                # of the ascending node from the ascending node. The 180° offset
                # in M compensates. Evidence: the GUST86 code in moons.js
                # computes M = L - P + PI, where +PI is exactly this offset.
                if name in ('Ariel', 'Umbriel', 'Titania', 'Oberon', 'Miranda'):
                    moon['M'] = (moon['M'] + 180.0) % 360.0

                moons.append(moon)

        i += 1

    return moons


def parse_phys(text):
    """Parse pdftotext output of the physical parameters PDF.
    Returns dict keyed by moon name with Radius, Magnitude, Albedo."""
    phys = {}
    skip_words = ['Sat.', 'km3', 'Page ', 'https:', 'IMPORTANT', "Don't show",
                  'Table Column', 'References', 'View the NASA', 'Center for Near',
                  'subscribe', 'Please visit', 'document is',
                  'Planetary', 'Satellite', 'Geophysical', 'Astronomical',
                  'Contribution', 'Irregular', 'Limits', 'Nature', 'Size', 'Space', 'Map ']

    for line in text.split('\n'):
        stripped = line.strip()
        if not stripped:
            continue
        if any(s in stripped for s in skip_words):
            continue
        if stripped.startswith('[') or re.match(r'^\d+\.', stripped):
            continue

        name_match = re.match(r"\s*(S/\d{4}\s+\w+\s*\d*|[A-Z][a-z]+(?:'[a-z]+)?)\s+", line)
        if not name_match:
            continue
        name = name_match.group(1).strip()
        rest = line[name_match.end():]

        rest_clean = re.sub(r'\[[\d,]+\]', '', rest)
        rest_clean = re.sub(r'±[\d.Ee+-]+', '', rest_clean)
        rest_clean = rest_clean.replace('R', ' ').replace('V', ' ').replace('r', ' ')
        # Replace ? with sentinel to preserve column count (GM, Radius, Density, Mag, Albedo)
        rest_clean = rest_clean.replace('?', '99999')

        nums = re.findall(r'-?[\d]+\.[\d]*(?:[Ee][+-]?\d+)?|-?[\d]+', rest_clean)
        if len(nums) < 3:
            continue
        try:
            nf = [float(x) for x in nums]
        except ValueError:
            continue

        entry = {}
        if len(nf) >= 2 and nf[1] < 10000:
            entry['Radius'] = nf[1]
        if len(nf) >= 4 and nf[3] < 50:
            entry['Magnitude'] = nf[3]
        if len(nf) >= 5 and nf[4] < 10:
            entry['Albedo'] = nf[4]

        phys[name] = entry

    return phys


def format_js(moons, phys, analytical_only=False):
    """Format moon data as a JavaScript table."""
    if analytical_only:
        moons = [m for m in moons if m['name'] in ANALYTICAL_MOONS]

    # Group by planet for readability
    planets = {}
    for m in moons:
        planets.setdefault(m['planet'], []).append(m)

    planet_order = ['earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']
    lines = []
    lines.append('const MOON_DATA = {')

    for planet in planet_order:
        if planet not in planets:
            continue
        for m in planets[planet]:
            name = m['name']
            pp = phys.get(name, {})
            radius = pp.get('Radius', 0)

            # Convert V0 to H
            h = ''
            if 'Magnitude' in pp:
                h = f"{v0_to_H(pp['Magnitude'], m['planet']):.1f}"

            fields = []
            fields.append(f"a:{m['a']:.0f}")
            fields.append(f"e:{m['e']:.4f}")
            fields.append(f"w:{m['w']:.3f}")
            fields.append(f"M:{m['M']:.3f}")
            fields.append(f"i:{m['i']:.3f}")
            fields.append(f"node:{m['node']:.3f}")
            fields.append(f"epoch:{m['epoch']:.1f}")
            fields.append(f"n:{m['n']:.7f}")
            fields.append(f"Pw:{m['Pw']:.3f}")
            fields.append(f"Pnode:{m['Pnode']:.3f}")
            fields.append(f"RA:{m['RA']:.3f}")
            fields.append(f"Dec:{m['Dec']:.3f}")
            if radius:
                fields.append(f"radius:{radius:.1f}")
            if h:
                fields.append(f"H:{h}")

            jskey = f"'{name}'" if '/' in name or ' ' in name else name
            lines.append(f"  {jskey}: {{{', '.join(fields)}}},")

    lines.append('};')
    return '\n'.join(lines)


def pdf_to_text(pdf_path):
    """Extract text from PDF using pdftotext -layout."""
    result = subprocess.run(['pdftotext', '-layout', pdf_path, '-'],
                            capture_output=True, text=True, check=True)
    return result.stdout


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    jpl_dir = os.path.join(script_dir, '..', 'docs', 'jpl')
    orbits_pdf = os.path.join(jpl_dir, 'moon_orbits.pdf')
    phys_pdf = os.path.join(jpl_dir, 'moon_phys.pdf')

    for pdf in (orbits_pdf, phys_pdf):
        if not os.path.exists(pdf):
            print(f"Error: {pdf} not found", file=sys.stderr)
            sys.exit(1)

    all_moons = '--all' in sys.argv

    orbits_text = pdf_to_text(orbits_pdf)
    phys_text = pdf_to_text(phys_pdf)

    moons = parse_orbits(orbits_text)
    phys = parse_phys(phys_text)

    print(f"Parsed {len(moons)} moons from orbital PDF, {len(phys)} from physical PDF", file=sys.stderr)

    js = format_js(moons, phys, analytical_only=not all_moons)
    print(js)


if __name__ == '__main__':
    main()
