import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Poi } from "../hooks/usePois";

const UNASSIGNED = "Unassigned";

/**
 * Standalone always-on-top waypoint browser. POIs from the editable store are
 * grouped by their hand-assigned sector; clicking one copies its /wp. Its own
 * window so it can be parked and sized independently of the HUD dock.
 */
export function Waypoints() {
  const [pois, setPois] = useState<Poi[]>([]);
  const [openSector, setOpenSector] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const load = () => invoke<Poi[]>("list_pois").then(setPois).catch(() => {});
    load();
    const un = listen("pois:changed", load);
    return () => {
      un.then((off) => off());
    };
  }, []);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const m = new Map<string, Poi[]>();
    for (const p of pois) {
      if (needle && !p.name.toLowerCase().includes(needle)) continue;
      const k = p.sector?.trim() || UNASSIGNED;
      const arr = m.get(k);
      if (arr) arr.push(p);
      else m.set(k, [p]);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    // Sectors A→Z, unassigned last.
    return [...m.entries()].sort(([a], [b]) =>
      a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b),
    );
  }, [pois, q]);

  const copyWp = (p: Poi) => {
    navigator.clipboard
      .writeText(`/wp [Space, ${p.eu_x}, ${p.eu_y}, ${p.eu_z}, ${p.name}]`)
      .then(() => {
        setCopied(p.id);
        setTimeout(() => setCopied((c) => (c === p.id ? null : c)), 1200);
      })
      .catch(() => {});
  };

  return (
    <div className="dockwp dockwp--win">
      <div className="dockwp__head" data-tauri-drag-region title="Drag">
        <span className="dockwp__title" data-tauri-drag-region>
          Waypoints
        </span>
        <span className="dockwp__n" data-tauri-drag-region>
          {pois.length}
        </span>
        <button
          className="dockwp__close"
          onClick={() => invoke("hide_window", { label: "waypoints" }).catch(() => {})}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </div>

      <input
        className="dockwp__search"
        value={q}
        placeholder="Search…"
        spellCheck={false}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="dockwp__list">
        {groups.length === 0 ? (
          <div className="dockwp__empty">
            {pois.length === 0 ? "No POIs yet — add them on the map." : "No matches."}
          </div>
        ) : (
          groups.map(([sector, list]) => (
            <div key={sector}>
              <button
                className={`dockwp__sector ${openSector === sector ? "dockwp__sector--on" : ""}`}
                onClick={() => setOpenSector((s) => (s === sector ? null : sector))}
              >
                <span className="dockwp__caret">{openSector === sector ? "▾" : "▸"}</span>
                <span className="dockwp__sname">{sector}</span>
                <span className="dockwp__scount">{list.length}</span>
              </button>
              {openSector === sector && (
                <div className="dockwp__drawer">
                  {list.map((p) => (
                    <button
                      key={p.id}
                      className="dockwp__wp"
                      onClick={() => copyWp(p)}
                      title="Copy waypoint"
                    >
                      <span className="dockwp__wpname">{p.name}</span>
                      <span className="dockwp__wpcat">
                        {copied === p.id ? "copied ✓" : p.category.replace(/-/g, " ")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
