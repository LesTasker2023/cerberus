# Vanity Engineering Audit — Cerberus

**Date:** 2026-07-22 · **Scope:** whole app (~22k lines — 10.7k TS/TSX, 3.8k Rust, 7.5k CSS)
**Framework:** `vanity-engineering-review` — complexity that doesn't buy proportional capability.

---

## Requirement anchor

| | |
|---|---|
| **Users** | Solo dev + a small Entropia Universe piracy clan (handful of people) |
| **Core jobs** | 1. Tail `chat.log` for live intel · 2. Track hunt profitability (spend vs loot) · 3. Log rocks/mobs for the clan · 4. 3D map, waypoints, POIs, location broadcast · 5. Market tools (auctions, arbitrage, item database) |
| **Actual scale** | One desktop app, a few users, local JSON files + Supabase clan sync |
| **Real constraints** | Windows; must read a running game's log; must overlay a fullscreen game; Nexus/EC APIs 403 non-browser clients (hence the Rust proxy) |
| **Team** | 1 |

## Verdict — RCR 3/10

**The complexity is mostly earned.** The debt is *residue* left by iteration, not *architecture*.

Cerberus has no plugin system, no DI container, no event bus for synchronous work, **zero custom
Rust traits**, and no IPC abstraction layer (`invoke()` is called directly). Tauri, React and THREE
each fit the problem genuinely. That is a healthier result than most codebases of this size.

---

## Findings

| # | Finding | Where | Severity | Kill cost | Status |
|---|---|---|---|---|---|
| 1 | 7 dead IPC commands | `lib.rs` | V1 | 30m | ✅ fixed |
| 2 | 1,033 dead CSS lines (120 classes, 14%) | `styles.css` | V1 | 1h | ✅ fixed |
| 3 | 383-line `useEffect` in a 1,186-line component | `MapView.tsx` | V2 | 4h | open |
| 4 | 4× duplicated store boilerplate (224 lines) | `asteroids/poi/sessions/combat.rs` | V1 | 2h | open |
| 5 | 57 commands + 76 fns in one module | `lib.rs` (1,238 lines) | V2 | 3h | open |
| 6 | ~530 lines behind disabled WIP flags | `Combat/MobDb/Calibrator` | V1 | decision | open |

### 1 — Dead IPC surface ✅

`toggle_panel`, `toggle_capregion`, `toggle_radar`, `toggle_mobcap` had zero callers: the generic
`set_overlay` (11 uses) superseded them and the specific versions were never deleted. Also
`stop_watch` (the watcher could not be stopped from any UI), `set_capture_meta`, and `session_clear`
— the last of which was added during this very session and never wired up.

**Lesson:** generalising without deleting the thing you generalised leaves a permanently
misleading API surface.

### 2 — Dead CSS ✅

120 class names existed only in `styles.css`, never in any source file — residue of removed or
redesigned UI (`dash__grid`, `dashsec__*`, `combtoggle*`, `filterlist`, `feed__filters`,
`codex__age`, `clan__status--live`…).

Dynamically-composed classes (`cat--${}`, `chan--${}`, `clanrow__kind--${}`, `wchip--${}` …) were
**excluded** from the dead set — grep alone would have produced false positives and deleted live
styles. Only rules whose selectors consist *entirely* of dead classes were removed.

### 3 — MapView god component (open)

One `useEffect` at line 344 spans **383 lines** and builds the entire THREE scene: camera, lights,
fresnel materials, label sprites, raycasting, animation loop. Not vanity by intent — 3D genuinely
is complex — but it fails the **New Hire Test** badly and makes every map change high-risk.

**Fix:** extract scene construction into a pure `lib/map/scene.ts` (no React), leaving the component
to bind data → scene.

### 4 — Under-abstraction, not over- (open)

`asteroids` (54), `poi` (68), `sessions` (55) and `EncounterStore` (47) each independently implement
`open/persist/list/add/remove` over `Mutex<Vec<T>>` + serde JSON.

The **Abstraction Test** says 3+ concrete implementations is where abstraction starts paying. There
are 4. A generic `JsonStore<T>` collapses ~224 lines to ~60 plus per-type specifics.

> Flagged deliberately because this review framework is biased *against* abstraction and would
> otherwise miss the opposite failure. Evidence justifies abstracting here.

### 5 — `lib.rs` as a god module (open)

Domain modules exist (`combat.rs`, `poi.rs`, `sessions.rs`, `nexus.rs`…) but **all** their Tauri
commands live in `lib.rs` regardless of domain — auth, overlays, watcher, nexus, sessions, capture,
POI and settings in one 1,238-line file.

**Fix:** move each command beside its domain module; keep `lib.rs` for wiring and registration.

### 6 — Disabled features need a decision date (open)

Mob logger (`Combat.tsx` 182 + `MobDb.tsx` 226) and `Calibrator.tsx` (123) — ~530 lines reachable
only by flipping `src/lib/features.ts`. Gating WIP behind a flag is correct handling, **but without
an expiry date "WIP" quietly becomes permanent dead weight.** See kill criteria below.

---

## Explicitly NOT vanity

- **13 overlay windows** — each is a real transparent always-on-top surface over a fullscreen game.
  Deletion Test: removing any loses genuine capability.
- **1,412 loadout parity tests** — not gold plating. They enforce byte-identical maths against
  Artemis-Tracker, which is a stated hard requirement.
- **Rust API proxy** (`nexus_get`, `ec_*`) — not NIH. The webview physically cannot call these APIs
  (403 + CORS); the proxy is the only way.

---

## Vanity debt

~1,250 lines of dead code (now removed). Direct maintenance cost was low, but it was permanent
search and navigation friction — every grep returned residue. Estimate **1–2 person-hours/month**
of "is this still used?" before cleanup.

---

## The hard question

> 16 pages, 13 windows and 57 IPC commands, serving a handful of clan members.
> **Which three pages do you actually open during a hunt?**

If DelBoy, Arb Board, Media or Codex are not on that list, they were built because they were
interesting to build. That is not an argument to delete them — it is an argument to stop adding
to them until they earn their place.

---

## Kill criteria — disabled WIP features

Applies to `FEATURES.mobLogger` and `FEATURES.rangeCalibrator` in `src/lib/features.ts`.

**Tier 1 — hard kill (automatic).**
Still disabled 90 days from 2026-07-22 (i.e. **2026-10-20**) → delete the pages, windows, Rust
commands and CSS outright. Git history is the archive.

**Tier 2 — review trigger.**
Any change to shared code that requires touching the disabled feature to keep compiling → review
immediately, default to delete.

**Tier 3 — earn continuation.**
To flip a flag back on, the feature must: work end-to-end in a real hunt; own no failing or
skipped tests; and add no new IPC command that duplicates an existing generic one (see finding 1).

**New-feature rule (prevents recurrence).**
Any new page ships with a stated job-to-be-done and a 30-day usage check. If it was not opened
during a real hunt in 30 days, it goes behind a flag and inherits the Tier 1 clock above.
