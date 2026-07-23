// Chat triggers — watch the live tail for terms and raise an alert.
//
// Matching is deliberately dumb: case-insensitive substring, any term hits.
// No regex, no word boundaries — a trigger you can't predict is a trigger you
// stop trusting. Terms match against the speaker and the message body.

const TRIGGERS_KEY = "cerberus.triggers";
const ALERTS_KEY = "cerberus.alerts";

/** Keep the alert history bounded. */
export const MAX_ALERTS = 300;

export interface Trigger {
  id: string;
  name: string;
  /** Any term matching raises the alert. Case-insensitive substrings. */
  terms: string[];
  /** Channels to watch — empty means every channel. */
  channels: string[];
  enabled: boolean;
}

/** A line that fired a trigger. */
export interface Alert {
  id: string;
  triggerId: string;
  triggerName: string;
  /** Log timestamp of the matched line. */
  at: string;
  channel: string | null;
  speaker: string | null;
  text: string;
  /** Which term actually hit — shown so a noisy trigger is easy to diagnose. */
  term: string;
}

/** Fired to the overlay window when a trigger hits. */
export const ALERT_EVENT = "chat:alert";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadTriggers(): Trigger[] {
  const v = readJson<Trigger[]>(TRIGGERS_KEY, []);
  if (!Array.isArray(v)) return [];
  return v.filter(
    (t): t is Trigger =>
      !!t && typeof t.id === "string" && Array.isArray(t.terms) && Array.isArray(t.channels),
  );
}

export function saveTriggers(list: readonly Trigger[]): void {
  localStorage.setItem(TRIGGERS_KEY, JSON.stringify(list));
}

export function loadAlerts(): Alert[] {
  const v = readJson<Alert[]>(ALERTS_KEY, []);
  return Array.isArray(v) ? v : [];
}

export function saveAlerts(list: readonly Alert[]): void {
  localStorage.setItem(ALERTS_KEY, JSON.stringify(list.slice(0, MAX_ALERTS)));
}

export function newTriggerId(): string {
  return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : String(Date.now());
}

/**
 * Which term of `t` matches this line, if any.
 * Returns the matched term so the alert can show what actually fired.
 */
export function matchTrigger(
  t: Trigger,
  channel: string | null,
  speaker: string | null,
  text: string,
): string | null {
  if (!t.enabled || t.terms.length === 0) return null;
  if (t.channels.length > 0) {
    const c = (channel ?? "").toLowerCase();
    if (!t.channels.some((x) => x.toLowerCase() === c)) return null;
  }
  const hay = `${speaker ?? ""} ${text}`.toLowerCase();
  for (const term of t.terms) {
    const needle = term.trim().toLowerCase();
    if (needle && hay.includes(needle)) return term;
  }
  return null;
}

/** Split a comma/newline separated term list into clean terms. */
export function parseTerms(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
