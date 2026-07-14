import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isSpaceResource } from "../lib/feed";

/** A universe-wide global hit, pushed live from EntropiaCentral's SignalR hub. */
export interface Global {
  id: number;
  ts: number;
  avatar: string;
  value: number;
  /** "Hunting" | "Mining" | "Crafting" | … */
  kind: string;
  /** Creature killed or resource mined. */
  subject: string;
  area: string;
  instance: string;
  /** Heuristic: this hit is space mining (asteroid / space ore). */
  space: boolean;
  text: string;
}

/** A live trade-channel message (WTB / WTS chatter) from EC. */
export interface Trade {
  id: number;
  ts: number;
  channel: string;
  author: string;
  content: string;
}

interface RawGlobal {
  avatarName?: string;
  globalValue?: number;
  type?: string;
  creatureName?: string;
  landareaName?: string;
  instanceName?: string;
  strippedMessage?: string;
  fullMessage?: string;
  dateTime?: string;
}
interface RawTrade {
  id?: number;
  channel?: string;
  author?: string;
  content?: string;
  dateTime?: string;
}

const GLOBAL_CAP = 250;
const TRADE_CAP = 150;

function parseTs(s?: string): number {
  if (!s) return Date.now();
  const t = Date.parse(s);
  return Number.isNaN(t) ? Date.now() : t;
}

/**
 * Streams EntropiaCentral's live SignalR feeds into two rolling buffers — the
 * whole universe's globals and trade chatter. Server-pushed, so it runs even
 * when the local chat.log watcher / the game is offline. Hoisted in App so the
 * buffers survive page navigation.
 */
export function useEcIntel() {
  const [globals, setGlobals] = useState<Global[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const ung = listen<RawGlobal>("ec:global", (e) => {
      const r = e.payload;
      const subject = (r.creatureName ?? "").trim();
      const g: Global = {
        id: idRef.current++,
        ts: parseTs(r.dateTime),
        avatar: (r.avatarName ?? "").trim() || "Unknown",
        value: Math.round(r.globalValue ?? 0),
        kind: (r.type ?? "").trim(),
        subject,
        area: (r.landareaName ?? "").trim(),
        instance: (r.instanceName ?? "").trim(),
        space: isSpaceResource(subject) || isSpaceResource(r.strippedMessage ?? ""),
        text: (r.strippedMessage || r.fullMessage || "").trim(),
      };
      setGlobals((prev) => [g, ...prev].slice(0, GLOBAL_CAP));
    });

    const unt = listen<RawTrade>("ec:trade", (e) => {
      const r = e.payload;
      const t: Trade = {
        id: idRef.current++,
        ts: parseTs(r.dateTime),
        channel: (r.channel ?? "").replace(/^#/, ""),
        author: (r.author ?? "").trim(),
        content: (r.content ?? "").trim(),
      };
      setTrades((prev) => [t, ...prev].slice(0, TRADE_CAP));
    });

    return () => {
      ung.then((off) => off());
      unt.then((off) => off());
    };
  }, []);

  return { globals, trades };
}
