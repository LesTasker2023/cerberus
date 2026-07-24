import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  loadRegion,
  loadTuning,
  saveRegion,
  saveTuning,
  SC,
  type EmRegion,
  type EmTuning,
} from "../lib/emConfig";
import { pushEmConfig } from "../lib/em";

interface EmStatus {
  running: boolean;
  phase: string;
  detail: string;
}

/** EM assist — the "engage mob" accessibility loop. Presses Engage, and if no
 *  hit lands, reads the minimap and steers toward the nearest red blip until
 *  combat registers. All game-specific numbers are tunable below. */
export function EmTool() {
  const [tuning, setTuning] = useState<EmTuning>(loadTuning);
  const [region, setRegion] = useState<EmRegion | null>(loadRegion);
  const [status, setStatus] = useState<EmStatus>({ running: false, phase: "idle", detail: "" });

  useEffect(() => {
    invoke<boolean>("em_running")
      .then((r) => setStatus((s) => ({ ...s, running: r })))
      .catch(() => {});
    const un = listen<EmStatus>("em:status", (e) => setStatus(e.payload));
    return () => {
      un.then((off) => off());
    };
  }, []);

  const patch = (p: Partial<EmTuning>) =>
    setTuning((t) => {
      const next = { ...t, ...p };
      saveTuning(next);
      pushEmConfig(); // keep the backend copy (topbar/dock) current
      return next;
    });

  const frameMinimap = () => invoke("set_overlay", { label: "emregion", on: true }).catch(() => {});

  const captureRegion = async () => {
    const r = await invoke<EmRegion | null>("em_region_geom").catch(() => null);
    if (r && r.radius > 0) {
      setRegion(r);
      saveRegion(r);
      pushEmConfig(); // let the topbar/dock arm with it immediately
    }
    invoke("set_overlay", { label: "emregion", on: false }).catch(() => {});
  };

  const arm = async () => {
    // Snap the current frame geometry if we don't have it yet.
    const r = region ?? (await invoke<EmRegion | null>("em_region_geom").catch(() => null));
    if (!r || r.radius <= 0) {
      setStatus({
        running: false,
        phase: "not ready",
        detail: "Frame the minimap first: Show frame → position it → Use position",
      });
      return;
    }
    setRegion(r);
    invoke("em_start", { config: { ...tuning, ...r } }).catch(() => {});
  };
  const disarm = () => invoke("em_stop").catch(() => {});

  const swapTurn = () =>
    patch({ turnLeft: tuning.turnRight, turnRight: tuning.turnLeft });
  const turnLabel = tuning.turnLeft === SC.Z ? "Z ← / C →" : "C ← / Z →";

  return (
    <div className="emtool">
      <div className="emtool__warn">
        <b>Experimental.</b> Drives keyboard input into Entropia while it&rsquo;s focused. It only
        acts when Entropia is the foreground window. Panic stop:{" "}
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> from anywhere.
      </div>

      <div className="emtool__bar">
        <div className={`emtool__status emtool__status--${status.running ? "on" : "off"}`}>
          <span className="emtool__dot" />
          <span className="emtool__phase">{status.running ? status.phase : "Idle"}</span>
          {status.detail && <span className="emtool__detail">{status.detail}</span>}
        </div>
        {status.running ? (
          <button className="btn btn--accent" onClick={disarm}>
            ⏹ Stop
          </button>
        ) : (
          <button className="btn btn--accent" onClick={arm}>
            ▶ Start
          </button>
        )}
      </div>
      {!region && !status.running && (
        <span className="emtool__hint">Frame the minimap below, then press Start.</span>
      )}

      <section className="emtool__panel">
        <div className="emtool__row">
          <span className="emtool__label">
            Minimap area {region ? "✓" : "— required"}
          </span>
          <span className="emtool__val">
            {region ? `centre ${region.cx},${region.cy} · r${region.radius}` : "not set"}
          </span>
        </div>
        <div className="emtool__row">
          <button className="btn btn--ghost btn--sm" onClick={frameMinimap}>
            1 · Show frame
          </button>
          <button className="btn btn--accent btn--sm" onClick={captureRegion}>
            2 · Save area
          </button>
        </div>
        <p className="emtool__hint">
          <b>1</b> shows a circular frame over the game. Drag/resize it onto the round minimap so the
          dashed circle sits on the radar edge, then <b>2</b> to lock it in.
        </p>
      </section>

      <section className="emtool__panel">
        <NumRow
          label="Weapon range (rings)"
          hint="Fraction of the radar radius your weapon reaches"
          value={Math.round(tuning.rangeFrac * 100)}
          suffix="%"
          min={10}
          max={100}
          step={5}
          onChange={(v) => patch({ rangeFrac: v / 100 })}
        />
        <div className="emtool__row">
          <span className="emtool__label">Turn keys</span>
          <span className="emtool__val">{turnLabel}</span>
          <button className="btn btn--ghost btn--sm" onClick={swapTurn}>
            Swap L/R
          </button>
        </div>
        <NumRow label="Turn tap" hint="ms per view rotation" value={tuning.turnTap} suffix="ms" min={20} max={400} step={10} onChange={(v) => patch({ turnTap: v })} />
        <NumRow label="Forward tap" hint="ms per step forward" value={tuning.forwardTap} suffix="ms" min={60} max={1000} step={20} onChange={(v) => patch({ forwardTap: v })} />
        <NumRow label="Hit settle" hint="wait after Engage before judging a hit" value={tuning.settle} suffix="ms" min={200} max={2000} step={50} onChange={(v) => patch({ settle: v })} />
        <NumRow label="Aim tolerance" hint="how centred a blip must be to step" value={tuning.aimTolDeg} suffix="°" min={4} max={45} step={1} onChange={(v) => patch({ aimTolDeg: v })} />
        <NumRow label="Red threshold" hint="min red for a blip pixel" value={tuning.redMin} min={80} max={255} step={5} onChange={(v) => patch({ redMin: v })} />
        <NumRow label="Colour strictness" hint="max green/blue for a blip pixel" value={tuning.otherMax} min={20} max={160} step={5} onChange={(v) => patch({ otherMax: v })} />
        <NumRow label="Time limit" hint="hard stop" value={tuning.maxSeconds} suffix="s" min={30} max={600} step={30} onChange={(v) => patch({ maxSeconds: v })} />
      </section>

    </div>
  );
}

function NumRow({
  label,
  hint,
  value,
  suffix,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  suffix?: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="emtool__num">
      <div className="emtool__numhead">
        <span className="emtool__label">{label}</span>
        <span className="emtool__val">
          {value}
          {suffix ?? ""}
        </span>
      </div>
      {hint && <span className="emtool__hint">{hint}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
