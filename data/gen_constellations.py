#!/usr/bin/env python3
"""Generate constellations.js from shapes.csv, Boundaries.csv, and Constellations.csv."""
import math, os, sys, urllib.request

BASE_URL = 'https://raw.githubusercontent.com/timmyd7777/SSCore/master/SSData/Constellations'
NEEDED_FILES = {
    'shapes.csv': 'Shapes.csv',
    'Boundaries.csv': 'Boundaries.csv',
    'Constellations.csv': 'Constellations.csv',
}

for local_name, remote_name in NEEDED_FILES.items():
    if not os.path.exists(local_name):
        url = f'{BASE_URL}/{remote_name}'
        print(f"Downloading {url} -> {local_name}", file=sys.stderr)
        urllib.request.urlretrieve(url, local_name)

# Parse constellation centers / names from Constellations.csv
con_centers = {}
with open('Constellations.csv') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split(',')
        if parts[0] != 'CN' or len(parts) < 8:
            continue
        try:
            ra_rad = float(parts[1].strip()) * 15 * math.pi / 180
            dec_rad = float(parts[2].strip()) * math.pi / 180
        except ValueError:
            continue
        abbr = parts[5].strip()
        name = parts[6].strip()
        con_centers[abbr] = {'ra': ra_rad, 'dec': dec_rad, 'name': name}

print(f"Constellation centers: {len(con_centers)}", file=sys.stderr)

constellations = {}
with open('shapes.csv') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split(',')
        if len(parts) != 3:
            continue
        con = parts[0].strip()
        try:
            hr1, hr2 = int(parts[1].strip()), int(parts[2].strip())
        except ValueError:
            continue
        if con not in constellations:
            constellations[con] = []
        constellations[con].append((hr1, hr2))

print(f"Constellation lines: {sum(len(v) for v in constellations.values())} in {len(constellations)} constellations", file=sys.stderr)

# Parse IAU constellation boundaries (B1875.0 epoch)
boundaries = {}
with open('Boundaries.csv') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split(',')
        if len(parts) != 3:
            continue
        try:
            ra_rad = float(parts[0].strip()) * 15 * math.pi / 180  # hours to radians
            dec_rad = float(parts[1].strip()) * math.pi / 180
        except ValueError:
            continue
        con = parts[2].strip()
        if con not in boundaries:
            boundaries[con] = []
        boundaries[con].append((ra_rad, dec_rad))

# Interpolate boundary segments so no step exceeds 5° in RA or Dec
MAX_STEP = 5 * math.pi / 180
for con in boundaries:
    raw = boundaries[con]
    interp = [raw[0]]
    for i in range(len(raw)):
        ra0, dec0 = raw[i]
        ra1, dec1 = raw[(i + 1) % len(raw)]
        if abs(dec1 - dec0) < 1e-9:
            # Parallel of declination: interpolate RA
            dra = ra1 - ra0
            if dra > math.pi: dra -= 2 * math.pi
            if dra < -math.pi: dra += 2 * math.pi
            n = max(1, math.ceil(abs(dra) / MAX_STEP))
            for j in range(1, n):
                ra = ra0 + dra * j / n
                if ra < 0: ra += 2 * math.pi
                if ra >= 2 * math.pi: ra -= 2 * math.pi
                interp.append((ra, dec0))
        elif abs(ra1 - ra0) < 1e-9 or abs(ra1 - ra0 - 2*math.pi) < 1e-9 or abs(ra0 - ra1 - 2*math.pi) < 1e-9:
            # Meridian of RA: interpolate Dec
            ddec = dec1 - dec0
            n = max(1, math.ceil(abs(ddec) / MAX_STEP))
            for j in range(1, n):
                interp.append((ra0, dec0 + ddec * j / n))
        if (i + 1) % len(raw) != 0:
            interp.append((ra1, dec1))
    boundaries[con] = interp

total_verts = sum(len(v) for v in boundaries.values())
print(f"Boundaries: {total_verts} vertices ({total_verts - 1562} interpolated) in {len(boundaries)} constellations", file=sys.stderr)

with open('constellations.js', 'w', encoding='utf-8') as out:
    out.write('// Constellation stick figures — HR catalog numbers for each line segment\n')
    out.write('// Each entry: {name, lines:[[hr1,hr2], ...]} keyed by abbreviation\n')
    out.write('const CONSTELLATIONS = {\n')
    for con in sorted(constellations.keys()):
        name = con_centers[con]['name'] if con in con_centers else con
        lines = constellations[con]
        lines_str = ','.join(f'[{h1},{h2}]' for h1, h2 in lines)
        out.write(f'{con}:{{name:"{name}",lines:[{lines_str}]}},\n')
    out.write('};\n\n')
    out.write('// Constellation centers — J2000 RA/Dec in radians, name, abbreviation\n')
    out.write('// [ra, dec, name, abbr]\n')
    out.write('const CON_CENTERS = [\n')
    for abbr in sorted(con_centers.keys()):
        c = con_centers[abbr]
        out.write(f'[{c["ra"]:.6f},{c["dec"]:.6f},"{c["name"]}","{abbr}"],\n')
    out.write('];\n\n')
    out.write('// IAU constellation boundaries — B1875.0 RA/Dec in radians\n')
    out.write('// Each entry: [ra,dec, ra,dec, ...] — polygon vertices\n')
    out.write('const BOUNDARIES = {\n')
    for con in sorted(boundaries.keys()):
        verts = boundaries[con]
        coords = ','.join(f'{ra:.6f},{dec:.6f}' for ra, dec in verts)
        out.write(f'{con}:[{coords}],\n')
    out.write('};\n')

print("Wrote constellations.js", file=sys.stderr)
