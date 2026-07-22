import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getActiveLoadout, getEffectiveCostPerShot, type Loadout } from "../lib/loadout";
import { TRACKER_STATS_EVENT } from "../lib/trackerStats";
import { LoadoutCreator } from "../components/LoadoutCreator";

const ped = (n: number) => `${n < 0 ? "-" : ""}${Math.abs(n).toFixed(4)}`;
const mult = (n: number) => `${n.toFixed(3)}×`;

interface Tally {
  shots: number;
  loot: number;
  kills: number;
  /** Ammo events since the current kill started — the kill-inference counter. */
  sinceKill: number;
  lastKillLoot: number;
  lastKillShots: number;
}
const ZERO: Tally = { shots: 0, loot: 0, kills: 0, sinceKill: 0, lastKillLoot: 0, lastKillShots: 0 };

/** Hunt tracker — input vs output. Spend = shots × active-loadout cost/shot;
 *  loot = total received. Fed by the raw combat:shot / combat:loot log stream;
 *  a loot line marks a kill. No encounter grouping, no mob logger. */
export function Tracker() {
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState<Loadout | null>(() => getActiveLoadout());
  const cps = active ? getEffectiveCostPerShot(active) : 0;

  const [startMs, setStartMs] = useState<number | null>(null);
  const [endMs, setEndMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const running = startMs != null && endMs == null;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Running session tally, fed by every combat log line while the session runs.
  const [tally, setTally] = useState<Tally>(ZERO);
  const runningRef = useRef(running);
  runningRef.current = running;
  useEffect(() => {
    const uns = [
      listen<number>("combat:shot", () => {
        if (!runningRef.current) return;
        setTally((t) => ({ ...t, shots: t.shots + 1, sinceKill: t.sinceKill + 1 }));
      }),
      listen<number>("combat:loot", (e) => {
        if (!runningRef.current) return;
        const v = e.payload || 0;
        setTally((t) => {
          // A loot line with shots since the last kill = a new mob killed. Extra
          // drops from the same mob (no shots between) fold into that kill.
          if (t.sinceKill > 0) {
            return {
              ...t,
              loot: t.loot + v,
              kills: t.kills + 1,
              lastKillLoot: v,
              lastKillShots: t.sinceKill,
              sinceKill: 0,
            };
          }
          return { ...t, loot: t.loot + v, lastKillLoot: t.lastKillLoot + v };
        });
      }),
    ];
    return () => uns.forEach((u) => u.then((off) => off()));
  }, []);

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
  const showHud = (on: boolean) => invoke("set_overlay", { label: "trackhud", on }).catch(() => {});

  const start = () => {
    if (startMs == null) {
      setStartMs(Date.now());
      setTally(ZERO); // fresh session
    }
    setEndMs(null);
    setNowMs(Date.now());
    invoke("set_combat_capture", { on: true }).catch(() => {});
    showHud(true);
  };
  const stop = () => setEndMs(Date.now());
  const reset = () => {
    setStartMs(null);
    setEndMs(null);
    setTally(ZERO);
    showHud(false);
  };

  const spend = tally.shots * cps;
  const s = {
    shots: tally.shots,
    kills: tally.kills,
    loot: tally.loot,
    spend,
    profit: tally.loot - spend,
    returnPct: spend > 0 ? (tally.loot / spend) * 100 : 0,
    avgMult: spend > 0 ? tally.loot / spend : 0,
    lastMult: tally.lastKillShots > 0 ? tally.lastKillLoot / (tally.lastKillShots * cps) : 0,
    costPerKill: tally.kills > 0 ? spend / tally.kills : 0,
    lootPerKill: tally.kills > 0 ? tally.loot / tally.kills : 0,
  };

  const elapsed = startMs != null ? Math.floor(((endMs ?? nowMs) - startMs) / 1000) : 0;
  const multClass = (m: number) => (m >= 1 ? "trk--up" : m > 0 ? "trk--down" : "");

  // Feed the in-game overlay window.
  useEffect(() => {
    emit(TRACKER_STATS_EVENT, {
      running,
      elapsed,
      loadout: active?.name ?? null,
      cps,
      spend: s.spend,
      loot: s.loot,
      profit: s.profit,
      returnPct: s.returnPct,
      avgMult: s.avgMult,
      lastMult: s.lastMult,
      costPerKill: s.costPerKill,
      lootPerKill: s.lootPerKill,
      kills: s.kills,
      shots: s.shots,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, elapsed, active, cps, tally]);

  return (
    <div className="trk">
      <header className="trk__head">
        <span className={`trk__dot ${running ? "trk__dot--live" : ""}`} />
        <span className="trk__title">Session</span>
        <span className="trk__time">{fmt(elapsed)}</span>
        <button className="btn btn--ghost trk__loadbtn" onClick={() => setCreating(true)}>
          Loadouts
        </button>
      </header>

      <div className="trk__loadline">
        {active ? (
          <>
            <span className="trk__loadname">{active.name}</span>
            <span className="trk__cps">{ped(cps)} PED / shot</span>
          </>
        ) : (
          <span className="trk__warn">No active loadout — open Loadouts and star one (★) to compute spend.</span>
        )}
      </div>

      <div className="trk__grid">
        <Stat label="Spend" value={`${ped(s.spend)} PED`} />
        <Stat label="Loot" value={`${ped(s.loot)} PED`} />
        <Stat label="Profit" value={`${ped(s.profit)} PED`} cls={multClass(s.avgMult)} />
        <Stat label="Return" value={`${s.returnPct.toFixed(1)}%`} cls={multClass(s.avgMult)} />
        <Stat label="Multiplier" value={mult(s.avgMult)} cls={multClass(s.avgMult)} />
        <Stat label="Last kill" value={mult(s.lastMult)} cls={multClass(s.lastMult)} />
        <Stat label="Cost / kill" value={`${ped(s.costPerKill)} PED`} />
        <Stat label="Loot / kill" value={`${ped(s.lootPerKill)} PED`} />
        <Stat label="Kills" value={String(s.kills)} />
        <Stat label="Shots" value={s.shots.toLocaleString()} />
      </div>

      <div className="trk__actions">
        {running ? (
          <button className="btn btn--ghost" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="btn btn--accent" onClick={start}>
            {startMs != null ? "Resume" : "Start session"}
          </button>
        )}
        <button className="btn btn--ghost" onClick={reset} disabled={startMs == null}>
          Reset
        </button>
        <button
          className={`btn ${hudOpen ? "btn--accent" : "btn--ghost"}`}
          onClick={() => showHud(!hudOpen)}
        >
          {hudOpen ? "Overlay on" : "Overlay"}
        </button>
      </div>

      {creating && (
        <LoadoutCreator
          onClose={() => {
            setCreating(false);
            setActive(getActiveLoadout());
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div className={`trkstat ${cls}`}>
      <span className="trkstat__l">{label}</span>
      <span className="trkstat__v">{value}</span>
    </div>
  );
}

function fmt(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const sec = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
