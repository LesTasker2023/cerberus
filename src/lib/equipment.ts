import type { NexusItem } from "./codex/types";
import type { Equipment } from "./loadout";

/** Map a Nexus item to a loadout Equipment — the SAME conversion Artemis-Tracker
 *  uses (Decay is PEC → ÷100 for PED; ammoBurn stays raw). */
export function nexusToEquipment(item: NexusItem, name: string): Equipment {
  const econ = (item.Properties?.Economy ?? {}) as {
    Decay?: number | null;
    AmmoBurn?: number | null;
    Efficiency?: number | null;
    MaxTT?: number | null;
    MinTT?: number | null;
    Absorption?: number | null;
  };
  const d = item.Properties?.Damage;
  return {
    name,
    economy: {
      decay: (econ.Decay ?? 0) / 100, // PEC → PED at source
      ammoBurn: econ.AmmoBurn ?? 0,
      efficiency: econ.Efficiency ?? undefined,
      absorption: econ.Absorption ?? undefined,
    },
    damage: d
      ? {
          stab: d.Stab ?? 0,
          cut: d.Cut ?? 0,
          impact: d.Impact ?? 0,
          penetration: d.Penetration ?? 0,
          shrapnel: d.Shrapnel ?? 0,
          burn: d.Burn ?? 0,
          cold: d.Cold ?? 0,
          acid: d.Acid ?? 0,
          electric: d.Electric ?? 0,
        }
      : undefined,
    range: item.Properties?.Range ?? undefined,
    usesPerMinute: item.Properties?.UsesPerMinute ?? undefined,
    maxTT: econ.MaxTT ?? undefined,
    minTT: econ.MinTT ?? undefined,
  };
}
