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
