import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Shared location-broadcast toggle. State lives in Rust so the topbar and the
 *  HUD dock (separate windows) stay in lockstep; flipping it here emits
 *  `broadcast:changed` to every window. */
export function useBroadcast() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    invoke<boolean>("get_broadcast").then(setOn).catch(() => {});
    const un = listen<boolean>("broadcast:changed", (e) => setOn(e.payload));
    return () => {
      un.then((off) => off());
    };
  }, []);

  const toggle = useCallback(() => {
    invoke<boolean>("set_broadcast", { on: !on }).catch(() => {});
  }, [on]);

  return { on, toggle };
}
