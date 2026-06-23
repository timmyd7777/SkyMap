#!/usr/bin/env python3
"""Read MilkyWay.csv and generate milkyway.js with closed boundary polygons.

CSV columns: RA (degrees), Dec (degrees), Region (1-85), Edge (1=boundary, 0=fill).
All points within a region form a closed polygon (boundary + fill).

Auto-downloads MilkyWay.csv from SSCore if not present.
"""
import csv, math, os, sys, urllib.request

CSV_FILE = 'MilkyWay.csv'
CSV_URL = 'https://raw.githubusercontent.com/timmyd7777/SSCore/master/SSData/DeepSky/MilkyWay.csv'

if not os.path.exists(CSV_FILE):
    print(f"Downloading {CSV_URL} -> {CSV_FILE}", file=sys.stderr)
    urllib.request.urlretrieve(CSV_URL, CSV_FILE)

regions = {}
with open(CSV_FILE) as f:
    for row in csv.DictReader(f):
        r = int(row['Region'])
        ra = float(row['RA']) * math.pi / 180.0
        dec = float(row['Dec']) * math.pi / 180.0
        regions.setdefault(r, []).append((ra, dec))

polys = [regions[k] for k in sorted(regions)]
COALSACK = len(polys) - 1

with open('milkyway.js', 'w') as out:
    out.write(f'const COALSACK_INDEX = {COALSACK};\n')
    out.write('const MILKYWAY = [\n')
    for poly in polys:
        pts = ','.join(f'[{ra:.4f},{dec:.4f}]' for ra, dec in poly)
        out.write(f'  [{pts}],\n')
    out.write('];\n')

print(f"Wrote milkyway.js ({len(polys)} polygons, COALSACK_INDEX={COALSACK})", file=sys.stderr)
