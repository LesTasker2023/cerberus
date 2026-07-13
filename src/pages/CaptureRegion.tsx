import { invoke } from "@tauri-apps/api/core";

/**
 * Transparent viewfinder window. Drag the body to move, drag the edges to
 * resize, then OCR reads whatever screen pixels fall inside the frame.
 */
export function CaptureRegion() {
  return (
    <div className="capbox" data-tauri-drag-region>
      <div className="capbox__bar" data-tauri-drag-region>
        <span className="capbox__tag">OCR CAPTURE</span>
        <button
          className="capbox__hide"
          onClick={() => invoke("hide_window", { label: "capregion" })}
          aria-label="Hide"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
