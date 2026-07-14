//! Thin Tauri shell for Cerberus. Persists a small JSON settings blob and runs a
//! chat.log tail that streams new lines to the UI. Everything heavier (asteroid
//! logging, maps, clan sync) lands in later increments.

mod asteroids;
mod auth;
mod combat;
mod ec;
mod input;
mod nexus;
mod ocr;
mod poi;
mod watcher;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

/// User preferences, stored as one JSON file in the app data dir.
#[derive(Serialize, Deserialize, Clone, Default)]
struct Settings {
    /// Custom chat.log path; falls back to auto-detection when unset.
    log_path: Option<String>,
    /// In-game avatar name (reserved for future clan features).
    player_name: Option<String>,
}

/// Shared app state. The watcher flag is swapped to stop/replace the tail thread.
/// Label + type applied to the next captured rock. Set from any window (or the
/// hotkey path reads whatever was last set).
#[derive(Clone)]
struct CaptureMeta {
    label: String,
    category: String,
}

impl Default for CaptureMeta {
    fn default() -> Self {
        CaptureMeta {
            label: String::new(),
            category: "asteroid-m".to_string(),
        }
    }
}

struct AppState {
    settings_path: PathBuf,
    settings: Mutex<Settings>,
    watching: Mutex<Arc<AtomicBool>>,
    asteroids: asteroids::AsteroidStore,
    pois: poi::PoiStore,
    capture: Mutex<CaptureMeta>,
    /// Live combat/hunt tracker state.
    combat: combat::CombatState,
    /// Finished mob encounters (positions, HP, loot, skills).
    encounters: combat::EncounterStore,
    /// Discord login + clan-membership gate.
    auth: auth::AuthState,
}

/// Persisted position + size of the OCR capture box.
#[derive(Serialize, Deserialize, Clone, Copy)]
struct CapGeom {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

fn load_cap_geom(path: &PathBuf) -> Option<CapGeom> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|j| serde_json::from_str(&j).ok())
}

/// Write a capture window's current geometry to disk.
fn persist_geom(app: &AppHandle, label: &str, path: &std::path::Path) {
    let Some(w) = app.get_webview_window(label) else {
        return;
    };
    if let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) {
        let geom = CapGeom {
            x: pos.x,
            y: pos.y,
            w: size.width,
            h: size.height,
        };
        if let Ok(json) = serde_json::to_string(&geom) {
            let _ = std::fs::write(path, json);
        }
    }
}

