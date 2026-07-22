import type { ReactNode } from "react";
import type { DiscordSession } from "../hooks/useAuth";
import { FEATURES } from "../lib/features";

export type Page =
  | "home"
  | "feed"
  | "rocks"
  | "combat"
  | "bestiary"
  | "map"
  | "codex"
  | "media"
  | "clan"
  | "delboy"
  | "arb"
  | "trade"
  | "tracker"
  | "profile"
  | "settings";

interface NavItem {
  page: Page;
  label: string;
  icon: ReactNode;
  live?: boolean;
}

/** Persistent left tools rail — logo, grouped navigation, status slot. The app's
 *  primary navigation surface (the old top titlebar nav is retired). */
export function Sidebar({
  page,
  onNavigate,
  watching,
  session,
  collapsed,
  onToggleCollapse,
}: {
  page: Page;
  onNavigate: (p: Page) => void;
  watching: boolean;
  session: DiscordSession | null | undefined;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const home: NavItem = { page: "home", label: "Dashboard", icon: <IconDeck /> };
  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: "Live",
      items: [
        { page: "feed", label: "Feed", icon: <IconFeed />, live: watching },
        { page: "clan", label: "Clan Sync", icon: <IconClan /> },
        { page: "delboy", label: "DelBoy", icon: <IconGavel /> },
        { page: "arb", label: "Arb Board", icon: <IconArb /> },
        { page: "media", label: "Media", icon: <IconMedia /> },
      ],
    },
    {
      label: "Resources",
      items: [
        { page: "map", label: "Map", icon: <IconMap /> },
        { page: "codex", label: "Database", icon: <IconCodex /> },
        { page: "bestiary", label: "Observations", icon: <IconBestiary /> },
      ],
    },
    {
      label: "Automation",
      items: [
        { page: "rocks", label: "Rock Logger", icon: <IconRocks /> },
        ...(FEATURES.mobLogger
          ? [{ page: "combat", label: "Mob Logger", icon: <IconCombat /> } as NavItem]
          : []),
        { page: "trade", label: "Trade", icon: <IconDollar /> },
        { page: "tracker", label: "Tracker", icon: <IconTracker /> },
      ],
    },
    { label: "System", items: [{ page: "settings", label: "Config", icon: <IconConfig /> }] },
  ];

  return (
    <aside className="side">
      <button
        className="side__collapse"
        onClick={onToggleCollapse}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <IconCollapse />
      </button>

      <button className="side__brand" onClick={() => onNavigate("home")} title="Command Deck">
        <img className="side__mark" src="/logo.png" alt="" />
        <span className="side__brandtext">CERBERUS</span>
      </button>

      <nav className="side__nav">
        <button
          className={`navitem navitem--top ${page === home.page ? "navitem--on" : ""}`}
          onClick={() => onNavigate(home.page)}
          title={home.label}
        >
          <span className="navitem__icon">{home.icon}</span>
          <span className="navitem__label">{home.label}</span>
        </button>

        {groups.map((g) => (
          <div key={g.label} className="navgroup">
            <div className="navgroup__lbl">{g.label}</div>
            {g.items.map((it) => (
              <button
                key={it.page}
                className={`navitem ${page === it.page ? "navitem--on" : ""}`}
                onClick={() => onNavigate(it.page)}
                title={it.label}
              >
                <span className="navitem__icon">{it.icon}</span>
                <span className="navitem__label">{it.label}</span>
                {it.live && <span className="navitem__dot" />}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="side__foot">
        {session && (
          <button
            className={`sideuser ${page === "profile" ? "sideuser--on" : ""}`}
            onClick={() => onNavigate("profile")}
            title="Player profile"
          >
            {session.avatar_url ? (
              <img className="sideuser__av" src={session.avatar_url} alt="" />
            ) : (
              <span className="sideuser__av sideuser__av--none" />
            )}
            <span className="sideuser__name">{session.display_name}</span>
          </button>
        )}
      </div>
    </aside>
  );
}

/* ── Nav icons (one stroked language) ── */
const S = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function IconDeck() {
  return (
    <svg {...S}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function IconFeed() {
  return (
    <svg {...S}>
      <path d="M4 11a8 8 0 0 1 8-8M4 16a3 3 0 0 1 3-3" />
      <circle cx="5" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconRocks() {
  return (
    <svg {...S}>
      <path d="M12 3l7 4.2v8.6L12 21l-7-5.2V7.2L12 3z" />
      <path d="M12 3v18M5 7.2l7 4 7-4" opacity="0.4" />
    </svg>
  );
}
function IconCombat() {
  return (
    <svg {...S}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 1.8v3.4M12 18.8v3.4M1.8 12h3.4M18.8 12h3.4" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
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
function IconMap() {
  return (
    <svg {...S}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconCodex() {
  return (
    <svg {...S}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v14H6a2 2 0 0 0-2 2z" />
      <path d="M8 8h7M8 11h7" opacity="0.6" />
    </svg>
  );
}
function IconTracker() {
  return (
    <svg {...S}>
      <path d="M3.5 14.5l4-5 3.5 3.5 4-6 2.5 3.5h3" />
      <circle cx="7.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconDollar() {
  return (
    <svg {...S}>
      <path d="M12 3v18" />
      <path d="M16 7.2c-1-1.3-2.5-1.8-4-1.8-2 0-3.6 1-3.6 2.9 0 4.2 8 2 8 6.2 0 2-1.8 3-4.2 3-1.7 0-3.3-.6-4.2-2" />
    </svg>
  );
}
function IconArb() {
  return (
    <svg {...S}>
      <path d="M7 7h11l-3-3M17 17H6l3 3" />
      <circle cx="5.5" cy="7" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="17" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconGavel() {
  return (
    <svg {...S}>
      <path d="M9 11 4 16a1.6 1.6 0 0 0 2.3 2.3l5-5" />
      <path d="M8.5 8.5 14 14M11.5 5.5 17 11" />
      <path d="M13 3.5 20.5 11" />
      <path d="M4 21h8" />
    </svg>
  );
}
function IconClan() {
  return (
    <svg {...S}>
      <circle cx="9" cy="9" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 6.5a3 3 0 0 1 0 5.5M17.5 19a5.5 5.5 0 0 0-3-4.9" opacity="0.6" />
    </svg>
  );
}
function IconMedia() {
  return (
    <svg {...S}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 9.2v5.6l4.5-2.8z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconConfig() {
  return (
    <svg {...S}>
      <path d="M5 7h14M5 12h14M5 17h14" />
      <rect x="7.4" y="5.4" width="3.2" height="3.2" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="13.4" y="10.4" width="3.2" height="3.2" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="9" y="15.4" width="3.2" height="3.2" rx="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconCollapse() {
  return (
    <svg {...S}>
      <path d="M14 7l-5 5 5 5" />
      <path d="M19 5v14" opacity="0.5" />
    </svg>
  );
}
