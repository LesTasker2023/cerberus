import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { invokeReady } from "../lib/invokeReady";

export interface SkillGain {
  skill: string;
  xp: number;
}

export interface LootItem {
  item: string;
  qty: number;
  value: number;
}

/** Mirror of the Rust `Encounter`. */
export interface Encounter {
  id: string;
  name: string;
  level: number | null;
  maturity: string;
  eu_x: number | null;
  eu_y: number | null;
  eu_z: number | null;
  /** Total damage dealt = the mob's HP. */
  hp: number;
  shots: number;
  skills: SkillGain[];
  loot: LootItem[];
  loot_value: number;
  started_at: string;
  ended_at: string | null;
}

/**
 * Combat/hunt tracker. Streams the live in-progress encounter and keeps the
 * persisted log of finished ones. Encounters are opened/closed entirely in Rust
 * from the chat.log; here we just render what it emits.
 */
export function useEncounters() {
  const [items, setItems] = useState<Encounter[]>([]);
  const [current, setCurrent] = useState<Encounter | null>(null);
  const [enabled, setEnabled] = useState(false);

  const refresh = useCallback(() => {
    invokeReady<Encounter[]>("list_encounters").then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    invokeReady<Encounter | null>("current_encounter").then(setCurrent).catch(() => {});
    invokeReady<boolean>("combat_enabled").then(setEnabled).catch(() => {});
    const un = listen("encounters:changed", () => refresh());
    const up = listen<Encounter | null>("encounter:update", (e) => setCurrent(e.payload));
    const en = listen<boolean>("combat:enabled", (e) => setEnabled(e.payload));
    return () => {
      un.then((off) => off());
      up.then((off) => off());
      en.then((off) => off());
    };
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      await invoke("delete_encounter", { id });
      refresh();
    },
    [refresh],
  );

  const clear = useCallback(async () => {
    await invoke("clear_encounters");
    refresh();
  }, [refresh]);

  const toggle = useCallback(() => {
    invoke<boolean>("toggle_combat").then(setEnabled).catch(() => {});
  }, []);

  return { items, current, enabled, remove, clear, toggle };
}
