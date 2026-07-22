import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { WatchStatus } from "./useLogWatch";
import { getActiveLoadout, getEffectiveCostPerShot, type Loadout } from "../lib/loadout";
import { TRACKER_STATS_EVENT } from "../lib/trackerStats";
import {
  deriveStats,
  emptySession,
  loadIgnored,
  saveIgnored,
  type HuntSession,
} from "../lib/session";

/** Live session plus its run anchor. Kept in ONE state object so the combat
 *  listeners can check "are we running?" inside the functional update — no refs,
 *  so a toggle landing mid-event can never be read stale. */
interface Live {
  session: HuntSession | null;
  /** Epoch ms the session was last resumed; null while paused. */
  resumedAt: number | null;
}

/** Autosave cadence while running — the most a crash can cost. */
const SAVE_INTERVAL = 5000;

function newId(): string {
  return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : String(Date.now());
}

/** Fold the in-flight run time into `elapsedMs` for a durable copy. */
function settle(live: Live, at = Date.now()): HuntSession | null {
  if (!live.session) return null;
  const extra = live.resumedAt != null ? at - live.resumedAt : 0;
  return { ...live.session, elapsedMs: live.session.elapsedMs + extra };
}

/**
 * The hunt tracker's session engine. Mounted once at the app root — NOT inside
 * the Tracker page — so navigating away neither unmounts the listeners nor
 * discards a running session, and the in-game overlay keeps updating from
 * anywhere in the app.
 *
 * Sessions are persisted continuously: an unfinished one is resumed on boot,
 * and finishing archives it to the reviewable history.
 */
