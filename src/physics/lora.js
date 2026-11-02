/**
 * lora.js - properties of the LoRa radio itself.
 *
 * LoRa ("Long Range") hides a slow, very robust signal inside a wide chirp.
 * The Spreading Factor (SF) says how long each chirp is: every +1 in SF makes
 * each symbol twice as long, so the receiver can dig the signal out of ~2.5 dB
 * more noise - at the price of half the speed.
 *
 * References
 *  - Semtech SX1276/77/78/79 datasheet rev. 7, Table 10 (sensitivity, 862-1020 MHz band)
 *    and section 4.1.1.2 (required SNR per SF), 4.1.1.7 (time on air).
 *  - Semtech SX1261/2 datasheet rev. 2.1, section 6.1.4 (time on air) and 3.5
 *    (sensitivity; NF ~ 6 dB in boosted-gain RX mode).
 *  - Semtech AN1200.13 "LoRa Modem Designer's Guide" (time-on-air equation).
 */

/** Spreading factors supported by the planner. */
export const SPREADING_FACTORS = [7, 8, 9, 10, 11, 12];

/** Bandwidths supported by the planner (kHz). */
export const BANDWIDTHS_KHZ = [125, 250, 500];

/**
 * Minimum SNR (dB) at which the demodulator still decodes each SF.
 * Note the values are NEGATIVE: LoRa works below the noise floor.
 * Source: SX1276 datasheet Table 13 / SX1262 datasheet Table 6-1.
 */
export const REQUIRED_SNR_DB = {
  6: -5,
  7: -7.5,
  8: -10,
  9: -12.5,
  10: -15,
  11: -17.5,
  12: -20,
};

/**
 * SX1276 measured sensitivity (dBm), HF band (862-1020 MHz), from the
 * datasheet Table 10. Indexed [bandwidth kHz][SF].
 */
export const SX1276_SENSITIVITY_DBM = {
  125: { 7: -123, 8: -126, 9: -129, 10: -132, 11: -133, 12: -136 },
  250: { 7: -120, 8: -123, 9: -125, 10: -128, 11: -130, 12: -133 },
  500: { 7: -116, 8: -119, 9: -122, 10: -125, 11: -128, 12: -130 },
};

/** Receiver noise figure (dB) used for the theoretical sensitivity. */
export const DEFAULT_NOISE_FIGURE_DB = 6;

/**
 * Thermal noise power in the receiver bandwidth.
 *
 *   N = -174 dBm/Hz + 10*log10(BW_Hz) + NF
 *
 * -174 dBm/Hz is the noise every warm (290 K) resistor makes: k*T*1Hz.
 * At 125 kHz and NF = 6 dB that is -117 dBm.
 *
 * @param {number} bandwidthKHz
 * @param {number} [noiseFigureDb=6]
 * @returns {number} noise floor (dBm)
 */
export function noiseFloor(bandwidthKHz, noiseFigureDb = DEFAULT_NOISE_FIGURE_DB) {
  return -174 + 10 * Math.log10(bandwidthKHz * 1000) + noiseFigureDb;
}

/**
 * Receiver sensitivity: the weakest signal (dBm) the chip can still decode.
 *
 *   S = noiseFloor(BW) + requiredSNR(SF)
 *
 * chip = 'sx1262' uses this formula with NF = 6 dB (the SX1262 datasheet
 * values agree with it to within ~1 dB).
 * chip = 'sx1276' uses the measured table from the SX1276 datasheet.
 *
 * @param {number} sf spreading factor 7..12
 * @param {number} bandwidthKHz 125 | 250 | 500
 * @param {'sx1262'|'sx1276'} [chip='sx1262']
 * @returns {number} sensitivity (dBm), e.g. -137 for SF12 / 125 kHz
 */
export function sensitivity(sf, bandwidthKHz, chip = 'sx1262') {
  if (chip === 'sx1276') {
    const row = SX1276_SENSITIVITY_DBM[bandwidthKHz];
    if (row && row[sf] !== undefined) return row[sf];
  }
  const snr = REQUIRED_SNR_DB[sf];
  if (snr === undefined) throw new RangeError(`Unsupported spreading factor ${sf}`);
  return noiseFloor(bandwidthKHz) + snr;
}

/**
 * Should "Low Data Rate Optimisation" be on? The datasheet requires it when
 * one symbol lasts longer than 16 ms (SF11 and SF12 at 125 kHz).
 * @param {number} sf
 * @param {number} bandwidthKHz
 */
export function lowDataRateOptimize(sf, bandwidthKHz) {
  return symbolTime(sf, bandwidthKHz) > 0.016;
}

/**
 * Duration of one LoRa symbol (one chirp).
 *
 *   Tsym = 2^SF / BW
 *
 * @param {number} sf
 * @param {number} bandwidthKHz
 * @returns {number} seconds
 */
export function symbolTime(sf, bandwidthKHz) {
  return 2 ** sf / (bandwidthKHz * 1000);
}

/**
 * Time on air of one packet (Semtech AN1200.13, SX1276 datasheet 4.1.1.7).
 *
 *   Tpreamble = (nPreamble + 4.25) * Tsym
 *   nPayload  = 8 + max( ceil( (8*PL - 4*SF + 28 + 16*CRC - 20*IH)
 *                              / (4*(SF - 2*DE)) ) * (CR + 4), 0 )
 *   ToA       = Tpreamble + nPayload * Tsym
 *
 * PL = payload bytes, CRC = 1 if CRC on, IH = 1 if implicit header,
 * DE = 1 if low data rate optimisation, CR = 1..4 for coding rate 4/5..4/8.
 *
 * @param {object} p
 * @param {number} p.sf spreading factor
 * @param {number} p.bandwidthKHz
 * @param {number} p.payloadBytes
 * @param {number} [p.codingRate=1] 1..4 meaning 4/5..4/8
 * @param {number} [p.preambleSymbols=8]
 * @param {boolean} [p.explicitHeader=true]
 * @param {boolean} [p.crc=true]
 * @param {boolean} [p.lowDataRateOptimize] default: automatic
 * @returns {number} seconds
 */
export function timeOnAir({
  sf,
  bandwidthKHz,
  payloadBytes,
  codingRate = 1,
  preambleSymbols = 8,
  explicitHeader = true,
  crc = true,
  lowDataRateOptimize: de = lowDataRateOptimize(sf, bandwidthKHz),
}) {
  const tSym = symbolTime(sf, bandwidthKHz);
  const tPreamble = (preambleSymbols + 4.25) * tSym;
  const ih = explicitHeader ? 0 : 1;
  const num = 8 * payloadBytes - 4 * sf + 28 + 16 * (crc ? 1 : 0) - 20 * ih;
  const den = 4 * (sf - 2 * (de ? 1 : 0));
  const nPayload = 8 + Math.max(Math.ceil(num / den) * (codingRate + 4), 0);
  return tPreamble + nPayload * tSym;
}

/**
 * Raw bit rate of the LoRa modulation.
 *
 *   Rb = SF * (BW / 2^SF) * 4/(4+CR)
 *
 * @param {number} sf
 * @param {number} bandwidthKHz
 * @param {number} [codingRate=1]
 * @returns {number} bits per second
 */
export function bitRate(sf, bandwidthKHz, codingRate = 1) {
  return (sf * (bandwidthKHz * 1000)) / 2 ** sf * (4 / (4 + codingRate));
}
