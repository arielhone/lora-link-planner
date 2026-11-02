/*
 * LoRa range test for the Heltec WiFi LoRa 32 V3 (ESP32-S3 + SX1262).
 *
 * SENDER   : transmits a numbered packet every SEND_INTERVAL_S seconds.
 * RECEIVER : shows RSSI, SNR and packet loss on the OLED, and prints CSV
 *            over USB serial in the format the web app's field mode imports.
 *
 * Press the PRG button to switch between sender and receiver (remembered
 * across reboots). Settings: include/config.h.
 *
 * Serial output of the receiver (115200 baud):
 *   # comment lines start with '#'  (one per packet, ignored on import)
 *   timestamp,a_lat,...,notes       (CSV header, repeated now and then)
 *   312,,,2,,,2,917.3,9,125,14,...  (one summary row every SUMMARY_EVERY packets)
 */
#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <Preferences.h>
#include <RadioLib.h>
#include <SSD1306Wire.h>

#include "board_heltec_v3.h"
#include "config.h"

#ifndef DEFAULT_MODE_SENDER
#define DEFAULT_MODE_SENDER 0
#endif

// Same columns, same order as CSV_COLUMNS in src/field/csv.js
static const char *CSV_HEADER =
    "timestamp,a_lat,a_lon,a_height_m,b_lat,b_lon,b_height_m,freq_mhz,sf,bw_khz,"
    "tx_power_dbm,tx_gain_dbi,rx_gain_dbi,tx_cable_loss_db,rx_cable_loss_db,"
    "rssi_dbm,snr_db,packets_received,packets_lost,notes";

SX1262 radio = new Module(PIN_LORA_NSS, PIN_LORA_DIO1, PIN_LORA_RST, PIN_LORA_BUSY, SPI);
SSD1306Wire display(0x3c, PIN_OLED_SDA, PIN_OLED_SCL, GEOMETRY_128_64);
Preferences prefs;

static bool isSender = DEFAULT_MODE_SENDER;
static volatile bool packetFlag = false;

// ---- sender state
static uint32_t txSeq = 0;
static uint32_t lastTxMs = 0;
static int lastTxState = RADIOLIB_ERR_NONE;

// ---- receiver state
struct Window {
  uint32_t received = 0;
  uint32_t lost = 0;
  double rssiSum = 0;
  double snrSum = 0;
  uint32_t firstSeq = 0;
  uint32_t lastSeq = 0;
};
static Window win;
static bool haveSeq = false;
static uint32_t prevSeq = 0;
static uint32_t totalReceived = 0, totalLost = 0, crcErrors = 0;
static float lastRssi = 0, lastSnr = 0;
static int lastTxPower = LORA_TX_POWER_DBM;
static uint32_t rowsPrinted = 0;
static uint32_t lastRxMs = 0;

#if defined(ESP8266) || defined(ESP32)
ICACHE_RAM_ATTR
#endif
void onDio1() { packetFlag = true; }

// ------------------------------------------------------------------ display
static void showLines(const String &l1, const String &l2 = "", const String &l3 = "",
                      const String &l4 = "", const String &l5 = "") {
  display.clear();
  display.setFont(ArialMT_Plain_10);
  display.setTextAlignment(TEXT_ALIGN_LEFT);
  display.drawString(0, 0, l1);
  display.drawString(0, 13, l2);
  display.drawString(0, 26, l3);
  display.drawString(0, 39, l4);
  display.drawString(0, 52, l5);
  display.display();
}

static String radioLine() {
  char buf[40];
  snprintf(buf, sizeof(buf), "%.1fMHz SF%d BW%.0f", LORA_FREQ_MHZ, LORA_SF, LORA_BW_KHZ);
  return String(buf);
}

static void drawSender() {
  char l3[32], l4[32];
  snprintf(l3, sizeof(l3), "Packet #%lu", (unsigned long)txSeq);
  snprintf(l4, sizeof(l4), "%d dBm, every %ds", LORA_TX_POWER_DBM, SEND_INTERVAL_S);
  showLines("SENDER   (PRG=switch)", radioLine(), l3, l4,
            lastTxState == RADIOLIB_ERR_NONE ? String("last TX ok") : String("TX error ") + String(lastTxState));
}

