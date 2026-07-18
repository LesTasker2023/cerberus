import { useEffect, useState } from "react";
import type { CraftNode, Drop, NexusItem, RefiningRecipe, UsedIn } from "../../lib/codex/types";
import { craftTree, dropsOf, refining, usedIn } from "../../lib/codex/store";
import { nexusItem, type NexusItem as Markup } from "../../lib/nexus";
import { DamageBars, MaterialTree, RefLink, Section, Stat, rawMaterials } from "./CodexBits";

const ped = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(2)} PED`);

/** Full item hub: economy + live markup, combat, and the resolved relationship
 *  graph (crafted via, used in, refines, dropped by). */
export function ItemDetail({ item, onOpen }: { item: NexusItem; onOpen: (url: string) => void }) {
  const p = item.Properties;
  const econ = p.Economy ?? {};
  const tt = econ.MaxTT ?? econ.Value ?? null;

  const [markup, setMarkup] = useState<Markup | null>(null);
  const [tree, setTree] = useState<CraftNode | null>(null);
  const [used, setUsed] = useState<UsedIn[]>([]);
  const [refine, setRefine] = useState<{ from: RefiningRecipe[]; into: RefiningRecipe[] }>({
    from: [],
    into: [],
  });
  const [drops, setDrops] = useState<Drop[]>([]);

  useEffect(() => {
    let live = true;
    setMarkup(null);
    setTree(null);
    setUsed([]);
    setRefine({ from: [], into: [] });
    setDrops([]);
    nexusItem(item.Name).then((m) => live && setMarkup(m)).catch(() => {});
    craftTree(item.Name).then((t) => live && setTree(t)).catch(() => {});
    usedIn(item.Name).then((u) => live && setUsed(u)).catch(() => {});
    refining(item.Name).then((r) => live && setRefine(r)).catch(() => {});
    dropsOf(item.Name).then((d) => live && setDrops(d)).catch(() => {});
    return () => {
      live = false;
    };
  }, [item.Name]);

  const value = markup?.value ?? null;
  const damage = p.Damage;
  const totalDmg = damage
    ? Object.values(damage).reduce((s: number, v) => s + Number(v ?? 0), 0)
    : 0;
  const dps = totalDmg && p.UsesPerMinute ? (totalDmg * p.UsesPerMinute) / 60 : null;
  const raws = tree ? rawMaterials(tree) : [];

  return (
    <div className="codexdetail">
      <header className="codexhead">
        <div>
          <h2 className="codexhead__name">{item.Name}</h2>
          <div className="codexhead__sub">
            <span className="codexbadge">{kindLabel(item.Links.$Url)}</span>
            {p.Category && <span>{p.Category}</span>}
            {p.Type && <span>{p.Type}</span>}
            {p.Class && <span>{p.Class}</span>}
          </div>
        </div>
      </header>

      {p.Description && <p className="codexdesc">{p.Description}</p>}

      <Section title="Economy">
        <div className="codexgrid">
          <Stat label="TT">{ped(tt)}</Stat>
          {econ.MinTT != null && <Stat label="Min TT">{ped(econ.MinTT)}</Stat>}
          <Stat label="Markup">{markup?.markup != null ? `${markup.markup.toFixed(0)}%` : "—"}</Stat>
          <Stat label="Est. value">{value != null ? ped(value) : "—"}</Stat>
          {econ.Efficiency != null && <Stat label="Efficiency">{econ.Efficiency}%</Stat>}
          {econ.Decay != null && <Stat label="Decay">{econ.Decay} PEC</Stat>}
          {econ.AmmoBurn != null && <Stat label="Ammo burn">{econ.AmmoBurn}</Stat>}
          {p.Weight != null && <Stat label="Weight">{p.Weight}</Stat>}
        </div>
      </Section>

      {(totalDmg > 0 || p.UsesPerMinute != null) && (
        <Section title="Combat">
          <div className="codexgrid">
            {totalDmg > 0 && <Stat label="Damage">{totalDmg.toFixed(1)}</Stat>}
            {dps != null && <Stat label="DPS">{dps.toFixed(1)}</Stat>}
            {p.UsesPerMinute != null && <Stat label="Uses/min">{p.UsesPerMinute}</Stat>}
            {p.Range != null && <Stat label="Range">{p.Range} m</Stat>}
            {item.Ammo?.Name && (
              <Stat label="Ammo">
                <RefLink r={item.Ammo} onOpen={onOpen} />
              </Stat>
            )}
            {item.ProfessionHit?.Name && (
              <Stat label="Hit prof.">
                <RefLink r={item.ProfessionHit} onOpen={onOpen} />
              </Stat>
            )}
            {item.ProfessionDmg?.Name && (
              <Stat label="Dmg prof.">
                <RefLink r={item.ProfessionDmg} onOpen={onOpen} />
              </Stat>
            )}
          </div>
          <DamageBars d={damage} />
        </Section>
      )}

      {tree && tree.children?.length ? (
        <Section title={`Crafted via${tree.profession ? ` · ${tree.profession} L${tree.level}` : ""}`}>
          <MaterialTree node={tree} onOpen={onOpen} />
          {raws.length > 1 && (
            <div className="codexraws">
              <span className="codexraws__h">Raw materials</span>
              {raws.map((r) => (
                <span key={r.name} className="codexraws__chip">
                  {r.amount}× {r.name}
                </span>
              ))}
            </div>
          )}
        </Section>
      ) : null}

      {used.length > 0 && (
        <Section title="Used to craft" count={used.length}>
          <ul className="codexlist">
            {used.map((u) => (
              <li key={u.name} className="codexlist__row">
                <RefLink r={{ Name: u.name, Links: { $Url: u.url ?? undefined } }} onOpen={onOpen} />
                <span className="codexlist__meta">
                  {u.profession}
                  {u.level != null ? ` · L${u.level}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(refine.from.length > 0 || refine.into.length > 0) && (
        <Section title="Refining">
          {refine.from.map((r) => (
            <RecipeRow key={`f${r.Id}`} r={r} onOpen={onOpen} label="from" />
          ))}
          {refine.into.map((r) => (
            <RecipeRow key={`i${r.Id}`} r={r} onOpen={onOpen} label="into" />
          ))}
        </Section>
      )}

      {drops.length > 0 && (
        <Section title="Dropped by" count={drops.length}>
          <table className="codextable">
            <thead>
              <tr>
                <th>Mob</th>
                <th>Maturity</th>
                <th>Planet</th>
                <th>Freq.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {drops.map((d, i) => (
                <tr key={i} className={d.isDropping ? "" : "codextable__stale"}>
                  <td>
                    <button className="codexlink" onClick={() => onOpen(`/mobs/${d.mobId}`)}>
                      {d.mobName}
                    </button>
                  </td>
                  <td>{d.maturity ?? "—"}</td>
                  <td>{d.planet}</td>
                  <td>{d.frequency}</td>
                  <td>{d.isDropping ? "" : "old"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}

function RecipeRow({
  r,
  onOpen,
  label,
}: {
  r: RefiningRecipe;
  onOpen: (url: string) => void;
  label: "from" | "into";
}) {
  return (
    <div className="reciperow">
      <span className="reciperow__tag">{label === "from" ? "produced from" : "refines into"}</span>
      <span className="reciperow__body">
        {r.Ingredients.map((i, n) => (
          <span key={n}>
            {n > 0 && " + "}
            {i.Amount}× <RefLink r={i.Item} onOpen={onOpen} />
          </span>
        ))}
        {" → "}
        {r.Amount}× <RefLink r={r.Product} onOpen={onOpen} />
      </span>
    </div>
  );
}

function kindLabel(url: string): string {
  const k = url.split("/")[1] ?? "";
  return k.replace(/s$/, "").replace(/^\w/, (c) => c.toUpperCase());
}
