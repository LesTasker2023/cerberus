import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { invokeReady } from "../lib/invokeReady";

/** Mirror of the Rust `Asteroid`. */
export interface Asteroid {
  id: string;
  name: string;
  category: string;
  sector: string | null;
  eu_x: number;
  eu_y: number;
  eu_z: number;
  pvp_lootable: boolean;
  notes: string | null;
  logged_at: string;
}

/** Fields sent when logging a rock. */
export interface AsteroidInput {
  name: string;
  category: string;
  sector: string | null;
  eu_x: number;
  eu_y: number;
  eu_z: number;
  pvp_lootable: boolean;
  notes: string | null;
}

/** Local asteroid log — list / add / remove, persisted in Rust. */
export function useAsteroids() {
  const [items, setItems] = useState<Asteroid[]>([]);

  const refresh = useCallback(() => {
    invokeReady<Asteroid[]>("list_asteroids").then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    // Refresh when any window logs/deletes (panel, hotkey, main).
    const un = listen("asteroids:changed", () => refresh());
    return () => {
      un.then((off) => off());
    };
  }, [refresh]);

  const add = useCallback(
    async (input: AsteroidInput) => {
      await invoke<Asteroid>("add_asteroid", { input });
      refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await invoke("delete_asteroid", { id });
      refresh();
    },
    [refresh],
  );

  return { items, add, remove };
}
