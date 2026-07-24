# Cerberus — Claude Code project notes

Desktop tool for Les's Entropia Universe space-PVP / piracy clan. Read this before working.

## What it is
- **Stack:** Tauri 2 + React 19 + Vite + TypeScript. Windows-first. Standalone repo (NOT a Cargo workspace).
- **Repo:** `github.com/LesTasker2023/cerberus` (public). Branding: crimson accent `--accent #cf3b2d`, Oxanium + JetBrains Mono, dark.
- **Core idea:** tails the game's `chat.log` and layers tools on top — live feed, hunt tracker, rock/mob logging, 3D sector map, market tools, clan sync, and accessibility automation.

## Build / verify (always run before claiming done)
- Frontend: `npx tsc --noEmit` and `npx vite build`.
- Rust: needs the MSVC env. Use the vcvars-prefixed command (plain shells lack `link.exe`):
  `cmd /c '"C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1 && cd /d "<repo>\src-tauri" && cargo check'`
- Tests: `npx vitest run` (1412 loadout parity tests vs sibling `../Artemis-Tracker` — must stay green).
- **I cannot run the app.** Rust/overlay/input changes are compile-verified only — always ask Les to smoke-test.

## Release process (manual — GitHub Actions is unavailable, restricted account)
1. Bump version in `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`; `cargo check` to sync `Cargo.lock`.
2. Commit, push `main`.
3. Build: `npm run tauri build` via the vcvars command.
4. Sign the installer **separately**: `node_modules/.bin/tauri signer sign -f "C:/Users/les-t/Documents/GitHub/cerberus-updater.key" -p '' "src-tauri/target/release/bundle/nsis/Cerberus_<ver>_x64-setup.exe"`
5. Build `latest.json` from the `.sig` (updater endpoint = `releases/latest/download/latest.json`).
6. `gh release create v<ver> <setup.exe> <latest.json> --title "Cerberus v<ver>" --latest --notes "..."`

### ⚠️ Release hang / "failure" gotcha — READ before every release
`createUpdaterArtifacts:true` makes `tauri build` try to sign in-build, and that goes wrong two ways depending on the env:
- **No signing env set (current setup):** the build **exits code 1** at the end with `Error A public key has been found, but no private key`. **This is NOT a failure** — both installers already built (`Finished 2 bundles at:` appears just above). Ignore the exit code, then sign separately (step 4). Don't "fix" the exit 1.
- **Signing env set with the empty-password key:** the build **HANGS FOREVER** at `Decrypting updater signing key, expect a prompt for password`, because cmd `set VAR=` *unsets* an empty var so Tauri drops to an interactive prompt a background build can't answer. The installer .exe is already built at that point — kill the task and sign separately.
- **Bottom line:** never sign in-build. Let it exit 1 (or kill the hang), then always sign with the separate `tauri signer sign … -p ''` command. When monitoring a background build, treat exit 1 + `Finished 2 bundles` as success.
- **Separate splash-hang trap (v0.4.0):** don't navigate the main window via `tauri-plugin-localhost` — breaks IPC in *release only*, so the app hangs on the splash and dev never shows it. Smoke-test real builds.
- **Never change the updater pubkey** (breaks all installed updaters). Key file is OUTSIDE the repo, gitignored via `*.key`.

## Architecture that matters
- **Multi-window:** one frontend, branched in `src/main.tsx` on `getCurrentWindow().label`. Overlay windows (transparent, `decorations:false`, `alwaysOnTop`, `skipTaskbar`) are declared in `src-tauri/tauri.conf.json` AND `src-tauri/capabilities/default.json` (both lists must include the label) AND the `OverlayStates` struct in `lib.rs`.
- **Cross-window state lives in Rust**, synced via events — NOT localStorage (webview windows may not share it). Pattern: a Rust flag/config + a `*:changed` / `*:status` event the windows listen to. (Broadcast, combat capture, EM config all do this.)
- **App-root hooks:** anything that must survive page navigation lives in a hook mounted in `App.tsx`, not in a page (pages are conditionally rendered = unmounted on nav). E.g. `useTrackerSession`, `useChatTriggers`.
- **Input synthesis (`input.rs`):** CryEngine only reads **hardware scancodes**, not virtual keys, and needs a real down→hold→up spanning a frame. `press_key(scan, hold_ms)` + `sc::` constants. Always gate input on `entropia_is_focused()`.
- **Screen read:** `ocr.rs` — `read_region` (GDI BitBlt → Windows.Media.Ocr, no Tesseract) and `grab` (raw BGRA for pixel scans).
- **Clan sync = Supabase** (`src/lib/supabase.ts`, project `dhecuieubrnxudnrprse`). Use the legacy `anon` JWT (`eyJ…`), NOT `sb_publishable_` (Realtime rejects it). ⚠️ RLS is `using(true)` — anon key ships in the public build, so anyone can read/write. Harden before wider release.

