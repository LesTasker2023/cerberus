import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Encounter } from "../hooks/useEncounters";

/** Always-on-top "engaged" readout shown while the combat logger is armed —
 *  the pulsing dot means live, and the body shows the current target. */
export function CombatHud() {
  const [cur, setCur] = useState<Encounter | null>(null);

  useEffect(() => {
    invoke<Encounter | null>("current_encounter").then(setCur).catch(() => {});
    const un = listen<Encounter | null>("encounter:update", (e) => setCur(e.payload));
    return () => {
      un.then((off) => off());
    };
  }, []);

  const title = cur
    ? `${cur.level != null ? "L" + cur.level + " " : ""}${cur.name || "Unknown"}${
        cur.maturity ? " " + cur.maturity : ""
      }`.trim()
    : "Seeking target…";

  return (
    <div className={`chud ${cur ? "chud--live" : ""}`} data-tauri-drag-region>
      <span className="chud__dot" />
      <div className="chud__body">
        <div className="chud__title">{title}</div>
        <div className="chud__sub">
          {cur
            ? `${Math.round(cur.hp)} dmg · ${cur.shots} shots · ${cur.loot_value.toFixed(2)} PED`
            : "Combat logger armed"}
        </div>
      </div>
      <button
        className="chud__close"
        onClick={() => invoke("toggle_combat").catch(() => {})}
        title="Stop logging"
        aria-label="Stop logging"
      >
        ✕
      </button>
    </div>
  );
}