export function useTrackerSession() {
  const [live, setLive] = useState<Live>({ session: null, resumedAt: null });
  const [history, setHistory] = useState<HuntSession[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [ignored, setIgnored] = useState<Set<string>>(loadIgnored);
  const [active, setActive] = useState<Loadout | null>(() => getActiveLoadout());
  const [nowMs, setNowMs] = useState(Date.now());

  // Mirror of `live` for actions that need the current value without becoming
  // callbacks that change identity on every tick.
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  const cps = active ? getEffectiveCostPerShot(active) : 0;
  const running = live.session != null && live.resumedAt != null;

  /* ── history ── */
  const refreshHistory = useCallback(() => {
    invoke<HuntSession[]>("session_list")
      .then((all) => setHistory(all.filter((s) => s.endedAt)))
      .catch(() => {});
  }, []);

  /* ── hydrate: resume an unfinished session, always paused ── */
  useEffect(() => {
    invoke<HuntSession | null>("session_current")
      .then((s) => {
        if (s) setLive({ session: s, resumedAt: null });
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
    refreshHistory();
  }, [refreshHistory]);

  const persist = useCallback(() => {
    const snapshot = settle(liveRef.current);
    if (snapshot) invoke("session_save", { session: snapshot }).catch(() => {});
  }, []);

  /* ── persist while running ──
   * A fixed interval, NOT a debounce keyed on session state: combat events land
   * about once a second, so a debounce would be reset forever and never fire —
   * the whole hunt would go unsaved. Depending only on `resumedAt` keeps the
   * timer stable across event churn. */
  useEffect(() => {
    if (!hydrated || live.resumedAt == null) return;
    const id = setInterval(persist, SAVE_INTERVAL);
    return () => clearInterval(id);
  }, [hydrated, live.resumedAt, persist]);

  /* ── persist on settle (pause / restore) — cheap, and only fires on real
   * changes because a paused session has no incoming events ── */
  useEffect(() => {
    if (!hydrated || !live.session || live.resumedAt != null) return;
    persist();
  }, [hydrated, live.session, live.resumedAt, persist]);

  /* ── keep the session's cost/shot and exclusions current ──
   * `cps` is the price applied to the NEXT shot (earlier shots keep what they
   * were fired at), and the ignore list is mirrored in so finishing snapshots
   * the exclusions this session was actually recorded with. */
  useEffect(() => {
    setLive((st) => {
      if (!st.session) return st;
      const ign = [...ignored];
      const same =
        st.session.cps === cps &&
        st.session.ignored.length === ign.length &&
        ign.every((n) => st.session!.ignored.includes(n));
      return same ? st : { ...st, session: { ...st.session, cps, ignored: ign } };
    });
  }, [cps, ignored]);

  /* ── combat feed ── */
  useEffect(() => {
    const uns = [
      listen<number>("combat:shot", () => {
        setLive((st) => {
          if (!st.session || st.resumedAt == null) return st;
          const s = st.session;
          // Price the shot now, at the loadout in force — never retroactively.
          return {
            ...st,
            session: {
              ...s,
              shots: s.shots + 1,
              spend: s.spend + s.cps,
              sinceKill: s.sinceKill + 1,
              sinceKillSpend: s.sinceKillSpend + s.cps,
            },
          };
        });
      }),
      listen<{ item: string; qty: number; value: number }>("combat:loot", (e) => {
        const { item, qty, value } = e.payload;
        const name = item || "Unknown";
        setLive((st) => {
          if (!st.session || st.resumedAt == null) return st;
          const s = st.session;
          const prev = s.items[name] ?? { qty: 0, value: 0, drops: 0 };
          const items = {
            ...s.items,
            [name]: {
              qty: prev.qty + (qty || 0),
              value: prev.value + value,
              drops: prev.drops + 1,
            },
          };
          // Shots since the last kill ⇒ a new mob died. Extra drops from the
          // same mob (no shots between) fold into that same kill.
          if (s.sinceKill > 0) {
            return {
              ...st,
              session: {
                ...s,
                items,
                kills: s.kills + 1,
                lastKill: { [name]: value },
                lastKillSpend: s.sinceKillSpend,
                sinceKill: 0,
                sinceKillSpend: 0,
              },
            };
          }
          return {
            ...st,
            session: {
              ...s,
              items,
              lastKill: { ...s.lastKill, [name]: (s.lastKill[name] ?? 0) + value },
            },
          };
        });
      }),
    ];
    return () => uns.forEach((u) => u.then((off) => off()));
  }, []);

  /* ── chat.log connection ── */
  const [log, setLog] = useState<WatchStatus>({ watching: false, path: null });
  const [logErr, setLogErr] = useState<string | null>(null);
  const [lastLineMs, setLastLineMs] = useState(0);
  useEffect(() => {
    invoke<WatchStatus>("watch_status")
      .then(setLog)
      .catch(() => {});
    const unS = listen<WatchStatus>("watch:status", (e) => setLog(e.payload));
    // Throttled to once a second — this fires on every chat line.
    let last = 0;
    const unL = listen("log:line", () => {
      const now = Date.now();
      if (now - last >= 1000) {
        last = now;
        setLastLineMs(now);
      }
    });
    return () => {
      unS.then((off) => off());
      unL.then((off) => off());
    };
  }, []);

  /* ── overlay window ── */
  const [hudOpen, setHudOpen] = useState(false);
  useEffect(() => {
    invoke<{ trackhud: boolean }>("overlay_states")
      .then((o) => setHudOpen(!!o.trackhud))
      .catch(() => {});
    const un = listen<{ trackhud: boolean }>("overlays:changed", (e) =>
      setHudOpen(!!e.payload.trackhud),
    );
    return () => {
      un.then((off) => off());
    };
  }, []);
  const showHud = useCallback(
    (on: boolean) => invoke("set_overlay", { label: "trackhud", on }).catch(() => {}),
    [],
  );

  /* ── elapsed clock ── */
  useEffect(() => {
    if (live.resumedAt == null) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live.resumedAt]);

  const elapsedMs =
    (live.session?.elapsedMs ?? 0) + (live.resumedAt != null ? nowMs - live.resumedAt : 0);
  const elapsed = Math.floor(elapsedMs / 1000);
  // Derived here (off the 1s tick) rather than in the view, which would have to
  // call Date.now() during render — impure, and stale whenever paused.
  const lineAge = lastLineMs ? Math.max(0, Math.floor((nowMs - lastLineMs) / 1000)) : null;
  const stats = useMemo(() => deriveStats(live.session, ignored), [live.session, ignored]);

  /* ── actions ── */
  const start = useCallback(async () => {
    // A session not fed by a live chat.log silently records nothing, so connect
    // the tail first and refuse to start if it can't be reached.
    if (!liveRef.current.session || liveRef.current.resumedAt == null) {
      try {
        const st = await invoke<WatchStatus>("watch_status");
        if (!st.watching) setLog(await invoke<WatchStatus>("start_watch", { path: null }));
        else setLog(st);
        setLogErr(null);
      } catch (e) {
        setLogErr(String(e));
        return;
      }
    }
    setNowMs(Date.now());
    setLive((st) => ({
      session: st.session ?? emptySession(newId(), active?.name ?? null, cps),
      resumedAt: Date.now(),
    }));
    invoke("set_combat_capture", { on: true }).catch(() => {});
    showHud(true);
  }, [active, cps, showHud]);

  const stop = useCallback(() => {
    setLive((st) => {
      if (!st.session || st.resumedAt == null) return st;
      return { session: settle(st), resumedAt: null };
    });
    invoke("set_combat_capture", { on: false }).catch(() => {});
  }, []);

  /** End the session and archive it to the reviewable history. */
  const finish = useCallback(async () => {
    const snapshot = settle(liveRef.current);
    if (!snapshot) return;
    // Detach synchronously BEFORE awaiting: an autosave firing mid-await reads
    // liveRef and would otherwise write the un-ended copy back over the
    // archived one, resurrecting it as the resumable session.
    liveRef.current = { session: null, resumedAt: null };
    setLive({ session: null, resumedAt: null });
    invoke("set_combat_capture", { on: false }).catch(() => {});
    showHud(false);
    await invoke("session_save", {
      session: { ...snapshot, endedAt: new Date().toISOString() },
    }).catch(() => {});
    refreshHistory();
  }, [refreshHistory, showHud]);

  /** Throw the current session away without keeping it. */
  const discard = useCallback(async () => {
    const id = liveRef.current.session?.id;
    liveRef.current = { session: null, resumedAt: null };
    setLive({ session: null, resumedAt: null });
    invoke("set_combat_capture", { on: false }).catch(() => {});
    showHud(false);
    if (id) await invoke("session_delete", { id }).catch(() => {});
  }, [showHud]);

  const deleteSession = useCallback(
    async (id: string) => {
      await invoke("session_delete", { id }).catch(() => {});
      refreshHistory();
    },
    [refreshHistory],
  );

  const toggleIgnore = useCallback((name: string) => {
    setIgnored((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      saveIgnored(next);
      return next;
    });
  }, []);

  const refreshLoadout = useCallback(() => setActive(getActiveLoadout()), []);

  /* ── feed the in-game overlay (runs app-wide, not just on the Tracker page) ── */
  useEffect(() => {
    emit(TRACKER_STATS_EVENT, {
      running,
      elapsed,
      loadout: active?.name ?? null,
      cps,
      spend: stats.spend,
      loot: stats.loot,
      profit: stats.profit,
      returnPct: stats.returnPct,
      avgMult: stats.avgMult,
      lastMult: stats.lastMult,
      costPerKill: stats.costPerKill,
      lootPerKill: stats.lootPerKill,
      kills: stats.kills,
      shots: stats.shots,
    }).catch(() => {});
    // `hudOpen` is a dependency so opening the overlay while paused pushes the
    // current numbers at it — otherwise nothing changes and it would sit on
    // "Waiting for session…" indefinitely.
  }, [running, elapsed, active, cps, stats, hudOpen]);

  return {
    session: live.session,
    running,
    elapsed,
    stats,
    history,
    ignored,
    active,
    cps,
    log,
    logErr,
    lineAge,
    hudOpen,
    showHud,
    start,
    stop,
    finish,
    discard,
    deleteSession,
    toggleIgnore,
    refreshLoadout,
  };
}

export type TrackerSession = ReturnType<typeof useTrackerSession>;
