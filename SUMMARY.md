# Summary

## What was built

| Milestone | Status | Where |
| --------- | ------ | ----- |
| 1. Physics core + tests | ✅ FSPL, Fresnel radius, earth bulge (k = 4/3), knife-edge J(ν) and Deygout (ITU-R P.526), LoRa sensitivity (SX1262 formula / SX1276 table), required SNR, time on air, link budget, Israeli compliance check | `src/physics/`, `test/physics.test.js` |
| 2. Elevation pipeline | ✅ `build_dem.py` downloads Copernicus GLO-30 from AWS Open Data, filters, resamples to 2″ (~60 m), writes 114 gzip+delta tiles (13 MB); JS reader with bilinear interpolation; 30 m great-circle profile sampler | `scripts/`, `public/dem/`, `src/elevation/` |
| 3. Planner app | ✅ Leaflet map, draggable A/B, antenna heights, settings panel, SVG profile (terrain, LOS, Fresnel ellipse, 60% line, red/orange obstruction, labelled diffraction edges, hover read-out), result card with verdict, what-if (SF table + required heights with one-click apply), URL-hash sharing, examples, mobile layout | `index.html`, `src/app/` |
| 4. Field mode | ✅ Log tests, predicted vs measured table, prediction-error scatter chart with bias/RMS stats, CSV import/export, localStorage | `field.html`, `src/field/` |
| 5. Firmware | ✅ compiles in CI (PlatformIO, both environments), ⚠️ not tested on hardware. Sender/receiver for the Heltec WiFi LoRa 32 V3 with RadioLib, OLED status, PRG-button mode switch, CSV over serial in the field-mode format | `firmware/` |
| 6. Learning docs | ✅ 12 (now 15) sections from zero, each linked to the implementing function | `docs/LEARN.md` |
| 7. Polish | ✅ README, MIT licence, CI (tests, build, headless e2e, firmware compile), Pages deployment, DECISIONS.md | `.github/workflows/` |

### Second round

| Feature | Status | Where |
| ------- | ------ | ----- |
| 1. Coverage map | ✅ Grid of receivers around one transmitter (5–30 km, normal/fine resolution, RX height), computed in a Web Worker with progress and cancel, semi-transparent green/yellow/red heat map with legend and summary, hover read-out, click a cell to open its A–B profile; unit tests for the grid and the computation; e2e check | `src/coverage/`, `src/app/jobs.js` |
| 2. Relay planner | ✅ Searches high ground inside an ellipse around A–B, scores by the weaker hop, shows the top 3 sites with both hop margins, one-click hop inspection and back; tests on the real Mt Tabor path; e2e check | `src/relay/` |
| 3. Environment loss | ✅ open / suburban / urban / custom (0 / 10 / 20 dB / any), sources in DECISIONS.md §7 (ITU-R P.2108, implemented and tested, plus Okumura–Hata); Field-mode best-fit calibration with one-click apply and a link that carries the value to the planner | `src/physics/clutter.js`, `src/field/records.js` |
| 4. Hebrew / English | ✅ Whole planner and field mode, RTL layout, browser-language default, saved choice, all strings in one file, parity test for keys and placeholders | `src/i18n/` |
| 5. Docs | ✅ LEARN.md §12–14 (clutter, coverage maps, relays), README features + "how to use", DECISIONS.md §7–11, this summary; LEARN.md code links are now checked by a unit test | `docs/`, `scripts/fix-doc-anchors.mjs` |

**Verification done here:** 65 unit tests pass (`npm test`), and
`npm run build` succeeds. The headless Chromium check
(`scripts/e2e-check.mjs`) passes all 11 steps:
- **Original checks:** Tabor is blocked with red highlighting, Carmel → Akko
  is clear, and clicking the map places A and B.
- **Coverage:** a 10 km map in the worker shows progress, the overlay and the
  legend, and clicking the cell behind Mt Tabor opens a failing profile.
