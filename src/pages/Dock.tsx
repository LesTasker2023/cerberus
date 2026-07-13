import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface OverlayStates {
  panel: boolean;
  capregion: boolean;
  radar: boolean;
  dock: boolean;
}

type OverlayKey = "radar" | "capregion" | "panel";

interface DockButton {
  key: OverlayKey;
  cmd: string;
  title: string;
  icon: ReactNode;
}

const BUTTONS: DockButton[] = [
  { key: "radar", cmd: "toggle_radar", title: "Popout map", icon: <IconMap /> },
  { key: "capregion", cmd: "toggle_capregion", title: "OCR capture box", icon: <IconOcr /> },
  { key: "panel", cmd: "toggle_panel", title: "Log pill", icon: <IconLog /> },
];

/** Floating always-on-top HUD dock — one red hex button per popout overlay. */
export function Dock() {
  const [st, setSt] = useState<OverlayStates>({
    panel: false,
    capregion: false,
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

  return (
    <div className="dock">
      {BUTTONS.map((b) => (
        <button
          key={b.key}
          className={`dockbtn ${st[b.key] ? "dockbtn--on" : ""}`}
          onClick={() => invoke(b.cmd).catch(() => {})}
          title={b.title}
        >
          {b.icon}
        </button>
      ))}
      <button
        className={`dockbtn ${combat ? "dockbtn--on" : ""}`}
        onClick={() => invoke("toggle_combat").catch(() => {})}
        title="Combat logger"
      >
        <IconCombat />
      </button>

      <div className="dock__grip" data-tauri-drag-region title="Drag">
        ⠿
      </div>
    </div>
  );
}

/* ── Outlined red hex-badge icons (line-art, matching launcher style) ── */
const HEX = "M12 2.2 20.3 7 20.3 17 12 21.8 3.7 17 3.7 7Z";
const S = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function IconMap() {
  return (
    <svg {...S}>
      <path d={HEX} />
      <path d="M12 5.7 17.5 8.9 17.5 15.1 12 18.3 6.5 15.1 6.5 8.9Z" opacity="0.5" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconOcr() {
  return (
    <svg {...S}>
      <path d={HEX} />
      <path d="M8.9 10.7V8.9H10.7M13.3 8.9H15.1V10.7M15.1 13.3V15.1H13.3M10.7 15.1H8.9V13.3" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconLog() {
  return (
    <svg {...S}>
      <path d={HEX} />
      <path d="M8.6 9.9h6.8M8.6 12h6.8M8.6 14.1h4.2" />
    </svg>
  );
}

function IconCombat() {
  return (
    <svg {...S}>
      <path d={HEX} />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 6.6v2M12 15.4v2M6.6 12h2M15.4 12h2" />
    </svg>
  );
}
