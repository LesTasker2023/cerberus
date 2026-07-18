// Build the SLIM Nexus snapshot the Codex bundles.
//
// We ship only what can't be fetched live from Nexus: a search directory and the
// precomputed reverse-relationship indices (crafting edges, material usage,
// refining, item->mob drops). Full item/mob records are fetched on demand at
// runtime via the `nexus_get` Rust command, so the bundle stays a few MB, not 30.
//
// Build-time reads the delta repo's full api-cache; runtime never sees it.
// Re-run manually (`node scripts/build-nexus-snapshot.mjs`) after a game VU.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "public", "nexus");
const DELTA = "c:/Users/les-t/Documents/GitHub/delta/src/data";
const CACHE = join(DELTA, "api-cache");

function loadArray(...candidates) {
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (Array.isArray(j)) return j;
    if (Array.isArray(j?.data)) return j.data;
  }
  throw new Error(`no array source: ${candidates.join(", ")}`);
}
function cat(slug, ...extra) {
  return loadArray(join(DELTA, `${slug}.json`), join(CACHE, slug, `all-${slug}.json`), ...extra);
}

// Item categories that make up the searchable directory (kind === $Url segment).
const ITEM_CATS = [
  "weapons", "armors", "armorplatings", "materials", "misctools", "finders",
  "excavators", "refiners", "scanners", "medicaltools", "enhancers",
  "weaponamplifiers", "weaponvisionattachments", "finderamplifiers", "vehicles",
  "clothings", "absorbers", "medicalchips", "mindforceimplants",
  "teleportationchips", "effectchips", "stimulants",
];

mkdirSync(OUT, { recursive: true });
const counts = {};
function emit(name, data) {
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data));
  counts[name] = Array.isArray(data) ? data.length : Object.keys(data).length;
  console.log(`  ${name}.json  (${counts[name]})`);
}

// --- search directory: name, kind, tt, url only --------------------------

console.log("directory:");
const searchIndex = [];
for (const slug of ITEM_CATS) {
  let arr;
  try {
    arr = cat(slug);
  } catch {
    console.log(`  (skip ${slug})`);
    continue;
  }
  for (const it of arr) {
    const econ = it?.Properties?.Economy ?? {};
    searchIndex.push({
      name: it.Name,
      url: it?.Links?.$Url ?? `/${slug}/${it.Id}`,
      kind: slug,
      tt: econ.Value ?? econ.MaxTT ?? null,
    });
  }
}
const mobs = cat("mobs", join(CACHE, "mobs", "all-mobs-fresh.json"));
for (const m of mobs) {
  searchIndex.push({ name: m.Name, url: m?.Links?.$Url ?? `/mobs/${m.Id}`, kind: "mobs", tt: null });
}
searchIndex.sort((a, b) => a.name.localeCompare(b.name));
emit("search-index", searchIndex);

// --- crafting edges (slim) -----------------------------------------------
// productName -> { u:url, p:profession, l:level, q:minCraft, m:[{n,a,u}] }
// The client recurses over this map to build the full material tree without
// the 5MB of raw blueprint objects.

console.log("crafting:");
const blueprints = cat("blueprints");
const craftIndex = {};
const materialUsage = {}; // materialName -> [productName]
for (const bp of blueprints) {
  const product = bp?.Product?.Name;
  const mats = bp?.Materials;
  if (!product || !Array.isArray(mats) || mats.length === 0) continue;
  // Prefer the unlimited (non-(L)) recipe for a product.
  if (craftIndex[product] && bp.Name.includes("(L)")) continue;
  craftIndex[product] = {
    u: bp.Product?.Links?.$Url ?? null,
    p: bp.Profession?.Name ?? null,
    l: bp.Properties?.Level ?? null,
    q: bp.Properties?.MinimumCraftAmount ?? 1,
    m: mats.map((m) => ({ n: m.Item?.Name, a: m.Amount, u: m.Item?.Links?.$Url ?? null })),
  };
  for (const m of mats) {
    const mn = m.Item?.Name;
    if (!mn) continue;
    (materialUsage[mn] ??= []).push(product);
  }
}
// Dedupe + cap the reverse usage lists.
for (const k of Object.keys(materialUsage)) {
  materialUsage[k] = [...new Set(materialUsage[k])].slice(0, 80);
}
emit("craft-index", craftIndex);
emit("material-usage", materialUsage);

// --- refining (small; keep slim refs) ------------------------------------

const refining = cat("refiningrecipes").map((r) => ({
  Id: r.Id,
  Amount: r.Amount,
  Ingredients: (r.Ingredients ?? []).map((i) => ({
    Amount: i.Amount,
    Item: { Name: i.Item?.Name, Links: i.Item?.Links },
  })),
  Product: { Name: r.Product?.Name, Links: r.Product?.Links },
}));
emit("refining", refining);

// --- item -> mob drops (reverse index; irreplaceable live) ---------------

const drops = JSON.parse(readFileSync(join(CACHE, "loot", "item-drops.json"), "utf8"));
emit("item-drops", drops.data ?? drops);

// --- manifest -------------------------------------------------------------

writeFileSync(
  join(OUT, "manifest.json"),
  JSON.stringify({ builtAt: new Date().toISOString(), source: "delta api-cache", counts }, null, 2),
);
console.log(`\nslim snapshot → ${OUT}`);
