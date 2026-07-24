//! Combat / hunt tracker. Groups parsed chat.log lines into per-mob encounters.
//!
//! Attribution rule: the first `You inflicted …` damage line after an idle gap
//! opens a new encounter — that triggers an OCR of the target panel (level /
//! name / maturity) and a `<` position capture. Damage, skill-XP and loot lines
//! accumulate into the open encounter; it closes ~1s after loot lands. The next
//! damage line therefore starts the next mob. HP is the total damage to kill.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Epoch-ms of the last `You inflicted …` damage line. Tracked unconditionally
/// (before the logger/capture gate) so the accessibility EM assist can tell
/// whether an engage attempt actually landed a hit, without needing any feed
/// armed.
static LAST_DAMAGE_MS: AtomicU64 = AtomicU64::new(0);

/// Epoch-ms of the most recent damage dealt, or 0 if none this session.
pub fn last_damage_ms() -> u64 {
    LAST_DAMAGE_MS.load(Ordering::Relaxed)
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::watcher::LogLine;
use crate::AppState;

/// How long after the last loot line an encounter stays open.
const LOOT_CLOSE: Duration = Duration::from_millis(1000);

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct SkillGain {
    pub skill: String,
    pub xp: f64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct LootItem {
    pub item: String,
    pub qty: i64,
    pub value: f64,
}

/// One mob encounter, live or finished.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Encounter {
    pub id: String,
    pub name: String,
    pub level: Option<i64>,
    pub maturity: String,
    pub eu_x: Option<i64>,
    pub eu_y: Option<i64>,
    pub eu_z: Option<i64>,
    /// Total damage dealt = the mob's effective HP.
    pub hp: f64,
    pub shots: i64,
    pub skills: Vec<SkillGain>,
    pub loot: Vec<LootItem>,
    pub loot_value: f64,
    pub started_at: String,
    pub ended_at: Option<String>,
}

/// The in-progress encounter plus its pending close deadline.
pub struct Active {
    pub enc: Encounter,
    pub loot_close_at: Option<Instant>,
}

/// Shared live combat state.
#[derive(Default)]
pub struct CombatState {
    pub active: Mutex<Option<Active>>,
    /// Whether the mob logger is armed — drives encounter grouping + the store.
    pub enabled: AtomicBool,
    /// Whether the Tracker's raw shot/loot feed is armed. Fully independent of
    /// `enabled` — either can run without the other.
    pub capture: AtomicBool,
}

/* ── Line parsers ── */
fn re_dmg() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"You inflicted ([0-9.]+) points of damage").unwrap())
}
fn re_xp() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"You have gained ([0-9.]+) experience in your (.+?) skill").unwrap())
}
fn re_loot() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r"You received (.+?) x \((\d+)\) Value: ([0-9.]+) PED").unwrap()
    })
}

/// Parse an OCR of the target panel ("L30 Dymlek Provider") into
/// (name, level, maturity). Level is the leading `L<n>`; maturity is the last
/// word; the name is whatever sits between.
/// Known Entropia creature maturities — the reliable anchor for the last token.
const MATURITIES: &[&str] = &[
    "young", "mature", "old", "provider", "guardian", "dominant", "alpha",
    "prowler", "stalker", "hunter", "warrior", "gatherer", "scout", "hatchling",
    "adult", "elder", "queen", "leader",
];

/// Species we know to expect — the seed for name-snapping. Grows at runtime
/// with whatever's already in the encounter store (see `snap_species`).
pub const KNOWN_SPECIES: &[&str] = &["Dymlek", "Cosmic Horror"];

fn capitalize(s: &str) -> String {
    let mut ch = s.chars();
    match ch.next() {
        Some(f) => f.to_uppercase().collect::<String>() + ch.as_str(),
        None => String::new(),
    }
}

/// Repair the classic OCR letter/digit confusions inside a token we *expect*
/// to be numeric (e.g. a level's digits, where "L2B" should read "L28").
fn repair_digits(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'O' | 'o' | 'D' | 'Q' => '0',
            'I' | 'l' | 'i' | '|' => '1',
            'Z' | 'z' => '2',
            'B' => '8',
            'S' | 's' => '5',
            'G' => '6',
            'T' => '7',
            'g' | 'q' => '9',
            _ => c,
        })
        .collect()
}

/// Levenshtein edit distance — the metric behind maturity / species snapping.
pub fn levenshtein(a: &str, b: &str) -> usize {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let (m, n) = (a.len(), b.len());
    if m == 0 {
        return n;
    }
    if n == 0 {
        return m;
    }
    let mut dp: Vec<usize> = (0..=n).collect();
    for i in 1..=m {
        let mut prev = dp[0];
        dp[0] = i;
        for j in 1..=n {
            let tmp = dp[j];
            dp[j] = if a[i - 1] == b[j - 1] {
                prev
            } else {
                1 + prev.min(dp[j]).min(dp[j - 1])
            };
            prev = tmp;
        }
    }
    dp[n]
}