fn load_settings(path: &PathBuf) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn persist_settings(path: &PathBuf, settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// Where the watcher would actually read from, and whether that file exists.
#[derive(Serialize)]
struct LogCheck {
    /// The path the watcher would use, if any resolved.
    resolved: Option<String>,
    /// Whether that path exists on disk right now.
    exists: bool,
    /// How `resolved` was obtained: "configured", "detected", or "none".
    source: &'static str,
}

/// Current watch state pushed to the UI on change.
#[derive(Serialize, Clone)]
struct WatchStatus {
    watching: bool,
    path: Option<String>,
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().expect("settings poisoned").clone()
}

#[tauri::command]
fn save_settings(settings: Settings, state: State<'_, AppState>) -> Result<(), String> {
    persist_settings(&state.settings_path, &settings)?;
    *state.settings.lock().expect("settings poisoned") = settings;
    Ok(())
}

/// The auto-detected chat.log path, if one exists.
#[tauri::command]
fn detect_log_path() -> Option<String> {
    watcher::default_log_path().map(|p| p.to_string_lossy().into_owned())
}

/// Resolve the effective log path (explicit arg → configured → auto-detect) and
/// report whether it exists. Powers the Settings page's live validation.
#[tauri::command]
fn check_log_path(path: Option<String>, state: State<'_, AppState>) -> LogCheck {
    let explicit = path.filter(|p| !p.trim().is_empty());
    let configured = state
        .settings
        .lock()
        .expect("settings poisoned")
        .log_path
        .clone()
        .filter(|p| !p.trim().is_empty());

    let (resolved, source) = match explicit.or(configured) {
        Some(p) => (Some(PathBuf::from(p)), "configured"),
        None => match watcher::default_log_path() {
            Some(p) => (Some(p), "detected"),
            None => (None, "none"),
        },
    };
    let exists = resolved.as_ref().map(|p| p.exists()).unwrap_or(false);
    LogCheck {
        resolved: resolved.map(|p| p.to_string_lossy().into_owned()),
        exists,
        source,
    }
}

/// Start tailing the chat.log. Uses `path`, else the configured path, else auto-detect.
#[tauri::command]
fn start_watch(
    path: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WatchStatus, String> {
    let configured = state
        .settings
        .lock()
        .expect("settings poisoned")
        .log_path
        .clone()
        .filter(|p| !p.trim().is_empty());

    let resolved = match path.filter(|p| !p.trim().is_empty()).or(configured) {
        Some(p) => PathBuf::from(p),
        None => watcher::default_log_path().ok_or("No chat.log found in the usual locations")?,
    };
    if !resolved.exists() {
        return Err(format!("File not found: {}", resolved.display()));
    }

    // Stop any existing watcher, then install + spawn a fresh one.
    let running = Arc::new(AtomicBool::new(true));
    {
        let mut flag = state.watching.lock().expect("watch flag poisoned");
        flag.store(false, Ordering::Relaxed);
        *flag = running.clone();
    }
    watcher::spawn(resolved.clone(), running, app.clone());

    let status = WatchStatus {
        watching: true,
        path: Some(resolved.to_string_lossy().into_owned()),
    };
    let _ = app.emit("watch:status", &status);
    Ok(status)
}

/// Coordinates captured from a position line.
#[derive(Serialize, Clone)]
struct Coords {
    x: i64,
    y: i64,
    z: i64,
}

/// Resolve the effective chat.log path (configured → auto-detect) and confirm it exists.
fn resolve_log_path(state: &AppState) -> Result<PathBuf, String> {
    let configured = state
        .settings
        .lock()
        .expect("settings poisoned")
        .log_path
        .clone()
        .filter(|p| !p.trim().is_empty());
    let path = match configured {
        Some(p) => PathBuf::from(p),
        None => watcher::default_log_path().ok_or("No chat.log found in the usual locations")?,
    };
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }
    Ok(path)
}

/// Scan every `[...]` group on the line and return the first that holds ≥3
/// integers — the coordinate triple. Skips tokens like `[System]` / `[]` that
/// precede the real `[Space, x, y, z, ...]` group on a raw log line.
fn extract_coords(line: &str) -> Option<Coords> {
    let mut rest = line;
    while let Some(open) = rest.find('[') {
        let after = &rest[open + 1..];
        let Some(close) = after.find(']') else { break };
        let nums: Vec<i64> = after[..close]
            .split(',')
            .filter_map(|t| t.trim().parse::<i64>().ok())
            .collect();
        if nums.len() >= 3 {
            return Some(Coords {
                x: nums[0],
                y: nums[1],
                z: nums[2],
            });
        }
        rest = &after[close + 1..];
    }
    None
}

/// Fire the position keypress, then watch the log tail for ~2.5s for the
/// resulting position line and return its coordinates. (Internal.)
fn capture_coords(state: &AppState) -> Result<Coords, String> {
    use std::io::{Read, Seek, SeekFrom};

    let path = resolve_log_path(state)?;
    let start = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();

    // Bring Entropia to the front and fire the key. Focus is deliberately left
    // on the game afterwards so play continues seamlessly.
    if !input::focus_entropia() {
        return Err("Entropia window not found — is the game running?".into());
    }
    std::thread::sleep(std::time::Duration::from_millis(150));
    input::send_position_key();

    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(2500);
    let mut found: Option<Coords> = None;
    while std::time::Instant::now() <= deadline {
        std::thread::sleep(std::time::Duration::from_millis(120));
        let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
        if size > start {
            let mut f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
            f.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            f.take(size - start).read_to_end(&mut buf).map_err(|e| e.to_string())?;
            let text = String::from_utf8_lossy(&buf);
            let lines: Vec<&str> = text.lines().collect();
            // Prefer the [System] position line; fall back to any coord line.
            let hit = lines
                .iter()
                .rev()
                .find(|l| l.contains("[System]") && extract_coords(l).is_some())
                .or_else(|| lines.iter().rev().find(|l| extract_coords(l).is_some()));
            if let Some(c) = hit.and_then(|l| extract_coords(l)) {
                found = Some(c);
                break;
            }
        }
    }

    found.ok_or_else(|| "No position detected. Is the location key bound to `<` in-game?".into())
}

/// Fire the position key and return the freshly captured coordinates. Backs the
/// map's click-to-measure: ping the player's live position on demand.
#[tauri::command]
fn capture_position(state: State<'_, AppState>) -> Result<Coords, String> {
    capture_coords(&state)
}

/* ── Discord login ── */

/// Open the Discord OAuth flow, resolve clan membership, and store the session.
/// Blocks (on its own thread) until the browser round-trip finishes or times out.
#[tauri::command]
fn discord_login(app: AppHandle) -> Result<auth::Session, String> {
    auth::login(&app)
}

/// Clear the stored session.
#[tauri::command]
fn discord_logout(state: State<'_, AppState>) {
    state.auth.set(None);
}

/// Current session (token stripped), or null if signed out / expired.
#[tauri::command]
fn auth_status(state: State<'_, AppState>) -> Option<auth::Session> {
    state.auth.get().filter(|s| !s.expired()).map(|s| s.public())
}

/// Whether the clan gate is active (Discord app IDs are configured).
#[tauri::command]
fn auth_configured() -> bool {
    auth::is_configured()
}

/// Look up an item's live TT value + market markup from Entropia Nexus.
#[tauri::command]
fn nexus_item(name: String) -> nexus::NexusItem {
    nexus::lookup(&name)
}

/// Scout a player — pull their EntropiaCentral dossier for the in-app popover.
#[tauri::command]
fn ec_avatar(name: String) -> ec::Avatar {
    ec::avatar(&name)
}

/// Community media feeds — live Twitch streams, YouTube videos, Steam news.
#[tauri::command]
fn ec_media() -> ec::EcMedia {
    ec::media()
}

/// Short type code for auto-naming an unlabelled rock.
fn short_code(category: &str) -> &'static str {
    match category {
        "asteroid-m" => "M",
        "asteroid-c" => "C",
        "asteroid-f" => "F",
        "asteroid-s" => "S",
        "asteroid-nd" => "ND",
        "asteroid-scrap" => "SC",
        "station" => "ST",
        _ => "R",
    }
}

