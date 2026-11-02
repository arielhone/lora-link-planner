# Rebuilding the elevation data

The planner ships with preprocessed elevation tiles in `public/dem/`
(Copernicus GLO-30, resampled to 2 arc-seconds ≈ 60 m, ~13 MB).
You only need this if you want to change the resolution or the area.

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r scripts/requirements.txt
python scripts/build_dem.py            # downloads ~320 MB once into .dem-cache/
```

Options:

| flag | default | meaning |
| ---- | ------- | ------- |
| `--arcsec N` | `2` | output grid spacing (1 = full 30 m, ~4× bigger) |
| `--tile-deg X` | `0.25` | tile size in degrees |
| `--cache DIR` | `.dem-cache` | where downloaded source tiles are kept |
| `--out DIR` | `public/dem` | output directory (manifest + tiles) |

The bounding box is set by `NORTH/SOUTH/WEST/EAST` at the top of
`build_dem.py`. The source tiles come from the public AWS bucket
`s3://copernicus-dem-30m` over plain HTTPS; no account is needed.

The file format is documented at the top of `build_dem.py`, and the reader is
`src/elevation/dem.js`.
