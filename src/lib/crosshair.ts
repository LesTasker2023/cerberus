import { emit } from "@tauri-apps/api/event";

/** Drawn-crosshair config. `offsetX/Y` shift it from screen centre — the range
 *  finder drives these to compensate for the belly-gun convergence. */
export interface CrosshairConfig {
  offsetX: number;
  offsetY: number;
  size: number;
  gap: number;
  thickness: number;
  color: string;
  dot: boolean;
  /** Ranging ring — fit the target inside it to read range. */
  ring: boolean;
  ringRadius: number;
}

export const DEFAULT_CROSSHAIR: CrosshairConfig = {
  offsetX: 0,
  offsetY: 0,
  size: 24,
  gap: 6,
  thickness: 2,
  color: "#ff3b30",
  dot: true,
  ring: true,
  ringRadius: 44,
};

const KEY = "cerberus.crosshair";

export function loadCrosshair(): CrosshairConfig {
  try {
    const s = localStorage.getItem(KEY);
    return s ? { ...DEFAULT_CROSSHAIR, ...(JSON.parse(s) as Partial<CrosshairConfig>) } : { ...DEFAULT_CROSSHAIR };
  } catch {
    return { ...DEFAULT_CROSSHAIR };
  }
}

/** Persist + broadcast to the crosshair overlay window (all windows listen). */
export function saveCrosshair(cfg: CrosshairConfig): void {
  localStorage.setItem(KEY, JSON.stringify(cfg));
  emit("crosshair:changed", cfg).catch(() => {});
}