static void drawReceiver() {
  char l3[32], l4[32], l5[32];
  if (totalReceived == 0) {
    showLines("RECEIVER (PRG=switch)", radioLine(), "waiting for packets...",
              crcErrors ? String("CRC errors: ") + String(crcErrors) : String(""), "");
    return;
  }
  uint32_t total = totalReceived + totalLost;
  float loss = total ? 100.0f * totalLost / total : 0;
  snprintf(l3, sizeof(l3), "RSSI %.1f  SNR %.1f", lastRssi, lastSnr);
  snprintf(l4, sizeof(l4), "#%lu  rx %lu  lost %lu", (unsigned long)prevSeq, (unsigned long)totalReceived,
           (unsigned long)totalLost);
  snprintf(l5, sizeof(l5), "loss %.1f%%  %lus ago", loss, (unsigned long)((millis() - lastRxMs) / 1000));
  showLines("RECEIVER (PRG=switch)", radioLine(), l3, l4, l5);
}

// ------------------------------------------------------------------ radio
static void radioFail(int state) {
  Serial.printf("# radio init failed, code %d\n", state);
  showLines("Radio init FAILED", String("code ") + String(state), "check config.h");
  while (true) delay(1000);
}

static void setupRadio() {
  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);
  int state = radio.begin(LORA_FREQ_MHZ, LORA_BW_KHZ, LORA_SF, LORA_CR_DENOM, LORA_SYNC_WORD,
                          LORA_TX_POWER_DBM, LORA_PREAMBLE, LORA_TCXO_VOLTAGE, false);
  if (state != RADIOLIB_ERR_NONE) radioFail(state);
  radio.setCRC(true);
  radio.setDio2AsRfSwitch(true);
  radio.setDio1Action(onDio1);
}

static void startMode() {
  packetFlag = false;
  if (isSender) {
    radio.standby();
    lastTxMs = millis() - SEND_INTERVAL_S * 1000UL;  // send right away
    Serial.println("# mode: SENDER");
    drawSender();
  } else {
    win = Window();
    haveSeq = false;
    totalReceived = totalLost = crcErrors = 0;
    Serial.println("# mode: RECEIVER");
    Serial.printf("# radio: %.1f MHz, SF%d, BW %.0f kHz, CR 4/%d\n", LORA_FREQ_MHZ, LORA_SF, LORA_BW_KHZ,
                  LORA_CR_DENOM);
    Serial.println(CSV_HEADER);
    int state = radio.startReceive();
    if (state != RADIOLIB_ERR_NONE) Serial.printf("# startReceive failed, code %d\n", state);
    drawReceiver();
  }
}

// ------------------------------------------------------------------ sender
static void sendPacket() {
  // Text payload, padded to LORA_PAYLOAD_BYTES so time-on-air matches the planner.
  char payload[LORA_PAYLOAD_BYTES + 1];
  int n = snprintf(payload, sizeof(payload), "LRT,%lu,%d", (unsigned long)txSeq, LORA_TX_POWER_DBM);
  for (int i = n; i < LORA_PAYLOAD_BYTES; i++) payload[i] = '.';
  payload[LORA_PAYLOAD_BYTES] = '\0';

  digitalWrite(PIN_LED, HIGH);
  uint32_t t0 = millis();
  lastTxState = radio.transmit((uint8_t *)payload, LORA_PAYLOAD_BYTES);
  uint32_t toa = millis() - t0;
  digitalWrite(PIN_LED, LOW);
  Serial.printf("# sent seq=%lu state=%d airtime_ms=%lu\n", (unsigned long)txSeq, lastTxState,
                (unsigned long)toa);
  txSeq++;
  drawSender();
}

// ------------------------------------------------------------------ receiver
static void printSummary() {
  if (win.received + win.lost == 0) return;
  if (rowsPrinted > 0 && rowsPrinted % HEADER_EVERY_ROWS == 0) Serial.println(CSV_HEADER);
  double rssi = win.received ? win.rssiSum / win.received : 0;
  double snr = win.received ? win.snrSum / win.received : 0;
  // timestamp = receiver uptime in seconds (the board has no clock)
  Serial.printf("%lu,%s,%s,%s,%s,%s,%s,%.1f,%d,%.0f,%d,%.1f,%.1f,%.1f,%.1f,",
                (unsigned long)(millis() / 1000), SITE_A_LAT, SITE_A_LON, SITE_A_HEIGHT_M, SITE_B_LAT,
                SITE_B_LON, SITE_B_HEIGHT_M, LORA_FREQ_MHZ, LORA_SF, LORA_BW_KHZ, lastTxPower, TX_GAIN_DBI,
                RX_GAIN_DBI, TX_CABLE_LOSS_DB, RX_CABLE_LOSS_DB);
  if (win.received)
    Serial.printf("%.1f,%.2f,", rssi, snr);
  else
    Serial.print(",,");
  Serial.printf("%lu,%lu,seq %lu-%lu\n", (unsigned long)win.received, (unsigned long)win.lost,
                (unsigned long)win.firstSeq, (unsigned long)win.lastSeq);
  rowsPrinted++;
  win = Window();
}

