import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { invokeReady } from "../lib/invokeReady";

/** Mirror of the Rust `Poi`. */
export interface Poi {
  id: string;
  name: string;
  category: string;
  eu_x: number;
  eu_y: number;
  eu_z: number;
  pvp_lootable: boolean;
  notes: string | null;
  /** Sector this POI is anchored to — named after a space station. */
  sector: string | null;
  /** ISO time this marker was logged in-game; null = hand-placed anchor. */
  logged_at: string | null;
}

export interface PoiInput {
  name: string;
  category: string;
  eu_x: number;
  eu_y: number;
  eu_z: number;
  pvp_lootable: boolean;
  notes: string | null;
  sector: string | null;
}

/**
 * Every map marker — stations, gates, outlaw zones, landmarks and logged rocks.
 * One store: `logged_at` distinguishes a rock scanned in-game from a marker
 * placed by hand, replacing the separate asteroid log that could never be edited.
 */
export function usePois() {
  const [items, setItems] = useState<Poi[]>([]);

  const refresh = useCallback(() => {
    invokeReady<Poi[]>("list_pois").then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const un = listen("pois:changed", () => refresh());
    return () => {
      un.then((off) => off());
    };
  }, [refresh]);

  const add = useCallback((input: PoiInput) => invoke<Poi>("add_poi", { input }), []);
  const update = useCallback(
    (id: string, input: PoiInput) => invoke<Poi>("update_poi", { id, input }),
    [],
  );
  const remove = useCallback((id: string) => invoke("delete_poi", { id }), []);

  return { items, add, update, remove };
}