/// Fix the trailing asteroid size, which is always a Roman numeral (I…XX). OCR
/// mis-reads the strokes as digits/letters ("II"→"11", "VIII"→"V111", "I"→"l"),
/// so map those back to `I`/`V`/`X` — but only when the last token is entirely
/// roman-ish, never touching the leading "L8" level or the type words.
fn normalize_roman_size(name: &str) -> String {
    let mut parts: Vec<String> = name.split_whitespace().map(String::from).collect();
    if let Some(last) = parts.last_mut() {
        let romanish = !last.is_empty()
            && last
                .chars()
                .all(|c| matches!(c, 'I' | 'i' | 'V' | 'v' | 'X' | 'x' | 'L' | 'l' | '1' | '|'));
        if romanish {
            *last = last
                .chars()
                .map(|c| match c {
                    '1' | '|' | 'l' | 'L' | 'i' => 'I',
                    'v' => 'V',
                    'x' => 'X',
                    other => other.to_ascii_uppercase(),
                })
                .collect();
        }
    }
    parts.join(" ")
}

/// Turn an OCR of the target panel (e.g. "L3 M-type Asteroid I Hold to Set Team
/// Target") into a clean (name, category). Returns None if it doesn't look like
/// a targeted rock/station, so callers can fall back to the manual label.
fn parse_target(raw: &str) -> Option<(String, String)> {
    // Drop the trailing UI prompt ("Hold to Set Team Target", "Click to…", …).
    let mut name = raw.trim().to_string();
    let lower_full = name.to_lowercase();
    for cut in ["hold to", "click to", "press to"] {
        if let Some(i) = lower_full.find(cut) {
            name.truncate(i);
            break;
        }
    }
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return None;
    }
    let name = normalize_roman_size(&name);
    let lower = name.to_lowercase();
    if !(lower.contains("type") || lower.contains("asteroid") || lower.contains("station")) {
        return None; // not a target panel — probably noise
    }
    let has = |t: &str| lower.contains(t);
    let category = if has("m-type") || has("m type") {
        "asteroid-m"
    } else if has("c-type") || has("c type") {
        "asteroid-c"
    } else if has("f-type") || has("f type") {
        "asteroid-f"
    } else if has("s-type") || has("s type") {
        "asteroid-s"
    } else if has("nd-type") || has("nd type") {
        "asteroid-nd"
    } else if has("scrap") {
        "asteroid-scrap"
    } else if has("station") {
        "station"
    } else {
        "asteroid-m"
    };
    Some((name, category.to_string()))
}

