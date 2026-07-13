import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { useEncounters, Encounter } from "../hooks/useEncounters";
import { IconEye, IconFrame, IconTrash } from "../components/icons";

function clock(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB");
}

const ped = (v: number) => v.toFixed(2);

/** "L30 Dymlek Provider" from an encounter's parts. */
function mobTitle(e: Encounter): string {
  const lvl = e.level != null ? `L${e.level} ` : "";
  const mat = e.maturity ? ` ${e.maturity}` : "";
  return `${lvl}${e.name || "Unknown"}${mat}`.trim();
}

export function Combat({ store }: { store: ReturnType<typeof useEncounters> }) {
  const { items, current, enabled, remove, clear, toggle } = store;
  const [boxOpen, setBoxOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<{ ok: boolean; text: string } | null>(null);

  const toggleBox = useCallback(async () => {
    try {
      setBoxOpen(await invoke<boolean>("toggle_mobcap"));
    } catch {
      /* ignore */
    }
  }, []);

  const testRead = useCallback(async () => {
    setReading(true);
    setRead(null);
    try {
      const t = await invoke<string>("read_mob_region");
      setRead({ ok: true, text: t || "(nothing read)" });
    } catch (e) {
      setRead({ ok: false, text: String(e) });
    } finally {
      setReading(false);
    }
  }, []);

  const session = useMemo(() => {
    let dmg = 0;
    let loot = 0;
    const skills: Record<string, number> = {};
    for (const e of items) {
      dmg += e.hp;
      loot += e.loot_value;
      for (const s of e.skills) skills[s.skill] = (skills[s.skill] ?? 0) + s.xp;
    }
    const topSkills = Object.entries(skills).sort((a, b) => b[1] - a[1]);
    return { kills: items.length, dmg, loot, topSkills };
  }, [items]);

  return (
    <section className="rocks">
      <div className="rocks__toolbar">
        <button
          className={`combtoggle ${enabled ? "combtoggle--on" : ""}`}
          onClick={toggle}
        >
          <span className="combtoggle__dot" />
          {enabled ? "Logging ON" : "Logging OFF"}
        </button>
        <button className={`toolbtn ${boxOpen ? "toolbtn--active" : ""}`} onClick={toggleBox}>
          <IconFrame /> Mob Box
        </button>
        <button className="toolbtn" onClick={testRead} disabled={reading}>
          <IconEye /> {reading ? "Reading…" : "Test Read"}
        </button>
        {read && (
          <span className={`rocks__readout ${read.ok ? "" : "is-err"}`} title={read.text}>
            {read.text}
          </span>
        )}
        {items.length > 0 && (
          <button className="toolbtn toolbtn--right" onClick={clear}>
            <IconTrash /> Clear
          </button>
        )}
      </div>

      <p className="rocks__help">
        Position the Mob Box over the creature name panel once. Combat logs itself — the first hit
        on a new mob OCRs its name and captures your position, then damage, skills and loot track
        until ~1s after loot drops.
      </p>

      {current && (
        <div className="engage">
          <div className="engage__head">
            <span className="engage__dot" />
            <span className="engage__name">{mobTitle(current)}</span>
            <span className="engage__hp">
              {Math.round(current.hp)} dmg · {current.shots} shots
            </span>
          </div>
          {(current.skills.length > 0 || current.loot.length > 0) && (
            <div className="engage__chips">
              {current.skills.map((s) => (
                <span key={s.skill} className="chip">
                  {s.skill} +{s.xp.toFixed(2)}
                </span>
              ))}
              {current.loot.map((l) => (
                <span key={l.item} className="chip chip--loot">
                  {l.item} ×{l.qty} · {ped(l.value)} PED
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="sess">
        <div className="sess__stat">
          <span className="sess__k">Kills</span>
          <b>{session.kills}</b>
        </div>
        <div className="sess__stat">
          <span className="sess__k">Damage</span>
          <b>{Math.round(session.dmg).toLocaleString()}</b>
        </div>
        <div className="sess__stat">
          <span className="sess__k">Loot</span>
          <b>{ped(session.loot)} PED</b>
        </div>
        {session.topSkills.slice(0, 2).map(([k, v]) => (
          <div key={k} className="sess__stat">
            <span className="sess__k">{k}</span>
            <b>+{v.toFixed(2)}</b>
          </div>
        ))}
      </div>

      <div className="rocks__listhead">
        <span className="rocks__listtitle">Encounters</span>
        <span className="rocks__count">{items.length}</span>
      </div>

      <div className="rocks__list">
        {items.length === 0 ? (
          <div className="rocks__empty">
            <IconFrame size={30} />
            <p className="rocks__empty-title">No mobs logged yet</p>
            <p className="rocks__empty-sub">Start shooting — encounters log automatically.</p>
          </div>
        ) : (
          <>
            <div className="enc enc--head">
              <span>Mob</span>
              <span>HP</span>
              <span>Shots</span>
              <span>Loot</span>
              <span>When</span>
              <span />
            </div>
            {items.map((e) => (
              <div key={e.id} className="enc">
                <span className="enc__name">{mobTitle(e)}</span>
                <span className="enc__c">{Math.round(e.hp)}</span>
                <span className="enc__c">{e.shots}</span>
                <span className="enc__c">{ped(e.loot_value)}</span>
                <span className="enc__time">{clock(e.started_at)}</span>
                <span className="enc__actions">
                  <button
                    className="icobtn icobtn--del"
                    onClick={() => remove(e.id)}
                    aria-label="Delete"
                    title="Delete"
                  >
                    <IconTrash />
                  </button>
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
