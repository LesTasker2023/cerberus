import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WindowControls } from "./components/WindowControls";
import { Dashboard } from "./pages/Dashboard";
import { Feed } from "./pages/Feed";
import { Asteroids } from "./pages/Asteroids";
import { Combat } from "./pages/Combat";
import { MobDb } from "./pages/MobDb";
import { MapView } from "./pages/MapView";
import { Settings } from "./pages/Settings";
import { Login } from "./pages/Login";
import { useAuth, isAuthed } from "./hooks/useAuth";
import { useLogWatch } from "./hooks/useLogWatch";
import { useFeedIntel } from "./hooks/useFeedIntel";
import { useAsteroids } from "./hooks/useAsteroids";
import { useEncounters } from "./hooks/useEncounters";
import { usePois } from "./hooks/usePois";
import { usePlayerPosition } from "./hooks/usePlayerPosition";
import { useUpdater } from "./hooks/useUpdater";

type Page = "home" | "feed" | "rocks" | "combat" | "bestiary" | "map" | "settings";

export default function App() {
  const auth = useAuth();
  const watch = useLogWatch();
  const intel = useFeedIntel();
  const rocks = useAsteroids();
  const encounters = useEncounters();
  const poiStore = usePois();
  const playerPos = usePlayerPosition();
  useUpdater();
  const [page, setPage] = useState<Page>("home");
  const [dockOpen, setDockOpen] = useState(false);

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

  return (
    <div className="app">
      <header className="titlebar" data-tauri-drag-region>
        <button
          className="brand"
          onClick={() => setPage("home")}
          title="Command"
        >
          <span className="brand__diamond" />
          CERBERUS
        </button>

        <div className="titlebar__drag" data-tauri-drag-region />

        <div
          className={`titlebar__sys ${watch.status.watching ? "titlebar__sys--on" : ""}`}
        >
          <span className="titlebar__sysdot" />
          {watch.status.watching ? "ONLINE" : "OFFLINE"}
        </div>

        <button
          className={`hudtoggle ${dockOpen ? "hudtoggle--on" : ""}`}
          onClick={() => invoke("toggle_dock").catch(() => {})}
          title="HUD dock"
          aria-label="HUD dock"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
            <path d="M12 2 20.5 7 20.5 17 12 22 3.5 17 3.5 7Z" />
            <path d="M12 6.5 16.7 9.2 16.7 14.8 12 17.5 7.3 14.8 7.3 9.2Z" opacity="0.5" />
          </svg>
        </button>

        {auth.session && (
          <button className="userchip" onClick={auth.logout} title="Sign out">
            {auth.session.avatar_url ? (
              <img className="userchip__av" src={auth.session.avatar_url} alt="" />
            ) : (
              <span className="userchip__av userchip__av--none" />
            )}
            <span className="userchip__name">{auth.session.display_name}</span>
          </button>
        )}

        <WindowControls />
      </header>

      <main className="content">
        {page === "home" && (
          <Dashboard
            watch={watch}
            rocks={rocks}
            encounters={encounters}
            poiStore={poiStore}
            onNavigate={setPage}
          />
        )}
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
          />
        )}
        {page === "settings" && (
          <Settings watch={watch} onWatchStarted={() => setPage("feed")} />
        )}
      </main>
    </div>
  );
}
