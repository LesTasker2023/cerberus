import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { Panel } from "./pages/Panel";
import { CaptureRegion } from "./pages/CaptureRegion";
import { MobCaptureRegion } from "./pages/MobCaptureRegion";
import { BattleRadar } from "./pages/BattleRadar";
import { Dock } from "./pages/Dock";
import { CombatHud } from "./pages/CombatHud";
import { Splash } from "./pages/Splash";
import "./styles.css";

// One frontend, several windows — branch on the window label.
const label = getCurrentWindow().label;
if (["capregion", "mobcap", "panel", "radar", "dock", "combathud", "splash"].includes(label)) {
  document.documentElement.classList.add("win-transparent");
}

function root() {
  if (label === "panel") return <Panel />;
  if (label === "capregion") return <CaptureRegion />;
  if (label === "mobcap") return <MobCaptureRegion />;
  if (label === "radar") return <BattleRadar />;
  if (label === "dock") return <Dock />;
  if (label === "combathud") return <CombatHud />;
  if (label === "splash") return <Splash />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{root()}</React.StrictMode>,
);
