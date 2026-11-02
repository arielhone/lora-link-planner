# Range-test firmware (Heltec WiFi LoRa 32 V3)

A tiny sender/receiver pair to check the planner's predictions in the field.
Runs on the **Heltec WiFi LoRa 32 V3** (ESP32-S3 + SX1262 + OLED), built with
[PlatformIO](https://platformio.org/), the Arduino framework and
[RadioLib](https://github.com/jgromes/RadioLib).

| Mode | What it does |
| ---- | ------------ |
| **Sender** | Sends packet `LRT,<seq>,<power>` (padded to 20 bytes) every 5 s. OLED shows the packet number. |
| **Receiver** | Shows last RSSI, SNR, received/lost counts and loss % on the OLED. Prints one CSV row per 20 packets over USB serial, in the exact format the web app's **Field mode** imports. |

Press the **PRG** button to switch modes (remembered after a reboot).

## Build and flash

```bash
pip install platformio
cd firmware
pio run -e sender -t upload        # board 1
pio run -e receiver -t upload      # board 2
pio device monitor -b 115200       # watch the receiver
```

## Settings

Edit [`include/config.h`](include/config.h). Defaults match the web app
(Israel, AS923-4): **917.3 MHz, SF9, 125 kHz, CR 4/5, 14 dBm, 20-byte payload**.
Both boards must use the same frequency, SF, bandwidth, coding rate and sync
word. Remember the Israeli limit is 14 dBm **EIRP**: with a 3 dBi antenna set
`LORA_TX_POWER_DBM` to 11.

## Serial output and field mode

```
# LoRa Link Planner range test firmware
# mode: RECEIVER
timestamp,a_lat,a_lon,a_height_m,b_lat,b_lon,b_height_m,freq_mhz,sf,bw_khz,tx_power_dbm,...,notes
# pkt seq=0 rssi=-101.0 snr=6.25 lost_before=0
...
112,,,2,,,2,917.3,9,125,14,0.0,0.0,0.0,0.0,-102.5,5.75,19,1,seq 0-19
```

- Lines starting with `#` are per-packet details; the importer skips them.
- `timestamp` is the receiver's uptime in seconds (the board has no clock).
- Coordinates are empty unless you set `SITE_A_LAT` … in `config.h`. When you
  import the file in Field mode, empty coordinates are filled from the A/B
  points in the form, so: set the points on the map, then import.

Copy the serial log to a `.csv` file (e.g. `pio device monitor | tee test.csv`)
and use **Import CSV** in Field mode.

## Pin map

See [`include/board_heltec_v3.h`](include/board_heltec_v3.h): SX1262 on
NSS 8 / SCK 9 / MOSI 10 / MISO 11 / RST 12 / BUSY 13 / DIO1 14 with a 1.8 V
TCXO; OLED on I²C SDA 17 / SCL 18 / RST 21, powered via Vext (GPIO 36, low = on).
Other SX1262 boards work after editing that file.
