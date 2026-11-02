#!/usr/bin/env python3
"""
build_dem.py - turn the Copernicus GLO-30 DEM into small elevation tiles
that the LoRa Link Planner can load in the browser.

What it does
------------
1. Downloads the 1x1 degree Copernicus GLO-30 tiles that cover Israel
   from the AWS Open Data bucket (no account needed):
       https://copernicus-dem-30m.s3.amazonaws.com/
2. Stitches them into one mosaic covering the bounding box below.
3. Low-pass filters (3x3 binomial kernel) and decimates the 1 arc-second
   (~30 m) grid to a coarser grid (default 2 arc-seconds, ~60 m) so the
   repository stays small. See DECISIONS.md for the tradeoff.
4. Cuts the result into square tiles (default 0.25 deg) and writes each one
   as gzip-compressed, row-delta-encoded little-endian int16 metres.
5. Writes manifest.json describing the grid so the browser can find samples.

Tile file format (".i16.gz")
----------------------------
    gzip( int16le[rows * cols] )   rows = cols = tileSize
Values are stored *delta encoded along each row*: v[r][0] is stored as is,
and v[r][c] is stored as v[r][c] - v[r][c-1] (int16 wrap-around arithmetic).
Deltas between neighbouring terrain samples are small numbers, which makes
gzip compress them ~2x better than raw heights.

Grid geometry (point-registered, like the source data)
------------------------------------------------------
    global sample (R, C) is located at
        lat = north - R * step
        lon = west  + C * step
Tile (tr, tc) holds global rows tr*T .. tr*T+T-1 and cols tc*T .. tc*T+T-1.
Tiles that are entirely sea level (0 m) are not written; the browser treats
missing tiles as 0 m.

Usage
-----
    pip install numpy tifffile imagecodecs
    python scripts/build_dem.py                 # default: 2" grid, writes public/dem
    python scripts/build_dem.py --arcsec 1      # full 30 m resolution (~4x bigger)
    python scripts/build_dem.py --cache ~/dem-cache --out public/dem

Licence of the data
-------------------
Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space
GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA;
all rights reserved. Free to use with attribution (see the Copernicus DEM
licence). The attribution is shown in the app footer.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

try:
    import tifffile
except ImportError:  # pragma: no cover
    sys.exit("Missing dependency: pip install numpy tifffile imagecodecs")

BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"

# Bounding box (degrees). Covers Israel from Eilat (29.5N) to Mount Hermon
# (33.42N) and from the Gaza coast (34.2E) to the Golan Heights (35.9E),
# with a little margin. Neighbouring areas inside the box come along for free.
NORTH, SOUTH = 33.5, 29.25
WEST, EAST = 34.0, 36.0

SRC_PER_DEG = 3600  # Copernicus GLO-30 is 1 arc-second


def tile_name(lat: int, lon: int) -> str:
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"Copernicus_DSM_COG_10_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"


def download(lat: int, lon: int, cache: Path) -> Path | None:
    """Download one source tile (if not cached). Returns None for sea tiles
    that do not exist in the bucket (HTTP 404)."""
    name = tile_name(lat, lon)
    path = cache / f"{name}.tif"
    if path.exists() and path.stat().st_size > 0:
        return path
    url = f"{BUCKET}/{name}/{name}.tif"
    print(f"  downloading {url}")
    try:
        with urllib.request.urlopen(url, timeout=120) as r, open(path.with_suffix(".part"), "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            print(f"  (no tile for {name}: all sea)")
            return None
        raise
    path.with_suffix(".part").rename(path)
    return path


def build_mosaic(cache: Path) -> np.ndarray:
    """Return a float32 mosaic, point registered, one sample per arc-second:
    mosaic[i, j] is located at lat = NORTH - i/3600, lon = WEST + j/3600."""
    rows = round((NORTH - SOUTH) * SRC_PER_DEG)
    cols = round((EAST - WEST) * SRC_PER_DEG)
    mosaic = np.zeros((rows, cols), dtype=np.float32)
    for lat in range(math.floor(SOUTH), math.ceil(NORTH)):
        for lon in range(math.floor(WEST), math.ceil(EAST)):
            p = download(lat, lon, cache)
            if p is None:
                continue
            with tifffile.TiffFile(p) as tif:
                page = tif.pages[0]
                tie = page.tags["ModelTiepointTag"].value  # (i, j, k, lon, lat, z)
                scale = page.tags["ModelPixelScaleTag"].value
                data = page.asarray().astype(np.float32)
            # Copernicus tiles are PixelIsPoint: pixel (r, c) centre at
            # (tie_lat - r*sy, tie_lon + c*sx).
            t_lon, t_lat = tie[3], tie[4]
            if abs(scale[0] - 1 / 3600) > 1e-9 or abs(scale[1] - 1 / 3600) > 1e-9:
                # Above 50 deg latitude tiles get narrower; not relevant for Israel.
                raise RuntimeError(f"unexpected pixel size in {p}: {scale}")
            r0 = round((NORTH - t_lat) * SRC_PER_DEG)
            c0 = round((t_lon - WEST) * SRC_PER_DEG)
            h, w = data.shape
            rs, cs = max(r0, 0), max(c0, 0)
            re, ce = min(r0 + h, rows), min(c0 + w, cols)
            if rs >= re or cs >= ce:
                continue
            mosaic[rs:re, cs:ce] = data[rs - r0 : re - r0, cs - c0 : ce - c0]
            print(f"  placed {p.name}")
    return mosaic


def smooth_and_decimate(mosaic: np.ndarray, factor: int) -> np.ndarray:
    """Anti-alias with a separable binomial kernel, then keep every
    `factor`-th sample. The kernel is centred on each kept sample, so the
    output stays point-registered at exactly the same coordinates
    (output[R, C] is at lat = NORTH - R*step, lon = WEST + C*step)."""
    if factor == 1:
        return mosaic
    k = np.array([1.0])
    for _ in range(2 * factor - 2):  # width 2*factor-1, e.g. [1, 2, 1]/4 for factor 2
        k = np.convolve(k, [1.0, 1.0])
    k = (k / k.sum()).astype(np.float32)
    half = factor - 1
    p = np.pad(mosaic, half, mode="edge")
    h, w = mosaic.shape
    tmp = np.zeros((p.shape[0], w), dtype=np.float32)
    for i, wt in enumerate(k):
        tmp += wt * p[:, i : i + w]
    del p
    out = np.zeros((h, w), dtype=np.float32)
    for i, wt in enumerate(k):
        out += wt * tmp[i : i + h, :]
    return out[::factor, ::factor]


def encode_tile(tile: np.ndarray) -> bytes:
    t = np.round(tile).astype(np.int16)
    d = np.empty_like(t)
    d[:, 0] = t[:, 0]
    d[:, 1:] = (t[:, 1:].astype(np.int32) - t[:, :-1].astype(np.int32)).astype(np.int16)
    return gzip.compress(d.astype("<i2").tobytes(), compresslevel=9, mtime=0)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--arcsec", type=int, default=2, choices=[1, 2, 3, 4], help="output grid spacing in arc-seconds")
    ap.add_argument("--tile-deg", type=float, default=0.25, help="tile size in degrees")
    ap.add_argument("--cache", type=Path, default=Path(".dem-cache"), help="where to keep downloaded source tiles")
    ap.add_argument("--out", type=Path, default=Path("public/dem"), help="output directory")
    args = ap.parse_args()

    args.cache.mkdir(parents=True, exist_ok=True)
    print("1/3 building 1-arc-second mosaic")
    mosaic = build_mosaic(args.cache)

    print(f"2/3 smoothing and decimating to {args.arcsec} arc-seconds")
    grid = smooth_and_decimate(mosaic, args.arcsec)
    step = args.arcsec / 3600
    T = round(args.tile_deg / step)
    n_rows = round((NORTH - SOUTH) / step)
    n_cols = round((EAST - WEST) / step)
    grid = grid[:n_rows, :n_cols]
    assert grid.shape == (n_rows, n_cols), grid.shape

    print(f"3/3 writing tiles of {T}x{T} samples to {args.out}")
    args.out.mkdir(parents=True, exist_ok=True)
    for old in args.out.glob("*.i16.gz"):
        old.unlink()
    tiles = []
    total = 0
    for tr in range(math.ceil(n_rows / T)):
        for tc in range(math.ceil(n_cols / T)):
            tile = np.zeros((T, T), dtype=np.float32)
            part = grid[tr * T : (tr + 1) * T, tc * T : (tc + 1) * T]
            tile[: part.shape[0], : part.shape[1]] = part
            if np.all(np.abs(tile) < 0.5):
                continue  # open sea - skip
            blob = encode_tile(tile)
            (args.out / f"{tr}_{tc}.i16.gz").write_bytes(blob)
            tiles.append(f"{tr}_{tc}")
            total += len(blob)
    manifest = {
        "format": "i16-rowdelta-gzip",
        "source": "Copernicus DEM GLO-30 (DSM), AWS Open Data copernicus-dem-30m",
        "attribution": "Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA",
        "north": NORTH,
        "west": WEST,
        "south": SOUTH,
        "east": EAST,
        "arcsec": args.arcsec,
        "step": step,
        "tileSize": T,
        "rows": n_rows,
        "cols": n_cols,
        "tiles": tiles,
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"done: {len(tiles)} tiles, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
