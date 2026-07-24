import { invoke } from "@tauri-apps/api/core";

/** Framing overlay for the EM assist — drag/resize this over the in-game
 *  minimap circle. Its inscribed circle (centre + radius) becomes the area the
 *  blip scan reads. A circular guide makes the fit obvious. */
export function EmRegion() {
  return (
    <div className="emregion" data-tauri-drag-region>
      <div className="emregion__ring" />
      <div className="emregion__cross" />
      <button
        className="emregion__done"
        onClick={() => invoke("hide_window", { label: "emregion" }).catch(() => {})}
        title="Done framing"
      >
        ✓
      </button>
    </div>
  );
}