## Hard-won gotchas (don't rediscover these)
- **Windowed commands must be `async`.** A *sync* `#[tauri::command]` that builds a webview window **deadlocks on Windows** (window creation needs the main-thread event loop the command is blocking) → white never-painted window that wedges sibling webviews. See `open_stream`.
- **ureq `into_string()` caps at 10 MB.** `/mobs` is ~14 MB → use `into_json()` / read from the reader. This silently broke the Nexus refresh.
- **Twitch embeds fail in packaged builds:** the iframe `parent=<host>` check rejects Tauri's prod protocol. Fix = open the stream in its own window (top-level, no parent check). Bare player = `player.twitch.tv/?channel=X&parent=twitch.tv`.
- **`data-tauri-drag-region` only drags when the element under the cursor has it.** A child covering the region (e.g. `inset:0` overlay) blocks the drag unless it's `pointer-events:none` or also carries the attribute. Bit the tracker HUD header and the EM frame.
- **Don't navigate the main window via `tauri-plugin-localhost`** — breaks IPC in release builds (splash hang, v0.4.0). Dev is unaffected, so smoke-test real builds.
- Icons aren't cargo build inputs — `touch src-tauri/build.rs` to re-embed after regenerating.

## WIP / feature flags
- `src/lib/features.ts` gates unfinished features (`mobLogger`, `rangeCalibrator` = false, hidden from nav/dock/config). Kill-date **2026-10-20** — see `AUDIT.md`.
- `import.meta.env.DEV` gates dev-only tools (e.g. the Feed's channel history scan). Verified stripped from prod bundles.

## Conventions
- SCSS is a single `src/styles.css` (BEM-ish flat classes), not modules. Keep braces balanced; prune dead classes conservatively (exclude dynamically-composed `prefix--${}` classes).
- No `console.log` in commits. Conventional commit prefixes. End commit messages with the Co-Authored-By trailer.
- See `AUDIT.md` for the vanity-engineering audit (RCR 3/10) and the open items: MapView god-component (383-line effect), 4× duplicated JSON store boilerplate (`asteroids/poi/sessions/combat.rs` → a generic `JsonStore<T>` is justified), `lib.rs` as a god module (commands should move beside their domain modules).

## Current state (2026-07-24)
- **Released: v0.6.0.** Auto-updates from prior versions.
- **⚠️ UNCOMMITTED: the EM accessibility tool** (`src-tauri/src/em.rs`, `src/pages/EmTool.tsx`, `src/pages/EmRegion.tsx`, `src/lib/em.ts`, `src/lib/emConfig.ts`, plus edits to `input.rs`, `combat.rs`, `ocr.rs`, `lib.rs`, `Dock.tsx`, `App.tsx`, `Sidebar.tsx`, `main.tsx`, `tauri.conf.json`, `capabilities/default.json`, `styles.css`). Compile-clean, NOT smoke-tested, NOT committed.
  - **EM tool** = accessibility "engage mob" loop. Nav: Accessibility → EM Assist. Loop: press F (engage) → if no `You inflicted` damage lands, OCR the game minimap for red blips, turn the view (Z/C) toward the nearest, step W, repeat until combat registers. Minimap is heading-up (12 o'clock = forward); dot angle from vertical drives the turn. Rings = range. Everything tunable in the UI (persisted localStorage `cerberus.emTuning`/`cerberus.emRegion`, pushed to backend via `em_set_config` so topbar + HUD-dock toggles can arm it).
  - Safety: input gated on Entropia focus; global kill-switch **Ctrl+Shift+K**; hard time cap.
  - Start/stop from: the EM Assist page, the **topbar** EM button, and the **HUD dock** EM button.
  - **Unverified assumptions to calibrate with Les:** Z vs C turn direction (has a Swap L/R button), red-blip thresholds, turn/step magnitudes, whether F engages the nearest vs faced mob.