- **Relay:** the Tabor path gets 3 relay sites with both hops ≥ 0 dB, and
  inspect / back work.
- **Hebrew:** the planner and field mode switch to RTL.
- **Calibration:** importing firmware rows that are ~14 dB weaker than
  predicted gives a best fit of 14 dB, applying it brings the predictions
  within 3 dB, and the planner link carries the value.

Real-DEM spot checks (Hermon, Meron, Tabor, Dead Sea, Jerusalem) are in the
unit tests. A 5,000-cell coverage map takes ~1 s in Node.

## What's missing / not verified

- **Firmware compiles in GitHub Actions**: the `firmware` CI job built
  sender and receiver successfully. It could not be compiled inside the
  development sandbox, where the PlatformIO registry was blocked, and it has
  **not been tested on hardware**.
- **CI:** the first-round run on GitHub passed all jobs (unit tests, build,
  headless e2e, firmware). The run for this round was still in progress when
  this file was written; check the Actions tab. The e2e job now also
  exercises the coverage map, relay planner, calibration and Hebrew UI.
- **No GIF** in the README, only static screenshots. The map background in
  the screenshots is blank because OpenStreetMap tiles were blocked in the
  sandbox.
- **GitHub Pages** must be enabled once (Settings → Pages → Source: GitHub
  Actions). It deploys from `main`.
- The Israeli 14 dBm EIRP limit comes from the LoRa Alliance AS923-4 plan;
  the Hebrew regulation text itself could not be retrieved (see DECISIONS.md §1).
- The Hebrew translation was written without a native-speaker review.

## Known limitations

- **Model scope:** free space + terrain diffraction + one average clutter
  term. No ground reflection or multipath, no interference, no
  location-specific clutter (a single building next to the antenna).
- **Deygout over-estimates** loss on broad, rounded hills, where secondary
  edges on the same hill add tens of dB (e.g. 82 dB across Mt Tabor, where a
  single knife edge gives ~41 dB). The verdict is the same in such cases, but
  marginal paths over rounded terrain, and therefore coverage-map edges, may be
  pessimistic. "Single knife edge" is available as an alternative.
- **60 m DEM resolution** smooths narrow peaks by a few metres and can miss
  thin ridges or single buildings.
- **Coverage map:** cells are at least 100 m and each is a single point at the
  cell centre, so small shadows between centres can be missed. Paths are
  sampled every 60 m instead of 30 m.
- **Relay search** considers ~150 high points on a ~70 × 70 grid. It finds good
  sites, but not necessarily the single best spot, and the relay uses the same
  radio settings as A and B.
- **Environment loss** is one number per link (not per end, not per land-cover
  type). Field-mode calibration fits one value for all logged tests, and the
  Field-mode environment setting is page-wide, not stored per test.
- Coverage is the bounding box 29.25–33.5 °N, 34–36 °E. Outside it, terrain
  reads as 0 m and the app warns you.
- Measured SNR saturates near +10 dB on real chips, so the SNR comparison is
  only meaningful for weak links.
- Field-mode data lives in one browser's localStorage. There is no sync.
- Firmware loss counting only notices lost packets when the next one
  arrives.

## Suggested next steps

1. Run the firmware CI job and flash two boards; do a first field campaign
   and use the new calibration to replace the clutter presets with measured
   values for Israeli city / town / open terrain.
2. Add the ITU-R P.526-15 Bullington + spherical-earth method as an
   alternative diffraction model, and land-cover-based clutter per path end
   (e.g. from ESA WorldCover).
3. Coverage map: export as GeoTIFF/PNG, compare two transmitter sites, and
   "best site" search (the relay search generalised to one site serving many
   receivers).
4. Multi-hop relays (two relays) for very long or very blocked paths.
5. Optional 1″ (30 m) tiles served from a release asset or CDN for higher
   resolution without growing the repo.
6. GPS support in the firmware (e.g. Heltec Wireless Tracker) so CSV rows
   carry real coordinates.
7. A native-speaker review of the Hebrew strings.
