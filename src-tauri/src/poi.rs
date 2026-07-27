//! Editable POI store — stations, warp gates, landmarks, outlaw zones, asteroid
//! anchors and custom markers the user manages from the map editor. JSON-backed;
//! seeded once from the bundled ProjectDelta station set plus the Howling Mine
//! survey.
//!
//! The Howling Mine set used to be a static frontend import (`howlingMine.json`)
//! merged straight into the map, which meant ~286 markers — including every
//! outlaw zone — rendered on the map but were absent from the editor list and
//! could not be renamed, moved or deleted. They are now real store rows like
//! everything else. `migrate_howling_mine` back-fills stores that predate the
//! change; it runs once, guarded by a marker file, so anything the user
//! subsequently deletes stays deleted.

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
    /// Sector this POI is anchored to — named after a space station, assigned by
    /// hand. Defaulted so existing stores load unchanged.
    #[serde(default)]
    pub sector: Option<String>,
    /// When this marker was logged in-game, if it was. `Some` = a rock the user
    /// scanned and logged (the map draws these differently and labels them);
    /// `None` = a hand-placed anchor. This replaces the separate asteroid store —
    /// "logged" is a property of a marker, not a different kind of thing.
    #[serde(default)]
    pub logged_at: Option<String>,
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
    #[serde(default)]
    pub sector: Option<String>,
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
    #[serde(default)]
    sector: Option<String>,
}

/// One row of the Howling Mine survey. Camel-cased — this file was authored for
/// the frontend before the set became editable, and is kept verbatim.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeedHmPoi {
    name: String,
    category: String,
    eu_x: i64,
    eu_y: i64,
    eu_z: i64,
    #[serde(default)]
    pvp_lootable: bool,
    #[serde(default)]
    description: String,
}

const SEED: &str = include_str!("seed_pois.json");
const SEED_HM: &str = include_str!("seed_howling_mine.json");

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
            sector: s.sector,
            logged_at: None,
        })
        .collect()
}

/// The Howling Mine survey as store rows. Stable `hm-<i>` ids keep the migration
/// idempotent and match the ids the map used to synthesise for these markers.
fn seed_howling_mine() -> Vec<Poi> {
    serde_json::from_str::<Vec<SeedHmPoi>>(SEED_HM)
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(i, s)| Poi {
            id: format!("hm-{i}"),
            name: s.name,
            category: s.category,
            eu_x: s.eu_x,
            eu_y: s.eu_y,
            eu_z: s.eu_z,
            pvp_lootable: s.pvp_lootable,
            notes: (!s.description.is_empty()).then_some(s.description),
            sector: None,
            logged_at: None,
        })
        .collect()
}

/// A row of the old standalone asteroid log, for the one-shot import.
#[derive(Deserialize)]
struct LegacyRock {
    id: String,
    name: String,
    category: String,
    #[serde(default)]
    sector: Option<String>,
    eu_x: i64,
    eu_y: i64,
    eu_z: i64,
    #[serde(default)]
    pvp_lootable: bool,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    logged_at: Option<String>,
}

pub struct PoiStore {
    path: PathBuf,
    items: Mutex<Vec<Poi>>,
}

impl PoiStore {
    pub fn open(path: PathBuf) -> Self {
        // Seed only on a fresh install — never touch an existing curated store.
        let (items, fresh) = if path.exists() {
            let loaded: Vec<Poi> = std::fs::read_to_string(&path)
                .ok()
                .and_then(|j| serde_json::from_str(&j).ok())
                .unwrap_or_default();
            (loaded, false)
        } else {
            let mut seeded = seed_items();
            seeded.extend(seed_howling_mine());
            let _ = std::fs::write(&path, serde_json::to_string_pretty(&seeded).unwrap_or_default());
            (seeded, true)
        };

        let store = Self {
            path,
            items: Mutex::new(items),
        };
        // Fresh installs already have the survey; existing ones get it back-filled.
        if fresh {
            let _ = std::fs::write(store.hm_marker(), "1");
        } else {
            store.migrate_howling_mine();
        }
        // Fold in the old standalone asteroid log, whenever it exists.
        store.migrate_asteroids();
        store
    }

    /// Marker recording that the Howling Mine back-fill has run for this store.
    fn hm_marker(&self) -> PathBuf {
        self.path.with_file_name("pois.hm-imported")
    }

