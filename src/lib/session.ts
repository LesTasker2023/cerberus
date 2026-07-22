// Hunt-tracker session model. Mirrors the Rust `HuntSession` (camelCase over
// the IPC boundary). Sessions store raw counters only — every displayed stat is
// derived here, so a formula change never invalidates saved history.

/** One looted item's running total within a session. */
export interface SessionLoot {
  qty: number;
  value: number;
  drops: number;
}

export interface HuntSession {
  id: string;
  startedAt: string;
  /** Set once finished; `null` marks the single resumable session. */
  endedAt: string | null;
  /** Accumulated running time in ms — excludes paused and app-closed stretches. */
  elapsedMs: number;
  loadout: string | null;
  /** Cost per shot of the loadout in force right now. */
  cps: number;
  shots: number;
  /**
   * Spend in PED, accumulated shot by shot at the cost/shot active at that
   * moment. Storing the running total (rather than `shots × cps`) is what makes
   * a mid-hunt loadout swap correct — earlier shots keep the price they were
   * actually fired at.
   */
  spend: number;
  kills: number;
  /** Ammo events since the current kill — the kill-inference counter. */
  sinceKill: number;
  /** Spend accumulated toward the in-progress kill. */
  sinceKillSpend: number;
  items: Record<string, SessionLoot>;
  lastKill: Record<string, number>;
  /** What the last kill actually cost. */
  lastKillSpend: number;
  /** Items excluded from loot totals, snapshotted with the session. */
  ignored: string[];
}

export interface SessionStats {
  shots: number;
  kills: number;
  loot: number;
  spend: number;
  profit: number;
  returnPct: number;
  avgMult: number;
  lastMult: number;
  costPerKill: number;
  lootPerKill: number;
  /** Loot excluded by the ignore list — shown so the omission is never hidden. */
  excluded: number;
}

export function emptySession(id: string, loadout: string | null, cps: number): HuntSession {
  return {
    id,
    startedAt: new Date().toISOString(),
    endedAt: null,
    elapsedMs: 0,
    loadout,
    cps,
    shots: 0,
    spend: 0,
    kills: 0,
    sinceKill: 0,
    sinceKillSpend: 0,
    items: {},
    lastKill: {},
    lastKillSpend: 0,
    ignored: [],
  };
}

/** Sum item values, skipping anything excluded. */
function sumLoot(items: Record<string, { value: number }>, ignored: ReadonlySet<string>): number {
  let total = 0;
  for (const [name, row] of Object.entries(items)) {
    if (!ignored.has(name)) total += row.value;
  }
  return total;
}

const ZERO_STATS: SessionStats = {
  shots: 0,
  kills: 0,
  loot: 0,
  spend: 0,
  profit: 0,
  returnPct: 0,
  avgMult: 0,
  lastMult: 0,
  costPerKill: 0,
  lootPerKill: 0,
  excluded: 0,
};

/**
 * Derive every displayed stat from a session's raw counters.
 *
 * Spend needs no cost/shot argument — it was accumulated as the shots happened,
 * which is precisely why a loadout swap can't reprice history.
 */
export function deriveStats(
  session: HuntSession | null,
  ignored: ReadonlySet<string>,
): SessionStats {
  if (!session) return ZERO_STATS;

  const { shots, kills, spend } = session;
  const loot = sumLoot(session.items, ignored);
  const lastKillLoot = sumLoot(
    Object.fromEntries(Object.entries(session.lastKill).map(([n, v]) => [n, { value: v }])),
    ignored,
  );
  let excluded = 0;
  for (const [name, row] of Object.entries(session.items)) {
    if (ignored.has(name)) excluded += row.value;
  }

  return {
    shots,
    kills,
    loot,
    spend,
    profit: loot - spend,
    returnPct: spend > 0 ? (loot / spend) * 100 : 0,
    avgMult: spend > 0 ? loot / spend : 0,
    // Guard the denominator — with no active loadout the kill cost is 0.
    lastMult: session.lastKillSpend > 0 ? lastKillLoot / session.lastKillSpend : 0,
    costPerKill: kills > 0 ? spend / kills : 0,
    lootPerKill: kills > 0 ? loot / kills : 0,
    excluded,
  };
}

/** The exclusions a saved session was recorded with. */
export function sessionIgnored(session: HuntSession | null): ReadonlySet<string> {
  return new Set(session?.ignored ?? []);
}

/** Items excluded from loot totals — the live user preference. */
const IGNORE_KEY = "cerberus-tracker-ignored";

export function loadIgnored(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(IGNORE_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? (raw as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveIgnored(names: ReadonlySet<string>): void {
  localStorage.setItem(IGNORE_KEY, JSON.stringify([...names]));
}
