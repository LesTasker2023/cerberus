import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { Panel } from "./pages/Panel";
import { CaptureRegion } from "./pages/CaptureRegion";
import { MobCaptureRegion } from "./pages/MobCaptureRegion";
import { BattleRadar } from "./pages/BattleRadar";
import { Dock } from "./pages/Dock";
import { Waypoints } from "./pages/Waypoints";
import { CombatHud } from "./pages/CombatHud";
import { Crosshair } from "./pages/Crosshair";
import { Splash } from "./pages/Splash";
import "./styles.css";

// One frontend, several windows — branch on the window label.
const label = getCurrentWindow().label;
if (
  ["capregion", "mobcap", "panel", "radar", "dock", "waypoints", "combathud", "crosshair", "splash"].includes(
    label,
  )
) {
  document.documentElement.classList.add("win-transparent");
}

function root() {
  if (label === "panel") return <Panel />;
  if (label === "capregion") return <CaptureRegion />;
  if (label === "mobcap") return <MobCaptureRegion />;
  if (label === "radar") return <BattleRadar />;
  if (label === "dock") return <Dock />;
  if (label === "waypoints") return <Waypoints />;
  if (label === "combathud") return <CombatHud />;
  if (label === "crosshair") return <Crosshair />;
  if (label === "splash") return <Splash />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{root()}</React.StrictMode>,
);
