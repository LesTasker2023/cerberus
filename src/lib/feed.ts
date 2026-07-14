//! Pure parsing helpers over the chat.log stream — channel classification and
//! extraction of the piracy-relevant signals (space-mining targets, warp
//! chatter, ship movements). No React, no I/O.

import type { LogLine } from "../hooks/useLogWatch";

/** Decode the HTML entities EntropiaCentral / the game feed use in names. */
export function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?34;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** "YYYY-MM-DD HH:MM:SS" → epoch ms (local). */
export function tsOf(at: string): number {
  const m = at.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return Date.now();
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

/** HH:MM:SS out of a full stamp. */
export function clock(at: string): string {
  const m = at.match(/\d{2}:\d{2}:\d{2}/);
  return m ? m[0] : at;
}

export type Bucket =
  | "global"
  | "trade"
  | "space"
  | "ship"
  | "team"
  | "system"
  | "local"
  | "rookie"
  | "other";

/** Route a raw channel token to a feed bucket. */
export function channelBucket(channel: string | null): Bucket {
  const c = (channel ?? "").toLowerCase();
  if (c.includes("global") || c.includes("hall")) return "global";
  if (c.includes("trade")) return "trade";
  if (c.includes("space_travel") || c.includes("space_flight") || c === "#space") return "space";
  if (c.includes("repair") || c.includes("ventureship") || c.includes("varyag")) return "ship";
  if (c.includes("team") || c.includes("society") || c === "#disi") return "team";
  if (c.includes("system")) return "system";
  if (c.includes("local")) return "local";
  if (c.includes("rookie")) return "rookie";
  return "other";
}

/* ── Space-mining targets ── */

// Space-only resources: asteroid types + the ores/materials mined in space.
const SPACE_RES = /asteroid|lysterium|caldorite|narcanisum|niksarium|energized|zinc|dianum|petonium/i;
const DEPOSIT = /^(.+?) found a deposit \((.+?)\) with a value of (\d+) PED/;

export interface MinerHit {
  ts: number;
  player: string;
  resource: string;
  value: number;
}

/** Whether a resource / message looks like space mining (asteroid + space ores). */
export function isSpaceResource(text: string): boolean {
  return SPACE_RES.test(text);
}

/** Parse a Globals line into a space-miner hit, or null if it isn't one. */
export function parseDeposit(line: LogLine): MinerHit | null {
  if (channelBucket(line.channel) !== "global") return null;
  const m = DEPOSIT.exec(line.text);
  if (!m) return null;
  const resource = decode(m[2]);
  if (!SPACE_RES.test(resource)) return null;
  const player = decode(m[1]);
  if (/^Team\s*"/.test(player)) return null; // anonymised shared-loot team — not gankable
  return { ts: tsOf(line.at), player, resource, value: parseInt(m[3], 10) };
}

/** "M-type Asteroid XVIII" → "M"; otherwise the leading word. */
export function resourceKind(res: string): string {
  const m = res.match(/^([A-Za-z]+)-type Asteroid/);
  return m ? m[1].toUpperCase() : res.split(" ")[0];
}

/* ── Warp chatter ── */

export type WarpKind = "offer" | "request" | "pirate" | "info";

export function warpKind(text: string): WarpKind {
  const t = text.toLowerCase();
  if (/pirate|attention|safe to travel|gank|caught|blockade|camp(ing|ed)?\b/.test(t)) return "pirate";
  if (/\b(lf|looking for|need|want|anyone got)\b.*\b(warp|flight|ride|lift|taxi)\b|\bwarp\b.*\bfrom\b/.test(t))
    return "request";
  if (/offer|service|express|airlines|taxi|delivery|\bwarps\b|privateer|mothership/.test(t)) return "offer";
  return "info";
}

/** Highlight the planet/route hops mentioned, for a quick glance. */
const PLANETS =
  /\b(calypso|caly|arkadia|ark|rocktropia|rt|cyrene|toulan|monria|next island|ni|foma|hell)\b/gi;
export function planetsIn(text: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  PLANETS.lastIndex = 0;
  while ((m = PLANETS.exec(text))) out.add(m[0].toLowerCase());
  return [...out];
}
