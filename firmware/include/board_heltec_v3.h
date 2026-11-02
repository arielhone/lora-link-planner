// Pin map of the Heltec WiFi LoRa 32 V3 (ESP32-S3FN8 + SX1262 + 0.96" SSD1306).
// Source: Heltec V3 schematic / pin diagram.
#pragma once

// SX1262 radio
#define PIN_LORA_NSS   8
#define PIN_LORA_SCK   9
#define PIN_LORA_MOSI  10
#define PIN_LORA_MISO  11
#define PIN_LORA_RST   12
#define PIN_LORA_BUSY  13
#define PIN_LORA_DIO1  14
// The V3 SX1262 uses a 1.8 V TCXO on DIO3.
#define LORA_TCXO_VOLTAGE 1.8f

// OLED (I2C) - powered through the Vext switch
#define PIN_OLED_SDA   17
#define PIN_OLED_SCL   18
#define PIN_OLED_RST   21
#define PIN_VEXT       36   // LOW = Vext on (OLED power)

// User button "PRG" and the white LED
#define PIN_BUTTON     0
#define PIN_LED        35