/// OCR the capture box's region and parse a target name + type from it. Reads
/// the screen pixels at the box's rectangle whether or not the box is shown —
/// the box only needs positioning once, then it can be hidden.
fn try_ocr_meta(app: &AppHandle) -> Option<(String, String)> {
    let w = app.get_webview_window("capregion")?;
    let pos = w.outer_position().ok()?;
    let size = w.outer_size().ok()?;
    let inset = 5i32;
    let cw = size.width as i32 - inset * 2;
    let ch = size.height as i32 - inset * 2;
    if cw < 4 || ch < 4 {
        return None;
    }
    let text = ocr::read_region(pos.x + inset, pos.y + inset, cw, ch).ok()?;
    parse_target(&text)
}

/// Capture the player's position and log it as a rock. Name + type come from the
/// OCR capture box when it's open, else the stored manual label. Shared by the
/// button, the panel, and the hotkey.
fn log_at_position(app: &AppHandle, state: &AppState) -> Result<asteroids::Asteroid, String> {
    // OCR the target panel first — the game keeps showing it regardless of focus.
    let ocr = try_ocr_meta(app);
    let coords = capture_coords(state)?;

    let (name, category) = match ocr {
        Some(pair) => pair,
        None => {
            let meta = state.capture.lock().expect("capture meta poisoned").clone();
            let name = if meta.label.trim().is_empty() {
                format!("{}-rock", short_code(&meta.category))
            } else {
                meta.label.trim().to_string()
            };
            (name, meta.category)
        }
    };

    let rock = state.asteroids.add(asteroids::AsteroidInput {
        name,
        category,
        sector: None,
        eu_x: coords.x,
        eu_y: coords.y,
        eu_z: coords.z,
        pvp_lootable: false,
        notes: None,
    })?;
    let _ = app.emit("asteroids:changed", ());
    let _ = app.emit("asteroid:logged", &rock);
    Ok(rock)
}

/// Set the label + type applied to the next capture (from any window).
#[tauri::command]
fn set_capture_meta(label: String, category: String, state: State<'_, AppState>) {
    *state.capture.lock().expect("capture meta poisoned") = CaptureMeta { label, category };
}

/// Capture position and log it. Returns the new rock.
#[tauri::command]
fn capture_and_log(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<asteroids::Asteroid, String> {
    log_at_position(&app, &state)
}

/// Live visibility of the always-on-top overlays — drives the HUD dock's
/// active-state indicators.
#[derive(Serialize, Clone)]
struct OverlayStates {
    panel: bool,
    capregion: bool,
    mobcap: bool,
    radar: bool,
    dock: bool,
}

fn overlay_states_of(app: &AppHandle) -> OverlayStates {
    let vis = |l: &str| {
        app.get_webview_window(l)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false)
    };
    OverlayStates {
        panel: vis("panel"),
        capregion: vis("capregion"),
        mobcap: vis("mobcap"),
        radar: vis("radar"),
        dock: vis("dock"),
    }
}

fn emit_overlay_states(app: &AppHandle) {
    let _ = app.emit("overlays:changed", overlay_states_of(app));
}

/// Show or hide a window by label deterministically — backs the compound dock
/// toggles (a logger cluster sets several windows to the same target state).
#[tauri::command]
fn set_overlay(app: AppHandle, label: String, on: bool) -> Result<bool, String> {
    if let Some(w) = app.get_webview_window(&label) {
        if on {
            w.show().map_err(|e| e.to_string())?;
        } else {
            w.hide().map_err(|e| e.to_string())?;
        }
    }
    emit_overlay_states(&app);
    Ok(on)
}

