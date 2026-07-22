/** Work-in-progress features, hidden from the UI until they're ready.
 *
 *  Flip a flag to `true` to bring one back — every nav item, dock button and
 *  Config control reads from here, so there's one switch per feature and no
 *  half-hidden entry points left behind.
 */
export const FEATURES: { mobLogger: boolean; rangeCalibrator: boolean } = {
  /** Mob Logger — encounter grouping, target-panel OCR, Observations feed. */
  mobLogger: false,
  /** Range calibrator — distance-based reticle offset. */
  rangeCalibrator: false,
};
