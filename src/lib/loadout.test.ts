import { describe, it, expect } from "vitest";
import * as C from "./loadout";
// Artemis-Tracker's original core, from the sibling repo — the source of truth.
import * as A from "../../../Artemis-Tracker/src/core/loadout";
import type { Loadout, Equipment } from "./loadout";

// ── Fixture builders ──────────────────────────────────────────────────────

const dmg = (total: number) => ({
  stab: total,
  cut: 0,
  impact: 0,
  penetration: 0,
  shrapnel: 0,
  burn: 0,
  cold: 0,
  acid: 0,
  electric: 0,
});

function base(over: Partial<Loadout> = {}): Loadout {
  return {
    id: "t",
    name: "t",
    armorPlates: [],
    damageEnhancers: 0,
    accuracyEnhancers: 0,
    rangeEnhancers: 0,
    economyEnhancers: 0,
    armorEnhancerSlots: 0,
    useManualCost: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const opalo: Equipment = {
  name: "Sollomate Opalo",
  economy: { decay: 0.02, ammoBurn: 200, efficiency: 48 },
  damage: dmg(8),
  range: 55,
  usesPerMinute: 44,
  maxTT: 3.8,
  minTT: 0.114,
};
const amp: Equipment = {
  name: "A104",
  economy: { decay: 0.1, ammoBurn: 300, efficiency: 60 },
  damage: dmg(4),
};
const scope: Equipment = { name: "Scope", economy: { decay: 0.001, ammoBurn: 0, efficiency: 90 } };
const sight: Equipment = { name: "Sight", economy: { decay: 0.0005, ammoBurn: 0, efficiency: 20 } };
const absorber: Equipment = {
  name: "Absorber",
  economy: { decay: 0, ammoBurn: 0, efficiency: 70, absorption: 0.1 },
};

// Hand-picked fixtures covering the tricky paths.
const HAND: Loadout[] = [
  base(), // no weapon
  base({ weapon: opalo }),
  base({ weapon: opalo, amp }),
  base({ weapon: opalo, amp, scope, sight, sight2: sight, absorber }),
  base({ weapon: opalo, damageEnhancers: 10 }),
  base({ weapon: opalo, economyEnhancers: 10 }),
  base({ weapon: opalo, amp, damageEnhancers: 5, economyEnhancers: 3, accuracyEnhancers: 4, rangeEnhancers: 6 }),
  base({ weapon: opalo, weaponEnhancerSlots: 4 }), // legacy field
  base({ weapon: opalo, hitProfession: 0, damageProfession: 0 }),
  base({ weapon: opalo, hitProfession: 50, damageProfession: 50 }),
  base({ weapon: opalo, useManualCost: true, manualCostPerShot: 0.5 }),
  base({
    weapon: opalo,
    armor: { id: 1, name: "Ghost", maxTT: 100, durability: 1000, isLimited: false },
    armorPlates: [
      { name: "5B", maxTT: 12, durability: 200 },
      { name: "Nano", maxTT: 8 }, // no durability → default 1000
    ],
    armorEnhancerCostOverride: 0.03,
  }),
  base({ weapon: { name: "z", economy: { decay: 0, ammoBurn: 0 } } }), // zero-cost weapon
  base({ weapon: opalo, armor: { id: 2, name: "x", maxTT: 50, durability: 0, isLimited: true } }), // 0 durability
];

// Seeded random fixtures for breadth.
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}
function randomFixtures(n: number): Loadout[] {
  const r = rng(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const eq = (): Equipment => ({
    name: "e",
    economy: {
      decay: Math.round(r() * 1000) / 1000,
      ammoBurn: Math.floor(r() * 3000),
      efficiency: Math.round(r() * 100),
      absorption: r() < 0.3 ? Math.round(r() * 100) / 100 : undefined,
    },
    damage: dmg(Math.round(r() * 200)),
    range: Math.round(r() * 200),
  });
  return Array.from({ length: n }, () =>
    base({
      weapon: r() < 0.9 ? eq() : undefined,
      amp: r() < 0.5 ? eq() : undefined,
      scope: r() < 0.4 ? eq() : undefined,
      sight: r() < 0.4 ? eq() : undefined,
      sight2: r() < 0.3 ? eq() : undefined,
      absorber: r() < 0.3 ? eq() : undefined,
      damageEnhancers: Math.floor(r() * 11),
      economyEnhancers: Math.floor(r() * 11),
      accuracyEnhancers: Math.floor(r() * 11),
      rangeEnhancers: Math.floor(r() * 11),
      weaponEnhancerSlots: r() < 0.2 ? Math.floor(r() * 5) : undefined,
      hitProfession: pick([0, 25, 50, 75, 100, undefined]),
      damageProfession: pick([0, 25, 50, 75, 100, undefined]),
      armor:
        r() < 0.5
          ? { id: 1, name: "a", maxTT: Math.round(r() * 200), durability: Math.floor(r() * 2000), isLimited: r() < 0.5 }
          : undefined,
      armorPlates:
        r() < 0.5
          ? Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({
              name: "p",
              maxTT: Math.round(r() * 30),
              durability: r() < 0.5 ? Math.floor(r() * 500) : undefined,
            }))
          : [],
    }),
  );
}

const ALL = [...HAND, ...randomFixtures(80)];

// ── Parity: every calc must match Artemis byte-for-byte ───────────────────

const LOADOUT_FNS = [
  "calculateRange",
  "calculateLoadoutCosts",
  "calculateTotalDamage",
  "calculateEnhancedDamage",
  "calculateEffectiveDamage",
  "getHitRate",
  "getCritRate",
  "getModifiedDecay",
  "getModifiedWeaponDecay",
  "getModifiedAmmo",
  "getTotalAmmo",
  "getEfficiency",
  "calculateDPP",
  "getEffectiveCostPerShot",
] as const;

describe("loadout engine ↔ Artemis parity", () => {
  ALL.forEach((fx, i) => {
    for (const fn of LOADOUT_FNS) {
      it(`${fn} #${i}`, () => {
        const cerb = (C as unknown as Record<string, (l: Loadout) => unknown>)[fn](fx);
        const arte = (A as unknown as Record<string, (l: Loadout) => unknown>)[fn](fx as never);
        expect(cerb).toEqual(arte);
      });
    }

    it(`equipment costs #${i}`, () => {
      expect(C.calculateWeaponCost(fx.weapon)).toEqual(A.calculateWeaponCost(fx.weapon as never));
      expect(C.calculateWeaponCost(fx.amp)).toEqual(A.calculateWeaponCost(fx.amp as never));
      expect(C.calculateAttachmentCost(fx.scope)).toEqual(
        A.calculateAttachmentCost(fx.scope as never),
      );
      expect(C.calculateTotalDamage(fx.weapon)).toEqual(A.calculateTotalDamage(fx.weapon as never));
      expect(C.calculateArmorDecayPerHit(fx.armor)).toEqual(
        A.calculateArmorDecayPerHit(fx.armor as never),
      );
      expect(C.calculateSinglePlateDecayPerHit(fx.armorPlates)).toEqual(
        A.calculateSinglePlateDecayPerHit(fx.armorPlates as never),
      );
    });
  });

  it("calculateWeaponEnhancerCost across arg combos", () => {
    for (let d = 0; d <= 10; d++)
      for (let e = 0; e <= 10; e++)
        for (const ov of [undefined, 0, 0.5]) {
          expect(C.calculateWeaponEnhancerCost(d, e, ov)).toEqual(
            A.calculateWeaponEnhancerCost(d, e, ov),
          );
        }
  });

  it("isLimitedItem", () => {
    for (const n of ["Opalo (L)", "Foo L", "Bar", "Baz (L) X", ""]) {
      expect(C.isLimitedItem(n)).toEqual(A.isLimitedItem(n));
    }
  });
});