/// Show/hide a window by label. Returns the new visibility.
fn toggle_window(app: &AppHandle, label: &str) -> Result<bool, String> {
    let w = app
        .get_webview_window(label)
        .ok_or_else(|| format!("{label} window not found"))?;
    let shown = if w.is_visible().unwrap_or(false) {
        w.hide().map_err(|e| e.to_string())?;
        false
    } else {
        w.show().map_err(|e| e.to_string())?;
        let _ = w.set_focus();
        true
    };
    emit_overlay_states(app);
    Ok(shown)
}

/// Current overlay visibility, for the dock to sync its buttons on load.
#[tauri::command]
fn overlay_states(app: AppHandle) -> OverlayStates {
    overlay_states_of(&app)
}

/// Hide a window by label + broadcast the change (used by overlays' own close
/// buttons so the dock stays in sync).
#[tauri::command]
fn hide_window(app: AppHandle, label: String) {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.hide();
    }
    emit_overlay_states(&app);
}

/// Show/hide the floating HUD dock.
#[tauri::command]
fn toggle_dock(app: AppHandle) -> Result<bool, String> {
    toggle_window(&app, "dock")
}

/// Show/hide the always-on-top overlay panel.
#[tauri::command]
fn toggle_panel(app: AppHandle) -> Result<bool, String> {
    toggle_window(&app, "panel")
}

/// Show/hide the draggable OCR capture box.
#[tauri::command]
fn toggle_capregion(app: AppHandle) -> Result<bool, String> {
    toggle_window(&app, "capregion")
}

/// Show/hide the always-on-top battle radar.
#[tauri::command]
fn toggle_radar(app: AppHandle) -> Result<bool, String> {
    toggle_window(&app, "radar")
}

/// Show/hide the mob OCR capture box.
#[tauri::command]
fn toggle_mobcap(app: AppHandle) -> Result<bool, String> {
    toggle_window(&app, "mobcap")
}

/// All finished mob encounters, newest first.
#[tauri::command]
fn list_encounters(state: State<'_, AppState>) -> Vec<combat::Encounter> {
    state.encounters.list()
}

/// The in-progress encounter, if any — lets the UI hydrate on load.
#[tauri::command]
fn current_encounter(state: State<'_, AppState>) -> Option<combat::Encounter> {
    state
        .combat
        .active
        .lock()
        .expect("combat poisoned")
        .as_ref()
        .map(|a| a.enc.clone())
}

/// Delete a stored encounter by id.
#[tauri::command]
fn delete_encounter(id: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.encounters.remove(&id)?;
    let _ = app.emit("encounters:changed", ());
    Ok(())
}

/// Clear the whole encounter log.
#[tauri::command]
fn clear_encounters(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.encounters.clear()?;
    let _ = app.emit("encounters:changed", ());
    Ok(())
}

/// Arm/disarm the combat logger. Shows/hides the engaged HUD and, when turning
/// off, discards any in-progress encounter.
fn set_combat_enabled(app: &AppHandle, state: &AppState, on: bool) {
    state.combat.enabled.store(on, Ordering::Relaxed);
    if !on {
        *state.combat.active.lock().expect("combat poisoned") = None;
        let none: Option<combat::Encounter> = None;
        let _ = app.emit("encounter:update", &none);
    }
    let _ = app.emit("combat:enabled", on);
    if let Some(w) = app.get_webview_window("combathud") {
        if on {
            let _ = w.show();
        } else {
            let _ = w.hide();
        }
    }
}

/// Toggle the combat logger. Returns the new state.
#[tauri::command]
fn toggle_combat(app: AppHandle, state: State<'_, AppState>) -> bool {
    let now = !state.combat.enabled.load(Ordering::Relaxed);
    set_combat_enabled(&app, state.inner(), now);
    now
}

/// Set the combat logger to an explicit state (for the compound Mob toggle).
#[tauri::command]
fn set_combat(app: AppHandle, state: State<'_, AppState>, on: bool) -> bool {
    set_combat_enabled(&app, state.inner(), on);
    on
}

/// Current combat-logger state (for the UI to hydrate on load).
#[tauri::command]
fn combat_enabled(state: State<'_, AppState>) -> bool {
    state.combat.enabled.load(Ordering::Relaxed)
}

