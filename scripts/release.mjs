#!/usr/bin/env node
// Post-build release helper: sign the NSIS installer (if not already), write the
// updater manifest (latest.json), and create the GitHub release with both assets.
// Run AFTER `npm run tauri build`. See RELEASING.md.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const REPO = "LesTasker2023/cerberus";
const KEY =
  process.env.TAURI_SIGNING_PRIVATE_KEY ||
  "C:\\Users\\les-t\\Documents\\GitHub\\cerberus-updater.key";

const version = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const tag = `v${version}`;
const dir = "src-tauri/target/release/bundle/nsis";
const exe = `${dir}/Cerberus_${version}_x64-setup.exe`;
const sig = `${exe}.sig`;
const manifest = `${dir}/latest.json`;

if (!existsSync(exe)) {
  console.error(`Installer not found: ${exe}\nRun \`npm run tauri build\` first.`);
  process.exit(1);
}

if (!existsSync(sig)) {
  console.log("Signing installer…");
  execSync(`npx tauri signer sign -f "${KEY}" -p "" "${exe}"`, { stdio: "inherit" });
}

writeFileSync(
  manifest,
  JSON.stringify(
    {
      version,
      notes: `Cerberus ${tag}`,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature: readFileSync(sig, "utf8").trim(),
          url: `https://github.com/${REPO}/releases/download/${tag}/Cerberus_${version}_x64-setup.exe`,
        },
      },
    },
    null,
    2,
  ),
);
console.log(`Wrote ${manifest}`);

console.log(`Creating release ${tag}…`);
execSync(
  `gh release create ${tag} --title "Cerberus ${tag}" ` +
    `--notes "Windows installer below. Installed builds auto-update." ` +
    `"${exe}" "${manifest}"`,
  { stdio: "inherit" },
);
console.log(`\nReleased: https://github.com/${REPO}/releases/tag/${tag}`);
