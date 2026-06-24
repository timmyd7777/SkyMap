#!/usr/bin/env python3
"""Generate vsop87.js from VSOP87D coefficient files (Bureau des Longitudes).
Downloads heliocentric ecliptic-of-date spherical coordinate series for all
major planets, truncates to the exact Meeus "Astronomical Algorithms" level
by keeping the top N terms per series (sorted by decreasing amplitude), and
outputs compact JavaScript data tables.

Usage: python3 gen_vsop87.py
  Output: vsop87.js
"""
import os, urllib.request, re

PLANETS = ['mer', 'ven', 'ear', 'mar', 'jup', 'sat', 'ura', 'nep']
PLANET_NAMES = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']
BASE_URL = 'https://cdsarc.cds.unistra.fr/ftp/VI/81/'
VAR_NAMES = {1: 'L', 2: 'B', 3: 'R'}

# Exact term counts from Meeus "Astronomical Algorithms" 2nd ed., Appendix III
# (pages 414-454). For each planet: {var: [n0, n1, n2, ...]} where nK is the
# number of terms in series K (L0, L1, ...; B0, B1, ...; R0, R1, ...).
MEEUS_COUNTS = {
    'mer': {
        'L': [38, 16, 10, 8, 6, 1],
        'B': [14, 11, 9, 7, 2],
        'R': [13, 8, 7, 5],
    },
    'ven': {
        'L': [24, 12, 8, 3, 3, 1],
        'B': [9, 4, 4, 4, 1],
        'R': [12, 3, 3, 1, 1],
    },
    'ear': {
        'L': [64, 34, 20, 7, 3, 1],
        'B': [5, 2],
        'R': [40, 10, 6, 2, 1],
    },
    'mar': {
        'L': [69, 46, 33, 12, 8, 2],
        'B': [16, 9, 7, 4, 3],
        'R': [45, 27, 11, 6, 4],
    },
    'jup': {
        'L': [64, 61, 57, 39, 19, 5],
        'B': [26, 22, 14, 9, 6, 1],
        'R': [46, 43, 36, 28, 15, 7],
    },
    'sat': {
        'L': [90, 79, 63, 48, 27, 12],
        'B': [34, 32, 29, 21, 12, 2],
        'R': [44, 38, 32, 28, 23, 18],
    },
    'ura': {
        'L': [91, 57, 35, 18, 4],
        'B': [28, 20, 11, 4, 1],
        'R': [59, 35, 18, 10, 2],
    },
    'nep': {
        'L': [38, 18, 7, 4, 1],
        'B': [17, 13, 6, 4, 1],
        'R': [32, 15, 5, 1],
    },
}

# Terms from Meeus Appendix III for series not present in VSOP87D files.
# Values transcribed from the book (A in 10^-8 units, B and C in radians).
MEEUS_EXTRA = {
    'ura': {
        'B4': [(6, 2.85, 74.78)],
    },
    'nep': {
        'L4': [(114, 3.142, 0)],
        'B3': [(273, 1.017, 38.133), (2, 0, 0), (2, 2.37, 36.65), (2, 5.33, 76.27)],
        'B4': [(6, 2.67, 38.13)],
    },
}

def download(planet_code):
    """Download VSOP87D file for a planet, caching locally."""
    fname = f'VSOP87D.{planet_code}'
    if os.path.exists(fname):
        with open(fname) as f:
            return f.read()
    url = BASE_URL + fname
    print(f'  Downloading {url}')
    try:
        data = urllib.request.urlopen(url, timeout=30).read().decode('ascii')
    except Exception:
        alt_url = f'ftp://ftp.imcce.fr/pub/ephem/planets/vsop87/{fname}'
        print(f'  Trying {alt_url}')
        data = urllib.request.urlopen(alt_url, timeout=30).read().decode('ascii')
    with open(fname, 'w') as f:
        f.write(data)
    return data

def parse_vsop87d_all(text):
    """Parse a VSOP87D file into {L: [[all_terms0], ...], B: [...], R: [...]}
    keeping ALL terms (no truncation). Terms are sorted by decreasing |A|."""
    result = {'L': [], 'B': [], 'R': []}
    current_var = None
    current_power = None
    current_terms = []

    for line in text.split('\n'):
        if line.startswith(' VSOP87'):
            if current_var is not None and current_terms:
                var_key = VAR_NAMES[current_var]
                while len(result[var_key]) <= current_power:
                    result[var_key].append([])
                current_terms.sort(key=lambda t: -abs(t[0]))
                result[var_key][current_power] = current_terms

            var_match = re.search(r'VARIABLE\s+(\d)', line)
            pow_match = re.search(r'\*T\*\*(\d)', line)
            if var_match and pow_match:
                current_var = int(var_match.group(1))
                current_power = int(pow_match.group(1))
                current_terms = []
        elif len(line) > 100 and current_var is not None:
            try:
                A = float(line[79:97].strip())
                B = float(line[97:111].strip())
                C = float(line[111:131].strip())
                current_terms.append((A, B, C))
            except (ValueError, IndexError):
                pass

    if current_var is not None and current_terms:
        var_key = VAR_NAMES[current_var]
        while len(result[var_key]) <= current_power:
            result[var_key].append([])
        current_terms.sort(key=lambda t: -abs(t[0]))
        result[var_key][current_power] = current_terms

    return result

