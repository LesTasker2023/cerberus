// Publish YOUR dev-curated data as the shipped defaults.
//
// Snapshots the current POIs / rock finds / mob spawns from this machine's
// app-data store into the committed seed files that get embedded in the build.
// New installs seed from these on first launch (existing users keep their own
// data — seeding is first-install-only). Run deliberately, review the diff,
// commit, then release.
//
//   node scripts/publish-seed.mjs
//
// The mob seed strips personal loot/skills — we ship spawn info, not your takings.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src-tauri", "src");
const APPDATA = join(process.env.APPDATA ?? "", "com.les-t.cerberus");

function read(file) {
  const p = join(APPDATA, file);
  if (!existsSync(p)) {
    console.log(`  (no ${file} in app-data — skipping)`);
    return null;
  }
  return JSON.parse(readFileSync(p, "utf8"));
}
function write(name, data) {
  writeFileSync(join(SRC, name), JSON.stringify(data, null, 2) + "\n");
  console.log(`  → src/${name}  (${data.length})`);
}

console.log(`app-data: ${APPDATA}`);

// POIs → seed_pois.json (SeedPoi shape: drop id, notes null→"").
const pois = read("pois.json");
if (pois) {
  write(
    "seed_pois.json",
    pois.map((p) => ({
      name: p.name,
      category: p.category,
      eu_x: p.eu_x,
      eu_y: p.eu_y,
      eu_z: p.eu_z,
      pvp_lootable: !!p.pvp_lootable,
      notes: p.notes ?? "",
      sector: p.sector ?? null,
    })),
  );
}

// Rock finds → seed_rocks.json (verbatim Asteroid shape).
const rocks = read("asteroids.json");
if (rocks) write("seed_rocks.json", rocks);

// Mob spawns → seed_mobs.json (Encounter shape, personal loot/skills stripped).
const mobs = read("encounters.json");
if (mobs) {
  write(
    "seed_mobs.json",
    mobs.map((m) => ({ ...m, loot: [], loot_value: 0, skills: [] })),
  );
}

console.log("done — review the diff, commit, then release.");
