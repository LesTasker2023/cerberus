import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DEFAULT_CROSSHAIR,
  loadCrosshair,
  rangeOffset,
  saveCrosshair,
  solveK,
  type CrosshairConfig,
} from "../lib/crosshair";

const SAMPLES = [10, 20, 30, 50, 75, 100];

/** Floating range-offset calibrator. Nudge the reticle to line up at one known
 *  range, Solve → k, then the reticle auto-offsets by k·(1/range − 1/rMax).
 *  Writes the shared crosshair config, so the overlay updates live. */
export function Calibrator() {
  const [cfg, setCfg] = useState<CrosshairConfig>(DEFAULT_CROSSHAIR);

  useEffect(() => {
    setCfg(loadCrosshair());
    const un = listen<CrosshairConfig>("crosshair:changed", (e) => setCfg(e.payload));
    return () => {
      un.then((off) => off());
    };
  }, []);

  const update = (patch: Partial<CrosshairConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    saveCrosshair(next);
  };

  const solve = () => {
    if (cfg.range > 0 && cfg.rMax > 0 && cfg.range !== cfg.rMax) {
      // Fold the nudged offset into k, then let the formula drive it.
      update({ k: solveK(cfg.range, cfg.offsetY, cfg.rMax), rangeMode: true, offsetY: 0 });
    }
  };

  const close = () => invoke("hide_window", { label: "calib" }).catch(() => {});
  const liveOffset = rangeOffset(cfg);

  return (
    <div className="calib">
      <header className="calib__head" data-tauri-drag-region>
        <span className="calib__title">Range Calibrator</span>
        <button className="calib__x" onClick={close} title="Close">
          ×
        </button>
      </header>

      <div className="calib__body">
        <label className="calib__row">
          <span>Range mode</span>
          <input
            type="checkbox"
            checked={cfg.rangeMode}
            onChange={(e) => update({ rangeMode: e.target.checked })}
          />
        </label>

        <label className="calib__row">
          <span>Max range (0 offset)</span>
          <input
            type="number"
            value={cfg.rMax}
            min={1}
            onChange={(e) => update({ rMax: Number(e.target.value) || 1 })}
          />
        </label>

        <label className="calib__row">
          <span>Target range</span>
          <input
            type="number"
            value={cfg.range}
            min={0}
            onChange={(e) => update({ range: Number(e.target.value) || 0 })}
          />
        </label>

        <div className="calib__nudge">
          <span>Offset {cfg.rangeMode ? liveOffset.toFixed(1) : cfg.offsetY.toFixed(1)} px</span>
          <div className="calib__btns">
            <button onClick={() => update({ offsetY: cfg.offsetY - 1, rangeMode: false })}>▲</button>
            <button onClick={() => update({ offsetY: cfg.offsetY + 1, rangeMode: false })}>▼</button>
          </div>
        </div>

        <button className="btn btn--accent calib__solve" onClick={solve}>
          Solve k at {cfg.range || "?"}m
        </button>

        <div className="calib__k">
          <span>k</span>
          <input
            type="number"
            value={Math.round(cfg.k)}
            onChange={(e) => update({ k: Number(e.target.value) || 0 })}
          />
        </div>

        <div className="calib__curve">
          {SAMPLES.map((r) => (
            <div key={r} className="calib__cell">
              <span className="calib__cr">{r}m</span>
              <span className="calib__co">
                {cfg.rMax > 0 && cfg.k ? (cfg.k * (1 / r - 1 / cfg.rMax)).toFixed(0) : "—"}
              </span>
            </div>
          ))}
        </div>

        <p className="calib__hint">
          Show the crosshair, sit at a known range, nudge until the shot lines up, then <b>Solve</b>.
          After that just set the target range.
        </p>
      </div>
    </div>
  );
}
