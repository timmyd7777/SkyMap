#!/usr/bin/env python3
"""Generate stars.js from a star catalog CSV.

Usage: gen_stars.py <input.csv> <mag_limit>
Example: gen_stars.py SKY2000.csv 8.0
"""
import csv, math, os, sys, re, urllib.request

DOWNLOAD_FILES = {
    'brightest.csv': 'https://raw.githubusercontent.com/timmyd7777/SSCore/master/SSData/Stars/Brightest.csv',
    'sky2000.csv': 'https://raw.githubusercontent.com/timmyd7777/SSCore/master/SSData/Stars/SKY2000.csv',
}

if len(sys.argv) != 3:
    print(f"Usage: {sys.argv[0]} <input.csv> <mag_limit>", file=sys.stderr)
    sys.exit(1)

INPUT_FILE = sys.argv[1]
MAG_LIMIT = float(sys.argv[2])

if not os.path.exists(INPUT_FILE) and INPUT_FILE.lower() in DOWNLOAD_FILES:
    url = DOWNLOAD_FILES[INPUT_FILE.lower()]
    print(f"Downloading {url} -> {INPUT_FILE}", file=sys.stderr)
    urllib.request.urlretrieve(url, INPUT_FILE)

IAU_CON = {'And','Ant','Aps','Aqr','Aql','Ara','Ari','Aur','Boo','Cae',
    'Cam','Cnc','CVn','CMa','CMi','Cap','Car','Cas','Cen','Cep','Cet','Cha',
    'Cir','Col','Com','CrA','CrB','Crv','Crt','Cru','Cyg','Del','Dor','Dra',
    'Equ','Eri','For','Gem','Gru','Her','Hor','Hya','Hyi','Ind','Lac','Leo',
    'LMi','Lep','Lib','Lup','Lyn','Lyr','Men','Mic','Mon','Mus','Nor','Oct',
    'Oph','Ori','Pav','Peg','Per','Phe','Pic','Psc','PsA','Pup','Pyx','Ret',
    'Sge','Sgr','Sco','Scl','Sct','Ser','Sex','Tau','Tel','Tri','TrA','Tuc',
    'UMa','UMi','Vel','Vir','Vol','Vul'}

GREEK = {'alpha','beta','gamma','delta','epsilon','zeta','eta','theta',
    'iota','kappa','lambda','mu','nu','xi','omicron','pi','rho','sigma',
    'tau','upsilon','phi','chi','psi','omega'}

def con_designation(f):
    """If f is 'prefix Con' where Con is an IAU abbreviation, return (prefix, Con).
    Numeric prefix = Flamsteed, otherwise Bayer/variable."""
    if ' ' not in f:
        return None
    prefix, suffix = f.rsplit(' ', 1)
    if suffix in IAU_CON:
        return (prefix, suffix)
    return None

def parse_ra(s):
    parts = s.strip().split()
    h, m, sec = int(parts[0]), int(parts[1]), float(parts[2])
    return (h + m / 60 + sec / 3600) * math.pi / 12

def parse_dec(s):
    s = s.strip()
    sign = -1 if s.startswith('-') else 1
    parts = s.lstrip('+-').split()
    d, m, sec = int(parts[0]), int(parts[1]), float(parts[2])
    return sign * (d + m / 60 + sec / 3600) * math.pi / 180

