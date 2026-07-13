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
}

export interface PoiInput {
  name: string;
  category: string;
  eu_x: number;
  eu_y: number;
  eu_z: number;
  pvp_lootable: boolean;
  notes: string | null;
}

/** Editable POIs (stations / gates / landmarks / custom) — list + CRUD. */
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
