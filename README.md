# SkyMap

An interactive sky map that runs in the browser. Shows stars, constellations (stick figures, boundaries, labels), deep sky objects, planets, and the Milky Way. Supports stereographic and other projections, dark/light themes, and location-aware horizon display.

## Usage

Open `skymap.html` in a browser. No build step or server required.

## Data generation

The JavaScript data files (`stars.js`, `constellations.js`, `deepsky.js`, `cities.js`, `milkyway.js`) are pre-generated and checked in. The Python scripts in `data/` regenerate them from source catalogs:

```
cd data
python3 gen_stars.py brightest.csv 6.0    # -> stars.js
python3 gen_stars.py SKY2000.csv 8.0      # -> stars.js (extended catalog)
python3 gen_constellations.py             # -> constellations.js
python3 gen_deepsky.py                    # -> deepsky.js
python3 gen_cities.py                     # -> cities.js
python3 gen_milkyway.py                   # -> milkyway.js
```

Most scripts auto-download their source CSV files from [SSCore](https://github.com/timmyd7777/SSCore) if not already present. `SKY2000.csv` is included in the repo.

Move the generated `.js` files into the project root to update the app.

## License

[Unlicense](LICENSE) — public domain.
