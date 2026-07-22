import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { nexusMeta, nexusRefresh, resetIndexes } from "../lib/codex/store";

/** Shared state for the Codex's Nexus index snapshot — its build time, whether a
 *  rebuild is running, and a `rev` that bumps when a refresh lands so consumers
 *  can re-read the freshly rebuilt indices. Listens app-wide, so the Config
 *  updater and an open Codex stay in lockstep. */
export function useNexusSnapshot() {
  const [builtAt, setBuiltAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    nexusMeta().then((m) => setBuiltAt(m?.builtAt ?? null));
    const un = listen<{ state: string; error?: string; manifest?: { builtAt?: string } }>(
      "nexus:refresh",
      (e) => {
        const s = e.payload.state;
        setRefreshing(s === "running");
        if (s === "running") setError(null);
        if (s === "error") setError(e.payload.error ?? "refresh failed");
        if (s === "done") {
          setError(null);
          setBuiltAt(e.payload.manifest?.builtAt ?? new Date().toISOString());
          resetIndexes(); // drop memoised indices so the next read hits fresh disk
          setRev((r) => r + 1);
        }
      },
    );
    return () => {
      un.then((off) => off());
    };
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setError(null);
    nexusRefresh().catch((e) => {
      setRefreshing(false);
      setError(String(e));
    });
  }, []);

  return { builtAt, refreshing, error, rev, refresh };
}
