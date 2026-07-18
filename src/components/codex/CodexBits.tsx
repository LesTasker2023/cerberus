import type { ReactNode } from "react";
import type { CraftNode, Damage, Ref } from "../../lib/codex/types";
import { isResolvable } from "../../lib/codex/store";

/** A relationship link. Clickable (deep-dive) when the target is resolvable,
 *  otherwise a plain label. */
export function RefLink({
  r,
  onOpen,
  fallback,
}: {
  r: Ref | undefined | null;
  onOpen: (url: string) => void;
  fallback?: ReactNode;
}) {
  const name = r?.Name;
  if (!name) return <>{fallback ?? "—"}</>;
  const url = r?.Links?.$Url;
  if (url && isResolvable(url)) {
    return (
      <button className="codexlink" onClick={() => onOpen(url)}>
        {name}
      </button>
    );
  }
  return <span className="codexref">{name}</span>;
}

/** A titled section that only renders when it has content. */
export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="codexsec">
      <h3 className="codexsec__h">
        {title}
        {count != null && <span className="codexsec__n">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

const DMG_KEYS: (keyof Damage)[] = [
  "Stab", "Cut", "Impact", "Penetration", "Shrapnel", "Burn", "Cold", "Acid", "Electric",
];

/** Horizontal bars for the nine damage/defense types (skips empty ones). */
export function DamageBars({ d }: { d: Damage | undefined }) {
  if (!d) return null;
  const rows = DMG_KEYS.map((k) => ({ k, v: Number(d[k] ?? 0) })).filter((r) => r.v > 0);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.v));
  return (
    <div className="dmgbars">
      {rows.map(({ k, v }) => (
        <div key={k} className="dmgbars__row">
          <span className="dmgbars__lbl">{k}</span>
          <span className="dmgbars__track">
            <span className="dmgbars__fill" style={{ width: `${(v / max) * 100}%` }} />
          </span>
          <span className="dmgbars__val">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Recursive crafting material tree. */
export function MaterialTree({
  node,
  onOpen,
  depth = 0,
}: {
  node: CraftNode;
  onOpen: (url: string) => void;
  depth?: number;
}) {
  return (
    <ul className="crafttree" style={depth ? { marginLeft: 14 } : undefined}>
      {(node.children ?? []).map((c, i) => (
        <li key={`${c.name}-${i}`} className="crafttree__node">
          <span className={`crafttree__row ${c.craftable ? "crafttree__row--craft" : ""}`}>
            <span className="crafttree__amt">{c.amount}×</span>
            {c.url && isResolvable(c.url) ? (
              <button className="codexlink" onClick={() => onOpen(c.url!)}>
                {c.name}
              </button>
            ) : (
              <span className="crafttree__name">{c.name}</span>
            )}
            {c.craftable && c.level != null && (
              <span className="crafttree__tag">craft · L{c.level}</span>
            )}
          </span>
          {c.children?.length ? <MaterialTree node={c} onOpen={onOpen} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Aggregate the leaf (non-craftable) materials of a tree by name. */
export function rawMaterials(node: CraftNode): { name: string; amount: number; url?: string }[] {
  const acc = new Map<string, { name: string; amount: number; url?: string }>();
  const walk = (n: CraftNode) => {
    for (const c of n.children ?? []) {
      if (c.craftable && c.children?.length) walk(c);
      else {
        const cur = acc.get(c.name);
        if (cur) cur.amount += c.amount;
        else acc.set(c.name, { name: c.name, amount: c.amount, url: c.url });
      }
    }
  };
  walk(node);
  return [...acc.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A compact label/value stat cell. */
export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="codexstat">
      <span className="codexstat__l">{label}</span>
      <span className="codexstat__v">{children}</span>
    </div>
  );
}
