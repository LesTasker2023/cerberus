import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WindowControls } from "./components/WindowControls";
import { Backdrop } from "./components/Backdrop";
import { Sidebar, type Page } from "./components/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { Feed } from "./pages/Feed";
import { Asteroids } from "./pages/Asteroids";
import { Combat } from "./pages/Combat";
import { MobDb } from "./pages/MobDb";
import { MapView } from "./pages/MapView";
import { Codex } from "./pages/Codex";
import { Media } from "./pages/Media";
import { ClanFeed } from "./pages/ClanFeed";
import { Profile } from "./pages/Profile";
import { Settings } from "./pages/Settings";
import { Login } from "./pages/Login";
import { useAuth, isAuthed } from "./hooks/useAuth";
import { useLogWatch } from "./hooks/useLogWatch";
import { useFeedIntel } from "./hooks/useFeedIntel";
import { useEcIntel } from "./hooks/useEcIntel";
import { useAsteroids } from "./hooks/useAsteroids";
import { useEncounters } from "./hooks/useEncounters";
import { usePois } from "./hooks/usePois";
import { usePlayerPosition } from "./hooks/usePlayerPosition";
import { useBroadcast } from "./hooks/useBroadcast";
import { useUpdater } from "./hooks/useUpdater";
import { useLocations } from "./hooks/useLocations";
import { insertSighting } from "./lib/sightings";
import { upsertLocation } from "./lib/locations";