static void handlePacket() {
  uint8_t buf[256];
  size_t len = radio.getPacketLength();
  if (len > sizeof(buf) - 1) len = sizeof(buf) - 1;
  int state = radio.readData(buf, len);
  if (state == RADIOLIB_ERR_CRC_MISMATCH) {
    crcErrors++;
    Serial.println("# crc error");
    radio.startReceive();
    return;
  }
  if (state != RADIOLIB_ERR_NONE) {
    Serial.printf("# read failed, code %d\n", state);
    radio.startReceive();
    return;
  }
  buf[len] = '\0';
  unsigned long seq = 0;
  int power = LORA_TX_POWER_DBM;
  if (sscanf((const char *)buf, "LRT,%lu,%d", &seq, &power) < 1) {
    Serial.println("# foreign packet ignored");
    radio.startReceive();
    return;
  }
  lastRssi = radio.getRSSI();
  lastSnr = radio.getSNR();
  lastTxPower = power;
  lastRxMs = millis();

  if (haveSeq && seq <= prevSeq) {
    // the sender restarted: close the current window and start over
    printSummary();
    haveSeq = false;
  }
  uint32_t gap = haveSeq ? (uint32_t)(seq - prevSeq - 1) : 0;
  if (win.received + win.lost == 0) win.firstSeq = seq;
  win.lost += gap;
  totalLost += gap;
  win.received++;
  totalReceived++;
  win.rssiSum += lastRssi;
  win.snrSum += lastSnr;
  win.lastSeq = seq;
  prevSeq = seq;
  haveSeq = true;

  Serial.printf("# pkt seq=%lu rssi=%.1f snr=%.2f lost_before=%lu\n", seq, lastRssi, lastSnr, (unsigned long)gap);
  digitalWrite(PIN_LED, HIGH);
  delay(20);
  digitalWrite(PIN_LED, LOW);

  if (win.received + win.lost >= SUMMARY_EVERY) printSummary();
  drawReceiver();
  radio.startReceive();
}

// ------------------------------------------------------------------ button
static void checkButton() {
  static bool lastLevel = HIGH;
  static uint32_t lastChange = 0;
  bool level = digitalRead(PIN_BUTTON);
  if (level != lastLevel && millis() - lastChange > 50) {
    lastChange = millis();
    lastLevel = level;
    if (level == LOW) {  // pressed
      if (!isSender) printSummary();
      isSender = !isSender;
      prefs.putBool("sender", isSender);
      startMode();
    }
  }
}

// ------------------------------------------------------------------ main
void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);

  // power the OLED and reset it
  pinMode(PIN_VEXT, OUTPUT);
  digitalWrite(PIN_VEXT, LOW);
  delay(50);
  pinMode(PIN_OLED_RST, OUTPUT);
  digitalWrite(PIN_OLED_RST, LOW);
  delay(20);
  digitalWrite(PIN_OLED_RST, HIGH);
  display.init();
  showLines("LoRa range test", "starting...");

  prefs.begin("rangetest", false);
  isSender = prefs.getBool("sender", DEFAULT_MODE_SENDER);

  Serial.println("# LoRa Link Planner range test firmware");
  setupRadio();
  startMode();
}

void loop() {
  checkButton();
  if (isSender) {
    if (millis() - lastTxMs >= SEND_INTERVAL_S * 1000UL) {
      lastTxMs += SEND_INTERVAL_S * 1000UL;
      sendPacket();
    }
  } else {
    if (packetFlag) {
      packetFlag = false;
      handlePacket();
    }
    static uint32_t lastDraw = 0;
    if (millis() - lastDraw > 1000) {  // refresh the "seconds ago" counter
      lastDraw = millis();
      drawReceiver();
    }
  }
}
