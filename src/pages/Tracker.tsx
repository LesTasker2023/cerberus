import { useState } from "react";
import { createPortal } from "react-dom";
import type { TrackerSession } from "../hooks/useTrackerSession";
import { search } from "../lib/codex/store";
import type { SearchEntry } from "../lib/codex/types";
import { deriveStats, sessionIgnored, type HuntSession } from "../lib/session";
import { LoadoutCreator } from "../components/LoadoutCreator";

const ped = (n: number) => `${n < 0 ? "-" : ""}${Math.abs(n).toFixed(4)}`;
const mult = (n: number) => `${n.toFixed(3)}×`;

function fmt(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const sec = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Hunt tracker — input vs output. Spend = shots × active-loadout cost/shot;
 *  loot = total received. All session state lives in `useTrackerSession` at the
 *  app root, so this page is a pure view: navigating away never interrupts a
 *  running session. */
export function Tracker({
  tracker,
  onOpenDb,
}: {
  tracker: TrackerSession;
  onOpenDb?: (url: string) => void;
}) {
  const {
    session,
    running,
    elapsed,
    stats: s,
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
  } = tracker;

  const [creating, setCreating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Resolve a loot name to its Nexus entity and open it in the Database.
  const openItem = async (name: string) => {
    if (!onOpenDb) return;
    const hits = await search(name, null, 20).catch(() => [] as SearchEntry[]);
    const exact = hits.find((h) => h.name.toLowerCase() === name.toLowerCase()) ?? hits[0];
    if (exact) onOpenDb(exact.url);
  };

  // Biggest earners first; excluded rows keep their place so they're easy to flip back on.
  const lootRows = Object.entries(session?.items ?? {}).sort((a, b) => b[1].value - a[1].value);
  const multClass = (m: number) => (m >= 1 ? "trk--up" : m > 0 ? "trk--down" : "");

  return (
    <div className="trk">
      <header className="trk__head">
        <span className={`trk__dot ${running ? "trk__dot--live" : ""}`} />
        <span className="trk__title">Session</span>
        <span className="trk__time">{fmt(elapsed)}</span>
        <button className="btn btn--ghost trk__loadbtn" onClick={() => setShowHistory(true)}>
          History{history.length > 0 ? ` (${history.length})` : ""}
        </button>
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
          <span className="trk__warn">
            No active loadout — open Loadouts and star one (★) to compute spend.
          </span>
        )}
      </div>

      <div className="trk__logline">
        {logErr ? (
          <span className="trk__warn">Chat.log not connected — {logErr}</span>
        ) : log.watching ? (
          <span className="trk__ok">
            Reading {log.path?.split(/[\\/]/).pop() ?? "chat.log"}
            {running && lineAge != null && ` · last line ${lineAge}s ago`}
          </span>
        ) : (
          <span className="trk__warn">Chat.log not connected — Start will connect it.</span>
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

      <div className="trk__loot">
        <div className="trk__loothead">
          <span>Loot</span>
          <span className="trk__lootcount">
            {lootRows.length} item{lootRows.length === 1 ? "" : "s"}
            {s.excluded > 0 && ` · ${ped(s.excluded)} excluded`}
          </span>
        </div>
        {lootRows.length === 0 ? (
          <div className="trk__lootempty">No loot yet this session.</div>
        ) : (
          lootRows.map(([name, r]) => {
            const off = ignored.has(name);
            return (
              <div key={name} className={`lootrow ${off ? "lootrow--off" : ""}`}>
                <button
                  className="lootrow__name"
                  onClick={() => openItem(name)}
                  title="View in Database"
                >
                  {name}
                </button>
                <span className="lootrow__qty">×{r.qty.toLocaleString()}</span>
                <span className="lootrow__val">{ped(r.value)}</span>
                <button
                  className={`lootrow__tog ${off ? "" : "lootrow__tog--on"}`}
                  onClick={() => toggleIgnore(name)}
                  title={
                    off ? "Not counted — click to include in loot" : "Counted — click to exclude"
                  }
                  aria-pressed={!off}
                >
                  {off ? "Off" : "On"}
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="trk__actions">
        {running ? (
          <button className="btn btn--ghost" onClick={stop}>
            Pause
          </button>
        ) : (
          <button className="btn btn--accent" onClick={start}>
            {session ? "Resume" : "Start session"}
          </button>
        )}
        <button className="btn btn--ghost" onClick={finish} disabled={!session}>
          Finish &amp; save
        </button>
        <button className="btn btn--ghost" onClick={discard} disabled={!session}>
          Discard
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
            refreshLoadout();
          }}
        />
      )}

      {showHistory && (
        <SessionHistory
          sessions={history}
          onDelete={deleteSession}
          onClose={() => setShowHistory(false)}
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

/** Saved sessions — pick one to review its stats and loot breakdown. Stats are
 *  recomputed from the stored counters using that session's own cost/shot. */
function SessionHistory({
  sessions,
  onDelete,
  onClose,
}: {
  sessions: HuntSession[];
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(sessions[0]?.id ?? null);
  const sel = sessions.find((x) => x.id === openId) ?? null;
  // Each session is scored with the exclusions it was recorded under, so
  // changing the live preference never rewrites past results.
  const selIgnored = sessionIgnored(sel);
  const s = deriveStats(sel, selIgnored);

  return createPortal(
    <div className="lcmodal" onClick={onClose} role="dialog" aria-label="Session history">
      <div className="lcbox lcbox--wide" onClick={(e) => e.stopPropagation()}>
        <header className="lcbox__head">
          <span className="sesh__title">Session history</span>
          <button className="lcbox__x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {sessions.length === 0 ? (
          <div className="sesh__empty">
            No saved sessions yet — finish a session to keep it here.
          </div>
        ) : (
          <div className="sesh__body">
            <ul className="sesh__list">
              {sessions.map((x) => {
                const xs = deriveStats(x, sessionIgnored(x));
                return (
                  <li key={x.id}>
                    <button
                      className={`sesh__item ${x.id === openId ? "sesh__item--on" : ""}`}
                      onClick={() => setOpenId(x.id)}
                    >
                      <span className="sesh__when">
                        {new Date(x.startedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="sesh__meta">
                        {fmt(Math.floor(x.elapsedMs / 1000))} · {x.kills} kills
                      </span>
                      <span className={`sesh__ret ${xs.avgMult >= 1 ? "trk--up" : "trk--down"}`}>
                        {xs.returnPct.toFixed(1)}%
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {sel && (
              <div className="sesh__detail">
                <div className="sesh__dhead">
                  <span>{sel.loadout ?? "No loadout"}</span>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      onDelete(sel.id);
                      setOpenId(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
                <div className="trk__grid">
                  <Stat label="Spend" value={`${ped(s.spend)} PED`} />
                  <Stat label="Loot" value={`${ped(s.loot)} PED`} />
                  <Stat label="Profit" value={`${ped(s.profit)} PED`} />
                  <Stat label="Return" value={`${s.returnPct.toFixed(1)}%`} />
                  <Stat label="Cost / kill" value={`${ped(s.costPerKill)} PED`} />
                  <Stat label="Loot / kill" value={`${ped(s.lootPerKill)} PED`} />
                  <Stat label="Kills" value={String(s.kills)} />
                  <Stat label="Shots" value={s.shots.toLocaleString()} />
                </div>
                <div className="trk__loot">
                  <div className="trk__loothead">
                    <span>Loot</span>
                    <span className="trk__lootcount">
                      {Object.keys(sel.items).length} items
                    </span>
                  </div>
                  {Object.entries(sel.items)
                    .sort((a, b) => b[1].value - a[1].value)
                    .map(([name, r]) => (
                      <div
                        key={name}
                        className={`lootrow ${selIgnored.has(name) ? "lootrow--off" : ""}`}
                      >
                        <span className="lootrow__nameplain">{name}</span>
                        <span className="lootrow__qty">×{r.qty.toLocaleString()}</span>
                        <span className="lootrow__val">{ped(r.value)}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
