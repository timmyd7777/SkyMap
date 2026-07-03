#!/usr/bin/env python3
"""Generate nebulae.js from Contours.csv and Index.csv.

Usage:
    cd data
    python3 gen_nebulae.py

Downloads source CSVs from SSCore if not present. Outputs nebulae.js with
two tables: NEBULA_CONTOURS (array of contour point arrays in radians) and
NEBULA_INDEX (array of name arrays).
"""

import csv
import math
import os
import sys
import urllib.request

BASE_URL = 'https://raw.githubusercontent.com/timmyd7777/SSCore/master/SSData/DeepSky'
for fname in ['Contours.csv', 'Index.csv']:
    if not os.path.exists(fname):
        url = f'{BASE_URL}/{fname}'
        print(f"Downloading {url} -> {fname}", file=sys.stderr)
        urllib.request.urlretrieve(url, fname)

DEG2RAD = math.pi / 180.0

contours = {}
with open('Contours.csv') as f:
    for row in csv.reader(f):
        ra_deg, dec_deg, idx = float(row[0]), float(row[1]), int(row[2])
        contours.setdefault(idx, []).append((ra_deg * DEG2RAD, dec_deg * DEG2RAD))

index = {}
with open('Index.csv') as f:
    for row in csv.reader(f, skipinitialspace=True):
        idx = int(row[0])
        names = [n.strip() for n in row[1].split(';')]
        index[idx] = names

max_idx = max(max(contours.keys()), max(index.keys()))

with open('nebulae.js', 'w') as out:
    out.write('const NEBULA_CONTOURS = [\n')
    for i in range(1, max_idx + 1):
        pts = contours.get(i, [])
        pairs = ','.join('[%.4f,%.4f]' % (ra, dec) for ra, dec in pts)
        out.write('  [%s],\n' % pairs)
    out.write('];\n\n')

    out.write('const NEBULA_INDEX = [\n')
    for i in range(1, max_idx + 1):
        names = index.get(i, [])
        quoted = ','.join('"%s"' % n for n in names)
        out.write('  [%s],\n' % quoted)
    out.write('];\n')

print(f'Wrote {max_idx} contours to nebulae.js', file=sys.stderr)