/// Snap a token to the nearest known maturity, tolerating light OCR noise.
/// Short vocab words ("old") demand an exact hit to avoid colliding with a
/// species token; longer ones accept up to two edits.
fn snap_maturity(tok: &str) -> Option<String> {
    let t = tok.to_lowercase();
    let mut best: Option<(usize, &str)> = None;
    for m in MATURITIES {
        let d = levenshtein(&t, m);
        let ok = d == 0 || (m.len() >= 5 && t.len() >= 4 && d <= 2);
        if ok && best.map_or(true, |(bd, _)| d < bd) {
            best = Some((d, m));
        }
    }
    best.map(|(_, m)| capitalize(m))
}

/// Snap a read species name onto the nearest known one (seed list + names
/// already in the store), so "Dymiek"/"Dymlex" collapse onto "Dymlek". An
/// unrecognised name is returned title-cased but otherwise untouched, so new
/// species still register.
pub fn snap_species(name: &str, known: &[String]) -> String {
    let cand = name.to_lowercase();
    let mut best: Option<(usize, String)> = None;
    for k in known {
        let d = levenshtein(&cand, &k.to_lowercase());
        let thr = (k.chars().count() / 4).max(1);
        if d <= thr && best.as_ref().map_or(true, |(bd, _)| d < *bd) {
            best = Some((d, k.clone()));
        }
    }
    best.map(|(_, k)| k).unwrap_or_else(|| {
        name.split_whitespace()
            .map(|w| capitalize(&w.to_lowercase()))
            .collect::<Vec<_>>()
            .join(" ")
    })
}

pub fn parse_mob_identity(raw: &str) -> Option<(String, Option<i64>, String)> {
    // Drop any trailing UI prompt the OCR may have caught.
    let mut cleaned = raw.trim().to_string();
    let lower = cleaned.to_lowercase();
    for cut in ["hold to", "click to", "press to"] {
        if let Some(i) = lower.find(cut) {
            cleaned.truncate(i);
            break;
        }
    }
    if cleaned.trim().eq_ignore_ascii_case("unknown") {
        return None;
    }

    // Tokenise, stripping surrounding punctuation ("96." -> "96").
    let toks: Vec<String> = cleaned
        .split_whitespace()
        .map(|t| {
            t.trim_matches(|c: char| !c.is_alphanumeric())
                .to_string()
        })
        .filter(|t| !t.is_empty())
        .collect();
    if toks.is_empty() {
        return None;
    }

    // Level = first "L##" token. The digits are OCR-repaired first, so "L2B"
    // resolves to 28 rather than being mistaken for part of the name.
    let mut level = None;
    let mut level_idx = None;
    for (i, t) in toks.iter().enumerate() {
        if let Some(rest) = t.strip_prefix(['L', 'l']) {
            let fixed = repair_digits(rest);
            if !fixed.is_empty() && fixed.chars().all(|c| c.is_ascii_digit()) {
                level = fixed.parse::<i64>().ok();
                level_idx = Some(i);
                break;
            }
        }
    }

    // Maturity = last token that snaps to the known vocabulary (fuzzy).
    let mut maturity = String::new();
    let mut mat_idx = None;
    for (i, t) in toks.iter().enumerate().rev() {
        if let Some(m) = snap_maturity(t) {
            maturity = m;
            mat_idx = Some(i);
            break;
        }
    }

    // Name = alphabetic tokens between level and maturity; drop pure-number and
    // short (<=2 char) garbage like a stray "QB".
    let start = level_idx.map(|i| i + 1).unwrap_or(0);
    let end = mat_idx.unwrap_or(toks.len()).max(start);
    let name = toks[start..end]
        .iter()
        .filter(|t| t.len() > 2 && t.chars().any(|c| c.is_alphabetic()))
        .cloned()
        .collect::<Vec<_>>()
        .join(" ");
    if name.is_empty() {
        return None;
    }
    Some((name, level, maturity))
}

