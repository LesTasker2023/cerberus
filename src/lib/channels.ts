// Chat channel registry + user-defined feed tabs.
//
// The registry is the answer to "which channels does this user actually have?"
// It is built once (optionally seeded by a full log scan) and then maintained
// incrementally from the live tail — every line carrying a new channel adds it.
// That is why no launch needs to re-read the whole chat.log.

const CHANNELS_KEY = "cerberus.channels";
const TABS_KEY = "cerberus.chatTabs";
const COLORS_KEY = "cerberus.channelColors";

/** Size of the channel palette (see `.chanc-*` in styles.css). */
export const PALETTE_SIZE = 12;

/** A user-defined feed tab: a named set of channels to show. */
export interface ChatTab {
  id: string;
  name: string;
  /** Channel names, matched case-insensitively. */
  channels: string[];
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** System noise is never a chat channel the user can subscribe to. */
export function isSystemChannel(name: string | null | undefined): boolean {
  return !name || name.toLowerCase() === "system";
}

/* ── known channels ── */

export function loadChannels(): string[] {
  const v = readJson<string[]>(CHANNELS_KEY, []);
  return Array.isArray(v) ? v : [];
}

export function saveChannels(names: readonly string[]): void {
  localStorage.setItem(CHANNELS_KEY, JSON.stringify([...names]));
}

/**
 * Fold newly-seen channel names into the known set.
 * Returns the same array reference when nothing is new, so callers can bail out
 * of a state update cheaply.
 */
export function mergeChannels(known: readonly string[], seen: Iterable<string | null>): string[] {
  const set = new Set(known);
  let changed = false;
  for (const name of seen) {
    if (isSystemChannel(name)) continue;
    const n = name as string;
    if (!set.has(n)) {
      set.add(n);
      changed = true;
    }
  }
  if (!changed) return known as string[];
  return [...set].sort((a, b) => a.localeCompare(b));
}

/* ── tabs ── */

export function loadTabs(): ChatTab[] {
  const v = readJson<ChatTab[]>(TABS_KEY, []);
  if (!Array.isArray(v)) return [];
  // Tolerate hand-edited or older shapes.
  return v.filter(
    (t): t is ChatTab =>
      !!t && typeof t.id === "string" && typeof t.name === "string" && Array.isArray(t.channels),
  );
}

export function saveTabs(tabs: readonly ChatTab[]): void {
  localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
}

export function newTabId(): string {
  return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : String(Date.now());
}

/* ── colours ── */

/**
 * Stable palette slot for a channel name.
 *
 * Derived by hashing the name so a channel keeps the same colour across
 * launches and machines with no stored state — the override map only has to
 * hold the ones you deliberately changed.
 */
function hashSlot(name: string): number {
  let h = 5381;
  const s = name.toLowerCase();
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h % PALETTE_SIZE;
}

export function loadChannelColors(): Record<string, number> {
  const v = readJson<Record<string, number>>(COLORS_KEY, {});
  return v && typeof v === "object" ? v : {};
}

export function saveChannelColors(map: Record<string, number>): void {
  localStorage.setItem(COLORS_KEY, JSON.stringify(map));
}

/** Palette slot for a channel: the user's override, else its hashed default. */
export function channelSlot(
  name: string | null | undefined,
  overrides: Record<string, number>,
): number {
  if (!name) return 0;
  const key = name.toLowerCase();
  const o = overrides[key];
  return typeof o === "number" ? ((o % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE : hashSlot(name);
}

/** Advance a channel to the next palette slot, returning the new override map. */
export function cycleChannelColor(
  name: string,
  overrides: Record<string, number>,
): Record<string, number> {
  const next = { ...overrides, [name.toLowerCase()]: (channelSlot(name, overrides) + 1) % PALETTE_SIZE };
  saveChannelColors(next);
  return next;
}

/** Does a line's channel belong to this tab? Case-insensitive. */
export function tabMatches(tab: ChatTab, channel: string | null): boolean {
  if (!channel) return false;
  const c = channel.toLowerCase();
  return tab.channels.some((x) => x.toLowerCase() === c);
}
