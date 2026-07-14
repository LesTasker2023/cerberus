/**
 * Rock Scanner — a chrome-less transparent viewfinder. Position it over the
 * asteroid scan panel; the rock logger OCRs whatever screen pixels fall inside
 * the frame. Drag anywhere to move. Shown/hidden from the dock (Rock cluster).
 */
export function CaptureRegion() {
  return <div className="capbox" data-tauri-drag-region />;
}
