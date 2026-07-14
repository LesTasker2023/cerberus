import type { ReactNode } from "react";
import type { DiscordSession } from "../hooks/useAuth";

export type Page = "home" | "feed" | "rocks" | "combat" | "bestiary" | "map" | "media" | "settings";

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
  onLogout,
  dockOpen,
  onToggleDock,
}: {
  page: Page;
  onNavigate: (p: Page) => void;
  watching: boolean;
  session: DiscordSession | null | undefined;
  onLogout: () => void;
  dockOpen: boolean;
  onToggleDock: () => void;
}) {
  const groups: { label: string; items: NavItem[] }[] = [
    { label: "Command", items: [{ page: "home", label: "Dashboard", icon: <IconDeck /> }] },
    {
      label: "Tools",
      items: [
        { page: "feed", label: "Feed", icon: <IconFeed />, live: watching },
        { page: "rocks", label: "Rock Logger", icon: <IconRocks /> },
        { page: "combat", label: "Mob Logger", icon: <IconCombat /> },
        { page: "bestiary", label: "Bestiary", icon: <IconBestiary /> },
        { page: "map", label: "Map", icon: <IconMap /> },
        { page: "media", label: "Media", icon: <IconMedia /> },
      ],
    },
    { label: "System", items: [{ page: "settings", label: "Config", icon: <IconConfig /> }] },
  ];

  return (
    <aside className="side">
      <button className="side__brand" onClick={() => onNavigate("home")} title="Command Deck">
        <span className="side__diamond" />
        CERBERUS
      </button>

      <nav className="side__nav">
        {groups.map((g) => (
          <div key={g.label} className="navgroup">
            <div className="navgroup__lbl">{g.label}</div>
            {g.items.map((it) => (
              <button
                key={it.page}
                className={`navitem ${page === it.page ? "navitem--on" : ""}`}
                onClick={() => onNavigate(it.page)}
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
        <button
          className={`sidebtn ${dockOpen ? "sidebtn--on" : ""}`}
          onClick={onToggleDock}
          title="Floating HUD dock"
        >
          <IconDock />
          HUD Dock
        </button>

        <div className={`sidestat ${watching ? "sidestat--on" : ""}`}>
          <span className="sidestat__dot" />
          {watching ? "Watcher online" : "Watcher offline"}
        </div>

        {session && (
          <button className="sideuser" onClick={onLogout} title="Sign out">
            {session.avatar_url ? (
              <img className="sideuser__av" src={session.avatar_url} alt="" />
            ) : (
              <span className="sideuser__av sideuser__av--none" />
            )}
            <span className="sideuser__name">{session.display_name}</span>
            <IconPower />
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
function IconDock() {
  return (
    <svg {...S}>
      <path d="M12 2 20 6.5 20 15.5 12 20 4 15.5 4 6.5Z" />
      <circle cx="12" cy="11" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconPower() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="sideuser__out">
      <path d="M12 4v7M7 6a7 7 0 1 0 10 0" />
    </svg>
  );
}
