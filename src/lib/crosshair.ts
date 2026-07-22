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
  /** Range-offset (belly-gun parallax) — when on, the vertical offset is
   *  computed as k·(1/range − 1/rMax) on top of offsetY. */
  rangeMode: boolean;
  k: number; // calibration constant (px · range-units)
  rMax: number; // convergence range — offset is zero here
  range: number; // current target range (the range finder writes this)
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
  rangeMode: false,
  k: 0,
  rMax: 100,
  range: 0,
};

/** The parallax vertical offset (px) for the current range, or 0 when off. */
export function rangeOffset(cfg: CrosshairConfig): number {
  if (!cfg.rangeMode || cfg.range <= 0 || cfg.rMax <= 0) return 0;
  return cfg.k * (1 / cfg.range - 1 / cfg.rMax);
}

/** Solve the calibration constant from one known (range, offset) point. */
export function solveK(range: number, offset: number, rMax: number): number {
  const denom = 1 / range - 1 / rMax;
  return denom !== 0 ? offset / denom : 0;
}

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
