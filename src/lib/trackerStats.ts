/** Live session stats, emitted from the Tracker page to the in-game overlay. */
export interface TrackerStats {
  running: boolean;
  elapsed: number;
  loadout: string | null;
  cps: number;
  spend: number;
  loot: number;
  profit: number;
  returnPct: number;
  avgMult: number;
  lastMult: number;
  costPerKill: number;
  lootPerKill: number;
  kills: number;
  shots: number;
}

export const TRACKER_STATS_EVENT = "tracker:stats";
