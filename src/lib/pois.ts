import type { Encounter } from "../hooks/useEncounters";
import type { Poi } from "../hooks/usePois";

/** A marker as the 3D map consumes it — the merged shape of everything drawn. */
export interface MapPoi {
  id: string;
  name: string;
  category: string;
  euX: number;
  euY: number;
  euZ: number;
  pvpLootable: boolean;
  /** True = user-logged detailed rock; false = context/anchor. */
  logged: boolean;
  /** Which store owns this marker — decides where edits and deletes go. */
  source: "poi" | "rock" | "mob";
}

/**
 * Build the map's marker list from the POI store plus logged mob encounters.
 * Mob encounters plot at the position captured when the fight started.
 *
 * This used to merge four sources — a static `howlingMine.json` import, the POI
 * store, a separate asteroid store and encounters — which is why some markers
 * drew on the map but were missing from the editor and impossible to change.
 * Markers now live in one store (see `poi.rs`); encounters are the only other
 * input, and `source` tells the UI which store owns each row.
 */
export function combinePois(storePois: Poi[], mobs: Encounter[] = []): MapPoi[] {
  const managed: MapPoi[] = storePois.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    euX: p.eu_x,
    euY: p.eu_y,
    euZ: p.eu_z,
    pvpLootable: p.pvp_lootable,
    // A rock scanned in-game vs a marker placed by hand — the same store now,
    // told apart by whether it carries a log time.
    logged: p.logged_at != null,
    source: "poi",
  }));
  const mobPois: MapPoi[] = mobs
    .filter((m) => m.eu_x != null && m.eu_y != null && m.eu_z != null)
    .map((m) => ({
      id: `mob-${m.id}`,
      name: m.name || "Mob",
      category: "mob",
      euX: m.eu_x as number,
      euY: m.eu_y as number,
      euZ: m.eu_z as number,
      pvpLootable: false,
      logged: false,
      source: "mob",
    }));
  return [...managed, ...mobPois];
}
