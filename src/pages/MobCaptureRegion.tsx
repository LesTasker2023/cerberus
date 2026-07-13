import { invoke } from "@tauri-apps/api/core";

/**
 * Transparent viewfinder for the mob target-name panel. Positioned once over the
 * creature name (e.g. "L30 Dymlek Provider"); the combat tracker OCRs this spot
 * automatically at the start of each encounter.
 */
export function MobCaptureRegion() {
  return (
    <div className="capbox" data-tauri-drag-region>
      <div className="capbox__bar" data-tauri-drag-region>
        <span className="capbox__tag">MOB OCR</span>
        <button
          className="capbox__hide"
          onClick={() => invoke("hide_window", { label: "mobcap" })}
          aria-label="Hide"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
