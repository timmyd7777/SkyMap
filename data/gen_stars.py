#!/usr/bin/env python3
"""Generate stars.js from a star catalog CSV.

Usage: gen_stars.py <input.csv> <mag_limit>
Example: gen_stars.py SKY2000.csv 8.0
"""
import math, os, sys, re, urllib.request

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
CATALOG_PREFIX = ('HR ','HD ','SAO ','BD ','CD ','HIP ','TYC ','GAIA ','WDS ','GJ ',
                  'GC ','NGC ','IC ','PK ','PNG ','PGC ','UGC ','LBN ',
                  'CST:','LTT ','GCVS ','NSV ','CP ')

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

def parse_star_line(line):
    line = line.strip()
    if not line:
        return None
    parts = line.rstrip(',').split(',')
    if len(parts) < 8:
        return None

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

    hr_matches = re.findall(r'\bHR (\d+)\b', line)
    hrs = [int(x) for x in hr_matches]
    hr = hrs[0] if hrs else 0
    hd_match = re.search(r'\bHD (\d+)\b', line)
    hd = int(hd_match.group(1)) if hd_match else 0
    hip_match = re.search(r'\bHIP (\d+)\b', line)
    hip = int(hip_match.group(1)) if hip_match else 0
    dm_match = re.search(r'\b(BD|CD|CP) [+-]\d+ \d+', line)
    dm = dm_match.group(0) if dm_match else ''

    dist_str = parts[7].strip()
    try:
        dist = float(dist_str) if dist_str else None
    except ValueError:
        dist = None

    bayer = ''
    flamsteed = ''
    name = ''
    for f in parts:
        f = f.strip()
        cd = con_designation(f)
        if cd:
            if re.match(r'^\d+$', cd[0]):
                if not flamsteed:
                    flamsteed = f
            else:
                if not bayer:
                    bayer = f
    # The common name is the last non-catalog, non-Bayer, non-Flamsteed field
    for f in reversed(parts):
        f = f.strip()
        if not f:
            continue
        if any(f.startswith(p) for p in CATALOG_PREFIX):
            break
        if not con_designation(f):
            name = f
            break

    # Filter out object type codes and other non-name fields
    skip_names = {'A','B','AB','BC','AC','ABC','RS','EB','DCEP','BCEP','SR','SB',
                  'CST','UV','BY','EW','DS','SS','VS','DV','SB1','SB2'}
    if name in skip_names or re.match(r'^[A-Z][0-9]', name):
        name = ''

    base = {
        'hd': hd, 'hip': hip,
        'ra': ra, 'dec': dec, 'mag': mag, 'bmv': bmv, 'dist': dist,
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
with open(INPUT_FILE) as f:
    for line in f:
        results = parse_star_line(line)
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
print(f"Total stars: {len(stars)} (mag <= {MAG_LIMIT})", file=sys.stderr)
print(f"With HR: {with_hr}, HD: {with_hd}, HIP: {with_hip}, names: {named}, Bayer: {bayered}, Flamsteed: {flamsteeded}, distance: {with_dist}", file=sys.stderr)

def js_str(s):
    if not s:
        return "''"
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"

with open('stars.js', 'w', encoding='utf-8') as out:
    out.write(f'// {len(stars)} stars from {INPUT_FILE} (mag <= {MAG_LIMIT})\n')
    out.write('// Star: [RA_rad, Dec_rad, mag, bmv, dist_pc, HR, HD, HIP, bayer, flamsteed, name, dm]\n')
    out.write('var STARS = [\n')
    for s in stars:
        dist = 'null' if s['dist'] is None else f"{s['dist']:.1f}"
        out.write(f"[{s['ra']:.5f},{s['dec']:.5f},{s['mag']:.2f},{s['bmv']:.2f},{dist},"
                  f"{s['hr']},{s['hd']},{s['hip']},{js_str(s['bayer'])},{js_str(s['flamsteed'])},{js_str(s['name'])},{js_str(s['dm'])}],\n")
    out.write('];\n')

print("Wrote stars.js", file=sys.stderr)
