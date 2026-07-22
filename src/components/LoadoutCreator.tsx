import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { search, resolveItem } from "../lib/codex/store";
import type { SearchEntry } from "../lib/codex/types";
import { nexusToEquipment } from "../lib/equipment";
import {
  calculateDPP,
  calculateEffectiveDamage,
  calculateEnhancedDamage,
  calculateLoadoutCosts,
  calculateRange,
  createLoadout,
  deleteLoadout,
  getActiveLoadout,
  getActiveLoadoutId,
  getEfficiency,
  getModifiedDecay,
  getTotalAmmo,
  loadLoadouts,
  saveLoadout,
  setActiveLoadoutId,
  type Equipment,
  type Loadout,
} from "../lib/loadout";

type SlotKey = "weapon" | "amp" | "scope" | "sight" | "absorber";
const SLOTS: { key: SlotKey; label: string; kind: string }[] = [
  { key: "weapon", label: "Weapon", kind: "weapons" },
  { key: "amp", label: "Amp", kind: "weaponamplifiers" },
  { key: "scope", label: "Scope", kind: "weaponvisionattachments" },
  { key: "sight", label: "Sight", kind: "weaponvisionattachments" },
  { key: "absorber", label: "Absorber", kind: "absorbers" },
];

const ped = (n: number) => n.toFixed(4);

/** Loadout manager — list · editor · live stats. Edits auto-save, so switching
 *  between loadouts never loses work; one loadout can be marked active. */