/// Close the splash window and reveal the main window (called once the UI loads).
#[tauri::command]
fn finish_splash(app: AppHandle) {
    if let Some(s) = app.get_webview_window("splash") {
        let _ = s.close();
    }
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.show();
        let _ = m.set_focus();
    }
}

/// OCR the pixels inside a capture window's rectangle (inset past its frame).
fn read_window_region(app: &AppHandle, label: &str) -> Result<String, String> {
    let w = app
        .get_webview_window(label)
        .ok_or("Capture box unavailable")?;
    let pos = w.outer_position().map_err(|e| e.to_string())?;
    let size = w.outer_size().map_err(|e| e.to_string())?;
    // The Scanner is now a chrome-less bordered box — OCR just insets past the
    // 2px frame so the border itself isn't read.
    let inset = 5i32;
    let cw = size.width as i32 - inset * 2;
    let ch = size.height as i32 - inset * 2;
    if cw < 4 || ch < 4 {
        return Err("Capture box is too small".into());
    }
    ocr::read_region(pos.x + inset, pos.y + inset, cw, ch)
}

/// OCR the mob capture box and parse it into (name, level, maturity). Used by
/// the combat tracker to identify each mob at the start of an encounter.
fn try_ocr_mob_identity(app: &AppHandle) -> Option<(String, Option<i64>, String)> {
    let text = read_window_region(app, "mobcap").ok()?;
    combat::parse_mob_identity(&text)
}

/// OCR the text inside the rock capture box.
#[tauri::command]
fn read_region(app: AppHandle) -> Result<String, String> {
    read_window_region(&app, "capregion")
}

/// OCR the text inside the mob capture box.
#[tauri::command]
fn read_mob_region(app: AppHandle) -> Result<String, String> {
    read_window_region(&app, "mobcap")
}

/// All logged asteroids, newest first.
#[tauri::command]
fn list_asteroids(state: State<'_, AppState>) -> Vec<asteroids::Asteroid> {
    state.asteroids.list()
}

