import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { useAsteroids } from "../hooks/useAsteroids";
import {
  IconCheck,
  IconCopy,
  IconEye,
  IconFrame,
  IconPopout,
  IconRadar,
  IconTrash,
} from "../components/icons";

const CATEGORIES = [
  { key: "asteroid-m", label: "M-Type", short: "M" },
  { key: "asteroid-c", label: "C-Type", short: "C" },
  { key: "asteroid-f", label: "F-Type", short: "F" },
  { key: "asteroid-s", label: "S-Type", short: "S" },
  { key: "asteroid-nd", label: "ND-Type", short: "ND" },
  { key: "asteroid-scrap", label: "Scrap", short: "SC" },
  { key: "station", label: "Station", short: "ST" },
];

function short(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.short ?? "?";
}

/** cat--m / cat--station etc. for colour. */
function catClass(key: string): string {
  return `cat--${key.replace("asteroid-", "")}`;
}

/** HH:MM:SS out of an ISO timestamp. */
function clock(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB");
}

export function Asteroids({ store }: { store: ReturnType<typeof useAsteroids> }) {
  const { items, remove } = store;

  const [boxOpen, setBoxOpen] = useState(false);
  const [loggerOpen, setLoggerOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [radarOpen, setRadarOpen] = useState(false);

  const toggleBox = useCallback(async () => {
    try {
      setBoxOpen(await invoke<boolean>("toggle_capregion"));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleLogger = useCallback(async () => {
    try {
      setLoggerOpen(await invoke<boolean>("toggle_panel"));
    } catch {
      /* ignore */
    }
  }, []);

  const testRead = useCallback(async () => {
    setReading(true);
    setRead(null);
    try {
      const text = await invoke<string>("read_region");
      setRead({ ok: true, text: text || "(nothing read)" });
    } catch (e) {
      setRead({ ok: false, text: String(e) });
    } finally {
      setReading(false);
    }
  }, []);

  const copyWaypoint = (a: (typeof items)[number]) => {
    navigator.clipboard
      .writeText(`/wp [Space, ${a.eu_x}, ${a.eu_y}, ${a.eu_z}, ${a.name}]`)
      .then(() => {
        setCopiedId(a.id);
        setTimeout(() => setCopiedId(null), 1200);
      })
      .catch(() => {});
  };

  return (
    <section className="rocks">
      {/* ── Control toolbar ── */}
      <div className="rocks__toolbar">
        <button
          className={`toolbtn ${boxOpen ? "toolbtn--active" : ""}`}
          onClick={toggleBox}
        >
          <IconFrame /> Capture Box
        </button>
        <button className="toolbtn" onClick={testRead} disabled={reading}>
          <IconEye /> {reading ? "Reading…" : "Test Read"}
        </button>

        {read && (
          <span className={`rocks__readout ${read.ok ? "" : "is-err"}`} title={read.text}>
            {read.text}
          </span>
        )}

        <button
          className={`toolbtn toolbtn--right ${loggerOpen ? "toolbtn--active" : ""}`}
          onClick={toggleLogger}
        >
          <IconPopout /> Logger
        </button>
        <button
          className={`toolbtn ${radarOpen ? "toolbtn--active" : ""}`}
          onClick={async () => {
            try {
              setRadarOpen(await invoke<boolean>("toggle_radar"));
            } catch {
              /* ignore */
            }
          }}
        >
          <IconRadar /> Radar
        </button>
      </div>

      <p className="rocks__help">
        Position the Capture Box over the target tooltip once — it keeps reading that spot
        even when hidden. In-game, hover a rock and press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+
        <kbd>C</kbd> (or the Logger pill) to log at your position.
      </p>

      {/* ── Log list ── */}
      <div className="rocks__listhead">
        <span className="rocks__listtitle">Logged</span>
        <span className="rocks__count">{items.length}</span>
      </div>

      <div className="rocks__list">
        {items.length === 0 ? (
          <div className="rocks__empty">
            <IconFrame size={30} />
            <p className="rocks__empty-title">No asteroids logged yet</p>
            <p className="rocks__empty-sub">
              Hover a rock in-game and hit the Logger pill or the hotkey.
            </p>
          </div>
        ) : (
          <>
            <div className="rock rock--head">
              <span>Type</span>
              <span>Name</span>
              <span>X</span>
              <span>Y</span>
              <span>Z</span>
              <span>Logged</span>
              <span />
            </div>
            {items.map((a) => (
              <div key={a.id} className="rock">
                <span className={`rock__type ${catClass(a.category)}`}>{short(a.category)}</span>
                <span className="rock__name">
                  {a.name}
                  {a.pvp_lootable && <span className="rock__pvp">PVP</span>}
                </span>
                <span className="rock__c">{a.eu_x}</span>
                <span className="rock__c">{a.eu_y}</span>
                <span className="rock__c">{a.eu_z}</span>
                <span className="rock__time">{clock(a.logged_at)}</span>
                <span className="rock__actions">
                  <button
                    className="icobtn"
                    onClick={() => copyWaypoint(a)}
                    aria-label="Copy waypoint"
                    title="Copy waypoint"
                  >
                    {copiedId === a.id ? <IconCheck /> : <IconCopy />}
                  </button>
                  <button
                    className="icobtn icobtn--del"
                    onClick={() => remove(a.id)}
                    aria-label="Delete"
                    title="Delete"
                  >
                    <IconTrash />
                  </button>
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