export default function App() {
  const auth = useAuth();
  const watch = useLogWatch();
  const intel = useFeedIntel();
  const ec = useEcIntel();
  const rocks = useAsteroids();
  const encounters = useEncounters();
  const poiStore = usePois();
  const playerPos = usePlayerPosition();
  const broadcast = useBroadcast();
  const clanLocations = useLocations();
  useUpdater();
  const [page, setPage] = useState<Page>("home");
  const [dockOpen, setDockOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(
    () => localStorage.getItem("rail-collapsed") === "1",
  );

  useEffect(() => {
    localStorage.setItem("rail-collapsed", railCollapsed ? "1" : "0");
  }, [railCollapsed]);

  // Location-broadcast heartbeat interval (seconds), configurable in Config.
  const [pingInterval, setPingInterval] = useState(() => {
    const v = Number(localStorage.getItem("cerberus.pingInterval"));
    return v >= 3 ? v : 10;
  });
  useEffect(() => {
    localStorage.setItem("cerberus.pingInterval", String(pingInterval));
  }, [pingInterval]);

  // Track HUD dock visibility for the titlebar toggle's active state.
  useEffect(() => {
    const un = listen<{ dock: boolean }>("overlays:changed", (e) =>
      setDockOpen(e.payload.dock),
    );
    return () => {
      un.then((off) => off());
    };
  }, []);

  // Auto-start the tail on boot and keep retrying until it catches. The log
  // often doesn't exist yet when Cerberus launches before Entropia, so a single
  // attempt would silently fail and sit OFFLINE — watching must never depend on
  // a manual Start. Retries stop once watching.
  const watchingRef = useRef(watch.status.watching);
  watchingRef.current = watch.status.watching;
  useEffect(() => {
    let cancelled = false;
    const attempt = () => {
      if (cancelled || watchingRef.current) return;
      watch.start().catch(() => {});
    };
    attempt();
    const id = setInterval(attempt, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dismiss the splash + reveal this window after the takeover animation plays.
  useEffect(() => {
    const t = setTimeout(() => {
      invoke("finish_splash").catch(() => {});
    }, 6200);
    return () => clearTimeout(t);
  }, []);

  // Single auto-ping: while broadcasting, fire the in-game `<` on the configured
  // interval so our position refreshes on a heartbeat (which then shares + moves
  // the map marker). Only pings when Entropia is the focused window, so it never
  // steals focus from another app. The ONLY interval capture — maps don't self-ping.
  useEffect(() => {
    if (!broadcast.on) return;
    const fire = async () => {
      if (await invoke<boolean>("entropia_focused").catch(() => false)) {
        invoke("capture_position").catch(() => {});
      }
    };
    fire();
    const id = setInterval(fire, Math.max(3, pingInterval) * 1000);
    return () => clearInterval(id);
  }, [broadcast.on, pingInterval]);

  // Location broadcast: while the toggle is on, post our position into the clan
  // sync feed on every update — deduped by coordinates so each distinct spot is
  // one entry (standing still doesn't spam). The main window owns this; the HUD
  // dock only flips the shared flag. Fires on toggle-on too (posts current pos).
  const lastBroadcastRef = useRef("");
  useEffect(() => {
    if (!broadcast.on || !playerPos || !auth.session) return;
    const key = `${playerPos.x},${playerPos.y},${playerPos.z}`;
    if (key === lastBroadcastRef.current) return;
    lastBroadcastRef.current = key;
    // Log it in the sync feed …
    insertSighting({
      kind: "location",
      name: "Location",
      x: playerPos.x,
      y: playerPos.y,
      z: playerPos.z,
      value: null,
      pilot: auth.session.display_name,
    }).catch(() => {});
    // … and update our live presence row (drives the map markers).
    upsertLocation({
      pilot_id: auth.session.user_id,
      pilot: auth.session.display_name,
      x: playerPos.x,
      y: playerPos.y,
      z: playerPos.z,
    }).catch(() => {});
  }, [broadcast.on, playerPos, auth.session]);

  // Clan gate: only active once the Discord app IDs are configured. Until then
  // the app stays open so it's usable before login is wired up.
  if (auth.configured === true && !isAuthed(auth.session)) {
    return (
      <Login
        session={auth.session}
        busy={auth.busy}
        error={auth.error}
        onLogin={auth.login}
        onLogout={auth.logout}
      />
    );
  }

  const TITLES: Record<Page, string> = {
    home: "Dashboard",
    feed: "Intel Feed",
    rocks: "Rock Logger",
    combat: "Mob Logger",
    bestiary: "Observations",
    map: "Sector Map",
    codex: "Database",
    media: "Media",
    clan: "Clan Sync",
    profile: "Player Profile",
    settings: "Config",
  };

  return (
    <div className={`app ${railCollapsed ? "app--rail" : ""}`}>
      <Backdrop />
      <Sidebar
        page={page}
        onNavigate={setPage}
        watching={watch.status.watching}
        session={auth.session}
        collapsed={railCollapsed}
        onToggleCollapse={() => setRailCollapsed((v) => !v)}
      />

      <div className="main">
        <header className="topbar" data-tauri-drag-region>
          <span className="topbar__title">{TITLES[page]}</span>
          <div className="topbar__drag" data-tauri-drag-region />
          <button
            className={`topbar__cast ${broadcast.on ? "topbar__cast--live" : ""}`}
            onClick={broadcast.toggle}
            title={
              broadcast.on
                ? "Broadcasting your location to the clan — click to stop"
                : "Broadcast your location to the clan"
            }
            aria-label="Toggle location broadcast"
          >
            <BroadcastIcon />
          </button>
          <button
            className={`topbar__dock ${dockOpen ? "topbar__dock--on" : ""}`}
            onClick={() => invoke("toggle_dock").catch(() => {})}
            title="Floating HUD dock"
            aria-label="Toggle HUD dock"
          >
            <HudDockIcon />
          </button>
          <WindowControls />
        </header>

        <main className="content">
          {page === "home" && <Dashboard ec={ec} />}
          {page === "feed" && <Feed watch={watch} intel={intel} />}
          {page === "rocks" && <Asteroids store={rocks} />}
          {page === "combat" && <Combat store={encounters} />}
          {page === "bestiary" && <MobDb store={encounters} />}
          {page === "map" && (
            <MapView
              store={rocks}
              poiStore={poiStore}
              playerPos={playerPos}
              mobStore={encounters}
              presence={clanLocations.filter((l) => l.pilot_id !== auth.session?.user_id)}
            />
          )}
          {page === "codex" && <Codex />}
          {page === "media" && <Media />}
          {page === "clan" && <ClanFeed pilot={auth.session?.display_name} />}
          {page === "profile" && (
            <Profile
              session={auth.session}
              onLogout={() => {
                auth.logout();
                setPage("home");
              }}
            />
          )}
          {page === "settings" && (
            <Settings
              watch={watch}
              onWatchStarted={() => setPage("feed")}
              pingInterval={pingInterval}
              onPingInterval={setPingInterval}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function BroadcastIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M6 6a8 8 0 0 0 0 12M18 6a8 8 0 0 1 0 12" opacity="0.5" />
    </svg>
  );
}
function HudDockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2 20 6.5 20 15.5 12 20 4 15.5 4 6.5Z" />
      <circle cx="12" cy="11" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
