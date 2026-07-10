#!/usr/bin/env python3
"""Generate deepsky.js (full NGC/IC) and deepsky_mc.js (Messier+Caldwell only)
from SSCore CSV catalog files.

Usage:
    cd data
    python3 gen_deepsky.py

Downloads source CSVs from SSCore if not present. Move generated .js files
to the project root to update the app.
"""

import csv
import os
import re
import math
import sys
import urllib.request

BASE_URL = 'https://raw.githubusercontent.com/timmyd7777/SSCore/master/SSData/DeepSky'
for fname in ['Messier.csv', 'Caldwell.csv', 'MCNGCIC.csv']:
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
    if obj_type == 'NO':
        return None

    ra = parse_ra(fields[1])
    dec = parse_dec(fields[2])
    vmag = fields[5].strip() or fields[6].strip()
    vmag = float(vmag) if vmag else None
    dist = fields[7].strip()
    dist = float(dist) if dist else None
    maj = fields[10].strip()
    try:
        maj = float(maj) if maj else None
    except ValueError:
        maj = None
    minor = fields[11].strip() if len(fields) > 11 else ''
    try:
        minor = float(minor) if minor else None
    except ValueError:
        minor = None
    pa = fields[12].strip() if len(fields) > 12 else ''
    try:
        pa = float(pa) if pa else None
    except ValueError:
        pa = None
    morph = fields[9].strip() if len(fields) > 9 else ''
    morph = morph or None

    mc_id = None
    ngc_ic = None
    ngc_ic2 = None
    common = None

    # Column 13: semicolon-delimited catalog IDs (M, C, NGC, IC, etc.)
    ids_field = fields[13].strip() if len(fields) > 13 else ''
    if ids_field:
        for id_str in ids_field.split(';'):
            id_str = id_str.strip()
            if not id_str:
                continue
            if re.match(r'^[MC] \d+$', id_str):
                mc_id = id_str
            elif re.match(r'^(NGC|IC) \d+\w*$', id_str):
                if ngc_ic is None:
                    ngc_ic = id_str
                elif ngc_ic2 is None:
                    ngc_ic2 = id_str

    # Column 14: semicolon-delimited common names
    names_field = fields[14].strip() if len(fields) > 14 else ''
    if names_field:
        common = names_field.split(';')[0].strip() or None

    return [{
        'type': obj_type,
        'ra': ra,
        'dec': dec,
        'mag': vmag,
        'dist': dist,
        'major': maj,
        'minor': minor,
        'pa': pa,
        'morph': morph,
        'mc': mc_id,
        'ngcic': ngc_ic,
        'ngcic2': ngc_ic2,
        'name': common,
    }]

def js_val(v, fmt=None):
    if v is None:
        return 'null'
    if isinstance(v, str):
        return f'"{v}"'
    if fmt:
        return fmt % v
    return str(v)

def sort_key(o):
    mc = o['mc'] or ''
    ngc = o['ngcic'] or ''
    if mc:
        cat = mc[0]
        order = {'M': 0, 'C': 1}.get(cat, 2)
        num = int(mc.split()[1])
        return (order, num, '')
    elif ngc:
        m = re.match(r'^(NGC|IC) (\d+)(.*)', ngc)
        if m:
            cat_order = 2 if m.group(1) == 'NGC' else 3
            return (cat_order, int(m.group(2)), m.group(3))
    return (4, 0, '')

def write_js(objects, path):
    with open(path, 'w') as out:
        out.write('const DS_TYPE=0,DS_RA=1,DS_DEC=2,DS_MAG=3,DS_DIST=4,DS_MAJ=5,DS_MIN=6,DS_PA=7,DS_MORPH=8,DS_MC=9,DS_NGC=10,DS_NGC2=11,DS_NAME=12,DS_X=13,DS_Y=14,DS_Z=15;\n')
        out.write('const DEEPSKY = [\n')
        for o in objects:
            parts = [
                js_val(o['type']),
                '%.6f' % o['ra'],
                '%.6f' % o['dec'],
                js_val(o['mag']),
                js_val(o['dist']),
                js_val(o['major']),
                js_val(o['minor']),
                js_val(o['pa']),
                js_val(o['morph']),
                js_val(o['mc']),
                js_val(o['ngcic']),
                js_val(o['ngcic2']),
                js_val(o['name']),
            ]
            out.write('  [' + ','.join(parts) + '],\n')
        out.write('];\n')

# Parse Messier + Caldwell only -> deepsky_mc.js
mc_objects = []
for path in ['Messier.csv', 'Caldwell.csv']:
    with open(path, newline='') as f:
        for row in csv.reader(f):
            if len(row) < 14:
                continue
            if row[0].strip() == 'Type':
                continue
            entries = parse_row(row)
            if entries:
                mc_objects.extend(entries)

mc_objects.sort(key=sort_key)
write_js(mc_objects, 'deepsky_mc.js')
print(f'Wrote {len(mc_objects)} objects to deepsky_mc.js', file=sys.stderr)

# Parse full MCNGCIC -> deepsky.js
all_objects = []
with open('MCNGCIC.csv', newline='') as f:
    for row in csv.reader(f):
        if len(row) < 14:
            continue
        if row[0].strip() == 'Type':
            continue
        entries = parse_row(row)
        if entries:
            all_objects.extend(entries)

all_objects.sort(key=sort_key)
write_js(all_objects, 'deepsky.js')
print(f'Wrote {len(all_objects)} objects to deepsky.js', file=sys.stderr)
