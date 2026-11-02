/**
 * linkBudget.js - the "bank account" of a radio link.
 *
 * Start with the transmitter's power (deposit), add antenna gains (bonuses),
 * subtract every loss (expenses): cables, distance, hills. What is left is
 * the received power. Compare it with the receiver's sensitivity (the
 * minimum balance the bank allows). The difference is the LINK MARGIN.
 *
 *   EIRP   = Ptx + Gtx - Lcable_tx
 *   Prx    = EIRP - FSPL - Lobstruction - Lclutter + Grx - Lcable_rx
 *   margin = Prx - sensitivity
 *
 * All values in dB / dBm, so everything is simple addition and subtraction.
 */

/** Margin (dB) at or above which we call the link reliable. */
export const MARGIN_GOOD_DB = 10;
/** Margin (dB) at or above which the link should work, but not reliably. */
export const MARGIN_MARGINAL_DB = 0;

/**
 * Effective isotropic radiated power.
 * @param {number} txPowerDbm radio output power
 * @param {number} txGainDbi antenna gain
 * @param {number} txCableLossDb loss in cable and connectors
 * @returns {number} dBm
 */
export function eirp(txPowerDbm, txGainDbi, txCableLossDb) {
  return txPowerDbm + txGainDbi - txCableLossDb;
}

/**
 * Turn a margin into a verdict.
 *
 *  - 'works'    margin >= 10 dB : enough reserve for fading, rain, people walking by
 *  - 'marginal' 0 <= margin < 10 dB : will probably work some of the time
 *  - 'fails'    margin < 0 dB : the signal is weaker than the receiver can hear
 *
 * @param {number} marginDb
 * @returns {'works'|'marginal'|'fails'}
 */
export function verdict(marginDb) {
  if (marginDb >= MARGIN_GOOD_DB) return 'works';
  if (marginDb >= MARGIN_MARGINAL_DB) return 'marginal';
  return 'fails';
}

/**
 * Full link budget.
 *
 * @param {object} p
 * @param {number} p.txPowerDbm
 * @param {number} p.txGainDbi
 * @param {number} p.rxGainDbi
 * @param {number} p.txCableLossDb
 * @param {number} p.rxCableLossDb
 * @param {number} p.pathLossDb free-space path loss
 * @param {number} p.obstructionLossDb diffraction loss from terrain
 * @param {number} [p.clutterLossDb=0] extra loss from buildings/trees (environment)
 * @param {number} p.sensitivityDbm receiver sensitivity
 * @param {number} [p.noiseFloorDbm] receiver noise floor, to estimate SNR
 * @returns {{eirpDbm:number, rxPowerDbm:number, marginDb:number, snrDb:number|null,
 *            verdict:'works'|'marginal'|'fails', lines:{label:string, value:number}[]}}
 */
export function linkBudget({
  txPowerDbm,
  txGainDbi,
  rxGainDbi,
  txCableLossDb,
  rxCableLossDb,
  pathLossDb,
  obstructionLossDb,
  clutterLossDb = 0,
  sensitivityDbm,
  noiseFloorDbm,
}) {
  const e = eirp(txPowerDbm, txGainDbi, txCableLossDb);
  const rx = e - pathLossDb - obstructionLossDb - clutterLossDb + rxGainDbi - rxCableLossDb;
  const margin = rx - sensitivityDbm;
  return {
    eirpDbm: e,
    rxPowerDbm: rx,
    marginDb: margin,
    snrDb: noiseFloorDbm === undefined ? null : rx - noiseFloorDbm,
    verdict: verdict(margin),
    // The "bank statement", in order, for display.
    // `key` is a stable id for translations, `label` the English text.
    lines: [
      { key: 'txPower', label: 'TX power', value: txPowerDbm },
      { key: 'txGain', label: 'TX antenna gain', value: +txGainDbi },
      { key: 'txCable', label: 'TX cable loss', value: -txCableLossDb },
      { key: 'fspl', label: 'Free-space path loss', value: -pathLossDb },
      { key: 'obstruction', label: 'Obstruction loss', value: -obstructionLossDb },
      { key: 'clutter', label: 'Environment (clutter) loss', value: -clutterLossDb },
      { key: 'rxGain', label: 'RX antenna gain', value: +rxGainDbi },
      { key: 'rxCable', label: 'RX cable loss', value: -rxCableLossDb },
    ],
  };
}
