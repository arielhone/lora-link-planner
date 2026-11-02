# Engineering decisions

This file records the choices made while building the planner, and why.
When something was ambiguous, the reasoning is written down here.

## 1. Frequency band and power for Israel

**Decision:** default to **917.3 MHz**, **14 dBm EIRP** (25 mW), band **917–920 MHz**.
All three are configurable in the settings panel; the app shows a warning (it
does not block you) when the frequency is outside 917–920 MHz or when
`TX power + antenna gain − cable loss` is above 14 dBm.

**Sources**

- Israel's Ministry of Communications signed an order opening **917–920 MHz**
  for licence-exempt LoRa/LoRaWAN devices (announced by the LoRa Alliance,
  see [everythingrf: "The LoRaWAN Standard is Now Open for Business in Israel"](https://www.everythingrf.com/news/details/12335-the-lorawan-standard-is-now-open-for-business-in-israel)).
- The LoRa Alliance then defined the **AS923-4** channel plan for Israel in the
  *LoRaWAN Regional Parameters* (RP002-1.0.3 and later): the AS923 plan shifted
  by −5.9 MHz, so the two default channels are **917.3 and 917.5 MHz**, with a
  **maximum EIRP of 14 dBm**. TTN lists the same plan
  ([TTN device repository, AS923-4](https://www.thethingsnetwork.org/device-repository/tags/as923-4/),
  [Digital Matter on AS923-4 for Israel](https://sense.digitalmatter.com/about-us-blog/support-for-lorawan-as923-4-israel)).
- Older Israeli rules allowed 915–917 MHz for short-range devices; that band
  is *not* the LoRaWAN plan, so it is not the default.

**Caveat:** I could not retrieve the Hebrew text of the regulation itself from
this environment, so the 14 dBm limit is taken from the LoRa Alliance Regional
Parameters (which are written to match national rules). Check the current
regulation before you transmit. The 14 dBm figure is an EIRP limit, so a
3 dBi antenna means the radio itself should be set to 11 dBm.

## 2. Receiver sensitivity model

The Semtech datasheets give sensitivity in two styles:

- **SX1276**: a measured table (datasheet Table 10, 862–1020 MHz band). Used
  verbatim when "SX1276" is selected.
- **SX1262**: the datasheet quotes a handful of points that agree with the
  standard formula `S = −174 + 10·log10(BW) + NF + SNR_required` with
  **NF = 6 dB** to about 1 dB (e.g. SF12/125 kHz → −137 dBm). The planner uses
  the formula for SX1262, which is the **default** because the reference
  firmware board (Heltec WiFi LoRa 32 V3) uses an SX1262.

Required SNR per SF: −7.5, −10, −12.5, −15, −17.5, −20 dB for SF7…SF12
(same in both datasheets).

## 3. Propagation model

- **Free-space loss** (ITU-R P.525) + **terrain diffraction** only. No clutter
  loss, no ground reflection (two-ray), no rain (negligible at 900 MHz), no
  multipath fading. This is the classic "line of sight + knife edge"
  planning model; it is optimistic in cities and forests. The 10 dB margin
  for a "works" verdict is the reserve for everything not modelled.
- **Earth curvature**: effective earth radius with **k = 4/3** (standard
  atmosphere). The bulge `d1·d2/(2kR)` is added to every terrain sample, so
  the line of sight can then be drawn as a straight line.
- **Diffraction**: **Deygout** (main edge + up to two secondary edges, the
  classic 3-edge form from ITU-R P.526 up to edition 12) by default. A
  "single knife edge" option (main edge only) is available. ITU-R P.526-15
  now recommends the Bullington + spherical-earth method; Deygout was chosen
  because it is easy to explain edge by edge, which fits the teaching goal.
  Deygout tends to over-estimate loss for many closely spaced edges, which is
  why recursion is limited to depth 2.
- **Verdict thresholds**: margin ≥ 10 dB → *works*, 0–10 dB → *marginal*,
  < 0 → *fails*. 10 dB is a common fade margin rule of thumb for fixed
  sub-GHz links.

## 4. Elevation data

**Decision:** Copernicus **GLO-30** DEM from the AWS Open Data bucket
(`copernicus-dem-30m`, no account required), preprocessed by
`scripts/build_dem.py` into **2 arc-second (~60 m) tiles**, stored in the
repository under `public/dem/` (**~13 MB**, 114 files).

Why Copernicus rather than SRTM: it is newer (2011–2015 TanDEM-X), more
accurate, has no voids, and is freely downloadable over plain HTTPS.

It is a **surface model (DSM)**: it includes buildings and forest canopy to
some degree. For radio planning that is mostly a feature (a building blocks
radio too), but it means "ground" in the chart may be a rooftop.

**Size tradeoff**

| Grid | Spacing | Size in repo (gzip + delta) |
| ---- | ------- | --------------------------- |
| 1″   | ~30 m   | ~45–50 MB                   |
| 2″   | ~60 m   | **~13 MB** (chosen)         |
| 3″   | ~90 m   | ~7 MB                       |

1″ would roughly quadruple the repo size and the per-path download, for a
small gain: at 900 MHz the first Fresnel zone over a 5 km link is ~20 m
wide, and the hills that actually decide a link in Israel (ridges,
wadis, the Carmel, the Galilee) are wider than 60 m. 2″ keeps the whole
dataset well under GitHub's recommended sizes and a typical path loads
2–4 tiles (~150 kB each). The script takes `--arcsec 1` if you want full
resolution.

Downsampling uses a binomial low-pass filter centred on each kept sample
(no half-pixel shift), then decimation. Note that smoothing lowers sharp
peaks slightly (a few metres on narrow summits).

**Format**: each 0.25° tile is 450×450 little-endian int16 metres, delta
encoded along rows, gzipped (`.i16.gz`). The browser fetches only the tiles a
path crosses and inflates them with the built-in `DecompressionStream`
(no library). Tiles that are entirely sea are omitted and read as 0 m.
A gzip "magic bytes" check makes it work whether or not the web server adds
`Content-Encoding: gzip`.

**Bounding box**: 29.25–33.5 °N, 34.0–36.0 °E (Eilat to Mt Hermon, Gaza coast
to the Golan, plus margins in neighbouring countries).

**Sampling**: the profile is sampled every 30 m (configurable) with bilinear
interpolation, so the 60 m grid is interpolated smoothly. Points are spaced
along the great circle.

## 5. Tooling

- **Vite** for bundling (Leaflet from npm, multi-page: planner + field mode).
  Base path is relative (`./`) so the same build works on GitHub Pages under
  `/lora-link-planner/` and locally.
- **Tests** use Node's built-in `node:test` runner: no test framework
  dependency, and the physics modules are plain ES modules that run in Node
  unchanged.
- **Charts** are hand-written SVG (terrain profile, prediction-error chart)
  rather than a chart library: the Fresnel ellipse and the obstruction markers
  are easier to draw directly, and it keeps the bundle small.

## 6. Field mode and the CSV format

- Records live in `localStorage` only (key `lora-link-planner.field-tests.v1`);
  there is no server. Export to CSV to back them up.
- One CSV format is shared by the web app and the firmware
  (`src/field/csv.js`, columns listed in `CSV_COLUMNS`). Lines starting with
  `#` are comments; unknown columns are ignored, so exported files (which add
  `distance_m` and `predicted_*` columns) can be re-imported.
- The reference board has no GPS, so firmware rows leave the coordinate
  columns empty and put the receiver's **uptime in seconds** in `timestamp`.
  On import, empty coordinates are filled from the A/B points currently in
  the field-mode form. Each firmware row summarises a window of packets
  (average RSSI/SNR, received and lost counts).
- The prediction for a field test uses the same model as the planner with
  the default chip (SX1262) and Deygout diffraction. "Error" is
  `measured − predicted`, so positive means the link was better than predicted.
- Measured SNR on SX126x/SX127x saturates around +10…+13 dB for strong
  signals, so SNR errors are only meaningful for weak links.

## 7. Environment (clutter) loss

**Decision:** one extra loss term, applied once per link, with presets
**open = 0 dB, suburban = 10 dB, urban = 20 dB**, plus **custom** (any value,
e.g. from Field-mode calibration). Code: `src/physics/clutter.js`.

**Why these numbers**

- **ITU-R P.2108-1 §3.2** (statistical clutter loss for terrestrial paths,
  one end inside urban/suburban clutter) gives a **median of ≈ 23 dB at
  917 MHz** for paths longer than about 1 km:
  `L = −5·log10(10^(−0.2·Ll) + 10^(−0.2·Ls))`, with
  `Ll = 23.5 + 9.6·log10(f)` and `Ls = 32.98 + 23.9·log10(d) + 3·log10(f)`.
  It's implemented as `p2108TerrestrialClutterLoss()` and unit-tested.
- The **Okumura–Hata** model's suburban correction at 900 MHz,
  `2·[log10(f/28)]² + 5.4 ≈ 10 dB`, says suburban areas are about 10 dB
  better than urban ones.
- Our terrain model uses a *surface* model (DSM) that already captures large
  buildings and dense forest in part, so the full P.2108 value would
  double-count some of that. The urban preset is therefore set slightly below
  P.2108 (20 dB), and suburban 10 dB below urban.
- "Open" is 0 dB: free space + terrain is the right model for hilltops,
  fields and desert.

These are rough planning values. Real loss depends strongly on where the
device sits: a device inside a building or in a pocket can lose much more.
That's why Field mode can fit the value from your own measurements.

**Calibration (Field mode):** each prediction also stores the RSSI predicted
*without* environment loss (`predicted_rssi_open_dbm`). The least-squares
best single extra loss is simply the average shortfall
`L = mean(predicted_open − measured)`, clamped at 0 (`bestFitExtraLoss()` in
`src/field/records.js`). The environment setting in Field mode is page-wide
(saved in localStorage), not stored per test, so one calibration fits all
logged tests. The result can be applied to Field mode, or opened in the
planner as `#env=custom&cl=<dB>`.

## 8. Coverage map

- **Grid:** regular in latitude/longitude, centred on the transmitter, square
  cells in metres, only cells within the radius are computed (a disc). Cell
  size is chosen so there are at most ~81 cells across ("normal") or ~161
  ("fine"). That's ~5,000 or ~20,000 full link calculations. Radii: 5, 10,
  15, 20, 30 km. Code: `src/coverage/grid.js`.
- **Per cell:** the same `analyzeLink()` as the A–B view (FSPL + Deygout +
  environment), with terrain sampled every **60 m** (the DEM spacing) instead
  of 30 m, and without the what-if extras. In Node a 5,000-cell map takes about
  1 s, so the browser stays well within a few seconds.
- **Web Worker:** `src/coverage/worker.js` loads the elevation tiles itself
  and posts progress every 50 cells. Cancelling is cooperative (the worker
  yields between batches).
- **Drawing:** one pixel per cell on a canvas, shown as a Leaflet
  `imageOverlay` with `image-rendering: pixelated`. That's much faster than
  thousands of rectangles. The lat/lon grid is drawn on the Web-Mercator map
  as an image; over ±30 km the resulting distortion is below 0.5%, far less
  than a cell.
- **Colours:** discrete green / yellow / red, with the same thresholds as the
  verdict (≥ 10, 0–10, < 0 dB), semi-transparent.
- Clicking a computed cell switches to the A–B view with A = transmitter and
  B = the cell centre (receiver height from the coverage panel).

## 9. Relay planner

- **Search area:** an ellipse with foci A and B, where `|AR| + |RB| ≤
  max(1.5·D, D + 6 km)`. A relay far off to the side only makes both hops
  longer.
- **High ground first:** the ellipse is sampled on a ~70 × 70 grid, the
  points are sorted by elevation, and the ~150 highest are kept, at least 2.5
  cells apart so they are not all on one summit.
- **Score:** the full link analysis for both hops, then the **weaker hop's
  margin** (a chain is as strong as its weakest link). Ties go to higher
  ground. The top 3 sites at least `max(1 km, D/8)` apart are shown.
- The relay uses the same radio settings as A and B, with its own antenna
  height (default 5 m). Code: `src/relay/relay.js`; it runs in the same Web
  Worker as the coverage map.
- The relay panel appears when the direct link is marginal or fails.
  Inspecting a hop temporarily replaces A/B in the view (the URL keeps the
  original pair), and "Back to A–B" restores it.

## 10. Languages (Hebrew / English)

- All strings live in **one file**, `src/i18n/strings.js`, with a tiny
  helper (`src/i18n/index.js`) and no library. HTML elements carry
  `data-i18n` / `data-i18n-html` / `data-i18n-attr` keys; dynamic content
  calls `t(key, params)`.
- **Default** = saved choice, else the browser language (`he`/`iw` → Hebrew),
  else English. The choice is saved in localStorage.
- **RTL:** Hebrew sets `<html dir="rtl">`. The CSS grid mirrors the layout
  (side panel moves left). The map, the charts and numeric inputs stay
  left-to-right, and values with units use `unicode-bidi: plaintext` so
  "7.49 km" isn't reordered.
- A unit test checks that every key exists in both languages with the same
  placeholders.
- Example names are translated. Technical abbreviations (SF, dBm, EIRP, RSSI)
  stay in Latin script, as is usual in Hebrew technical writing.

## 11. Branches

The default branch is `main`. When this work started, the remote had only
the original feature branch, so `main` was created from its tip and work
continued there.
