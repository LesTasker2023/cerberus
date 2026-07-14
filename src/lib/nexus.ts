import { invoke } from "@tauri-apps/api/core";

/** Mirror of the Rust `NexusItem`. */
export interface NexusItem {
  name: string;
  tt: number | null;
  markup: number | null;
  value: number | null;
  found: boolean;
}

// Client-side cache + in-flight dedupe so repeated clicks don't re-hit Rust.
const cache = new Map<string, NexusItem>();
const inflight = new Map<string, Promise<NexusItem>>();

export function nexusItem(name: string): Promise<NexusItem> {
  const key = name.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const flying = inflight.get(key);
  if (flying) return flying;
  const p = invoke<NexusItem>("nexus_item", { name })
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
