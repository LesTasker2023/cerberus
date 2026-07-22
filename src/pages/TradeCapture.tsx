/**
 * Trade Capture — a chrome-less transparent viewfinder. Position it over the
 * in-game trade window; the Trade tool OCRs whatever screen pixels fall inside
 * the frame. Drag anywhere to move, edges resize. Shown/hidden from the Trade page.
 */
export function TradeCapture() {
  // No text inside the frame — it would land in the OCR grab. Just the border.
  return <div className="tradebox" data-tauri-drag-region />;
}
