import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export interface PlayerPos {
  x: number;
  y: number;
  z: number;
  at: string;
}

interface Line {
  channel: string | null;
  text: string;
  raw: string;
  at: string;
}

/** Pull an [..., x, y, z, ...] triple out of a System position line. */
function coordsFrom(line: Line): { x: number; y: number; z: number } | null {
  if ((line.channel ?? "").toLowerCase() !== "system") return null;
  let rest = line.text || line.raw;
  while (true) {
    const open = rest.indexOf("[");
    if (open < 0) break;
    const close = rest.indexOf("]", open);
    if (close < 0) break;
    const nums = rest
      .slice(open + 1, close)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^-?\d+$/.test(s))
      .map(Number);
    if (nums.length >= 3) return { x: nums[0], y: nums[1], z: nums[2] };
    rest = rest.slice(close + 1);
  }
  return null;
}

const KEY = "cerberus.playerPos";

/**
 * The player's last-known location — updated whenever a System position line
 * lands in the log (from a manual `<` or a logger capture). Persisted so the
 * marker survives restarts.
 */
export function usePlayerPosition(): PlayerPos | null {
  const [pos, setPos] = useState<PlayerPos | null>(() => {
    try {
      const s = localStorage.getItem(KEY);
      return s ? (JSON.parse(s) as PlayerPos) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const un = listen<Line>("log:line", (e) => {
      const c = coordsFrom(e.payload);
      if (!c) return;
      const next = { ...c, at: e.payload.at };
      setPos(next);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    });
    return () => {
      un.then((off) => off());
    };
  }, []);

  return pos;
}
