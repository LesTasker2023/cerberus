import { describe, expect, it } from "vitest";
import { combinePois } from "./pois";
import type { Poi } from "../hooks/usePois";
import type { Encounter } from "../hooks/useEncounters";

const poi = (over: Partial<Poi> = {}): Poi => ({
  id: "p1",
  name: "Station",
  category: "space-station",
  eu_x: 1,
  eu_y: 2,
  eu_z: 3,
  pvp_lootable: false,
  notes: null,
  sector: null,
  logged_at: null,
  ...over,
});

const mob = (over: Partial<Encounter> = {}): Encounter => ({
  id: "e1",
  name: "Cosmic Horror",
  level: null,
  maturity: "",
  eu_x: 10,
  eu_y: 20,
  eu_z: 30,
  hp: 100,
  shots: 5,
  skills: [],
  loot: [],
  loot_value: 0,
  started_at: "2026-07-26T00:00:00Z",
  ended_at: null,
  ...over,
});

describe("combinePois", () => {
  it("emits a marker for every logged mob encounter", () => {
    const out = combinePois([poi()], [mob(), mob({ id: "e2", name: "Hermit" })]);
    const mobs = out.filter((p) => p.source === "mob");
    expect(mobs).toHaveLength(2);
    expect(mobs.map((m) => m.id)).toEqual(["mob-e1", "mob-e2"]);
    expect(mobs[0].category).toBe("mob");
    expect(mobs[0].euX).toBe(10);
  });

  it("drops encounters with no captured position", () => {
    const out = combinePois([], [mob({ id: "e3", eu_x: null, eu_y: null, eu_z: null })]);
    expect(out.filter((p) => p.source === "mob")).toHaveLength(0);
  });

  it("marks store rows logged only when they carry a log time", () => {
    const out = combinePois([
      poi({ id: "anchor" }),
      poi({ id: "rock", logged_at: "2026-01-01T00:00:00Z" }),
    ]);
    expect(out.find((p) => p.id === "anchor")?.logged).toBe(false);
    expect(out.find((p) => p.id === "rock")?.logged).toBe(true);
    expect(out.every((p) => p.source === "poi")).toBe(true);
  });

  it("keeps mobs and POIs in one list", () => {
    const out = combinePois([poi()], [mob()]);
    expect(out).toHaveLength(2);
  });
});
