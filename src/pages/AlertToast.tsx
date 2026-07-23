import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ALERT_EVENT, type Alert } from "../lib/triggers";
import { channelSlot, loadChannelColors } from "../lib/channels";
import { ding, unlockAudio } from "../lib/chime";

const SOUND_KEY = "cerberus.alertSound";

/** How long a toast stays before fading out. */
const TTL_MS = 45_000;
/** Most toasts on screen at once — oldest drop off. */
const MAX_SHOWN = 5;

interface Toast extends Alert {
  bornAt: number;
}

/** In-game alert overlay — transparent, always-on-top. Shows chat lines that
 *  fired a trigger while you're tabbed into the game. */
export function AlertToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [shake, setShake] = useState(false);
  const [sound, setSound] = useState(() => localStorage.getItem(SOUND_KEY) !== "0");
  const colors = loadChannelColors();

  // Read through a ref so the listener never needs re-subscribing when the
  // sound preference changes (which would drop alerts in the gap).
  const soundRef = useRef(sound);
  soundRef.current = sound;

  useEffect(() => {
    const un = listen<Alert>(ALERT_EVENT, (e) => {
      setToasts((prev) => [{ ...e.payload, bornAt: Date.now() }, ...prev].slice(0, MAX_SHOWN));
      // Attention grab: shake always, chime if enabled.
      setShake(true);
      setTimeout(() => setShake(false), 500);
      if (soundRef.current) ding();
    });
    return () => {
      un.then((off) => off());
    };
  }, []);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    localStorage.setItem(SOUND_KEY, next ? "1" : "0");
    // This click is the user gesture that lets the webview start audio.
    if (next) {
      unlockAudio();
      ding();
    }
  };

  // Expire old toasts. One timer for the list, not one per toast.
  useEffect(() => {
    if (toasts.length === 0) return;
    const id = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.bornAt < TTL_MS));
    }, 1000);
    return () => clearInterval(id);
  }, [toasts.length]);

  const close = () => invoke("hide_window", { label: "alerts" }).catch(() => {});

  return (
    <div className={`alerts ${shake ? "alerts--shake" : ""}`}>
      <header className="alerts__head" data-tauri-drag-region>
        <span className="alerts__dot" data-tauri-drag-region />
        <span className="alerts__title" data-tauri-drag-region>
          ALERTS
        </span>
        <button
          className={`alerts__snd ${sound ? "alerts__snd--on" : ""}`}
          onClick={toggleSound}
          title={sound ? "Chime on — click to mute" : "Muted — click to enable the chime"}
          aria-pressed={sound}
        >
          {sound ? "♪" : "✕♪"}
        </button>
        {toasts.length > 0 && (
          <button className="alerts__clr" onClick={() => setToasts([])} title="Clear">
            clear
          </button>
        )}
        <button className="alerts__x" onClick={close} title="Hide">
          ×
        </button>
      </header>

      <div className="alerts__list">
        {toasts.length === 0 ? (
          <div className="alerts__idle">Watching for triggers…</div>
        ) : (
          toasts.map((t) => (
            <div key={t.id} className="alert">
              <div className="alert__top">
                <span className="alert__trig">{t.triggerName}</span>
                {t.channel && (
                  <span className={`alert__chan chanc-${channelSlot(t.channel, colors)}`}>
                    {t.channel}
                  </span>
                )}
              </div>
              <div className="alert__body">
                {t.speaker && <span className="alert__who">{t.speaker}</span>}
                <span className="alert__text">{t.text}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
