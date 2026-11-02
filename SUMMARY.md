# Summary

## What was built

| Milestone | Status | Where |
| --------- | ------ | ----- |
| 1. Physics core + tests | ✅ FSPL, Fresnel radius, earth bulge (k = 4/3), knife-edge J(ν) and Deygout (ITU-R P.526), LoRa sensitivity (SX1262 formula / SX1276 table), required SNR, time on air, link budget, Israeli compliance check | `src/physics/`, `test/physics.test.js` |
| 2. Elevation pipeline | ✅ `build_dem.py` downloads Copernicus GLO-30 from AWS Open Data, filters, resamples to 2″ (~60 m), writes 114 gzip+delta tiles (13 MB); JS reader with bilinear interpolation; 30 m great-circle profile sampler | `scripts/`, `public/dem/`, `src/elevation/` |
| 3. Planner app | ✅ Leaflet map, draggable A/B, antenna heights, settings panel, SVG profile (terrain, LOS, Fresnel ellipse, 60% line, red/orange obstruction, labelled diffraction edges, hover read-out), result card with verdict, what-if (SF table + required heights with one-click apply), URL-hash sharing, examples, mobile layout | `index.html`, `src/app/` |
| 4. Field mode | ✅ Log tests, predicted vs measured table, prediction-error scatter chart with bias/RMS stats, CSV import/export, localStorage | `field.html`, `src/field/` |
| 5. Firmware | ✅ written, ⚠️ not compiled locally (see below). Sender/receiver for the Heltec WiFi LoRa 32 V3 with RadioLib, OLED status, PRG-button mode switch, CSV over serial in the field-mode format | `firmware/` |
| 6. Learning docs | ✅ 12 sections from zero, each linked to the implementing function | `docs/LEARN.md` |
| 7. Polish | ✅ README, MIT licence, CI (tests, build, headless e2e, firmware compile), Pages deployment, DECISIONS.md | `.github/workflows/` |

**Verification done here:** 45 unit tests pass (`npm test`); `npm run build`
succeeds; the headless Chromium check (`scripts/e2e-check.mjs`) passes against
both `vite preview` and a plain static server under `/lora-link-planner/` (as
GitHub Pages serves it). Across Mt Tabor the link is *fails* with the hill drawn
in red, Carmel → Akko is *works*, and clicking the map places A and B and
updates the URL. Real-DEM spot checks (Hermon, Meron, Tabor, Dead Sea,
Jerusalem) are in the unit tests.

## What's missing / not verified

- **Firmware was not compiled in this environment.** The PlatformIO registry
  and GitHub were blocked by the sandbox network policy. The code was
  type-checked with `g++ -fsyntax-only` against hand-written stub headers that
  mirror the RadioLib 7 / ThingPulse SSD1306 APIs. The real compile runs in the
  `firmware` job of `ci.yml`; check that job on the first push. It has not
  been tested on hardware.
- **No GIF** in the README, only static screenshots. The screenshots show a
  blank map background because OpenStreetMap tiles were blocked in the
  sandbox.
- **GitHub Pages** must be enabled once (Settings → Pages → Source: GitHub
  Actions), and the deploy workflow runs on `main`. This work is on branch
  `claude/stoic-mendel-018mok`, so the live demo link works only after it is
  merged to `main`.
- The Israeli 14 dBm EIRP limit comes from the LoRa Alliance AS923-4 plan;
  the Hebrew regulation text itself could not be retrieved (see DECISIONS.md §1).

## Known limitations

- **Model scope:** free space + terrain diffraction only. No clutter
  (buildings and vegetation beyond what the 60 m DSM contains), no ground
  reflection or multipath, no interference. Optimistic in urban areas.
- **Deygout over-estimates** loss on broad, rounded hills, where secondary
  edges on the same hill add tens of dB (e.g. 82 dB across Mt Tabor, where a
  single knife edge gives ~41 dB). The verdict is the same in such cases
  (fails), but marginal paths over rounded terrain may be pessimistic.
  "Single knife edge" is available as an alternative.
- **60 m DEM resolution** smooths narrow peaks by a few metres and can miss
  thin ridges or single buildings.
- Coverage is the bounding box 29.25–33.5 °N, 34–36 °E. Outside it, terrain
  reads as 0 m and the app warns you.
- Measured SNR saturates near +10 dB on real chips, so the SNR comparison is
  only meaningful for weak links.
- Field-mode data lives in one browser's localStorage. There is no sync.
- Firmware loss counting only notices lost packets when the next one
  arrives. If the sender stops, the final window is not closed until a
  restart or a mode switch.

## Suggested next steps

1. Run the firmware CI job and flash two boards; do a first field campaign
   and use the error statistics to calibrate an extra "environment loss"
   setting (urban / suburban / open).
2. Add the ITU-R P.526-15 Bullington + spherical-earth method as an
   alternative diffraction model, and a clutter/land-cover loss term (e.g.
   from ESA WorldCover).
3. Coverage map mode: for one transmitter, compute the margin on a grid
   (in a Web Worker) and draw a heat map.
4. Relay planner: suggest a hilltop between A and B when the direct link fails.
5. Optional 1″ (30 m) tiles served from a release asset or CDN for higher
   resolution without growing the repo.
6. GPS support in the firmware (e.g. Heltec Wireless Tracker) so CSV rows
   carry real coordinates.