    /// One-shot back-fill of the Howling Mine survey into a store created before
    /// those markers became editable. Guarded by a marker file rather than by
    /// checking for the rows themselves — otherwise deleting an imported marker
    /// would resurrect it on the next launch. Rows already present by id are
    /// skipped so a half-finished run can't duplicate.
    fn migrate_howling_mine(&self) {
        let marker = self.hm_marker();
        if marker.exists() {
            return;
        }
        {
            let mut items = self.items.lock().expect("poi store poisoned");
            let have: std::collections::HashSet<String> =
                items.iter().map(|p| p.id.clone()).collect();
            let added: Vec<Poi> = seed_howling_mine()
                .into_iter()
                .filter(|p| !have.contains(&p.id))
                .collect();
            if !added.is_empty() {
                items.extend(added);
                if self.persist(&items).is_err() {
                    return; // leave the marker unwritten so it retries next launch
                }
            }
        }
        let _ = std::fs::write(marker, "1");
    }

    /// One-shot import of `asteroids.json`, the old standalone rock log, into
    /// this store. Rocks and POIs were always the same shape bar `logged_at`;
    /// keeping them apart meant two lists, two editors, and rocks that could
    /// never be edited at all (the old store had no `update`).
    ///
    /// Ids are prefixed `rock-` so they can't collide with POI ids (both were
    /// microsecond timestamps). The source file is renamed to `.imported`
    /// rather than deleted — this migrates real user data, so it stays
    /// recoverable — and that rename is also what stops it running twice.
    fn migrate_asteroids(&self) {
        let src = self.path.with_file_name("asteroids.json");
        if !src.exists() {
            return;
        }
        let Ok(raw) = std::fs::read_to_string(&src) else {
            return;
        };
        let legacy: Vec<LegacyRock> = serde_json::from_str(&raw).unwrap_or_default();

        {
            let mut items = self.items.lock().expect("poi store poisoned");
            let have: std::collections::HashSet<String> =
                items.iter().map(|p| p.id.clone()).collect();
            let added: Vec<Poi> = legacy
                .into_iter()
                .map(|r| Poi {
                    id: format!("rock-{}", r.id),
                    name: r.name,
                    category: r.category,
                    eu_x: r.eu_x,
                    eu_y: r.eu_y,
                    eu_z: r.eu_z,
                    pvp_lootable: r.pvp_lootable,
                    notes: r.notes,
                    sector: r.sector,
                    // Preserve the original log time; fall back to "logged, time
                    // unknown" so an imported rock never reads as an anchor.
                    logged_at: Some(r.logged_at.unwrap_or_else(|| Utc::now().to_rfc3339())),
                })
                .filter(|p| !have.contains(&p.id))
                .collect();
            if !added.is_empty() {
                items.extend(added);
                if self.persist(&items).is_err() {
                    return; // keep the source file so the import retries
                }
            }
        }
        let _ = std::fs::rename(&src, src.with_extension("json.imported"));
    }

