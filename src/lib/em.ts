import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readEmConfig } from "./emConfig";

/** Push the saved EM config to the backend so any window can arm it. Call on
 *  app boot and whenever the config changes. */
export function pushEmConfig(): void {
  const cfg = readEmConfig();
  if (cfg) invoke("em_set_config", { config: cfg }).catch(() => {});
}

/**
 * Arm the EM loop. Returns false only if nothing has ever been framed.
 *
 * From the main window we pass the localStorage config directly; from the dock
 * (a separate window that may not share localStorage) we fall back to the
 * backend's stored config, which the main window pushed on boot.
 */
export async function startEm(): Promise<boolean> {
  const cfg = readEmConfig();
  if (cfg) {
    await invoke("em_start", { config: cfg }).catch(() => {});
    return true;
  }
  const configured = await invoke<boolean>("em_configured").catch(() => false);
  if (!configured) return false;
  await invoke("em_start", { config: null }).catch(() => {});
  return true;
}

export async function stopEm(): Promise<void> {
  await invoke("em_stop").catch(() => {});
}

/** Live running state of the EM loop, synced app-wide via `em:status`. */
export function useEmRunning(): boolean {
  const [running, setRunning] = useState(false);
  useEffect(() => {
    invoke<boolean>("em_running")
      .then(setRunning)
      .catch(() => {});
    const un = listen<{ running: boolean }>("em:status", (e) => setRunning(e.payload.running));
    return () => {
      un.then((off) => off());
    };
  }, []);
  return running;
}
