// EM assist configuration. Every game-specific number lives here, persisted to
// localStorage and merged with the framed minimap geometry before arming.

/** Set-1 scancodes for the keys the loop drives. */
export const SC = {
  F: 0x21,
  W: 0x11,
  A: 0x1e,
  S: 0x1f,
  D: 0x20,
  Z: 0x2c,
  C: 0x2e,
} as const;

export interface EmTuning {
  /** Weapon range as a fraction (0..1) of the radar radius — "2 rings". */
  rangeFrac: number;
  /** Blip colour test: red ≥ redMin, green & blue ≤ otherMax. */
  redMin: number;
  otherMax: number;
  /** Which scancode turns the view left / right (Z/C, swappable). */
  turnLeft: number;
  turnRight: number;
  forward: number;
  engage: number;
  /** Timings, ms. */
  turnTap: number;
  forwardTap: number;
  settle: number;
  /** A blip within this many degrees of straight-up counts as "ahead". */
  aimTolDeg: number;
  /** Hard stop after this many seconds regardless. */
  maxSeconds: number;
}

/** Minimap circle in physical screen px, from the framing overlay. */
export interface EmRegion {
  cx: number;
  cy: number;
  radius: number;
}

/** What the Rust `em_start` command expects (tuning + geometry, flat). */
export type EmConfig = EmTuning & EmRegion;

export const DEFAULT_TUNING: EmTuning = {
  rangeFrac: 0.5,
  redMin: 150,
  otherMax: 80,
  turnLeft: SC.Z,
  turnRight: SC.C,
  forward: SC.W,
  engage: SC.F,
  turnTap: 90,
  forwardTap: 260,
  settle: 650,
  aimTolDeg: 12,
  maxSeconds: 180,
};

const KEY = "cerberus.emTuning";
const REGION_KEY = "cerberus.emRegion";

export function loadTuning(): EmTuning {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_TUNING };
    return { ...DEFAULT_TUNING, ...(JSON.parse(raw) as Partial<EmTuning>) };
  } catch {
    return { ...DEFAULT_TUNING };
  }
}

export function saveTuning(t: EmTuning): void {
  localStorage.setItem(KEY, JSON.stringify(t));
}

export function loadRegion(): EmRegion | null {
  try {
    const raw = localStorage.getItem(REGION_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as EmRegion;
    return r && r.radius > 0 ? r : null;
  } catch {
    return null;
  }
}

export function saveRegion(r: EmRegion): void {
  localStorage.setItem(REGION_KEY, JSON.stringify(r));
}

/** The full config to arm with, or null if the minimap hasn't been framed. */
export function readEmConfig(): EmConfig | null {
  const r = loadRegion();
  if (!r) return null;
  return { ...loadTuning(), ...r };
}
