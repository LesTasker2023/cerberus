import { useState } from "react";
import type { Poi } from "../hooks/usePois";
import type { MapPoi } from "../lib/pois";
import { IconCheck, IconCopy } from "./icons";

/** Readable name per marker category, for the selected-POI header. */
const CAT_LABEL: Record<string, string> = {
  station: "Station",
  "space-station": "Space Station",
  "warp-gate": "Warp Gate",
  "asteroid-m": "M-Type",
  "asteroid-c": "C-Type",
  "asteroid-f": "F-Type",
  "asteroid-s": "S-Type",
  "asteroid-nd": "ND-Type",
  "asteroid-scrap": "Scrap",
  "outlaw-zone": "Outlaw Zone",
  mob: "Mob",
  player: "Player",
  landmark: "Landmark",
};

/**
 * Only the places you actually fly to. Outlaw zones, mob spawns and logged rocks
 * are all real POIs, but they're map detail — putting them here buried the two
 * things this card exists to hand over quickly.
 */
const NOTABLE = ["space-station", "station", "warp-gate"];

/** Short label per category for the row tag. */
const TAG: Record<string, string> = {
  "space-station": "STATION",
  station: "STATION",
  "warp-gate": "GATE",
};

/** Stations first — they're the more common destination. */
const RANK: Record<string, number> = {
  "space-station": 0,
  station: 0,
  "warp-gate": 1,
};

const wpString = (p: Poi) => `/wp [Space, ${p.eu_x}, ${p.eu_y}, ${p.eu_z}, ${p.name}]`;

/**
 * The map's one information surface, in two modes.
 *
 * With nothing selected it's a sector dossier: stations and gates in the current
 * sector, each one click from the clipboard, so you never have to hunt for a dot
 * to grab a course. Select a marker and it becomes that marker's detail —
 * coordinates and its waypoint — reverting to the sector view when you clear the
 * selection. One card that changes contents, rather than two panels competing
 * for the same corner.
 */
export function SectorCard({
  name,
  cell,
  pvp,
  pois,
  selected,
  onClose,
  onClearSelection,
  onFocus,
}: {
  name: string;
  /** Grid reference, e.g. "C3". */
  cell: string;
  pvp: boolean;
  /** Every POI inside this sector. */
  pois: Poi[];
  /** The marker currently selected on the map, if any. */
  selected: MapPoi | null;
  onClose: () => void;
  /** Drop the selection and fall back to the sector view. */
  onClearSelection: () => void;
  /** Fly the map to a POI and select it. */
  onFocus: (p: Poi) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [noArt, setNoArt] = useState(false);

  const rocks = pois.filter((p) => p.category.startsWith("asteroid")).length;
  const rows = pois
    .filter((p) => NOTABLE.includes(p.category))
    .sort((a, b) => (RANK[a.category] ?? 9) - (RANK[b.category] ?? 9) || a.name.localeCompare(b.name));

  const copy = (p: Poi) => {
    navigator.clipboard
      .writeText(wpString(p))
      .then(() => {
        setCopiedId(p.id);
        setTimeout(() => setCopiedId(null), 1200);
      })
      .catch(() => {});
  };

  const selWp = selected
    ? `/wp [Space, ${selected.euX}, ${selected.euY}, ${selected.euZ}, ${selected.name}]`
    : "";
  const copySelected = () => {
    if (!selected) return;
    navigator.clipboard
      .writeText(selWp)
      .then(() => {
        setCopiedId(selected.id);
        setTimeout(() => setCopiedId(null), 1200);
      })
      .catch(() => {});
  };

  return (
    <section
      className={`seccard ${pvp ? "seccard--pvp" : ""}`}
      aria-label={selected ? selected.name : `Sector ${name}`}
    >
      <div className="seccard__bar" />

      <header className="seccard__head">
        <span className="seccard__sigil" aria-hidden>
          {noArt ? (
            // No art shipped for this sector — a procedural insignia reads as
            // deliberate where a broken image would not. Drop a file at
            // /sectors/<lowercase-name>.webp and it takes over automatically.
            <span className="seccard__glyph">{name.slice(0, 1)}</span>
          ) : (
            <img
              src={`/sectors/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.webp`}
              alt=""
              onError={() => setNoArt(true)}
            />
          )}
        </span>

        <span className="seccard__titles">
          {/* The sector stays visible as a breadcrumb while a marker is
              selected, so you never lose track of where you are. */}
          {selected && <span className="seccard__crumb">{name}</span>}
          <span className="seccard__name">{selected ? selected.name : name}</span>
          <span className="seccard__meta">
            <span className="seccard__cell">{cell}</span>
            {selected && (
              <span className="seccard__cat">
                {CAT_LABEL[selected.category] ?? selected.category}
              </span>
            )}
            {selected?.logged && <span className="seccard__cat">Logged</span>}
            {(selected ? selected.pvpLootable : pvp) && (
              <span className="seccard__pvp">{selected ? "PVP" : "Lootable PVP"}</span>
            )}
          </span>
        </span>

        {/* Backs out one level at a time: a selection first, then the sector. */}
        <button
          className="seccard__x"
          onClick={selected ? onClearSelection : onClose}
          aria-label={selected ? "Clear selection" : "Close and zoom out"}
          title={selected ? "Back to sector (Esc)" : "Back to overview (Esc)"}
        >
          ✕
        </button>
      </header>

      {selected ? (
        <div className="seccard__poi">
          <div className="seccard__coords">
            {([["X", selected.euX], ["Y", selected.euY], ["Z", selected.euZ]] as const).map(
              ([axis, val]) => (
                <span key={axis} className="seccard__coord">
                  <span className="seccard__axis">{axis}</span>
                  <span className="seccard__val">{val}</span>
                </span>
              ),
            )}
          </div>
          <button className="seccard__wp" onClick={copySelected} title={`Copy ${selWp}`}>
            {copiedId === selected.id ? <IconCheck /> : <IconCopy />}
            {copiedId === selected.id ? "Copied" : "Copy Waypoint"}
          </button>
        </div>
      ) : (
        <>
          <div className="seccard__stats">
            <span>
              <b>{rows.length}</b> waypoints
            </span>
            <span>
              <b>{rocks}</b> rocks
            </span>
          </div>

          <div className="seccard__list">
            {rows.length === 0 ? (
              <p className="seccard__empty">No stations or gates in this sector.</p>
            ) : (
              rows.map((p) => (
                <div key={p.id} className="wprow">
                  <button className="wprow__main" onClick={() => onFocus(p)} title="Show on map">
                    <span className={`wprow__tag cat--${p.category.replace("asteroid-", "")}`}>
                      {TAG[p.category] ?? p.category}
                    </span>
                    <span className="wprow__name">{p.name}</span>
                  </button>
                  <button
                    className="wprow__copy"
                    onClick={() => copy(p)}
                    title={`Copy ${wpString(p)}`}
                    aria-label={`Copy waypoint for ${p.name}`}
                  >
                    {copiedId === p.id ? <IconCheck /> : <IconCopy />}
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
