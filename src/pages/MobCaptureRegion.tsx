/**
 * Mob Scanner — a chrome-less transparent viewfinder over the creature
 * name/level/maturity panel; the combat tracker OCRs it at the start of each
 * encounter. Drag anywhere to move. Shown/hidden from the dock (Mob cluster).
 * Orange frame distinguishes it from the red rock Scanner.
 */
export function MobCaptureRegion() {
  return <div className="capbox capbox--mob" data-tauri-drag-region />;
}
