# Cerberus

Desktop companion for the **Cerberus** clan — space PVP & piracy in Entropia Universe.

Built with Tauri 2 (Rust) + React 19 + Vite. Windows-first.

## Status — v0.1 (app shell)

- **Branding + shell** — top bar, ember/void theme, tabbed nav.
- **Settings** — pick or auto-detect your `chat.log`, live path validation, save.
- **Live Feed** — tails `chat.log` and streams new lines as they happen (newest on top),
  colour-coded by channel (Globals / System / Team / Society / Local).

Settings persist to a JSON file in the app data dir. No database or clan sync yet.

## Roadmap

- Asteroid + coordinate logging (auto-capture from the log, plus manual paste).
- 3D space map + area map (ported from the delta project).
- Clan sync (shared backend) — currently local-only.

## Develop

```bash
npm install
npm run tauri dev
```

Rust builds need a vcvars-initialized MSVC environment (VS 2019 BuildTools). From a bare
shell the MSYS `link.exe` shadows the MSVC linker — run from a VS-aware terminal.

## Structure

```
src/                     React front-end
  App.tsx                shell (top bar + nav)
  pages/Feed.tsx         live log feed
  pages/Settings.tsx     chat.log config + watch control
  hooks/useLogWatch.ts   log:line / watch:status subscription
  components/Logo.tsx     Cerberus sigil
src-tauri/
  src/lib.rs             commands: settings + start/stop watch
  src/watcher.rs         chat.log tail → `log:line` events
```