def parse_star_line(parts):
    """Parse a CSV row (list of fields) into one or more star entries."""
    if len(parts) < 29:
        return None

    obj_type = parts[0].strip()

    try:
        ra = parse_ra(parts[1])
        dec = parse_dec(parts[2])
        v_str = parts[5].strip()
        b_str = parts[6].strip()
        if v_str:
            mag = float(v_str)
            bmv = round(float(b_str) - mag, 2) if b_str else 0
        elif b_str:
            mag = float(b_str)
            bmv = 0
        else:
            return None
    except (ValueError, IndexError):
        return None

    dist_str = parts[7].strip()
    try:
        dist = float(dist_str) if dist_str else None
    except ValueError:
        dist = None

    spec = parts[9].strip() if len(parts) > 9 else ''

    # Parse structured ID column (index 27): semicolon-delimited catalog IDs
    ids = [x.strip() for x in parts[27].split(';') if x.strip()]

    hrs = []
    hd = 0
    hip = 0
    dm = ''
    bayer = ''
    flamsteed = ''

    for ident in ids:
        m = re.match(r'^HR (\d+)$', ident)
        if m:
            hrs.append(int(m.group(1)))
            continue
        m = re.match(r'^HD (\d+)$', ident)
        if m and not hd:
            hd = int(m.group(1))
            continue
        m = re.match(r'^HIP (\d+)$', ident)
        if m and not hip:
            hip = int(m.group(1))
            continue
        m = re.match(r'^(BD|CD|CP) [+-]\d+ \d+', ident)
        if m and not dm:
            dm = ident
            continue
        cd = con_designation(ident)
        if cd:
            if re.match(r'^\d+$', cd[0]):
                if not flamsteed:
                    flamsteed = ident
            else:
                if not bayer:
                    prefix = re.sub(r'\d+$', '', cd[0])
                    bayer = (cd[0].capitalize() + ' ' + cd[1]) if prefix in GREEK else ident

    # Parse structured Names column (index 28): semicolon-delimited common names
    names = [x.strip() for x in parts[28].split(';') if x.strip()]
    name = names[0] if names else ''

    # Filter out object type codes and other non-name fields
    skip_names = {'A','B','AB','BC','AC','ABC','RS','EB','DCEP','BCEP','SR','SB',
                  'CST','UV','BY','EW','DS','SS','VS','DV','SB1','SB2'}
    if name in skip_names or re.match(r'^[A-Z][0-9]', name):
        name = ''

    base = {
        'type': obj_type, 'hd': hd, 'hip': hip,
        'ra': ra, 'dec': dec, 'mag': mag, 'bmv': bmv, 'dist': dist, 'spec': spec,
        'name': name, 'bayer': bayer, 'flamsteed': flamsteed, 'dm': dm,
    }

    results = []
    if hrs:
        for h in hrs:
            entry = dict(base)
            entry['hr'] = h
            entry['key'] = f'HR{h}'
            results.append(entry)
    else:
        base['hr'] = 0
        base['key'] = f'HD{hd}' if hd else f'HIP{hip}' if hip else f'P{ra:.6f}{dec:.6f}'
        results.append(base)

    return results

# Parse all stars
all_stars = {}
with open(INPUT_FILE, newline='') as f:
    reader = csv.reader(f)
    next(reader)  # Skip header row
    for parts in reader:
        results = parse_star_line(parts)
        if results:
            for result in results:
                k = result['key']
                if k not in all_stars or result['mag'] < all_stars[k]['mag']:
                    all_stars[k] = result

# Filter by magnitude
stars = [s for s in all_stars.values() if s['mag'] <= MAG_LIMIT]

stars.sort(key=lambda s: (s['hr'] == 0, s['hr'], s['ra']))

named = sum(1 for s in stars if s['name'])
bayered = sum(1 for s in stars if s['bayer'])
flamsteeded = sum(1 for s in stars if s['flamsteed'])
with_hr = sum(1 for s in stars if s['hr'])
with_hd = sum(1 for s in stars if s['hd'])
with_hip = sum(1 for s in stars if s['hip'])
with_dist = sum(1 for s in stars if s['dist'] is not None)
with_spec = sum(1 for s in stars if s['spec'])
print(f"Total stars: {len(stars)} (mag <= {MAG_LIMIT})", file=sys.stderr)
print(f"With HR: {with_hr}, HD: {with_hd}, HIP: {with_hip}, names: {named}, Bayer: {bayered}, Flamsteed: {flamsteeded}, distance: {with_dist}, spectrum: {with_spec}", file=sys.stderr)

def js_str(s):
    if not s:
        return "''"
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"

with open('stars.js', 'w', encoding='utf-8') as out:
    out.write(f'// {len(stars)} stars from {INPUT_FILE} (mag <= {MAG_LIMIT})\n')
    out.write('const S_TYPE=0,S_RA=1,S_DEC=2,S_MAG=3,S_BMV=4,S_DIST=5,S_SPEC=6,S_HR=7,S_HD=8,S_HIP=9,S_DM=10,S_BAYER=11,S_FLAM=12,S_NAME=13,S_X=14,S_Y=15,S_Z=16;\n')
    out.write('var STARS = [\n')
    for s in stars:
        dist = 'null' if s['dist'] is None else f"{s['dist']:.1f}"
        out.write(f"[{js_str(s['type'])},{s['ra']:.5f},{s['dec']:.5f},{s['mag']:.2f},{s['bmv']:.2f},{dist},{js_str(s['spec'])},"
                  f"{s['hr']},{s['hd']},{s['hip']},{js_str(s['dm'])},{js_str(s['bayer'])},{js_str(s['flamsteed'])},{js_str(s['name'])}],\n")
    out.write('];\n')

print("Wrote stars.js", file=sys.stderr)
