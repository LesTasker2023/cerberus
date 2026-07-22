//! Hunt session store — persists Tracker sessions so they survive a restart and
//! can be reviewed later.
//!
//! The live session is upserted continuously (a crash or an accidental close
//! therefore costs nothing), and finishing one simply stamps `endedAt` and
//! leaves it in the history. Exactly one session may be unfinished at a time —
//! that's the one the Tracker resumes on boot.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Keep the history bounded — the newest N sessions.
const MAX_SESSIONS: usize = 200;

/// One looted item's running total within a session.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct LootRow {
    pub qty: i64,
    pub value: f64,
    pub drops: i64,
}

/// A tracker session: the raw counters, not derived stats. Everything the UI
/// shows (return %, multipliers, per-kill averages) is computed from these, so
/// changing a formula never invalidates saved history.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HuntSession {
    pub id: String,
    pub started_at: String,
    /// Set once the session is finished; `None` marks the resumable one.
    pub ended_at: Option<String>,
    /// Accumulated running time in ms — excludes paused stretches and the time
    /// the app was closed, so a resumed session reports honest per-hour rates.
    pub elapsed_ms: i64,
    pub loadout: Option<String>,
    /// Cost per shot of the loadout in force right now.
    pub cps: f64,
    pub shots: i64,
    /// Spend in PED, accumulated shot by shot at the cost/shot active at that
    /// moment — so swapping loadout mid-hunt never reprices earlier shots.
    pub spend: f64,
    pub kills: i64,
    /// Ammo events since the current kill — the kill-inference counter, kept so
    /// a resumed session doesn't miscount the kill that was in progress.
    pub since_kill: i64,
    /// Spend accumulated toward the in-progress kill.
    pub since_kill_spend: f64,
    pub items: HashMap<String, LootRow>,
    pub last_kill: HashMap<String, f64>,
    /// What the last kill actually cost — priced as it happened.
    pub last_kill_spend: f64,
    /// Items excluded from loot totals, snapshotted so reviewing this session
    /// later isn't retroactively changed by the current preference.
    pub ignored: Vec<String>,
}

pub struct SessionStore {
    path: PathBuf,
    items: Mutex<Vec<HuntSession>>,
}

impl SessionStore {
    pub fn open(path: PathBuf) -> Self {
        let items: Vec<HuntSession> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|j| serde_json::from_str(&j).ok())
            .unwrap_or_default();
        Self {
            path,
            items: Mutex::new(items),
        }
    }

    fn persist(&self, items: &[HuntSession]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| e.to_string())
    }

    /// Newest first.
    pub fn list(&self) -> Vec<HuntSession> {
        self.items.lock().expect("session store poisoned").clone()
    }

    /// The single unfinished session, if one exists.
    pub fn current(&self) -> Option<HuntSession> {
        self.items
            .lock()
            .expect("session store poisoned")
            .iter()
            .find(|s| s.ended_at.is_none())
            .cloned()
    }

    /// Insert or replace by id, newest first.
    pub fn save(&self, session: HuntSession) -> Result<(), String> {
        let mut items = self.items.lock().expect("session store poisoned");
        match items.iter_mut().find(|s| s.id == session.id) {
            Some(slot) => *slot = session,
            None => items.insert(0, session),
        }
        items.truncate(MAX_SESSIONS);
        self.persist(&items)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut items = self.items.lock().expect("session store poisoned");
        items.retain(|s| s.id != id);
        self.persist(&items)
    }
}
