import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { useLogWatch } from "../hooks/useLogWatch";
import { useNexusSnapshot } from "../hooks/useNexusSnapshot";
import { loadCrosshair, saveCrosshair, type CrosshairConfig } from "../lib/crosshair";

interface Settings {
  log_path: string | null;
  player_name: string | null;
}

interface LogCheck {
  resolved: string | null;
  exists: boolean;
  source: "configured" | "detected" | "none";
}

const SOURCE_LABEL: Record<LogCheck["source"], string> = {
  configured: "Using your configured path",
  detected: "Auto-detected in the usual location",
  none: "No chat.log found — pick it manually",
};

const PING_OPTIONS = [5, 10, 15, 30, 60];

export function Settings({
  watch,
  onWatchStarted,
  pingInterval,
  onPingInterval,
}: {
  watch: ReturnType<typeof useLogWatch>;
  onWatchStarted: () => void;
  pingInterval: number;
  onPingInterval: (secs: number) => void;
}) {
  const [logPath, setLogPath] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [check, setCheck] = useState<LogCheck | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current settings once.
  useEffect(() => {
    invoke<Settings>("get_settings").then((s) => {
      setLogPath(s.log_path ?? "");
      setPlayerName(s.player_name ?? "");
    });
  }, []);

  // Re-validate the effective path whenever the input changes.
  const revalidate = useCallback((path: string) => {
    invoke<LogCheck>("check_log_path", { path: path.trim() || null })
      .then(setCheck)
      .catch(() => setCheck(null));
  }, []);

  useEffect(() => {
    revalidate(logPath);
  }, [logPath, revalidate]);

  const browse = useCallback(async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Log", extensions: ["log", "txt"] }],
    });
    if (typeof picked === "string") setLogPath(picked);
  }, []);

  const autoDetect = useCallback(async () => {
    const detected = await invoke<string | null>("detect_log_path");
    if (detected) setLogPath(detected);
    else setError("No chat.log found in the usual Entropia locations.");
  }, []);

  const save = useCallback(async () => {
    setError(null);
    try {
      await invoke("save_settings", {
        settings: {
          log_path: logPath.trim() || null,
          player_name: playerName.trim() || null,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(String(e));
    }
  }, [logPath, playerName]);

  const saveAndWatch = useCallback(async () => {
    await save();
    try {
      await watch.start(logPath.trim() || undefined);
      onWatchStarted();
    } catch (e) {
      setError(String(e));
    }
  }, [save, watch, logPath, onWatchStarted]);

  return (
    <section className="settings">
      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Chat Log</h2>
          <p className="panel__sub">
            Cerberus tails your Entropia <code>chat.log</code> and streams events to the
            Live Feed. Point it at the file, then start watching.
          </p>
        </div>

        <label className="field">
          <span className="field__label">chat.log path</span>
          <div className="field__row">
            <input
              className="input"
              type="text"
              value={logPath}
              placeholder="C:\Users\you\Documents\Entropia Universe\chat.log"
              onChange={(e) => setLogPath(e.target.value)}
              spellCheck={false}
            />
            <button className="btn btn--ghost" onClick={browse}>
              Browse…
            </button>
            <button className="btn btn--ghost" onClick={autoDetect}>
              Auto-detect
            </button>
          </div>
          {check && (
            <span className={`field__check ${check.exists ? "ok" : "bad"}`}>
              <span className="dot" />
              {check.exists
                ? `${SOURCE_LABEL[check.source]} — file found`
                : check.resolved
                  ? `${SOURCE_LABEL[check.source]} — file not found`
                  : SOURCE_LABEL.none}
            </span>
          )}
        </label>

        <label className="field">
          <span className="field__label">
            Avatar name <span className="field__opt">(optional)</span>
          </span>
          <input
            className="input"
            type="text"
            value={playerName}
            placeholder="Your in-game name"
            onChange={(e) => setPlayerName(e.target.value)}
            spellCheck={false}
          />
          <span className="field__hint">Reserved for upcoming clan features.</span>
        </label>

        {error && <div className="notice notice--bad">{error}</div>}

        <div className="panel__actions">
          <button className="btn btn--ghost" onClick={save}>
            {saved ? "Saved ✓" : "Save"}
          </button>
          <button
            className="btn btn--accent"
            onClick={saveAndWatch}
            disabled={!!check && !check.exists}
          >
            Save &amp; Start Watching
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Location Broadcast</h2>
          <p className="panel__sub">
            While broadcast is on (topbar / HUD), Cerberus pings your position on this interval
            and shares it with the clan. It only pings while <strong>Entropia is focused</strong>,
            so it never steals focus from another app.
          </p>
        </div>

        <label className="field">
          <span className="field__label">Ping interval</span>
          <div className="field__row">
            {PING_OPTIONS.map((s) => (
              <button
                key={s}
                className={`btn ${pingInterval === s ? "btn--accent" : "btn--ghost"}`}
                onClick={() => onPingInterval(s)}
              >
                {s}s
              </button>
            ))}
          </div>
          <span className="field__hint">How often to refresh + share your position.</span>
        </label>
      </div>

      <CrosshairSettings />

      <NexusData />
    </section>
  );
}

const XFIELDS: { key: keyof CrosshairConfig; label: string; min?: number }[] = [
  { key: "offsetX", label: "Offset X" },
  { key: "offsetY", label: "Offset Y" },
  { key: "size", label: "Size", min: 4 },
  { key: "gap", label: "Centre gap", min: 0 },
  { key: "thickness", label: "Thickness", min: 1 },
  { key: "ringRadius", label: "Ring radius", min: 4 },
];

/** Drawn crosshair — show/hide + offset & style. Offset shifts it from centre to
 *  compensate for the belly-gun convergence; the range finder drives it later. */
function CrosshairSettings() {
  const [cfg, setCfg] = useState<CrosshairConfig>(loadCrosshair);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    invoke<{ crosshair: boolean }>("overlay_states")
      .then((s) => setShown(!!s.crosshair))
      .catch(() => {});
    const un = listen<{ crosshair: boolean }>("overlays:changed", (e) =>
      setShown(!!e.payload.crosshair),
    );
    return () => {
      un.then((off) => off());
    };
  }, []);

  const update = (patch: Partial<CrosshairConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    saveCrosshair(next);
  };

  return (
    <div className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Crosshair</h2>
        <p className="panel__sub">
          A drawn reticle at screen centre with an adjustable offset — to correct the pilot-seat
          vs. belly-gun convergence. Toggle it here or from the HUD dock; it never blocks clicks.
        </p>
      </div>

      <div className="panel__actions">
        <button
          className={`btn ${shown ? "btn--accent" : "btn--ghost"}`}
          onClick={() => invoke("set_overlay", { label: "crosshair", on: !shown }).catch(() => {})}
        >
          {shown ? "Hide crosshair" : "Show crosshair"}
        </button>
      </div>

      <div className="xcfg">
        {XFIELDS.map((f) => (
          <label key={f.key} className="xcfg__row">
            <span>{f.label}</span>
            <input
              className="input"
              type="number"
              value={cfg[f.key] as number}
              min={f.min}
              onChange={(e) => update({ [f.key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <label className="xcfg__row">
          <span>Colour</span>
          <input type="color" value={cfg.color} onChange={(e) => update({ color: e.target.value })} />
        </label>
        <label className="xcfg__row xcfg__row--check">
          <input
            type="checkbox"
            checked={cfg.dot}
            onChange={(e) => update({ dot: e.target.checked })}
          />
          <span>Centre dot</span>
        </label>
        <label className="xcfg__row xcfg__row--check">
          <input
            type="checkbox"
            checked={cfg.ring}
            onChange={(e) => update({ ring: e.target.checked })}
          />
          <span>Ranging ring</span>
        </label>
      </div>
    </div>
  );
}

/** Codex data source — rebuild the Nexus catalogue on demand. It also refreshes
 *  automatically once a day; item & mob pages always fetch live regardless. */
function NexusData() {
  const { builtAt, refreshing, refresh } = useNexusSnapshot();
  return (
    <div className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Nexus Data</h2>
        <p className="panel__sub">
          The Database catalogue is rebuilt from Entropia Nexus — the single source of truth.
          It updates automatically once a day; item &amp; mob details always load live.
        </p>
      </div>

      <div className="field">
        <span className="field__label">Catalogue snapshot</span>
        <span className={`field__check ${refreshing ? "" : builtAt ? "ok" : "bad"}`}>
          <span className="dot" />
          {refreshing
            ? "Rebuilding from live Nexus…"
            : builtAt
              ? `Updated ${relTime(builtAt)}`
              : "Bundled seed — not yet refreshed from Nexus"}
        </span>
      </div>

      <div className="panel__actions">
        <button className="btn btn--accent" onClick={refresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh from Nexus"}
        </button>
      </div>
    </div>
  );
}

function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