/// Feed one parsed log line into the tracker.
pub fn process_line(app: &AppHandle, line: &LogLine) {
    let text = line.text.as_str();
    let state = app.state::<AppState>();

    // Record damage time unconditionally, before any gate — the EM assist reads
    // this to detect a landed hit even when no feed is armed.
    if re_dmg().is_match(text) {
        LAST_DAMAGE_MS.store(epoch_ms(), Ordering::Relaxed);
    }

    // Two independent consumers: the Tracker's raw session feed (`capture`) and
    // the mob logger's encounter grouping (`enabled`). Either can run alone.
    let capturing = state.combat.capture.load(Ordering::Relaxed);
    let logging = state.combat.enabled.load(Ordering::Relaxed);
    if !capturing && !logging {
        return;
    }

    // Damage — opens a new encounter if idle, else adds to the open one.
    if let Some(c) = re_dmg().captures(text) {
        let dmg: f64 = c[1].parse().unwrap_or(0.0);
        if capturing {
            let _ = app.emit("combat:shot", dmg);
        }
        if !logging {
            return;
        }
        let mut started: Option<String> = None;
        {
            let mut guard = state.combat.active.lock().expect("combat poisoned");
            if guard.is_none() {
                let id = format!("{}", Utc::now().timestamp_micros());
                let enc = Encounter {
                    id: id.clone(),
                    started_at: Utc::now().to_rfc3339(),
                    ..Default::default()
                };
                *guard = Some(Active { enc, loot_close_at: None });
                started = Some(id);
            }
            if let Some(a) = guard.as_mut() {
                a.enc.hp += dmg;
                a.enc.shots += 1;
            }
        }
        if let Some(id) = started {
            spawn_capture(app.clone(), id);
        }
        emit_update(app);
        return;
    }

    // Missed / dodged / evaded / jammed / resisted — burns ammo so it counts as
    // a shot (matches Artemis' ammo-consuming events) but deals no damage.
    if text.contains("You missed")
        || text.contains("target Dodged")
        || text.contains("target Evaded")
        || text.contains("target Jammed")
        || text.contains("target resisted all damage")
    {
        if capturing {
            let _ = app.emit("combat:shot", 0.0_f64);
        }
        if !logging {
            return;
        }
        let mut guard = state.combat.active.lock().expect("combat poisoned");
        if let Some(a) = guard.as_mut() {
            a.enc.shots += 1;
            drop(guard);
            emit_update(app);
        }
        return;
    }

    // Skill XP — mob logger only, and only while an encounter is open.
    if let Some(c) = re_xp().captures(text) {
        if !logging {
            return;
        }
        let xp: f64 = c[1].parse().unwrap_or(0.0);
        let skill = c[2].to_string();
        let mut guard = state.combat.active.lock().expect("combat poisoned");
        if let Some(a) = guard.as_mut() {
            match a.enc.skills.iter_mut().find(|s| s.skill == skill) {
                Some(s) => s.xp += xp,
                None => a.enc.skills.push(SkillGain { skill, xp }),
            }
        } else {
            return;
        }
        drop(guard);
        emit_update(app);
        return;
    }

    // Loot — report the value to the raw session feed unconditionally, then
    // fold it into the open encounter if one is running (mob-logger detail).
    if let Some(c) = re_loot().captures(text) {
        // Some clients bracket the name ("[Shrapnel]") — normalise it so the
        // tracker's per-item breakdown and the Codex lookup both match.
        let item = c[1]
            .trim()
            .trim_matches(|ch| ch == '[' || ch == ']')
            .to_string();
        let qty: i64 = c.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(1);
        let value: f64 = c[3].parse().unwrap_or(0.0);
        // Raw session feed — fires even with no open encounter (loot-only bursts).
        if capturing {
            let _ = app.emit(
                "combat:loot",
                serde_json::json!({ "item": item.as_str(), "qty": qty, "value": value }),
            );
        }
        if !logging {
            return;
        }
        let mut guard = state.combat.active.lock().expect("combat poisoned");
        if let Some(a) = guard.as_mut() {
            match a.enc.loot.iter_mut().find(|l| l.item == item) {
                Some(l) => {
                    l.qty += qty;
                    l.value += value;
                }
                None => a.enc.loot.push(LootItem { item, qty, value }),
            }
            a.enc.loot_value += value;
            a.loot_close_at = Some(Instant::now() + LOOT_CLOSE);
            drop(guard);
            emit_update(app);
        }
    }
}

/// Called each watcher poll — closes an encounter whose loot timer has elapsed.
pub fn tick(app: &AppHandle) {
    let state = app.state::<AppState>();
    let finished: Option<Encounter> = {
        let mut guard = state.combat.active.lock().expect("combat poisoned");
        let due = matches!(
            guard.as_ref(),
            Some(a) if a.loot_close_at.is_some_and(|t| Instant::now() >= t)
        );
        if due {
            guard.take().map(|mut a| {
                a.enc.ended_at = Some(Utc::now().to_rfc3339());
                a.enc
            })
        } else {
            None
        }
    };
    if let Some(enc) = finished {
        let _ = state.encounters.add(enc.clone());
        let _ = app.emit("encounter:end", &enc);
        let _ = app.emit("encounters:changed", ());
        let none: Option<Encounter> = None;
        let _ = app.emit("encounter:update", &none);
    }
}

