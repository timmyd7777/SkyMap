#!/usr/bin/env python3
"""Generate satmag.js from McCants satellite magnitude data.

Auto-downloads mcnames.txt from SSCore GitHub if not present.
Output: satmag.js with NORAD ID -> standard magnitude lookup table.
Standard magnitude is visual magnitude at 1000 km range, half-phase (90° phase angle).
"""

import os, sys, urllib.request

MCNAMES_URL = "https://raw.githubusercontent.com/timmyd7777/SSCore/master/SSData/SolarSystem/Satellites/mcnames.txt"
MCNAMES_FILE = "mcnames.txt"

if not os.path.exists(MCNAMES_FILE):
    print(f"Downloading {MCNAMES_FILE}...")
    urllib.request.urlretrieve(MCNAMES_URL, MCNAMES_FILE)

entries = []
with open(MCNAMES_FILE) as f:
    for line in f:
        if len(line) < 30:
            continue
        try:
            norad = int(line[0:5])
            fields = line[22:].split()
            if len(fields) < 4:
                continue
            stdmag = float(fields[3])
            entries.append((norad, stdmag))
        except (ValueError, IndexError):
            continue

entries.sort(key=lambda e: e[0])

out = "satmag.js"
with open(out, "w") as f:
    f.write("// McCants satellite standard magnitudes (at 1000 km range, half-phase).\n")
    f.write(f"// Generated from mcnames.txt — {len(entries)} satellites.\n")
    f.write("const SATMAG = {\n")
    for i, (norad, mag) in enumerate(entries):
        comma = "," if i < len(entries) - 1 else ""
        f.write(f"  {norad}:{mag}{comma}\n")
    f.write("};\n")

print(f"Wrote {out}: {len(entries)} satellites")