    fn persist(&self, items: &[Poi]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| e.to_string())
    }

    pub fn list(&self) -> Vec<Poi> {
        self.items.lock().expect("poi store poisoned").clone()
    }

    pub fn add(&self, input: PoiInput) -> Result<Poi, String> {
        self.insert(input, None)
    }

    /// Log a marker scanned in-game — same store, stamped with the log time so
    /// the map and the list can tell it apart from a hand-placed anchor.
    pub fn add_logged(&self, input: PoiInput) -> Result<Poi, String> {
        self.insert(input, Some(Utc::now().to_rfc3339()))
    }

    fn insert(&self, input: PoiInput, logged_at: Option<String>) -> Result<Poi, String> {
        let poi = Poi {
            id: format!("{}", Utc::now().timestamp_micros()),
            name: input.name.trim().to_string(),
            category: input.category,
            eu_x: input.eu_x,
            eu_y: input.eu_y,
            eu_z: input.eu_z,
            pvp_lootable: input.pvp_lootable,
            notes: input.notes.filter(|s| !s.trim().is_empty()),
            sector: input.sector.filter(|s| !s.trim().is_empty()),
            logged_at,
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
        poi.sector = input.sector.filter(|s| !s.trim().is_empty());
        // `logged_at` is history, not a user field — editing a logged rock must
        // not silently demote it to a hand-placed anchor.
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Fresh temp dir per test — these exercise real file IO.
    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "cerberus-poi-{tag}-{}",
            Utc::now().timestamp_micros()
        ));
        std::fs::create_dir_all(&d).expect("tmp dir");
        d.join("pois.json")
    }

    #[test]
    fn seed_parses() {
        assert!(!seed_items().is_empty(), "station seed failed to parse");
        let hm = seed_howling_mine();
        assert!(hm.len() > 250, "howling mine seed failed to parse: {}", hm.len());
        assert!(
            hm.iter().any(|p| p.category == "outlaw-zone"),
            "outlaw zones missing from the survey"
        );
    }

    #[test]
    fn fresh_install_includes_the_survey() {
        let s = PoiStore::open(tmp("fresh"));
        let items = s.list();
        assert!(items.iter().any(|p| p.category == "space-station"));
        assert!(items.iter().any(|p| p.category == "outlaw-zone"));
        assert_eq!(items.len(), seed_items().len() + seed_howling_mine().len());
    }

    /// A store written before the survey became editable gets it back-filled.
    #[test]
    fn migrates_a_legacy_store() {
        let path = tmp("legacy");
        std::fs::write(&path, serde_json::to_string(&seed_items()).unwrap()).unwrap();

        let s = PoiStore::open(path.clone());
        assert!(
            s.list().iter().any(|p| p.category == "outlaw-zone"),
            "outlaw zones were not back-filled"
        );

        // Reopening must not duplicate them.
        let before = s.list().len();
        drop(s);
        let again = PoiStore::open(path);
        assert_eq!(again.list().len(), before, "migration ran twice");
    }

    /// The important one: deleting a migrated marker must stick across restarts.
    #[test]
    fn deleted_survey_rows_stay_deleted() {
        let path = tmp("delete");
        std::fs::write(&path, serde_json::to_string(&seed_items()).unwrap()).unwrap();

        let s = PoiStore::open(path.clone());
        let victim = s
            .list()
            .into_iter()
            .find(|p| p.category == "outlaw-zone")
            .expect("an outlaw zone to delete");
        s.remove(&victim.id).unwrap();
        drop(s);

        let reopened = PoiStore::open(path);
        assert!(
            !reopened.list().iter().any(|p| p.id == victim.id),
            "a deleted survey marker came back on restart"
        );
    }

    /// The old `asteroids.json` is folded in, keeps its log time, and the source
    /// file is preserved (renamed) rather than destroyed.
    #[test]
    fn imports_the_legacy_rock_log() {
        let path = tmp("rocks");
        let rocks = serde_json::json!([{
            "id": "1700000000000000",
            "name": "L8 M-type Asteroid II",
            "category": "asteroid-m",
            "sector": null,
            "eu_x": 78000, "eu_y": 77000, "eu_z": -1500,
            "pvp_lootable": true,
            "notes": null,
            "logged_at": "2026-01-02T03:04:05Z"
        }]);
        let src = path.with_file_name("asteroids.json");
        std::fs::write(&src, rocks.to_string()).unwrap();

        let s = PoiStore::open(path.clone());
        let rock = s
            .list()
            .into_iter()
            .find(|p| p.id == "rock-1700000000000000")
            .expect("legacy rock should be imported");
        assert_eq!(rock.name, "L8 M-type Asteroid II");
        assert_eq!(rock.logged_at.as_deref(), Some("2026-01-02T03:04:05Z"));
        assert!(rock.pvp_lootable);

        assert!(!src.exists(), "source should be renamed after import");
        assert!(
            src.with_extension("json.imported").exists(),
            "source should be kept as a backup, not deleted"
        );

        // Reopening must not re-import or duplicate.
        let before = s.list().len();
        drop(s);
        assert_eq!(PoiStore::open(path).list().len(), before);
    }

    /// Editing an imported rock must not quietly demote it to a hand-placed anchor.
    #[test]
    fn editing_a_logged_rock_keeps_its_log_time() {
        let path = tmp("keeplog");
        let s = PoiStore::open(path);
        let rock = s
            .add_logged(PoiInput {
                name: "Rock".into(),
                category: "asteroid-m".into(),
                eu_x: 1,
                eu_y: 2,
                eu_z: 3,
                pvp_lootable: false,
                notes: None,
                sector: None,
            })
            .unwrap();
        assert!(rock.logged_at.is_some());

        let edited = s
            .update(
                &rock.id,
                PoiInput {
                    name: "Rock renamed".into(),
                    category: "asteroid-c".into(),
                    eu_x: 9,
                    eu_y: 9,
                    eu_z: 9,
                    pvp_lootable: true,
                    notes: Some("fixed the type".into()),
                    sector: None,
                },
            )
            .unwrap();
        assert_eq!(edited.name, "Rock renamed");
        assert_eq!(
            edited.logged_at, rock.logged_at,
            "editing a rock must not clear its log time"
        );
    }

    #[test]
    fn survey_rows_are_editable_like_any_other() {
        let s = PoiStore::open(tmp("edit"));
        let row = s
            .list()
            .into_iter()
            .find(|p| p.id.starts_with("hm-"))
            .expect("a survey row");
        let updated = s
            .update(
                &row.id,
                PoiInput {
                    name: "Renamed".into(),
                    category: "landmark".into(),
                    eu_x: 1,
                    eu_y: 2,
                    eu_z: 3,
                    pvp_lootable: true,
                    notes: Some("edited".into()),
                    sector: None,
                },
            )
            .expect("update should succeed");
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.eu_x, 1);
    }
}
