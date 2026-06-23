#!/usr/bin/env python3
"""Generate cities.js from Cities.csv (from SSCore/SSData/SolarSystem)."""

import csv
import os
import sys
import urllib.request

CITIES_URL = 'https://raw.githubusercontent.com/timmyd7777/SSCore/master/SSData/SolarSystem/Cities.csv'
INFILE = 'Cities.csv'

if not os.path.exists(INFILE):
    print(f"Downloading {CITIES_URL} -> {INFILE}", file=sys.stderr)
    urllib.request.urlretrieve(CITIES_URL, INFILE)

cities = []
with open(INFILE, encoding='utf-8') as f:
    reader = csv.reader(f)
    for row in reader:
        if len(row) < 11 or row[0] != 'CT':
            continue
        name = row[1].strip()
        lat = round(float(row[3]), 4)
        lon = round(float(row[4]), 4)
        cc = row[5].strip()
        tz = row[9].strip()
        admin1 = row[10].strip()
        cities.append((name, admin1, cc, lat, lon, tz))

cities.sort(key=lambda c: (c[2], c[0]))

print(f'{len(cities)} cities', file=sys.stderr)

no_admin = sum(1 for c in cities if not c[1])
if no_admin:
    print(f'  {no_admin} cities with no admin1 name', file=sys.stderr)

with open('cities.js', 'w', encoding='utf-8') as out:
    out.write('// Cities: [name, admin1, countryCode, lat, lon, timezone]\n')
    out.write(f'// {len(cities)} cities from SSCore Cities.csv\n')
    out.write('const CITIES = [\n')
    for name, admin1, cc, lat, lon, tz in cities:
        js_name = name.replace('\\', '\\\\').replace("'", "\\'")
        js_admin = admin1.replace('\\', '\\\\').replace("'", "\\'")
        out.write(f"['{js_name}','{js_admin}','{cc}',{lat},{lon},'{tz}'],\n")
    out.write('];\n')
