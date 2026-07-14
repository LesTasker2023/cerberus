import { invoke } from "@tauri-apps/api/core";

/** Mirror of the Rust `ec::Avatar` dossier. */
export interface Avatar {
  found: boolean;
  name: string;
  slug: string;
  ec_rank: number | null;
  total_globals: number | null;
  total_value: number | null;
  largest_global: number | null;
  largest_detail: string;
  largest_type: string;
  hunting_globals: number | null;
  mining_globals: number | null;
  space_mining_globals: number | null;
  space_mining_value: number | null;
  largest_space_deposit: string;
  pvp_kills: number | null;
  pvp_rank: number | null;
  last_global_at: string;
  first_global_at: string;
}

// Client-side cache + in-flight dedupe so repeated clicks don't re-hit Rust.
const cache = new Map<string, Avatar>();
const inflight = new Map<string, Promise<Avatar>>();

export function ecAvatar(name: string): Promise<Avatar> {
  const key = name.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const flying = inflight.get(key);
  if (flying) return flying;
  const p = invoke<Avatar>("ec_avatar", { name })
    .then((r) => {
      cache.set(key, r);
      inflight.delete(key);
      return r;
    })
    .catch((e) => {
      inflight.delete(key);
      throw e;
    });
  inflight.set(key, p);
  return p;
}

/** Compact PED formatting: 7418051 → "7.42M". */
export function compact(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

/** "…days ago" from an ISO timestamp — how recently they were active. */
export function since(iso: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
