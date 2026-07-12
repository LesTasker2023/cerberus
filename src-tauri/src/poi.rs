//! Editable POI store — stations, warp gates, landmarks and custom markers the
//! user manages from the map editor. JSON-backed; seeded once from the bundled
//! ProjectDelta station set. (Howling Mine context stays static + separate.)

use std::path::PathBuf;
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct Poi {
    pub id: String,
    pub name: String,
    pub category: String,
    pub eu_x: i64,
    pub eu_y: i64,
    pub eu_z: i64,
    #[serde(default)]
    pub pvp_lootable: bool,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Fields accepted when creating/updating a POI (id assigned/looked-up server-side).
#[derive(Deserialize)]
pub struct PoiInput {
    pub name: String,
    pub category: String,
    pub eu_x: i64,
    pub eu_y: i64,
    pub eu_z: i64,
    #[serde(default)]
    pub pvp_lootable: bool,
    pub notes: Option<String>,
}

/// One row of the bundled seed (no id).
#[derive(Deserialize)]
struct SeedPoi {
    name: String,
    category: String,
    eu_x: i64,
    eu_y: i64,
    eu_z: i64,
    #[serde(default)]
    pvp_lootable: bool,
    #[serde(default)]
    notes: String,
}

const SEED: &str = include_str!("seed_pois.json");

fn seed_items() -> Vec<Poi> {
    serde_json::from_str::<Vec<SeedPoi>>(SEED)
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(i, s)| Poi {
            id: format!("seed-{i}"),
            name: s.name,
            category: s.category,
            eu_x: s.eu_x,
            eu_y: s.eu_y,
            eu_z: s.eu_z,
            pvp_lootable: s.pvp_lootable,
            notes: (!s.notes.is_empty()).then_some(s.notes),
        })
        .collect()
}

pub struct PoiStore {
    path: PathBuf,
    items: Mutex<Vec<Poi>>,
}

impl PoiStore {
    pub fn open(path: PathBuf) -> Self {
        let items = if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|j| serde_json::from_str(&j).ok())
                .unwrap_or_default()
        } else {
            let seeded = seed_items();
            let _ = std::fs::write(
                &path,
                serde_json::to_string_pretty(&seeded).unwrap_or_default(),
            );
            seeded
        };
        Self {
            path,
            items: Mutex::new(items),
        }
    }

    fn persist(&self, items: &[Poi]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| e.to_string())
    }

    pub fn list(&self) -> Vec<Poi> {
        self.items.lock().expect("poi store poisoned").clone()
    }

    pub fn add(&self, input: PoiInput) -> Result<Poi, String> {
        let poi = Poi {
            id: format!("{}", Utc::now().timestamp_micros()),
            name: input.name.trim().to_string(),
            category: input.category,
            eu_x: input.eu_x,
            eu_y: input.eu_y,
            eu_z: input.eu_z,
            pvp_lootable: input.pvp_lootable,
            notes: input.notes.filter(|s| !s.trim().is_empty()),
        };
        let mut items = self.items.lock().expect("poi store poisoned");
        items.push(poi.clone());
        self.persist(&items)?;
        Ok(poi)
    }

    pub fn update(&self, id: &str, input: PoiInput) -> Result<Poi, String> {
        let mut items = self.items.lock().expect("poi store poisoned");
        let poi = items.iter_mut().find(|p| p.id == id).ok_or("POI not found")?;
        poi.name = input.name.trim().to_string();
        poi.category = input.category;
        poi.eu_x = input.eu_x;
        poi.eu_y = input.eu_y;
        poi.eu_z = input.eu_z;
        poi.pvp_lootable = input.pvp_lootable;
        poi.notes = input.notes.filter(|s| !s.trim().is_empty());
        let updated = poi.clone();
        self.persist(&items)?;
        Ok(updated)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut items = self.items.lock().expect("poi store poisoned");
        items.retain(|p| p.id != id);
        self.persist(&items)
    }
}
