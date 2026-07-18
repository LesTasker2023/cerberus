import { useEffect, useState } from "react";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_CROSSHAIR, loadCrosshair, type CrosshairConfig } from "../lib/crosshair";

/** Full-screen, click-through crosshair overlay. Draws a reticle at screen
 *  centre plus an adjustable offset — a passive visual aid to compensate for the
 *  broken in-game convergence between the pilot seat and the belly gun. */
export function Crosshair() {
  const [cfg, setCfg] = useState<CrosshairConfig>(DEFAULT_CROSSHAIR);

  useEffect(() => {
    const win = getCurrentWindow();
    // Never intercept the mouse — clicks pass straight through to the game.
    win.setIgnoreCursorEvents(true).catch(() => {});
    // Cover the primary monitor so "centre" is the screen centre.
    currentMonitor()
      .then((mon) => {
        if (!mon) return;
        win.setPosition(new PhysicalPosition(mon.position.x, mon.position.y)).catch(() => {});
        win.setSize(new PhysicalSize(mon.size.width, mon.size.height)).catch(() => {});
      })
      .catch(() => {});

    setCfg(loadCrosshair());
    const un = listen<CrosshairConfig>("crosshair:changed", (e) => setCfg(e.payload));
    return () => {
      un.then((off) => off());
    };
  }, []);

  const { offsetX, offsetY, size, gap, thickness, color, dot, ring, ringRadius } = cfg;
  const ext = Math.max(size, ring ? ringRadius : 0) + thickness + 2;
  return (
    <div className="xhair">
      <div className="xhair__wrap" style={{ transform: `translate(${offsetX}px, ${offsetY}px)` }}>
        <svg width={ext * 2} height={ext * 2} viewBox={`${-ext} ${-ext} ${ext * 2} ${ext * 2}`}>
          {ring && (
            <circle cx={0} cy={0} r={ringRadius} fill="none" stroke={color} strokeWidth={thickness} />
          )}
          <g stroke={color} strokeWidth={thickness} strokeLinecap="round">
            <line x1={-size} y1={0} x2={-gap} y2={0} />
            <line x1={gap} y1={0} x2={size} y2={0} />
            <line x1={0} y1={-size} x2={0} y2={-gap} />
            <line x1={0} y1={gap} x2={0} y2={size} />
          </g>
          {dot && <circle cx={0} cy={0} r={Math.max(1, thickness * 0.9)} fill={color} />}
        </svg>
      </div>
    </div>
  );
}
