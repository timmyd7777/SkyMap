#!/usr/bin/env python3
"""Parse MilkyWayData.cpp and generate mwdata.js with closed boundary polygons.

Each Voyager II milky way region has:
  - A header: {boundary_count, offset_to_next}
  - boundary_count pairs of {RA, Dec} (the edge points)
  - A fill header: {-fill_count, 0}
  - fill_count pairs of {RA, Dec} (closing points)
The boundary + fill points together form a closed polygon.
"""
import re, math, sys

def extract_array(text, array_name):
    pattern = rf'{re.escape(array_name)}\s*\[[^\]]*\]\s*=\s*\{{(.*?)\}}\s*;'
    m = re.search(pattern, text, re.DOTALL)
    if not m:
        print(f"ERROR: Could not find array {array_name}", file=sys.stderr)
        return []
    body = m.group(1)
    pairs = re.findall(r'\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\}', body)
    return [(int(a), int(b)) for a, b in pairs]

def to_radians(ra_x1000, dec_x1000):
    return (ra_x1000 / 1000.0 * math.pi / 180.0,
            dec_x1000 / 1000.0 * math.pi / 180.0)

def parse_regions(data, expected_count, label):
    regions = []
    i = 0
    while i < len(data):
        boundary_count, offset = data[i]
        if boundary_count <= 0 or offset <= 0:
            break

        boundary = []
        for j in range(1, boundary_count + 1):
            if i + j >= len(data):
                break
            boundary.append(to_radians(*data[i + j]))

        fill = []
        fill_idx = i + boundary_count + 1
        if fill_idx < len(data) and data[fill_idx][0] < 0:
            nfill = -data[fill_idx][0]
            for k in range(1, nfill + 1):
                if fill_idx + k < len(data):
                    fill.append(to_radians(*data[fill_idx + k]))

        # boundary + fill form a closed polygon
        regions.append(boundary + fill)

        next_i = i + offset
        if next_i <= i:
            break
        i = next_i
        if len(regions) >= expected_count:
            break
    print(f"  {label}: extracted {len(regions)} regions (expected {expected_count})", file=sys.stderr)
    return regions

with open('MilkyWayData.cpp') as f:
    text = f.read()

inner_data = extract_array(text, 'InnerMilkyData')
outer_data = extract_array(text, 'OuterMilkyData')
print(f"InnerMilkyData: {len(inner_data)} entries", file=sys.stderr)
print(f"OuterMilkyData: {len(outer_data)} entries", file=sys.stderr)

inner_regions = parse_regions(inner_data, 85, "Inner")

COALSACK = len(inner_regions) - 1

with open('milkyway.js', 'w') as out:
    out.write(f'const COALSACK_INDEX = {COALSACK};\n')
    out.write('const MILKYWAY = [\n')
    for poly in inner_regions:
        pts = ','.join(f'[{ra:.4f},{dec:.4f}]' for ra, dec in poly)
        out.write(f'  [{pts}],\n')
    out.write('];\n')

print(f"Wrote milkyway.js ({len(inner_regions)} polygons, COALSACK_INDEX={COALSACK})", file=sys.stderr)
