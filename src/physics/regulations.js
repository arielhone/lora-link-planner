/**
 * regulations.js - default radio settings for Israel.
 *
 * Israel's Ministry of Communications opened 917-920 MHz for LoRa / LoRaWAN
 * (licence-exempt). The LoRa Alliance channel plan for Israel is "AS923-4"
 * (LoRaWAN Regional Parameters RP002-1.0.3+): the AS923 plan shifted by
 * -5.9 MHz, default channels 917.3 and 917.5 MHz, maximum EIRP 14 dBm.
 *
 * See DECISIONS.md ("Frequency band and power for Israel") for sources and
 * caveats. Always check the current regulation before transmitting.
 */
export const ISRAEL_REGULATION = {
  name: 'Israel - AS923-4 (917-920 MHz)',
  minFreqMHz: 917.0,
  maxFreqMHz: 920.0,
  defaultFreqMHz: 917.3,
  /** Maximum radiated power (EIRP) in dBm: 14 dBm = 25 mW. */
  maxEirpDbm: 14,
};

/**
 * Check a configuration against the Israeli limits.
 * @param {{freqMHz:number, eirpDbm:number}} cfg
 * @returns {string[]} human readable warnings (empty = compliant)
 */
export function checkCompliance({ freqMHz, eirpDbm }, reg = ISRAEL_REGULATION) {
  const warnings = [];
  if (freqMHz < reg.minFreqMHz || freqMHz > reg.maxFreqMHz) {
    warnings.push(
      `${freqMHz} MHz is outside the ${reg.minFreqMHz}-${reg.maxFreqMHz} MHz band allowed for LoRa in Israel.`,
    );
  }
  if (eirpDbm > reg.maxEirpDbm + 1e-9) {
    warnings.push(
      `EIRP ${eirpDbm.toFixed(1)} dBm exceeds the ${reg.maxEirpDbm} dBm limit (TX power + antenna gain - cable loss).`,
    );
  }
  return warnings;
}
