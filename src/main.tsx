import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { Panel } from "./pages/Panel";
import { CaptureRegion } from "./pages/CaptureRegion";
import { BattleRadar } from "./pages/BattleRadar";
import "./styles.css";

// One frontend, several windows — branch on the window label.
const label = getCurrentWindow().label;
if (label === "capregion" || label === "panel" || label === "radar") {
  document.documentElement.classList.add("win-transparent");
}

function root() {
  if (label === "panel") return <Panel />;
  if (label === "capregion") return <CaptureRegion />;
  if (label === "radar") return <BattleRadar />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{root()}</React.StrictMode>,
);
