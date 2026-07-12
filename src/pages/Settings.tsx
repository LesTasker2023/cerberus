import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { useLogWatch } from "../hooks/useLogWatch";

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

export function Settings({
  watch,
  onWatchStarted,
}: {
  watch: ReturnType<typeof useLogWatch>;
  onWatchStarted: () => void;
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
    </section>
  );
}
