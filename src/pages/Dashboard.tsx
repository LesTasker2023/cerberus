import type { ReactNode } from "react";
import type { useLogWatch } from "../hooks/useLogWatch";
import type { useAsteroids } from "../hooks/useAsteroids";
import type { useEncounters } from "../hooks/useEncounters";
import type { usePois } from "../hooks/usePois";

type Page = "feed" | "rocks" | "combat" | "bestiary" | "map" | "settings";

export interface DashboardProps {
  watch: ReturnType<typeof useLogWatch>;
  rocks: ReturnType<typeof useAsteroids>;
  encounters: ReturnType<typeof useEncounters>;
  poiStore: ReturnType<typeof usePois>;
  onNavigate: (page: Page) => void;
}

interface Tile {
  page: Page;
  index: string;
  name: string;
  desc: string;
  icon: ReactNode;
  live: boolean;
  status: string;
}

/** Command-centre landing — tiles route into each page, footers show live state. */
export function Dashboard({
  watch,
  rocks,
  encounters,
  poiStore,
  onNavigate,
}: DashboardProps) {
  const watching = watch.status.watching;
  const linked = Boolean(watch.status.path);

  const tiles: Tile[] = [
    {
      page: "feed",
      index: "01",
      name: "Feed",
      desc: "Live chat.log intel stream",
      icon: <IconFeed />,
      live: watching,
      status: watching ? `${watch.items.length} events` : "offline",
    },
    {
      page: "rocks",
      index: "02",
      name: "Rock Logger",
      desc: "Asteroid logger & registry",
      icon: <IconRocks />,
      live: rocks.items.length > 0,
      status: `${rocks.items.length} logged`,
    },
    {
      page: "combat",
      index: "03",
      name: "Mob Logger",
      desc: "Mob hunt & loot tracker",
      icon: <IconCombat />,
      live: encounters.current != null,
      status: encounters.current ? "engaged" : `${encounters.items.length} logged`,
    },
    {
      page: "bestiary",
      index: "04",
      name: "Bestiary",
      desc: "Per-mob loot tables",
      icon: <IconBestiary />,
      live: false,
      status: `${new Set(encounters.items.map((e) => e.name || "Unknown")).size} species`,
    },
    {
      page: "map",
      index: "05",
      name: "Map",
      desc: "3D tactical sector map",
      icon: <IconMap />,
      live: poiStore.items.length > 0,
      status: `${poiStore.items.length} waypoints`,
    },
    {
      page: "settings",
      index: "06",
      name: "Config",
      desc: "Log path & system setup",
      icon: <IconConfig />,
      live: linked,
      status: linked ? "log linked" : "no log path",
    },
  ];

  return (
    <div className="dash">
      <div className="dash__grid">
        {tiles.map((t, i) => (
          <button
            key={t.page}
            className="tile"
            style={{ animationDelay: `${60 + i * 55}ms` }}
            onClick={() => onNavigate(t.page)}
          >
            <span className="tile__ticks" aria-hidden />
            <span className="tile__edge" aria-hidden />

            <div className="tile__top">
              <span className="tile__index">{t.index}</span>
              <span className="tile__icon">{t.icon}</span>
            </div>

            <div className="tile__body">
              <div className="tile__name">{t.name}</div>
              <div className="tile__desc">{t.desc}</div>
            </div>

            <div className="tile__foot">
              <span
                className={`tile__dot ${t.live ? "tile__dot--on" : "tile__dot--off"}`}
              />
              <span className="tile__status">{t.status}</span>
              <span className="tile__go" aria-hidden>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="square" />
                </svg>
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Tactical stroked icons ── */
const S = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
} as const;

function IconFeed() {
  return (
    <svg {...S}>
      <path d="M4 11a8 8 0 0 1 8-8M4 15a4 4 0 0 1 4-4" strokeLinecap="round" />
      <path d="M4 19a12 12 0 0 1 12-12" strokeLinecap="round" opacity="0.45" />
      <circle cx="5" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconRocks() {
  return (
    <svg {...S}>
      <path d="M12 3l7 4.2v8.6L12 21l-7-5.2V7.2L12 3z" strokeLinejoin="miter" />
      <path d="M12 3v18M5 7.2l7 4 7-4" opacity="0.4" />
    </svg>
  );
}

function IconBestiary() {
  return (
    <svg {...S}>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6" />
      <path d="M4.5 12v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6" opacity="0.5" />
    </svg>
  );
}

function IconCombat() {
  return (
    <svg {...S}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconMap() {
  return (
    <svg {...S}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <path d="M12 12l4.5-4.5" opacity="0.4" />
    </svg>
  );
}

function IconConfig() {
  return (
    <svg {...S}>
      <path d="M5 7h14M5 12h14M5 17h14" strokeLinecap="round" />
      <rect
        x="7.5"
        y="5.4"
        width="3.2"
        height="3.2"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="13.3"
        y="10.4"
        width="3.2"
        height="3.2"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="9"
        y="15.4"
        width="3.2"
        height="3.2"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
