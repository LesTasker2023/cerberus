import { useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * On launch, check GitHub releases for a newer version. If one exists, ask the
 * user, then download + install + relaunch. Silent + non-fatal on any error
 * (offline, no release yet, etc.). Runs once from the main window.
 */
export function useUpdater() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await check();
        if (!update || cancelled) return;
        const ok = window.confirm(
          `Cerberus ${update.version} is available (you have ${update.currentVersion}).\n\nUpdate now?`,
        );
        if (!ok) return;
        await update.downloadAndInstall();
        await relaunch();
      } catch {
        /* no network / no release / dev build — ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
