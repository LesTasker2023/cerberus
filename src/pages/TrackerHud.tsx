import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TRACKER_STATS_EVENT, type TrackerStats } from "../lib/trackerStats";

const ped = (n: number) => `${n < 0 ? "-" : ""}${Math.abs(n).toFixed(4)}`;

function fmt(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** In-game session overlay — a compact, always-on-top readout of the live
 *  tracker stats, fed from the Tracker page via `tracker:stats`. */
export function TrackerHud() {
  const [s, setS] = useState<TrackerStats | null>(null);

  useEffect(() => {
    const un = listen<TrackerStats>(TRACKER_STATS_EVENT, (e) => setS(e.payload));
    return () => {
      un.then((off) => off());
    };
  }, []);

  const close = () => invoke("hide_window", { label: "trackhud" }).catch(() => {});
  const mCls = (m: number) => (m >= 1 ? "thud--up" : m > 0 ? "thud--down" : "");

  return (
    <div className="thud">
      <header className="thud__head" data-tauri-drag-region>
        <span className={`thud__dot ${s?.running ? "thud__dot--live" : ""}`} data-tauri-drag-region />
        <span className="thud__time" data-tauri-drag-region>
          {fmt(s?.elapsed ?? 0)}
        </span>
        <button className="thud__x" onClick={close} title="Close">
          ×
        </button>
      </header>

      {!s ? (
        <div className="thud__wait">Waiting for session…</div>
      ) : (
        <div className="thud__body">
          <div className={`thud__mult ${mCls(s.avgMult)}`}>{s.returnPct.toFixed(1)}%</div>
          <div className="thud__sub">
            last <b className={mCls(s.lastMult)}>{s.lastMult.toFixed(2)}×</b>
          </div>
          <Row l="Profit" v={`${ped(s.profit)}`} cls={mCls(s.avgMult)} />
          <Row l="Spend" v={ped(s.spend)} />
          <Row l="Loot" v={ped(s.loot)} />
          <Row l="Kills" v={String(s.kills)} />
          <Row l="Loot/kill" v={ped(s.lootPerKill)} />
          <Row l="Cost/kill" v={ped(s.costPerKill)} />
        </div>
      )}
    </div>
  );
}

function Row({ l, v, cls = "" }: { l: string; v: string; cls?: string }) {
  return (
    <div className="thud__row">
      <span className="thud__l">{l}</span>
      <span className={`thud__v ${cls}`}>{v}</span>
    </div>
  );
}
