import { invoke } from "@tauri-apps/api/core";

/**
 * Invoke a command, retrying while it rejects. On startup the webview mounts and
 * fires its initial `list_*` fetches before the Rust `setup` hook has finished
 * `app.manage()`-ing `AppState`, so those first calls reject with "state not
 * managed" — and a plain `.catch(() => {})` would leave the UI stuck at 0 until
 * some later event re-fetched. Retrying briefly bridges that boot race; once the
 * backend is up the very first attempt succeeds, so this is a no-op thereafter.
 */
export async function invokeReady<T>(
  cmd: string,
  args?: Record<string, unknown>,
  attempts = 12,
  delayMs = 200,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await invoke<T>(cmd, args);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