/// Log a new asteroid; returns the stored record.
#[tauri::command]
fn add_asteroid(
    input: asteroids::AsteroidInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<asteroids::Asteroid, String> {
    let rock = state.asteroids.add(input)?;
    let _ = app.emit("asteroids:changed", ());
    Ok(rock)
}

/// Delete a logged asteroid by id.
#[tauri::command]
fn delete_asteroid(id: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.asteroids.remove(&id)?;
    let _ = app.emit("asteroids:changed", ());
    Ok(())
}

/// All editable POIs (stations / gates / landmarks / custom).
#[tauri::command]
fn list_pois(state: State<'_, AppState>) -> Vec<poi::Poi> {
    state.pois.list()
}

#[tauri::command]
fn add_poi(
    input: poi::PoiInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<poi::Poi, String> {
    let p = state.pois.add(input)?;
    let _ = app.emit("pois:changed", ());
    Ok(p)
}

#[tauri::command]
fn update_poi(
    id: String,
    input: poi::PoiInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<poi::Poi, String> {
    let p = state.pois.update(&id, input)?;
    let _ = app.emit("pois:changed", ());
    Ok(p)
}

#[tauri::command]
fn delete_poi(id: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.pois.remove(&id)?;
    let _ = app.emit("pois:changed", ());
    Ok(())
}

/// Stop the watcher.
#[tauri::command]
fn stop_watch(app: AppHandle, state: State<'_, AppState>) -> WatchStatus {
    state
        .watching
        .lock()
        .expect("watch flag poisoned")
        .store(false, Ordering::Relaxed);
    let status = WatchStatus {
        watching: false,
        path: None,
    };
    let _ = app.emit("watch:status", &status);
    status
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let settings_path = dir.join("settings.json");
            let settings = load_settings(&settings_path);

            let cap_path = dir.join("capregion.json");
            let mob_cap_path = dir.join("mobcap.json");
            app.manage(AppState {
                settings_path,
                settings: Mutex::new(settings),
                watching: Mutex::new(Arc::new(AtomicBool::new(false))),
                asteroids: asteroids::AsteroidStore::open(dir.join("asteroids.json")),
                pois: poi::PoiStore::open(dir.join("pois.json")),
                capture: Mutex::new(CaptureMeta::default()),
                combat: combat::CombatState::default(),
                encounters: combat::EncounterStore::open(dir.join("encounters.json")),
                auth: auth::AuthState::open(dir.join("session.json")),
            });

            // Start the always-on EntropiaCentral intel client (universe-wide
            // globals + trades). Independent of the local chat.log watcher.
            ec::start(app.handle().clone());

            // Restore both capture boxes to their last position/size and keep
            // them persisted as the user drags/resizes.
            for (label, path) in [("capregion", cap_path), ("mobcap", mob_cap_path)] {
                if let Some(win) = app.get_webview_window(label) {
                    if let Some(g) = load_cap_geom(&path) {
                        let _ = win.set_position(tauri::PhysicalPosition::new(g.x, g.y));
                        let _ = win.set_size(tauri::PhysicalSize::new(g.w, g.h));
                    }
                    let handle = app.handle().clone();
                    let label = label.to_string();
                    win.on_window_event(move |event| {
                        if matches!(
                            event,
                            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
                        ) {
                            persist_geom(&handle, &label, &path);
                        }
                    });
                }
            }

            // Park the radar top-right by default (where EU's radar sits).
            if let Some(radar) = app.get_webview_window("radar") {
                if let Ok(Some(mon)) = radar.primary_monitor() {
                    let sw = mon.size().width as i32;
                    let win_w = (300.0 * mon.scale_factor()) as i32;
                    let _ = radar.set_position(tauri::PhysicalPosition::new(sw - win_w - 24, 64));
                }
            }

            // Park the HUD dock top-centre by default.
            if let Some(dock) = app.get_webview_window("dock") {
                if let Ok(Some(mon)) = dock.primary_monitor() {
                    let sw = mon.size().width as i32;
                    let win_w = (232.0 * mon.scale_factor()) as i32;
                    let _ = dock.set_position(tauri::PhysicalPosition::new((sw - win_w) / 2, 48));
                }
            }

            // Close-to-tray: X (or Alt+F4) hides the main window instead of
            // quitting; the app keeps running in the system tray.
            if let Some(main) = app.get_webview_window("main") {
                let hide_target = main.clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = hide_target.hide();
                    }
                });
            }

            // System tray — left-click reopens, menu offers Show / Quit.
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

                let show_i = MenuItem::with_id(app, "show", "Show Cerberus", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

                let show_main = |app: &AppHandle| {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                };

                let mut tray = TrayIconBuilder::with_id("cerberus-tray")
                    .tooltip("Cerberus")
                    .menu(&menu)
                    .show_menu_on_left_click(false);
                if let Some(icon) = app.default_window_icon() {
                    tray = tray.icon(icon.clone());
                }
                tray.on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            }

            // Global capture hotkey — Ctrl+Shift+C. Fires while the game is
            // focused; asks the UI to run a capture with the current label.
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };
                let sc = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyC);
                let _ = app.global_shortcut().on_shortcut(sc, move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        // Capture blocks up to ~2.5s — run off the hotkey thread.
                        let app = app.clone();
                        std::thread::spawn(move || {
                            let state = app.state::<AppState>();
                            if let Err(e) = log_at_position(&app, state.inner()) {
                                let _ = app.emit("capture:error", e);
                            }
                        });
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            detect_log_path,
            check_log_path,
            start_watch,
            stop_watch,
            list_asteroids,
            add_asteroid,
            delete_asteroid,
            list_pois,
            add_poi,
            update_poi,
            delete_poi,
            set_capture_meta,
            capture_and_log,
            capture_position,
            discord_login,
            discord_logout,
            auth_status,
            auth_configured,
            nexus_item,
            ec_avatar,
            ec_media,
            toggle_panel,
            toggle_capregion,
            toggle_radar,
            toggle_mobcap,
            toggle_dock,
            set_overlay,
            set_combat,
            overlay_states,
            hide_window,
            finish_splash,
            read_region,
            read_mob_region,
            list_encounters,
            current_encounter,
            delete_encounter,
            clear_encounters,
            toggle_combat,
            combat_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
