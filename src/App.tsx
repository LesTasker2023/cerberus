import { useEffect, useState } from "react";
import { WindowControls } from "./components/WindowControls";
import { Feed } from "./pages/Feed";
import { Asteroids } from "./pages/Asteroids";
import { MapView } from "./pages/MapView";
import { Settings } from "./pages/Settings";
import { useLogWatch } from "./hooks/useLogWatch";
import { useAsteroids } from "./hooks/useAsteroids";
import { usePois } from "./hooks/usePois";
import { usePlayerPosition } from "./hooks/usePlayerPosition";
import { useUpdater } from "./hooks/useUpdater";

type Page = "feed" | "rocks" | "map" | "settings";

export default function App() {
  const watch = useLogWatch();
  const rocks = useAsteroids();
  const poiStore = usePois();
  const playerPos = usePlayerPosition();
  useUpdater();
  const [page, setPage] = useState<Page>("feed");

  // Auto-start the tail on boot if a log path resolves. Non-fatal if none does.
  useEffect(() => {
    watch.start().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <header className="titlebar" data-tauri-drag-region>
        <nav className="nav">
          <button
            className={`nav__tab ${page === "feed" ? "nav__tab--active" : ""}`}
            onClick={() => setPage("feed")}
          >
            Feed
            <span
              className={`tabdot ${watch.status.watching ? "tabdot--on" : "tabdot--off"}`}
            />
          </button>
          <button
            className={`nav__tab ${page === "rocks" ? "nav__tab--active" : ""}`}
            onClick={() => setPage("rocks")}
          >
            Rocks
          </button>
          <button
            className={`nav__tab ${page === "map" ? "nav__tab--active" : ""}`}
            onClick={() => setPage("map")}
          >
            Map
          </button>
          <button
            className={`nav__tab ${page === "settings" ? "nav__tab--active" : ""}`}
            onClick={() => setPage("settings")}
          >
            Config
          </button>
        </nav>

        <div className="titlebar__drag" data-tauri-drag-region />

        <WindowControls />
      </header>

      <main className="content">
        {page === "feed" && <Feed watch={watch} />}
        {page === "rocks" && <Asteroids store={rocks} />}
        {page === "map" && <MapView store={rocks} poiStore={poiStore} playerPos={playerPos} />}
        {page === "settings" && (
          <Settings watch={watch} onWatchStarted={() => setPage("feed")} />
        )}
      </main>
    </div>
  );
}
