import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useBroadcast } from "../hooks/useBroadcast";
import { startEm, stopEm, useEmRunning } from "../lib/em";
import { FEATURES } from "../lib/features";

interface OverlayStates {
  panel: boolean;
  capregion: boolean;
  mobcap: boolean;
  radar: boolean;
  waypoints: boolean;
  crosshair: boolean;
  calib: boolean;
  alerts: boolean;
  dock: boolean;
}

/**
 * The single in-game command dock. Each button is a compound toggle:
 *   Rock      → the rock Scanner + the log pill
 *   Mob       → the combat logger + the mob Scanner (+ Engaged HUD when shooting)
 *   Radar     → the minimap overlay
 *   Waypoints → the standalone waypoint browser
 * This is the only surface that drives the overlays in-flight.
 */
export function Dock() {
  const [st, setSt] = useState<OverlayStates>({
    panel: false,
    capregion: false,
    mobcap: false,
    radar: false,
    waypoints: false,
    crosshair: false,
    calib: false,
    alerts: false,
    dock: true,
  });
  const [combat, setCombat] = useState(false);
  const cast = useBroadcast();
  const emRunning = useEmRunning();

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
  const setOverlay = (label: string, on: boolean) =>
    invoke("set_overlay", { label, on }).catch(() => {});

  return (
    <div className="dock">
      <div className="dock__bar">
        <button
          className={`dockbtn ${rockOn ? "dockbtn--on" : ""}`}
          onClick={() => setRock(!rockOn)}
          title="Rock logger — scanner + log pill"
        >
          <IconRock />
        </button>
        {FEATURES.mobLogger && (
          <button
            className={`dockbtn ${combat ? "dockbtn--on" : ""}`}
            onClick={() => setMob(!combat)}
            title="Mob logger — combat capture + scanner"
          >
            <IconMob />
          </button>
        )}
        <button
          className={`dockbtn ${st.radar ? "dockbtn--on" : ""}`}
          onClick={() => setOverlay("radar", !st.radar)}
          title="Radar — minimap overlay"
        >
          <IconRadar />
        </button>
        <button
          className={`dockbtn ${st.waypoints ? "dockbtn--on" : ""}`}
          onClick={() => setOverlay("waypoints", !st.waypoints)}
          title="Waypoints — browse by sector, click to copy"
        >
          <IconPin />
        </button>
        <button
          className={`dockbtn ${cast.on ? "dockbtn--on" : ""}`}
          onClick={cast.toggle}
          title="Broadcast your location to the clan"
        >
          <IconCast />
        </button>
        <button
          className={`dockbtn ${st.crosshair ? "dockbtn--on" : ""}`}
          onClick={() => setOverlay("crosshair", !st.crosshair)}
          title="Crosshair overlay — offset in Config"
        >
          <IconCross />
        </button>
        {FEATURES.rangeCalibrator && (
          <button
            className={`dockbtn ${st.calib ? "dockbtn--on" : ""}`}
            onClick={() => setOverlay("calib", !st.calib)}
            title="Range calibrator — dial in the reticle offset"
          >
            <IconCalib />
          </button>
        )}
        <button
          className={`dockbtn ${st.alerts ? "dockbtn--on" : ""}`}
          onClick={() => setOverlay("alerts", !st.alerts)}
          title="Chat alerts — trigger hits pop up in-game"
        >
          <IconAlert />
        </button>
        <button
          className={`dockbtn ${emRunning ? "dockbtn--on" : ""}`}
          onClick={() => (emRunning ? stopEm() : startEm())}
          title="EM assist — engage-mob loop (Ctrl+Shift+K stops)"
        >
          <IconEm />
        </button>

        <div className="dock__grip" data-tauri-drag-region title="Drag">
          ⠿
        </div>
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

function IconPin() {
  return (
    <svg {...S}>
      <path d={HEX} />
      <path d="M12 6.5c-1.85 0-3.35 1.5-3.35 3.35 0 2.45 3.35 6.05 3.35 6.05s3.35-3.6 3.35-6.05c0-1.85-1.5-3.35-3.35-3.35Z" />
      <circle cx="12" cy="9.85" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconCast() {
  return (
    <svg {...S}>
      <path d={HEX} />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <path d="M9.4 9.4a3.7 3.7 0 0 0 0 5.2M14.6 9.4a3.7 3.7 0 0 1 0 5.2" />
    </svg>
  );
}

function IconCross() {
  return (
    <svg {...S}>
      <path d={HEX} />
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 5.4v2.2M12 16.4v2.2M5.4 12h2.2M16.4 12h2.2" />
    </svg>
  );
}

function IconCalib() {
  return (
    <svg {...S}>
      <path d={HEX} />
      <path d="M7 15.5 17 8.5" />
      <path d="M7 15.5v-3M10 13.4v-3M13 11.3v-3" opacity="0.7" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg {...S}>
      <path d={HEX} />
      <path d="M9.2 15.2h5.6M12 7.4a3 3 0 0 0-3 3c0 2.2-.7 3.4-1.2 4.1h8.4c-.5-.7-1.2-1.9-1.2-4.1a3 3 0 0 0-3-3Z" />
      <path d="M11 17.2h2" opacity="0.7" />
    </svg>
  );
}

function IconEm() {
  return (
    <svg {...S}>
      <path d={HEX} />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="M12 5.2v2M12 16.8v2M5.2 12h2M16.8 12h2" opacity="0.75" />
    </svg>
  );
}
