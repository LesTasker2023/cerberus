// Codex data store. We bundle only slim indices (search directory + reverse
// relationship maps) and fetch full item/mob records live from Nexus via the
// `nexus_get` Rust command (the webview can't hit Nexus directly — 403/CORS).
// Every loader/lookup memoises so a file or path is fetched once.

import { invoke } from "@tauri-apps/api/core";
import type {
  CraftEntry,
  CraftNode,
  Drop,
  Mob,
  NexusItem,
  RefiningRecipe,
  Resolved,
  SearchEntry,
  UsedIn,
} from "./types";

const ITEM_KINDS = new Set([
  "weapons", "armors", "armorplatings", "materials", "misctools", "finders",
  "excavators", "refiners", "scanners", "medicaltools", "enhancers",
  "weaponamplifiers", "weaponvisionattachments", "finderamplifiers",
  "vehicles", "clothings", "absorbers", "medicalchips", "mindforceimplants",
  "teleportationchips", "effectchips", "stimulants",
]);

// --- local slim index loading --------------------------------------------

const files = new Map<string, Promise<unknown>>();

function fetchBundled<T>(file: string): Promise<T> {
  return fetch(`/nexus/${file}.json`).then((r) => {
    if (!r.ok) throw new Error(`nexus/${file}: ${r.status}`);
    return r.json() as Promise<T>;
  });
}

// Prefer the disk cache (rebuilt from live Nexus); fall back to the bundled seed.
function load<T>(file: string): Promise<T> {
  let p = files.get(file) as Promise<T> | undefined;
  if (!p) {
    p = invoke<T | null>("nexus_index", { name: file })
      .then((disk) => (disk != null ? disk : fetchBundled<T>(file)))
      .catch(() => fetchBundled<T>(file));
    files.set(file, p);
  }
  return p;
}

/** Drop the memoised indices so the next read picks up a fresh disk cache. */
export function resetIndexes(): void {
  files.clear();
}

/** The disk snapshot's manifest (builtAt + counts), or null before first refresh. */
export function nexusMeta(): Promise<{ builtAt?: string; source?: string } | null> {
  return invoke<{ builtAt?: string; source?: string } | null>("nexus_meta").catch(() => null);
}

/** Kick off a background rebuild of the indices from live Nexus. */
export function nexusRefresh(): Promise<void> {
  return invoke("nexus_refresh");
}

// --- live entity fetch (proxied through Rust, memoised per path) ----------

const live = new Map<string, Promise<unknown>>();
function getLive<T>(path: string): Promise<T> {
  let p = live.get(path) as Promise<T> | undefined;
  if (!p) {
    p = invoke<T>("nexus_get", { path });
    live.set(path, p);
    p.catch(() => live.delete(path)); // let failures retry
  }
  return p;
}

/** The $Url category segment, e.g. "/weapons/81" → "weapons". */
export function kindOf(url: string): string {
  return url.split("/")[1] ?? "";
}

export function isResolvable(url: string | undefined | null): boolean {
  if (!url) return false;
  const k = kindOf(url);
  return k === "mobs" || ITEM_KINDS.has(k);
}

// --- search ---------------------------------------------------------------

export function loadSearch(): Promise<SearchEntry[]> {
  return load<SearchEntry[]>("search-index");
}

export async function search(query: string, kind: string | null, limit = 60): Promise<SearchEntry[]> {
  const q = query.trim().toLowerCase();
  const all = await loadSearch();
  const hits: SearchEntry[] = [];
  for (const e of all) {
    if (kind && e.kind !== kind) continue;
    if (q && !e.name.toLowerCase().includes(q)) continue;
    hits.push(e);
    if (!q && hits.length >= limit) break;
  }
  if (q) {
    hits.sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.name.length - b.name.length;
    });
  }
  return hits.slice(0, limit);
}

// --- resolution (live) ----------------------------------------------------

export function resolveItem(url: string): Promise<NexusItem> {
  return getLive<NexusItem>(url);
}
export function resolveMob(url: string): Promise<Mob> {
  return getLive<Mob>(url);
}

export async function resolve(url: string): Promise<Resolved> {
  const kind = kindOf(url);
  try {
    if (kind === "mobs") return { kind: "mob", mob: await resolveMob(url) };
    if (ITEM_KINDS.has(kind)) return { kind: "item", item: await resolveItem(url) };
  } catch {
    /* fall through */
  }
  return { kind: "unknown", url };
}

// --- crafting graph (slim index) -----------------------------------------

function craftIndex(): Promise<Record<string, CraftEntry>> {
  return load<Record<string, CraftEntry>>("craft-index");
}

function tree(
  name: string,
  qty: number,
  idx: Record<string, CraftEntry>,
  depth: number,
  seen: Set<string>,
): CraftNode | null {
  const e = idx[name];
  if (!e) return null;
  const crafts = Math.ceil(qty / (e.q || 1));
  const children: CraftNode[] = [];
  for (const mat of e.m) {
    const amount = mat.a * crafts;
    const craftable = mat.n in idx;
    const node: CraftNode = { name: mat.n, amount, type: "", url: mat.u ?? undefined, craftable };
    if (craftable && depth < 8 && !seen.has(mat.n)) {
      const child = tree(mat.n, amount, idx, depth + 1, new Set(seen).add(mat.n));
      if (child) {
        node.children = child.children;
        node.profession = child.profession;
        node.level = child.level;
      }
    }
    children.push(node);
  }
  return {
    name,
    amount: qty,
    type: "",
    url: e.u ?? undefined,
    craftable: true,
    profession: e.p ?? undefined,
    level: e.l ?? undefined,
    children,
  };
}

export async function craftTree(name: string, qty = 1): Promise<CraftNode | null> {
  return tree(name, qty, await craftIndex(), 0, new Set([name]));
}

/** Products that consume `name` as a material (reverse "used to craft"). */
export async function usedIn(name: string, limit = 60): Promise<UsedIn[]> {
  const usage = await load<Record<string, string[]>>("material-usage");
  const idx = await craftIndex();
  return (usage[name] ?? []).slice(0, limit).map((product) => {
    const e = idx[product];
    return { name: product, url: e?.u ?? null, profession: e?.p ?? null, level: e?.l ?? null };
  });
}

// --- refining -------------------------------------------------------------

export async function refining(name: string): Promise<{ from: RefiningRecipe[]; into: RefiningRecipe[] }> {
  const recipes = await load<RefiningRecipe[]>("refining");
  const from: RefiningRecipe[] = [];
  const into: RefiningRecipe[] = [];
  for (const r of recipes) {
    if (r.Product?.Name === name) from.push(r);
    if (r.Ingredients?.some((i) => i.Item?.Name === name)) into.push(r);
  }
  return { from, into };
}

// --- drops ----------------------------------------------------------------

export async function dropsOf(name: string): Promise<Drop[]> {
  const idx = await load<Record<string, Drop[]>>("item-drops");
  return idx[name] ?? [];
}
