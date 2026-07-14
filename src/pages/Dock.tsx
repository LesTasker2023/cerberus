import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface OverlayStates {
  panel: boolean;
  capregion: boolean;
  mobcap: boolean;
  radar: boolean;
  dock: boolean;
}

/**
 * The single in-game command dock. Three clusters, each a compound toggle:
 *   Rock  → the rock Scanner + the log pill
 *   Mob   → the combat logger + the mob Scanner (+ Engaged HUD when shooting)
 *   Radar → the minimap overlay
 * This is the only surface that drives the overlays in-flight.
 */
export function Dock() {
  const [st, setSt] = useState<OverlayStates>({
    panel: false,
    capregion: false,
    mobcap: false,
    radar: false,
    dock: true,
  });
  const [combat, setCombat] = useState(false);

  useEffect(() => {
    invoke<OverlayStates>("overlay_states").then(setSt).catch(() => {});
    invoke<boolean>("combat_enabled").then(setCombat).catch(() => {});
    const un = listen<OverlayStates>("overlays:changed", (e) => setSt(e.payload));
    const en = listen<boolean>("combat:enabled", (e) => setCombat(e.payload));
    return () => {
      un.then((off) => off());
      en.then((off) => off());
    };
  }, []);

  const rockOn = st.capregion;
  const setRock = async (on: boolean) => {
    await invoke("set_overlay", { label: "capregion", on }).catch(() => {});
    await invoke("set_overlay", { label: "panel", on }).catch(() => {});
  };
  const setMob = async (on: boolean) => {
    await invoke("set_combat", { on }).catch(() => {});
    await invoke("set_overlay", { label: "mobcap", on }).catch(() => {});
  };
  const setRadar = (on: boolean) => invoke("set_overlay", { label: "radar", on }).catch(() => {});

  return (
    <div className="dock">
      <button
        className={`dockbtn ${rockOn ? "dockbtn--on" : ""}`}
        onClick={() => setRock(!rockOn)}
        title="Rock logger — scanner + log pill"
      >
        <IconRock />
      </button>
      <button
        className={`dockbtn ${combat ? "dockbtn--on" : ""}`}
        onClick={() => setMob(!combat)}
        title="Mob logger — combat capture + scanner"
      >
        <IconMob />
      </button>
      <button
        className={`dockbtn ${st.radar ? "dockbtn--on" : ""}`}
        onClick={() => setRadar(!st.radar)}
        title="Radar — minimap overlay"
      >
        <IconRadar />
      </button>

      <div className="dock__grip" data-tauri-drag-region title="Drag">
        ⠿
      </div>
    </div>
  );
}

/* ── Outlined red hex-badge icons (one language across the dock) ── */
const HEX = "M12 2.2 20.3 7 20.3 17 12 21.8 3.7 17 3.7 7Z";
const S = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function IconRock() {
  return (
    <svg {...S}>
      <path d={HEX} />
      <path d="M12 6.6 15.6 10.2 12 17.4 8.4 10.2Z" />
      <path d="M8.4 10.2h7.2" opacity="0.55" />
    </svg>
  );
}

function IconMob() {
  return (
    <svg {...S}>
      <path d={HEX} />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 6.6v2M12 15.4v2M6.6 12h2M15.4 12h2" />
    </svg>
  );
}

function IconRadar() {
  return (
    <svg {...S}>
      <path d={HEX} />
      <path d="M12 5.7 17.5 8.9 17.5 15.1 12 18.3 6.5 15.1 6.5 8.9Z" opacity="0.5" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}
