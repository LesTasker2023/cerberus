import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { LogLine } from "./useLogWatch";
import {
  ALERT_EVENT,
  loadAlerts,
  loadTriggers,
  matchTrigger,
  MAX_ALERTS,
  saveAlerts,
  saveTriggers,
  type Alert,
  type Trigger,
} from "../lib/triggers";

/**
 * Chat trigger engine. Mounted once at the app root so alerts fire no matter
 * which page is open — or whether the window is even focused.
 *
 * Every `log:line` is tested against the enabled triggers; a hit is appended to
 * the persisted alert history and pushed to the in-game overlay window.
 */
export function useChatTriggers() {
  const [triggers, setTriggers] = useState<Trigger[]>(loadTriggers);
  const [alerts, setAlerts] = useState<Alert[]>(loadAlerts);
  const [overlayOn, setOverlayOn] = useState(false);

  // The log:line listener is registered once; reading rules through a ref keeps
  // it from being torn down and re-subscribed on every edit, which would drop
  // lines in the gap.
  const triggersRef = useRef(triggers);
  useEffect(() => {
    triggersRef.current = triggers;
  }, [triggers]);

  useEffect(() => {
    const un = listen<LogLine>("log:line", (e) => {
      const line = e.payload;
      const rules = triggersRef.current;
      if (rules.length === 0) return;

      const hits: Alert[] = [];
      for (const t of rules) {
        const term = matchTrigger(t, line.channel, line.speaker, line.text);
        if (!term) continue;
        hits.push({
          id: `${Date.now()}-${t.id}-${Math.random().toString(36).slice(2, 8)}`,
          triggerId: t.id,
          triggerName: t.name,
          at: line.at,
          channel: line.channel,
          speaker: line.speaker,
          text: line.text || line.raw,
          term,
        });
      }
      if (hits.length === 0) return;

      setAlerts((prev) => {
        const next = [...hits, ...prev].slice(0, MAX_ALERTS);
        saveAlerts(next);
        return next;
      });
      // Push to the overlay; harmless if the window is hidden.
      for (const h of hits) emit(ALERT_EVENT, h).catch(() => {});
    });
    return () => {
      un.then((off) => off());
    };
  }, []);

  /* ── overlay window ── */
  useEffect(() => {
    invoke<{ alerts: boolean }>("overlay_states")
      .then((o) => setOverlayOn(!!o.alerts))
      .catch(() => {});
    const un = listen<{ alerts: boolean }>("overlays:changed", (e) =>
      setOverlayOn(!!e.payload.alerts),
    );
    return () => {
      un.then((off) => off());
    };
  }, []);
  const showOverlay = useCallback(
    (on: boolean) => invoke("set_overlay", { label: "alerts", on }).catch(() => {}),
    [],
  );

  /* ── rule management ── */
  const commit = useCallback((next: Trigger[]) => {
    setTriggers(next);
    saveTriggers(next);
  }, []);

  const upsertTrigger = useCallback(
    (t: Trigger) =>
      commit(
        triggersRef.current.some((x) => x.id === t.id)
          ? triggersRef.current.map((x) => (x.id === t.id ? t : x))
          : [...triggersRef.current, t],
      ),
    [commit],
  );

  const deleteTrigger = useCallback(
    (id: string) => commit(triggersRef.current.filter((x) => x.id !== id)),
    [commit],
  );

  const toggleTrigger = useCallback(
    (id: string) =>
      commit(
        triggersRef.current.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)),
      ),
    [commit],
  );

  const clearAlerts = useCallback(() => {
    setAlerts([]);
    saveAlerts([]);
  }, []);

  return {
    triggers,
    alerts,
    overlayOn,
    showOverlay,
    upsertTrigger,
    deleteTrigger,
    toggleTrigger,
    clearAlerts,
  };
}

export type ChatTriggers = ReturnType<typeof useChatTriggers>;
