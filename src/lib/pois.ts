import howlingMine from "../data/howlingMine.json";
import type { MapPoi } from "../components/MapDetail";
import type { Asteroid } from "../hooks/useAsteroids";
import type { Poi } from "../hooks/usePois";

const HM = howlingMine as Omit<MapPoi, "id" | "logged">[];

/**
 * Merge the static Howling Mine context, the editable POI store (stations /
 * gates / landmarks), and the live logged rocks into one map POI list.
 */
export function combinePois(items: Asteroid[], storePois: Poi[]): MapPoi[] {
  const hm: MapPoi[] = HM.map((p, i) => ({ ...p, id: `hm-${i}`, logged: false }));
  const managed: MapPoi[] = storePois.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    euX: p.eu_x,
    euY: p.eu_y,
    euZ: p.eu_z,
    pvpLootable: p.pvp_lootable,
    logged: false,
  }));
  const logged: MapPoi[] = items.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    euX: a.eu_x,
    euY: a.eu_y,
    euZ: a.eu_z,
    pvpLootable: a.pvp_lootable,
    logged: true,
  }));
  return [...hm, ...managed, ...logged];
}
