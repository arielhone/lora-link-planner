// Range-test settings. Keep these equal on the sender and the receiver,
// and equal to the settings you use in the web planner.
#pragma once

// ---- radio (defaults = LoRa Link Planner defaults for Israel, AS923-4)
#define LORA_FREQ_MHZ        917.3f   // Israel: 917-920 MHz
#define LORA_BW_KHZ          125.0f   // 125 / 250 / 500
#define LORA_SF              9        // 7..12
#define LORA_CR_DENOM        5        // coding rate 4/5 (planner "codingRate" 1)
#define LORA_TX_POWER_DBM    14       // Israel: max 14 dBm EIRP incl. antenna gain
#define LORA_PREAMBLE        8
#define LORA_SYNC_WORD       0x12     // private network sync word
#define LORA_PAYLOAD_BYTES   20       // planner default payload size

// ---- range test
#define SEND_INTERVAL_S      5        // sender: one packet every N seconds
#define SUMMARY_EVERY        20       // receiver: one CSV row per N packets (received + lost)
#define HEADER_EVERY_ROWS    10       // repeat the CSV header every N rows

// ---- optional: fill these to have the receiver print complete CSV rows.
// Leave as "" to fill the points later in the web app's field mode.
#ifndef SITE_A_LAT
#define SITE_A_LAT   ""
#define SITE_A_LON   ""
#define SITE_A_HEIGHT_M "2"
#define SITE_B_LAT   ""
#define SITE_B_LON   ""
#define SITE_B_HEIGHT_M "2"
#endif
#define TX_GAIN_DBI        0.0f
#define RX_GAIN_DBI        0.0f
#define TX_CABLE_LOSS_DB   0.0f
#define RX_CABLE_LOSS_DB   0.0f