/// OCR the target panel + capture position on a worker thread. The name panel
/// often reads "Unknown" on the first shot, so we keep OCR-ing after each shot
/// until a real name resolves (or the encounter closes).
fn spawn_capture(app: AppHandle, id: String) {
    std::thread::spawn(move || {
        // First OCR attempt, then capture position once via `<`.
        try_set_name(&app, &id);
        let coords = {
            let state = app.state::<AppState>();
            crate::capture_coords(&state).ok()
        };
        if let Some(c) = coords {
            let state = app.state::<AppState>();
            let mut guard = state.combat.active.lock().expect("combat poisoned");
            if let Some(a) = guard.as_mut() {
                if a.enc.id == id {
                    a.enc.eu_x = Some(c.x);
                    a.enc.eu_y = Some(c.y);
                    a.enc.eu_z = Some(c.z);
                }
            }
        }
        emit_update(&app);

        // Retry OCR (~every 700ms, roughly per shot) until the name resolves or
        // the encounter is no longer the open one.
        for _ in 0..20 {
            let need = {
                let state = app.state::<AppState>();
                let guard = state.combat.active.lock().expect("combat poisoned");
                matches!(guard.as_ref(), Some(a) if a.enc.id == id && a.enc.name.is_empty())
            };
            if !need {
                break;
            }
            std::thread::sleep(Duration::from_millis(700));
            if try_set_name(&app, &id) {
                emit_update(&app);
                break;
            }
        }
    });
}

/// One OCR of the mob panel; folds a resolved name into the open encounter.
/// Returns true only when a real name was set.
fn try_set_name(app: &AppHandle, id: &str) -> bool {
    let Some((name, level, maturity)) = crate::try_ocr_mob_identity(app) else {
        return false;
    };
    let state = app.state::<AppState>();

    // Snap the read name onto a known species — the seed list plus every name
    // already in the store — so OCR slips collapse onto the canonical spelling.
    let mut known: Vec<String> = KNOWN_SPECIES.iter().map(|s| s.to_string()).collect();
    for e in state.encounters.list() {
        if !e.name.is_empty() && !known.iter().any(|k| k.eq_ignore_ascii_case(&e.name)) {
            known.push(e.name.clone());
        }
    }
    let name = snap_species(&name, &known);

    let mut guard = state.combat.active.lock().expect("combat poisoned");
    if let Some(a) = guard.as_mut() {
        if a.enc.id == id && a.enc.name.is_empty() {
            a.enc.name = name;
            a.enc.level = level;
            a.enc.maturity = maturity;
            return true;
        }
    }
    false
}

fn emit_update(app: &AppHandle) {
    let state = app.state::<AppState>();
    let cur = state
        .combat
        .active
        .lock()
        .expect("combat poisoned")
        .as_ref()
        .map(|a| a.enc.clone());
    let _ = app.emit("encounter:update", &cur);
}

/* ── Persisted encounter store ── */

/// Bundled starter spawn log — shipped mob encounters, seeded on fresh install only.
const SEED: &str = include_str!("seed_mobs.json");

pub struct EncounterStore {
    path: PathBuf,
    items: Mutex<Vec<Encounter>>,
}

impl EncounterStore {
    pub fn open(path: PathBuf) -> Self {
        // Seed the shipped spawn log only on a fresh install — the user's own
        // logged encounters win and persist across updates.
        let items: Vec<Encounter> = if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|j| serde_json::from_str(&j).ok())
                .unwrap_or_default()
        } else {
            let seeded: Vec<Encounter> = serde_json::from_str(SEED).unwrap_or_default();
            let _ = std::fs::write(&path, serde_json::to_string_pretty(&seeded).unwrap_or_default());
            seeded
        };
        Self {
            path,
            items: Mutex::new(items),
        }
    }

    fn persist(&self, items: &[Encounter]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| e.to_string())
    }

    pub fn list(&self) -> Vec<Encounter> {
        self.items.lock().expect("encounter store poisoned").clone()
    }

    pub fn add(&self, enc: Encounter) -> Result<(), String> {
        let mut items = self.items.lock().expect("encounter store poisoned");
        items.insert(0, enc);
        self.persist(&items)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut items = self.items.lock().expect("encounter store poisoned");
        items.retain(|e| e.id != id);
        self.persist(&items)
    }

    pub fn clear(&self) -> Result<(), String> {
        let mut items = self.items.lock().expect("encounter store poisoned");
        items.clear();
        self.persist(&items)
    }
}
