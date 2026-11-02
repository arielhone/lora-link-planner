# Learn: how a LoRa link works, from zero

This guide explains every idea the planner uses. You don't need any radio
background, just school maths (adding, multiplying, a square root). Each
section ends with a link to the exact function in the code that does it,
so you can read the formula as a program too.

**Contents**

1. [What is LoRa?](#1-what-is-lora)
2. [Decibels: the only unit you need](#2-decibels-the-only-unit-you-need)
3. [Why signals get weaker with distance](#3-why-signals-get-weaker-with-distance-free-space-path-loss)
4. [The Fresnel zone: why a clear straight line is not enough](#4-the-fresnel-zone-why-a-clear-straight-line-is-not-enough)
5. [The Earth is round (and the air bends radio)](#5-the-earth-is-round-and-the-air-bends-radio)
6. [When a hill is in the way: diffraction](#6-when-a-hill-is-in-the-way-diffraction)
7. [Spreading Factor: trading speed for range](#7-spreading-factor-trading-speed-for-range)
8. [Receiver sensitivity: how quiet can it hear?](#8-receiver-sensitivity-how-quiet-can-it-hear)
9. [The link budget: radio accounting](#9-the-link-budget-radio-accounting)
10. [Time on air: how long a message occupies the channel](#10-time-on-air)
11. [Where the terrain comes from](#11-where-the-terrain-comes-from)
12. [Clutter loss: buildings, trees and you](#12-clutter-loss-buildings-trees-and-you)
13. [Coverage maps: one transmitter, thousands of receivers](#13-coverage-maps-one-transmitter-thousands-of-receivers)
14. [Relays: going over the hill instead of through it](#14-relays-going-over-the-hill-instead-of-through-it)
15. [What the model leaves out](#15-what-the-model-leaves-out)

---

## 1. What is LoRa?

LoRa ("**Lo**ng **Ra**nge") is a way of sending small messages by radio over
many kilometres using very little battery. Think of a sensor in a field that
sends "soil moisture = 31%" once an hour, and runs for years on two AA cells.

The trick: LoRa sends each piece of information as a **chirp**, a whistle
whose pitch slides from low to high. A receiver that knows what chirps to
expect can recognise them even when they are much quieter than the
background noise, the way you can pick out your own name in a noisy room.

The price is speed. LoRa sends a few hundred to a few thousand bits per second,
about what a 1990s modem did. Fine for "temperature = 24.5", useless for video.

In Israel, LoRa may use the **917–920 MHz** band, with at most **14 dBm**
(25 milliwatts) of radiated power. That's about 1/40 of the power of a phone,
and it can still reach tens of kilometres when the path is clear.
→ [`ISRAEL_REGULATION`](../src/physics/regulations.js#L12),
[`checkCompliance()`](../src/physics/regulations.js#L26)

## 2. Decibels: the only unit you need

Radio powers span huge ranges: a transmitter sends 0.025 W, and the receiver
may get 0.000 000 000 000 05 W. Writing all those zeros is painful, so
engineers use **decibels (dB)**, which count powers of ten:

| change | in dB |
| ------ | ----- |
| ×2 (double) | +3 dB |
| ×10 | +10 dB |
| ×100 | +20 dB |
| ÷2 (half) | −3 dB |
| ÷1000 | −30 dB |

**dBm** means "dB compared with 1 milliwatt": 0 dBm = 1 mW, 14 dBm ≈ 25 mW,
−120 dBm = one millionth of a millionth of a milliwatt.

The best part: in dB, **multiplying becomes adding**. "The power is cut in
half, then cut by 1000" becomes "−3 dB − 30 dB = −33 dB". That's why the link
budget in section 9 is plain addition and subtraction.

## 3. Why signals get weaker with distance (free-space path loss)

Picture a light bulb in a dark room. Close to it, a sheet of paper is bright.
Twice as far away, the same light spreads over a sphere with **four times**
the area, so the paper gets **¼** of the light. Radio works the same way.

This is called **free-space path loss** (FSPL):

```
FSPL (dB) = 20·log10(distance in km) + 20·log10(frequency in MHz) + 32.45
```

What it tells you:

- **Double the distance → 6 dB more loss** (¼ of the power).
- **10× the distance → 20 dB more loss.**
- Higher frequency → more loss. That's not because high frequencies are
  "weaker". A receiving antenna for a higher frequency is smaller, so it
  catches less of the spread-out energy.

Example: 19 km at 917 MHz → 25.6 + 59.2 + 32.45 ≈ **117 dB** of loss. The
signal arrives about 500 000 000 000 times weaker than it left. LoRa copes
with that.

→ [`freeSpacePathLoss()`](../src/physics/propagation.js#L48),
[`wavelength()`](../src/physics/propagation.js#L28)

## 4. The Fresnel zone: why a clear straight line is not enough

You might think: "if I can see the other antenna, the radio path is clear."
Not quite. Radio waves are not thin laser beams. A radio wave is long
(about **33 cm** at 917 MHz), and the energy that reaches the receiver travels
through a fat, invisible **rugby ball** around the straight line. This ball
is called the **first Fresnel zone** (say "freh-NEL").

```
          ___-------___
   A ---<-------------->--- B      ← the rugby ball (first Fresnel zone)
          ‾‾‾-------‾‾‾
```

Its radius at any point along the path is:

```
r = √( λ · d1 · d2 / (d1 + d2) )
```

where λ (lambda) is the wavelength and d1, d2 are the distances to each end.
The ball is fattest in the middle. For a 10 km link at 917 MHz the middle
radius is about **29 m**, so a ridge 20 m below your line of sight can still
hurt the signal.

**Rule of thumb:** keep at least **60 %** of the first Fresnel zone free of
obstacles. If you do, the link behaves almost like free space. That's why the
planner draws the ball as a shaded band on the profile and marks orange the
places where the ground enters the 60 % line. The "what if" helper calculates
how high the antennas must be to clear it.

→ [`fresnelRadius()`](../src/physics/propagation.js#L75),
[`pathGeometry()`](../src/physics/pathAnalysis.js#L50),
[`requiredExtraHeight()`](../src/physics/pathAnalysis.js#L94)

## 5. The Earth is round (and the air bends radio)

Over long paths, the Earth's curve lifts the ground in the middle of the path
up into your radio line. The bulge at a point is:

```
bulge = d1 · d2 / (2 · k · R)
```

R is the Earth's radius (6371 km). Over 10 km the middle rises by about
1.5 m, and over 50 km by about 37 m, which is as tall as a 12-storey building!

The **k = 4/3** factor exists because the air is thinner higher up, so radio
waves bend slightly downwards and follow the Earth's curve a little. Instead
of bending the waves, we pretend the Earth is bigger (4/3 of its real size,
so flatter) and keep the waves straight. Same answer, simpler maths.

In the profile chart the bulge is already added to the ground ("ground + earth
curve"), so the line of sight can be drawn as a straight line.

→ [`earthBulge()`](../src/physics/propagation.js#L113),
[`effectiveEarthRadius()`](../src/physics/propagation.js#L92),
[`radioHorizon()`](../src/physics/propagation.js#L126)

## 6. When a hill is in the way: diffraction

You can hear someone talking behind a wall, because sound bends around the
edge. Radio does the same: when a hill blocks the path, a little energy still
**bends over the top**. This is called **diffraction**, and it costs extra
loss.

We model the hill as a thin, sharp blade, a **knife edge**. First we measure
how far the top of the hill pokes into the path in "Fresnel units":

```
ν = h · √( 2·(d1 + d2) / (λ · d1 · d2) )        (ν is the Greek letter "nu")
```

h is the height of the hilltop above the straight line (negative if the line
passes above it). Then ITU-R P.526, the international standard, gives the
extra loss:

```
J(ν) = 6.9 + 20·log10( √((ν − 0.1)² + 1) + ν − 0.1 )      for ν > −0.78
```

Landmarks worth remembering:

| situation | ν | extra loss |
| --------- | - | ---------- |
| 60 % of the Fresnel zone clear | −0.78 | 0 dB |
| hilltop exactly touching the line | 0 | 6 dB |
| hilltop one Fresnel radius above the line | 1.4 | ~16 dB |
| a mountain in the way | 10+ | 33 dB and more |

**Several hills (the Deygout method):** find the worst hill (largest ν) and
count its loss. Then pretend that hilltop is a new antenna and repeat for the
two halves of the path, from A to the hilltop and from the hilltop to B. Add
the losses together. The planner goes two levels deep (the main hill plus up to
two more). Each edge it used is marked in red on the profile with its loss.

→ [`fresnelKirchhoffNu()`](../src/physics/diffraction.js#L28),
[`knifeEdgeLoss()`](../src/physics/diffraction.js#L45),
[`heightsAboveLos()`](../src/physics/diffraction.js#L64),
[`singleKnifeEdge()`](../src/physics/diffraction.js#L84),
[`deygout()`](../src/physics/diffraction.js#L136)

## 7. Spreading Factor: trading speed for range

The **Spreading Factor (SF)** says how long each chirp lasts. It goes from
SF7 to SF12, and **each step up doubles the chirp's length**.

Analogy: spelling a word to someone across a noisy street. You can say it
quickly (SF7), or very slowly and clearly, letter by letter (SF12). Slow is
easier to understand from far away, but it takes much longer.

| SF | relative speed | how far below the noise it still works |
| -- | -------------- | -------------------------------------- |
| 7  | fastest (×32) | −7.5 dB |
| 8  | ×16 | −10 dB |
| 9  | ×8  | −12.5 dB |
| 10 | ×4  | −15 dB |
| 11 | ×2  | −17.5 dB |
| 12 | slowest (×1) | −20 dB |

Each SF step buys about **2.5 dB** more range budget and costs **2×** the
air time (and battery). The **bandwidth** (125/250/500 kHz) works the other
way: doubling it makes chirps twice as fast but lets in twice the noise
(−3 dB).

The "what if" table in the app shows the margin and air time for every SF,
so you can pick the fastest one that still works.

→ [`symbolTime()`](../src/physics/lora.js#L110),
[`REQUIRED_SNR_DB`](../src/physics/lora.js#L28),
[`bitRate()`](../src/physics/lora.js#L165)

## 8. Receiver sensitivity: how quiet can it hear?

Every receiver hears a hiss of **thermal noise**, made by the random jiggling
of electrons in anything warm. Its power is:

```
noise = −174 dBm/Hz + 10·log10(bandwidth in Hz) + NF
```

At 125 kHz with a noise figure (NF, how much noise the receiver adds itself)
of 6 dB, that's about **−117 dBm**.

**Sensitivity** is the weakest signal the receiver can still decode:

```
sensitivity = noise + required SNR (from the SF table)
```

SF12 at 125 kHz: −117 + (−20) = **−137 dBm**. That's an incredibly small
power: 0.000 000 000 000 000 02 W.

The planner uses this formula for the SX1262 chip (it matches the Semtech
datasheet) and the measured table from the datasheet for the older SX1276.

→ [`noiseFloor()`](../src/physics/lora.js#L63),
[`sensitivity()`](../src/physics/lora.js#L81),
[`SX1276_SENSITIVITY_DBM`](../src/physics/lora.js#L42)

## 9. The link budget: radio accounting

The link budget is just a **bank statement**. You start with a deposit, add
bonuses, subtract expenses, and check whether you're still above the bank's
minimum balance.

| line | example (Carmel → Akko, 19 km) |
| ---- | ------------------------------ |
| + Transmitter power | +14 dBm |
| + Transmit antenna gain | +0 dB |
| − Transmit cable loss | −0 dB |
| − Free-space path loss | −117.3 dB |
| − Obstruction (diffraction) loss | −0 dB |
| − Environment (clutter) loss | −0 dB (open) |
| + Receive antenna gain | +0 dB |
| − Receive cable loss | −0 dB |
| **= Received power** | **−103.3 dBm** |
| − Sensitivity (SF9, 125 kHz) | −(−129.5) dBm |
| **= Link margin** | **+26.3 dB** |

The **margin** is your savings, a reserve for everything the model doesn't
know: people, trees, rain-soaked leaves, a car parked next to the antenna,
fading. The planner's verdict:

- **≥ 10 dB**: ✅ *works*
- **0 to 10 dB**: ⚠️ *marginal*, sometimes yes, sometimes no
- **< 0 dB**: ❌ *fails*, the signal is quieter than the receiver can hear

Antenna gain doesn't create energy. A "3 dBi" antenna just focuses it,
sending more towards the horizon and less up into the sky. That's why the law
limits **EIRP** = power + antenna gain − cable loss, not just the radio's
power.

→ [`eirp()`](../src/physics/linkBudget.js#L28),
[`linkBudget()`](../src/physics/linkBudget.js#L65),
[`verdict()`](../src/physics/linkBudget.js#L42),
[`analyzeLink()`](../src/physics/pathAnalysis.js#L125)

## 10. Time on air

**Time on air** is how long one message keeps the radio channel busy. It
matters because:

- the battery drains while transmitting;
- while you transmit, nobody else nearby can use the channel;
- networks (like The Things Network) set a daily air-time budget.

Semtech's formula counts the preamble (a "wake up, here comes a message"
pattern) plus the symbols needed for header, payload and error-checking
code:

```
T_symbol   = 2^SF / bandwidth
T_preamble = (preamble_symbols + 4.25) · T_symbol
n_payload  = 8 + max( ceil( (8·bytes − 4·SF + 28 + 16·CRC − 20·IH) / (4·(SF − 2·DE)) ) · (CR + 4), 0 )
time       = T_preamble + n_payload · T_symbol
```

A 20-byte message takes about **57 ms at SF7** but **1.3 s at SF12**, about
23 times longer for the same message.

→ [`timeOnAir()`](../src/physics/lora.js#L136),
[`lowDataRateOptimize()`](../src/physics/lora.js#L97)

## 11. Where the terrain comes from

The ground heights come from the **Copernicus GLO-30** digital elevation
model, which was measured by two German radar satellites (TanDEM-X) flying in
formation. A Python script ([`scripts/build_dem.py`](../scripts/build_dem.py))
downloads it once, shrinks it to one height every ~60 m, and stores it as
small compressed tiles. The browser downloads only the tiles your path
crosses, then walks along the line from A to B every 30 m and reads the
height at each step. Between grid points it blends the four nearest heights
(bilinear interpolation).

→ [`terrainProfile()`](../src/elevation/profile.js#L39),
[`pathPoints()`](../src/elevation/profile.js#L20),
[`distance()`](../src/elevation/geo.js#L16) (haversine),
[`interpolate()`](../src/elevation/geo.js#L27) (great circle),
[`Dem.elevationAt()`](../src/elevation/dem.js#L153),
[`decodeTile()`](../src/elevation/dem.js#L21)

## 12. Clutter loss: buildings, trees and you

The terrain model sees hills. It doesn't really see the things near the
antennas: houses, walls, trees, parked cars, the person holding the device.
Together these are called **clutter**, and they eat signal.

Analogy: the terrain is the mountains between two villages; the clutter is
the furniture in the room where you're shouting from. Even with no mountain
in the way, shouting from inside a closed cupboard doesn't carry far.

The planner models clutter as **one extra loss**, chosen by the type of
place:

| environment | extra loss | typical place |
| ----------- | ---------- | ------------- |
| open | 0 dB | hilltops, fields, desert, coast |
| suburban | 10 dB | houses with gardens, small towns, light woodland |
| urban | 20 dB | city streets, devices at street level between buildings |
| custom | your number | e.g. from Field-mode calibration |

20 dB means the signal is **100 times** weaker. These values come from
international measurement-based models (ITU-R P.2108 and the classic
Okumura–Hata model; see [DECISIONS.md](../DECISIONS.md#7-environment-clutter-loss)).
They're averages, though, and your street may differ by ±10 dB. That's why
**Field mode can calibrate it**: log a few real measurements and press
"Compute best-fit extra loss". The math is just an average: if your
measurements are on average 13 dB weaker than the open-terrain prediction,
your environment costs about 13 dB.

→ [`clutterLoss()`](../src/physics/clutter.js#L24),
[`ENVIRONMENT_LOSS_DB`](../src/physics/clutter.js#L11),
[`p2108TerrestrialClutterLoss()`](../src/physics/clutter.js#L56),
[`bestFitExtraLoss()`](../src/field/records.js#L85)

## 13. Coverage maps: one transmitter, thousands of receivers

The A–B view answers "does *this* link work?". A **coverage map** answers
"*where* can I hear this transmitter?".

It's the same calculation, repeated: the planner lays a grid of squares over
the area around the transmitter, about 80 × 80 or 160 × 160 of them. For each
square it pretends a receiver sits in the middle, cuts the terrain profile
from the transmitter to that point, and runs the full link budget. Then it
paints the square green (works), yellow (marginal) or red (fails).

Think of a lighthouse at night: the coverage map is the patch of sea its
light reaches. Hills throw **radio shadows** behind them, just like shadows
behind a rock. That's why coverage maps are never neat circles.

Thousands of link calculations take a few seconds, so they run in a **Web
Worker**, a helper thread in the browser. The page stays responsive and
shows a progress bar. Click any square to open its path in the normal A–B
view and see *why* it's that colour.

→ [`coverageGrid()`](../src/coverage/grid.js#L39),
[`autoCellSize()`](../src/coverage/grid.js#L23),
[`classifyMargin()`](../src/coverage/grid.js#L90),
[`computeCoverage()`](../src/coverage/compute.js#L25)

## 14. Relays: going over the hill instead of through it

When a hill blocks the path, you can fight it (more power, higher masts, a
slower SF), or you can **go around it**: put a third radio, a **relay**, on
high ground that both ends can see. The relay hears A and repeats the message
to B.

Why this helps so much: diffraction loss over a big hill can be 40 dB or
more, which is 10 000 times weaker. Two clear hops of half the distance each
cost only a little extra free-space loss. A relay turns one impossible link
into two easy ones.

How the planner searches:

1. It only looks inside an oval (an ellipse) around A and B. A relay far off
   to the side would make both hops much longer.
2. It prefers **high ground**: it samples the oval and keeps the highest
   points.
3. For each candidate it computes **both hops** (A → relay, relay → B).
4. It ranks candidates by their **weaker hop**, because a chain is only as
   strong as its weakest link. A relay with hops of +30 dB and −2 dB is
   worse than one with +12 and +11.

The top three sites are shown on the map with both margins, and you can
inspect each hop's profile.

→ [`relayCandidates()`](../src/relay/relay.js#L28),
[`findRelays()`](../src/relay/relay.js#L71)

## 15. What the model leaves out

A planner is a map, not the territory. Things this one does **not** model:

- **Buildings and trees** as separate objects. The elevation data includes
  some of them (it is a surface model), and the environment setting adds an
  average clutter loss (section 12), but a single building right next to your
  antenna can still make reality 10–20 dB worse than predicted.
- **Reflections** from the ground or water, which can add or cancel
  (multipath fading).
- **Your body, the car, the case** around a handheld device, which can easily
  cost 5–10 dB.
- **Interference** from other devices in the band.

That's why there is a **Field mode**: log real measurements, compare them
with the prediction, and learn how much margin *your* environment needs.
The [range-test firmware](../firmware/README.md) makes collecting those
measurements easy.

---

*Standards and datasheets used:* ITU-R P.525 (free space), ITU-R P.526
(diffraction), ITU-R P.453 (k-factor), Semtech SX1276 and SX1262 datasheets,
Semtech AN1200.13 (time on air), LoRa Alliance RP002 Regional Parameters
(AS923-4 for Israel).
