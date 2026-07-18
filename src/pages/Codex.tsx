import { useEffect, useMemo, useState } from "react";
import type { Resolved, SearchEntry } from "../lib/codex/types";
import { resolve, search } from "../lib/codex/store";
import { useNexusSnapshot } from "../hooks/useNexusSnapshot";
import { ItemDetail } from "../components/codex/ItemDetail";
import { MobDetail } from "../components/codex/MobDetail";

const FILTERS: { label: string; kind: string | null }[] = [
  { label: "All", kind: null },
  { label: "Weapons", kind: "weapons" },
  { label: "Armor", kind: "armors" },
  { label: "Materials", kind: "materials" },
  { label: "Mobs", kind: "mobs" },
];

/** Codex — the Nexus wiki. Search the bundled catalogue, then deep-dive the
 *  relationship graph. Every linked entity opens in place with back/forward. */
export function Codex() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [results, setResults] = useState<SearchEntry[]>([]);

  // Navigation history of $Urls (a browser-style back/forward stack).
  const [stack, setStack] = useState<string[]>([]);
  const [pos, setPos] = useState(-1);
  const current = pos >= 0 ? stack[pos] : null;

  // Freshness: a refresh landing bumps `rev` so search + the open detail
  // re-read the newly rebuilt indices. The updater UI itself lives in Config.
  const { rev } = useNexusSnapshot();

  function open(url: string) {
    setStack((s) => [...s.slice(0, pos + 1), url]);
    setPos((p) => p + 1);
  }

  // Debounced search (re-runs when a refresh bumps `rev`).
  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      search(query, kind).then((r) => live && setResults(r)).catch(() => {});
    }, 120);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, kind, rev]);

  return (
    <div className="codex">
      <div className="codex__side">
        <input
          className="codex__search"
          placeholder="Search items & mobs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div className="codex__filters">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              className={`codexchip ${kind === f.kind ? "codexchip--on" : ""}`}
              onClick={() => setKind(f.kind)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <ul className="codexresults">
          {results.map((r) => (
            <li key={r.url}>
              <button
                className={`codexresult ${current === r.url ? "codexresult--on" : ""}`}
                onClick={() => open(r.url)}
              >
                <span className="codexresult__name">{r.name}</span>
                <span className="codexresult__kind">{r.kind.replace(/s$/, "")}</span>
                {r.tt != null && <span className="codexresult__tt">{r.tt.toFixed(2)}</span>}
              </button>
            </li>
          ))}
          {query && results.length === 0 && <li className="codexresults__empty">No matches</li>}
        </ul>
      </div>

      <div className="codex__main">
        <div className="codex__bar">
          <button className="codexnav" disabled={pos <= 0} onClick={() => setPos((p) => p - 1)}>
            ‹
          </button>
          <button
            className="codexnav"
            disabled={pos >= stack.length - 1}
            onClick={() => setPos((p) => p + 1)}
          >
            ›
          </button>
        </div>
        {current ? <Detail key={`${current}:${rev}`} url={current} onOpen={open} /> : <Empty />}
      </div>
    </div>
  );
}

function Detail({ url, onOpen }: { url: string; onOpen: (url: string) => void }) {
  const [res, setRes] = useState<Resolved | null>(null);
  useEffect(() => {
    let live = true;
    setRes(null);
    resolve(url).then((r) => live && setRes(r)).catch(() => live && setRes({ kind: "unknown", url }));
    return () => {
      live = false;
    };
  }, [url]);

  if (!res) return <div className="codexdetail codexdetail--load">Loading…</div>;
  if (res.kind === "item") return <ItemDetail item={res.item} onOpen={onOpen} />;
  if (res.kind === "mob") return <MobDetail mob={res.mob} onOpen={onOpen} />;
  return <div className="codexdetail codexdetail--load">Not in catalogue: {url}</div>;
}

function Empty() {
  const tips = useMemo(
    () => ["Sollomate Opalo", "Lysterium Ingot", "Village Boar", "Molisk"],
    [],
  );
  return (
    <div className="codexempty">
      <p>Search the Entropia Nexus catalogue.</p>
      <p className="codexempty__dim">Try: {tips.join(" · ")}</p>
    </div>
  );
}
