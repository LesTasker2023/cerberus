//! Local asteroid log — a JSON-backed list of logged rocks with EU coordinates.
//! Mirrors the delta `spacePoi` shape. Clan sync lands later; for now each member
//! keeps their own log in the app data dir.

use std::path::PathBuf;
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};

/// One logged asteroid / point of interest.
#[derive(Serialize, Deserialize, Clone)]
pub struct Asteroid {
    pub id: String,
    pub name: String,
    /// asteroid-m / -c / -f / -s / -nd / -scrap / station.
    pub category: String,
    pub sector: Option<String>,
    pub eu_x: i64,
    pub eu_y: i64,
    pub eu_z: i64,
    pub pvp_lootable: bool,
    pub notes: Option<String>,
    pub logged_at: String,
}

/// Fields accepted when logging a new rock (id + timestamp are assigned server-side).
#[derive(Deserialize)]
pub struct AsteroidInput {
    pub name: String,
    pub category: String,
    pub sector: Option<String>,
    pub eu_x: i64,
    pub eu_y: i64,
    pub eu_z: i64,
    #[serde(default)]
    pub pvp_lootable: bool,
    pub notes: Option<String>,
}

/// Bundled starter survey — shipped rocks, seeded on a fresh install only.
const SEED: &str = include_str!("seed_rocks.json");

/// JSON-file store, newest-first, guarded by a mutex.
pub struct AsteroidStore {
    path: PathBuf,
    items: Mutex<Vec<Asteroid>>,
}

impl AsteroidStore {
    pub fn open(path: PathBuf) -> Self {
        // Seed the shipped survey only on a fresh install — never touch an
        // existing log (the user's own finds win and persist across updates).
        let items: Vec<Asteroid> = if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|j| serde_json::from_str(&j).ok())
                .unwrap_or_default()
        } else {
            let seeded: Vec<Asteroid> = serde_json::from_str(SEED).unwrap_or_default();
            let _ = std::fs::write(&path, serde_json::to_string_pretty(&seeded).unwrap_or_default());
            seeded
        };
        Self {
            path,
            items: Mutex::new(items),
        }
    }

    fn persist(&self, items: &[Asteroid]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| e.to_string())
    }

    pub fn list(&self) -> Vec<Asteroid> {
        self.items.lock().expect("asteroid store poisoned").clone()
    }

    pub fn add(&self, input: AsteroidInput) -> Result<Asteroid, String> {
        let rock = Asteroid {
            id: format!("{}", Utc::now().timestamp_micros()),
            name: input.name.trim().to_string(),
            category: input.category,
            sector: input.sector.filter(|s| !s.trim().is_empty()),
            eu_x: input.eu_x,
            eu_y: input.eu_y,
            eu_z: input.eu_z,
            pvp_lootable: input.pvp_lootable,
            notes: input.notes.filter(|s| !s.trim().is_empty()),
            logged_at: Utc::now().to_rfc3339(),
        };
        let mut items = self.items.lock().expect("asteroid store poisoned");
        items.insert(0, rock.clone());
        self.persist(&items)?;
        Ok(rock)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut items = self.items.lock().expect("asteroid store poisoned");
        items.retain(|a| a.id != id);
        self.persist(&items)
    }
}