def truncate_to_meeus(full_data, counts, extra_terms):
    """Keep only the top N terms per series, matching Meeus truncation.
    extra_terms supplies terms for series not present in VSOP87D files."""
    result = {'L': [], 'B': [], 'R': []}
    for var in ['L', 'B', 'R']:
        var_counts = counts.get(var, [])
        for i, n in enumerate(var_counts):
            if i < len(full_data[var]) and full_data[var][i]:
                terms = full_data[var][i][:n]
            else:
                terms = []
            key = f'{var}{i}'
            if key in extra_terms and len(terms) < n:
                terms.extend(extra_terms[key][:n - len(terms)])
            result[var].append(terms)
    return result

def format_term(A, B, C):
    """Format a single (A, B, C) tuple as a compact JavaScript array."""
    if abs(A) >= 0.001:
        a_str = f'{A:.11f}'.rstrip('0').rstrip('.')
    else:
        a_str = f'{A:.14e}'
    b_str = f'{B:.10f}'.rstrip('0').rstrip('.')
    c_str = f'{C:.10f}'.rstrip('0').rstrip('.')
    return f'[{a_str},{b_str},{c_str}]'

def main():
    print('Generating VSOP87 with exact Meeus truncation counts')

    all_data = {}
    total_terms = 0

    for code, name in zip(PLANETS, PLANET_NAMES):
        print(f'Processing {name}...')
        text = download(code)
        full = parse_vsop87d_all(text)
        data = truncate_to_meeus(full, MEEUS_COUNTS[code], MEEUS_EXTRA.get(code, {}))
        all_data[code] = data
        n = sum(len(terms) for series in data.values() for terms in series)
        total_terms += n
        for var in ['L', 'B', 'R']:
            actual = [len(s) for s in data[var]]
            expected = MEEUS_COUNTS[code].get(var, [])
            ok = '✓' if actual == expected else f'✗ expected {expected}'
            print(f'  {var}: {actual} = {sum(actual)} terms {ok}')

    print(f'\nTotal terms: {total_terms}')

    js_name = {'mer': 'MERCURY', 'ven': 'VENUS', 'ear': 'EARTH', 'mar': 'MARS',
               'jup': 'JUPITER', 'sat': 'SATURN', 'ura': 'URANUS', 'nep': 'NEPTUNE'}

    with open('vsop87.js', 'w') as f:
        f.write('// VSOP87 truncated planetary ephemeris (Bretagnon & Francou 1988).\n')
        f.write('// Heliocentric ecliptic coordinates referred to mean dynamical\n')
        f.write('// ecliptic and equinox of the date.\n')
        f.write('// Truncated to Meeus "Astronomical Algorithms" Appendix III level.\n')
        f.write('// Generated by gen_vsop87.py from VSOP87D data files.\n')
        f.write('//\n')
        f.write('// Each planet: {L: [[L0_terms], [L1_terms], ...], B: [...], R: [...]}\n')
        f.write('// Each term: [A, B, C] where contribution = A * cos(B + C * tau)\n')
        f.write('// tau = Julian millennia from J2000: (JDE - 2451545.0) / 365250\n')
        f.write('// L = L0 + L1*tau + L2*tau^2 + ...  (radians)\n')
        f.write('// B = B0 + B1*tau + B2*tau^2 + ...  (radians)\n')
        f.write('// R = R0 + R1*tau + R2*tau^2 + ...  (AU)\n\n')

        f.write(f'// {total_terms} terms across {len(PLANETS)} planets.\n')
        f.write('const VSOP87 = {\n')
        for i, (code, name) in enumerate(zip(PLANETS, PLANET_NAMES)):
            data = all_data[code]
            jsn = js_name[code]
            n = sum(len(terms) for series in data.values() for terms in series)
            f.write(f'  {jsn}: {{ // {n} terms\n')
            for var in ['L', 'B', 'R']:
                f.write(f'    {var}:[\n')
                for si, terms in enumerate(data[var]):
                    f.write(f'      // {var}{si} ({len(terms)} terms)\n')
                    f.write(f'      [\n')
                    for ti, (A, B, C) in enumerate(terms):
                        comma = ',' if ti < len(terms) - 1 else ''
                        f.write(f'        {format_term(A, B, C)}{comma}\n')
                    comma = ',' if si < len(data[var]) - 1 else ''
                    f.write(f'      ]{comma}\n')
                f.write(f'    ],\n')
            comma = ',' if i < len(PLANETS) - 1 else ''
            f.write(f'  }}{comma}\n')
        f.write('};\n')

    size = os.path.getsize('vsop87.js')
    print(f'\nWrote vsop87.js ({size:,} bytes, {total_terms} terms)')

if __name__ == '__main__':
    main()
