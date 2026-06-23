#!/usr/bin/env python3
"""Generate deepsky.js from Messier.csv and Caldwell.csv."""

import csv
import os
import re
import math
import sys
import urllib.request

BASE_URL = 'https://raw.githubusercontent.com/timmyd7777/SSCore/master/SSData/DeepSky'
for fname in ['Messier.csv', 'Caldwell.csv']:
    if not os.path.exists(fname):
        url = f'{BASE_URL}/{fname}'
        print(f"Downloading {url} -> {fname}", file=sys.stderr)
        urllib.request.urlretrieve(url, fname)

def parse_ra(s):
    """Parse RA 'HH MM SS.SS' to radians."""
    parts = s.strip().split()
    h, m, sec = float(parts[0]), float(parts[1]), float(parts[2])
    return (h + m / 60 + sec / 3600) * math.pi / 12

def parse_dec(s):
    """Parse Dec '+DD MM SS.S' to radians."""
    s = s.strip()
    sign = -1 if s.startswith('-') else 1
    parts = s.lstrip('+-').split()
    d, m, sec = float(parts[0]), float(parts[1]), float(parts[2])
    return sign * (d + m / 60 + sec / 3600) * math.pi / 180

def parse_row(fields):
    obj_type = fields[0].strip()
    ra = parse_ra(fields[1])
    dec = parse_dec(fields[2])
    vmag = fields[5].strip()
    vmag = float(vmag) if vmag else None
    dist = fields[7].strip()
    dist = float(dist) if dist else None
    maj = fields[10].strip()
    try:
        maj = float(maj) if maj else None
    except ValueError:
        maj = None

    # Identifiers start at field 13; common names are non-catalog strings
    catalog_pat = re.compile(
        r'^(M \d+|C \d+|NGC \d+|IC \d+|PK |PNG |PGC |UGC |UGCA |LBN |Sh2 |Mel |Cr |Tr )'
    )
    mc_id = None  # Messier or Caldwell
    ngc_ic = None  # NGC or IC
    names = []

    for f in fields[13:]:
        f = f.strip()
        if not f:
            continue
        if re.match(r'^M \d+$', f):
            mc_id = f
        elif re.match(r'^C \d+$', f):
            mc_id = f
        elif re.match(r'^(NGC|IC) \d+$', f) and ngc_ic is None:
            ngc_ic = f
        elif not catalog_pat.match(f):
            names.append(f)

    common = names[0] if names else None

    return {
        'type': obj_type,
        'ra': ra,
        'dec': dec,
        'mag': vmag,
        'dist': dist,
        'size': maj,
        'mc': mc_id,
        'ngc': ngc_ic,
        'name': common,
    }

def js_val(v, fmt=None):
    if v is None:
        return 'null'
    if isinstance(v, str):
        return f'"{v}"'
    if fmt:
        return fmt % v
    return str(v)

objects = []
for path in ['Messier.csv', 'Caldwell.csv']:
    with open(path, newline='') as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) < 14:
                continue
            objects.append(parse_row(row))

# Sort by catalog id (M first, then C), numerically
def sort_key(o):
    mc = o['mc'] or ''
    cat = mc[0] if mc else 'Z'
    order = {'M': 0, 'C': 1}.get(cat, 2)
    num = int(mc.split()[1]) if mc else 999
    return (order, num)

objects.sort(key=sort_key)

with open('deepsky.js', 'w') as out:
    out.write('// Deep sky objects: [type, ra_rad, dec_rad, mag, dist_pc, size_arcmin, mc_id, ngc_ic, name]\n')
    out.write('const DEEPSKY = [\n')
    for o in objects:
        parts = [
            js_val(o['type']),
            '%.6f' % o['ra'],
            '%.6f' % o['dec'],
            js_val(o['mag']),
            js_val(o['dist']),
            js_val(o['size']),
            js_val(o['mc']),
            js_val(o['ngc']),
            js_val(o['name']),
        ]
        out.write('  [' + ','.join(parts) + '],\n')
    out.write('];\n')

print(f'Wrote {len(objects)} objects to deepsky.js')
