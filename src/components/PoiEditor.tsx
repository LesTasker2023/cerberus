import { useMemo, useState } from "react";
import type { usePois, Poi } from "../hooks/usePois";
import { IconTrash } from "./icons";

// Creatable POI categories, grouped to match the map's filter buckets.
const CATS = [
  { key: "player", label: "Player" },
  { key: "mob", label: "Mob Zone" },
  { key: "space-station", label: "Space Station" },
  { key: "warp-gate", label: "Warp Gate" },
  { key: "outlaw-zone", label: "Outlaw Zone" },
  { key: "landmark", label: "Landmark (Misc)" },
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

const EMPTY = { name: "", category: "player", x: "", y: "", z: "", pvp: false, notes: "", sector: "" };

export function PoiEditor({
  poiStore,
  onFocus,
}: {
  poiStore: ReturnType<typeof usePois>;
  /** Fired when a POI row is clicked — the map flies to it. */
  onFocus?: (poi: Poi) => void;
}) {
  const { items, add, update, remove } = poiStore;
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState({ ...EMPTY });
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [sort, setSort] = useState<"name" | "category" | "sector">("name");
  const [formOpen, setFormOpen] = useState(false);

  // Sectors are named after the space stations — assigned by hand per POI.
  const sectors = useMemo(
    () =>
      [...new Set(items.filter((p) => p.category === "space-station").map((p) => p.name))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [items],
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((p) => (!q || p.name.toLowerCase().includes(q)) && (catFilter === "all" || p.category === catFilter))
      .sort((a, b) => {
        if (sort === "category") return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
        if (sort === "sector") {
          // Unassigned sort last, then by sector, then name.
          const as = a.sector ?? "￿";
          const bs = b.sector ?? "￿";
          return as.localeCompare(bs) || a.name.localeCompare(b.name);
        }
        return a.name.localeCompare(b.name);
      });
  }, [items, search, catFilter, sort]);

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
    setFormOpen(true);
    setF({
      name: p.name,
      category: p.category,
      x: String(p.eu_x),
      y: String(p.eu_y),
      z: String(p.eu_z),
      pvp: p.pvp_lootable,
      notes: p.notes ?? "",
      sector: p.sector ?? "",
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
      sector: f.sector.trim() || null,
    };
    try {
      if (editId) await update(editId, input);
      else await add(input);
      reset();
    } catch (e) {
      setError(String(e));
    }
  };

  const showForm = formOpen || editId != null;

  return (
    <div className="poied">
      <div className="poied__head">
        <span className="poied__title">POIs</span>
        <span className="poied__count">{items.length}</span>
      </div>

      <input
        className="input poied__search"
        value={search}
        placeholder="Search POIs…"
        spellCheck={false}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="poied__controls">
        <select className="input poied__ctl" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="all">All types</option>
          {CATS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          className="input poied__ctl"
          value={sort}
          onChange={(e) => setSort(e.target.value as "name" | "category" | "sector")}
        >
          <option value="name">Sort: Name</option>
          <option value="category">Sort: Type</option>
          <option value="sector">Sort: Sector</option>
        </select>
      </div>

      <div className="poied__list">
        {shown.length === 0 ? (
          <p className="poied__empty">{items.length === 0 ? "No POIs yet." : "No matches."}</p>
        ) : (
          shown.map((p) => (
            <div key={p.id} className={`poirow ${editId === p.id ? "poirow--on" : ""}`}>
              <button
                className="poirow__main"
                onClick={() => {
                  edit(p.id);
                  onFocus?.(p);
                }}
                title="Focus on map + edit"
              >
                <span className="poirow__name">{p.name}</span>
                <span className="poirow__cat">
                  {p.category.replace("asteroid-", "").replace("-", " ")}
                  {p.sector && <span className="poirow__sector">{p.sector}</span>}
                </span>
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
          ))
        )}
      </div>

      <button
        className={`poied__addtoggle ${showForm ? "poied__addtoggle--on" : ""}`}
        onClick={() => (showForm ? reset() : setFormOpen(true))}
      >
        {showForm ? "− Close editor" : "＋ Add POI"}
      </button>

      {showForm && (
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

        <select className="input" value={f.sector} onChange={(e) => set({ sector: e.target.value })}>
          <option value="">— No sector —</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
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
      )}
    </div>
  );
}
