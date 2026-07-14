import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { LogLine } from "./useLogWatch";
import { parseDeposit, channelBucket, warpKind, tsOf, type WarpKind } from "../lib/feed";

/** A tracked space miner — a live gank target built from the global feed. */
export interface Target {
  player: string;
  count: number;
  total: number;
  lastValue: number;
  lastResource: string;
  lastSeen: number;
  /** Recent hit timestamps (last few minutes) — powers the burst/ACTIVE flag. */
  recent: number[];
}

export interface WarpMsg {
  id: number;
  at: string;
  ts: number;
  speaker: string;
  text: string;
  kind: WarpKind;
}

export interface ShipMsg {
  id: number;
  at: string;
  ts: number;
  speaker: string;
  text: string;
}

const TARGET_TTL = 20 * 60 * 1000; // drop a miner after 20 min idle
const TARGET_CAP = 150;
const BURST_WINDOW = 3 * 60 * 1000; // recent-hit window
const MSG_CAP = 150;

/**
 * Accumulates piracy intel from the live `log:line` stream: a ranked board of
 * active space miners (targets), plus warp and ship-movement chatter. Kept in a
 * hoisted hook so it survives page navigation.
 */
export function useFeedIntel() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [warps, setWarps] = useState<WarpMsg[]>([]);
  const [ships, setShips] = useState<ShipMsg[]>([]);
  const mapRef = useRef(new Map<string, Target>());
  const idRef = useRef(0);

  useEffect(() => {
    const un = listen<LogLine>("log:line", (e) => {
      const line = e.payload;

      // Space-mining target board.
      const hit = parseDeposit(line);
      if (hit) {
        const m = mapRef.current;
        const t =
          m.get(hit.player) ??
          { player: hit.player, count: 0, total: 0, lastValue: 0, lastResource: "", lastSeen: 0, recent: [] };
        t.count += 1;
        t.total += hit.value;
        t.lastValue = hit.value;
        t.lastResource = hit.resource;
        t.lastSeen = hit.ts;
        t.recent = [...t.recent, hit.ts].filter((x) => hit.ts - x < BURST_WINDOW).slice(-10);
        m.set(hit.player, t);
        for (const [k, v] of m) if (hit.ts - v.lastSeen > TARGET_TTL) m.delete(k);
        if (m.size > TARGET_CAP) {
          const oldest = [...m.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
          for (let i = 0; i < m.size - TARGET_CAP; i++) m.delete(oldest[i][0]);
        }
        setTargets([...m.values()].sort((a, b) => b.lastSeen - a.lastSeen));
      }

      // Warp + ship chatter.
      const bucket = channelBucket(line.channel);
      if (bucket === "space" && line.text) {
        const msg: WarpMsg = {
          id: idRef.current++,
          at: line.at,
          ts: tsOf(line.at),
          speaker: line.speaker ?? "",
          text: line.text,
          kind: warpKind(line.text),
        };
        setWarps((prev) => [msg, ...prev].slice(0, MSG_CAP));
      } else if (bucket === "ship" && line.text) {
        const msg: ShipMsg = {
          id: idRef.current++,
          at: line.at,
          ts: tsOf(line.at),
          speaker: line.speaker ?? "",
          text: line.text,
        };
        setShips((prev) => [msg, ...prev].slice(0, MSG_CAP));
      }
    });
    return () => {
      un.then((off) => off());
    };
  }, []);

  return { targets, warps, ships };
}
