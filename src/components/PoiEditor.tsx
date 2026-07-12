import { useState } from "react";
import type { usePois } from "../hooks/usePois";
import { IconTrash } from "./icons";

const CATS = [
  { key: "space-station", label: "Space Station" },
  { key: "warp-gate", label: "Warp Gate" },
  { key: "landmark", label: "Landmark" },
  { key: "outlaw-zone", label: "Outlaw Zone" },
  { key: "station", label: "Station" },
];

/** Parse `[Space, 58265, 69229, -804, Waypoint]` → coords (+ optional name). */
function parseCoords(text: string): { x: number; y: number; z: number; name?: string } | null {
  const m = text
    .trim()
    .match(/\[?\s*(?:\w+\s*,\s*)?(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*([^\],]+?))?\s*\]?$/);
  if (!m) return null;
  const label = m[4]?.trim();
  return { x: +m[1], y: +m[2], z: +m[3], name: label && !/^waypoint$/i.test(label) ? label : undefined };
}

const EMPTY = { name: "", category: "space-station", x: "", y: "", z: "", pvp: false, notes: "" };

export function PoiEditor({ poiStore }: { poiStore: ReturnType<typeof usePois> }) {
  const { items, add, update, remove } = poiStore;
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState({ ...EMPTY });
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));

  const reset = () => {
    setEditId(null);
    setF({ ...EMPTY });
    setPaste("");
    setError(null);
  };

  const applyPaste = () => {
    const c = parseCoords(paste);
    if (!c) {
      setError("Couldn't read coords — expected [Space, x, y, z, …]");
      return;
    }
    set({ x: String(c.x), y: String(c.y), z: String(c.z), ...(c.name && !f.name ? { name: c.name } : {}) });
    setPaste("");
    setError(null);
  };

  const edit = (id: string) => {
    const p = items.find((i) => i.id === id);
    if (!p) return;
    setEditId(id);
    setF({
      name: p.name,
      category: p.category,
      x: String(p.eu_x),
      y: String(p.eu_y),
      z: String(p.eu_z),
      pvp: p.pvp_lootable,
      notes: p.notes ?? "",
    });
    setError(null);
  };

  const coordsOk = [f.x, f.y, f.z].every((v) => v.trim() !== "" && !Number.isNaN(Number(v)));
  const canSave = f.name.trim() !== "" && coordsOk;

  const save = async () => {
    if (!canSave) return;
    setError(null);
    const input = {
      name: f.name.trim(),
      category: f.category,
      eu_x: Number(f.x),
      eu_y: Number(f.y),
      eu_z: Number(f.z),
      pvp_lootable: f.pvp,
      notes: f.notes.trim() || null,
    };
    try {
      if (editId) await update(editId, input);
      else await add(input);
      reset();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="poied">
      <div className="poied__head">
        <span className="poied__title">POI Editor</span>
        <span className="poied__count">{items.length}</span>
      </div>

      <div className="poied__form">
        <div className="poied__row">
          <input
            className="input"
            value={paste}
            placeholder="Paste [Space, x, y, z, name]"
            spellCheck={false}
            onChange={(e) => setPaste(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyPaste()}
          />
          <button className="btn" onClick={applyPaste} disabled={!paste.trim()}>
            Set
          </button>
        </div>

        <input
          className="input"
          value={f.name}
          placeholder="Name"
          spellCheck={false}
          onChange={(e) => set({ name: e.target.value })}
        />
        <select className="input" value={f.category} onChange={(e) => set({ category: e.target.value })}>
          {CATS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>

        <div className="poied__coords">
          {(["x", "y", "z"] as const).map((axis) => (
            <input
              key={axis}
              className="input poied__coord"
              inputMode="numeric"
              value={f[axis]}
              placeholder={axis.toUpperCase()}
              onChange={(e) => set({ [axis]: e.target.value } as Partial<typeof f>)}
            />
          ))}
        </div>

        <label className="poied__pvp">
          <input type="checkbox" checked={f.pvp} onChange={(e) => set({ pvp: e.target.checked })} />
          PVP lootable
        </label>

        {error && <div className="poied__err">{error}</div>}

        <div className="poied__actions">
          {editId && (
            <button className="btn" onClick={reset}>
              Cancel
            </button>
          )}
          <button className="btn btn--accent" onClick={save} disabled={!canSave}>
            {editId ? "Save" : "Add POI"}
          </button>
        </div>
      </div>

      <div className="poied__list">
        {items.map((p) => (
          <div key={p.id} className={`poirow ${editId === p.id ? "poirow--on" : ""}`}>
            <button className="poirow__main" onClick={() => edit(p.id)} title="Edit">
              <span className="poirow__name">{p.name}</span>
              <span className="poirow__cat">{p.category.replace("asteroid-", "").replace("-", " ")}</span>
            </button>
            <button
              className="icobtn icobtn--del"
              onClick={() => {
                remove(p.id);
                if (editId === p.id) reset();
              }}
              aria-label="Delete"
              title="Delete"
            >
              <IconTrash />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