export function LoadoutCreator({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState<Loadout[]>(loadLoadouts);
  const [activeId, setActiveId] = useState<string | null>(getActiveLoadoutId());
  const [lo, setLo] = useState<Loadout>(
    () => getActiveLoadout() ?? loadLoadouts()[0] ?? createLoadout("New Loadout"),
  );

  // Ensure a brand-new/first loadout exists in storage so it shows in the list.
  useEffect(() => {
    if (!loadLoadouts().some((l) => l.id === lo.id)) setSaved(saveLoadout(lo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every edit persists and refreshes the list.
  const patch = (p: Partial<Loadout>) =>
    setLo((prev) => {
      const next = { ...prev, ...p };
      setSaved(saveLoadout(next));
      return next;
    });

  const newLoadout = () => {
    const l = createLoadout("New Loadout");
    setSaved(saveLoadout(l));
    setLo(l);
  };
  const remove = (id: string) => {
    const list = deleteLoadout(id);
    setSaved(list);
    if (activeId === id) {
      setActiveLoadoutId(null);
      setActiveId(null);
    }
    if (lo.id === id) setLo(list[0] ?? createLoadout("New Loadout"));
  };
  const setActive = (id: string) => {
    setActiveLoadoutId(id);
    setActiveId(id);
  };

  const dmg = calculateEnhancedDamage(lo);
  const costs = calculateLoadoutCosts(lo);
  const stats: [string, string][] = [
    ["Cost / shot", `${ped(costs.totalPerShot)} PED`],
    ["Efficiency", `${(getEfficiency(lo) * 100).toFixed(1)}%`],
    ["DPP", calculateDPP(lo).toFixed(2)],
    ["Damage", `${dmg.min.toFixed(1)} – ${dmg.max.toFixed(1)}`],
    ["Eff. damage", calculateEffectiveDamage(lo).toFixed(2)],
    ["Decay", `${(getModifiedDecay(lo) * 100).toFixed(3)} PEC`],
    ["Ammo", `${Math.round(getTotalAmmo(lo))} (${ped(getTotalAmmo(lo) * 0.0001)} PED)`],
    ["Range", `${calculateRange(lo).toFixed(0)} m`],
  ];

  const modal = (
    <div className="lcmodal" onClick={onClose}>
      <div className="lcbox lcbox--wide" onClick={(e) => e.stopPropagation()}>
        <header className="lcbox__head">
          <span className="lcbox__pencil" aria-hidden>
            ✎
          </span>
          <input
            className="lcbox__name"
            value={lo.name}
            title="Rename loadout"
            aria-label="Loadout name"
            spellCheck={false}
            onChange={(e) => patch({ name: e.target.value })}
            onFocus={(e) => e.target.select()}
          />
          <button className="lcbox__x" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="lcbox__body lcbox__body--3">
          {/* List / selector */}
          <div className="lclist">
            <div className="lclist__head">
              <span className="lccol__h">Loadouts</span>
              <button className="lclist__new" onClick={newLoadout} title="New loadout">
                +
              </button>
            </div>
            {saved.length === 0 && <p className="lclist__empty">No loadouts yet.</p>}
            {saved.map((l) => (
              <div
                key={l.id}
                className={`lcrow ${l.id === lo.id ? "lcrow--on" : ""}`}
                onClick={() => setLo(l)}
              >
                <button
                  className={`lcrow__star ${l.id === activeId ? "lcrow__star--on" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActive(l.id);
                  }}
                  title={l.id === activeId ? "Active loadout" : "Set active"}
                >
                  ★
                </button>
                <span className="lcrow__name">{l.name}</span>
                <span className="lcrow__cost">{calculateLoadoutCosts(l).totalPerShot.toFixed(3)}</span>
                <button
                  className="lcrow__del"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(l.id);
                  }}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* Editor */}
          <div className="lccol">
            <h3 className="lccol__h">Equipment</h3>
            {SLOTS.map((s) => (
              <EquipmentPicker
                key={s.key}
                label={s.label}
                kind={s.kind}
                value={lo[s.key]}
                onSelect={(eq) => patch({ [s.key]: eq } as Partial<Loadout>)}
                onClear={() => patch({ [s.key]: undefined } as Partial<Loadout>)}
              />
            ))}

            <h3 className="lccol__h">Enhancers (10 slots)</h3>
            <NumRow label="Damage" value={lo.damageEnhancers} max={10} onChange={(v) => patch({ damageEnhancers: v })} />
            <NumRow label="Economy" value={lo.economyEnhancers} max={10} onChange={(v) => patch({ economyEnhancers: v })} />
            <NumRow label="Accuracy" value={lo.accuracyEnhancers} max={10} onChange={(v) => patch({ accuracyEnhancers: v })} />
            <NumRow label="Range" value={lo.rangeEnhancers} max={10} onChange={(v) => patch({ rangeEnhancers: v })} />

            <h3 className="lccol__h">Skills</h3>
            <NumRow label="Hit prof." value={lo.hitProfession ?? 100} max={100} onChange={(v) => patch({ hitProfession: v })} />
            <NumRow label="Dmg prof." value={lo.damageProfession ?? 100} max={100} onChange={(v) => patch({ damageProfession: v })} />
          </div>

          {/* Stats */}
          <div className="lcstats">
            <h3 className="lccol__h">Stats</h3>
            {stats.map(([k, v]) => (
              <div key={k} className="lcstat">
                <span className="lcstat__l">{k}</span>
                <span className="lcstat__v">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function NumRow({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="lcnum">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
      />
    </label>
  );
}

function EquipmentPicker({
  label,
  kind,
  value,
  onSelect,
  onClear,
}: {
  label: string;
  kind: string;
  value?: Equipment;
  onSelect: (eq: Equipment) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      search(q, kind, 8).then((r) => live && setResults(r)).catch(() => {});
    }, 120);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q, kind]);

  const choose = async (e: SearchEntry) => {
    setOpen(false);
    setQ("");
    setBusy(true);
    try {
      const item = await resolveItem(e.url);
      onSelect(nexusToEquipment(item, e.name));
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lcslot">
      <span className="lcslot__label">{label}</span>
      {value ? (
        <div className="lcslot__sel">
          <span className="lcslot__name">{value.name}</span>
          <button className="lcslot__clear" onClick={onClear} title="Clear">
            ×
          </button>
        </div>
      ) : (
        <div className="lcslot__search">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            placeholder={busy ? "loading…" : "search…"}
          />
          {open && results.length > 0 && (
            <ul className="lcslot__results">
              {results.map((r) => (
                <li key={r.url}>
                  <button onClick={() => choose(r)}>{r.name}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
