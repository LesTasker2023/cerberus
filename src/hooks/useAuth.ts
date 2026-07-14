import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { invokeReady } from "../lib/invokeReady";

/** Mirror of the Rust `Session` (token stripped). */
export interface DiscordSession {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  is_member: boolean;
  roles: string[];
  has_required_role: boolean;
  expires_at: number;
}

/** True when the session clears the clan gate (member + any required role). */
export function isAuthed(s: DiscordSession | null | undefined): boolean {
  return !!(s && s.is_member && s.has_required_role);
}

/**
 * Discord login + clan gate. `session` is `undefined` while the stored session
 * loads, then the current session or `null`. Login opens Discord in the browser
 * and resolves once the loopback catches the redirect.
 */
export function useAuth() {
  const [session, setSession] = useState<DiscordSession | null | undefined>(undefined);
  const [configured, setConfigured] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invokeReady<boolean>("auth_configured")
      .then(setConfigured)
      .catch(() => setConfigured(false));
    invokeReady<DiscordSession | null>("auth_status")
      .then((s) => setSession(s ?? null))
      .catch(() => setSession(null));
  }, []);

  const login = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await invoke<DiscordSession>("discord_login");
      setSession(s);
      return s;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await invoke("discord_logout").catch(() => {});
    setSession(null);
  }, []);

  return { session, configured, busy, error, login, logout };
}
