//! Entropia Nexus item enrichment — live TT value + market markup for the feed.
//! Both endpoints return the whole catalog, so we fetch once and cache in memory
//! on a TTL. Needs a browser User-Agent (Nexus 403s non-browser clients and
//! blocks CORS, so this can't run from the webview — it lives here in Rust).

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                  (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TTL: Duration = Duration::from_secs(30 * 60);

/// Item data returned to the feed.
#[derive(Serialize, Clone, Default)]
pub struct NexusItem {
    pub name: String,
    /// TT (trade terminal) value in PED.
    pub tt: Option<f64>,
    /// Market markup as a percent (e.g. 110.0 = +10%).
    pub markup: Option<f64>,
    /// Estimated market value = tt × markup/100 (when both are known).
    pub value: Option<f64>,
    /// False when the item wasn't found in the Nexus catalog.
    pub found: bool,
}

struct Cache {
    tt: HashMap<String, f64>,
    mu: HashMap<String, f64>,
    at: Instant,
}

static CACHE: Mutex<Option<Cache>> = Mutex::new(None);

// Per-path detail cache for live entity lookups (the Codex fetches full item/mob
// records on demand rather than bundling them). Keyed by the Nexus $Url path.
struct Detail {
    at: Instant,
    body: String,
}
static DETAILS: Mutex<Option<HashMap<String, Detail>>> = Mutex::new(None);
const DETAIL_TTL: Duration = Duration::from_secs(3600);

/// Fetch a Nexus resource by its `$Url` path (e.g. `/weapons/2629`) and return
/// the raw JSON. Cached in memory on a TTL so revisiting an entity is instant.
/// The webview can't call Nexus directly (403 + CORS), so this proxies it.
pub fn get_path(path: &str) -> Result<serde_json::Value, String> {
    if !path.starts_with('/') || path.contains("..") || path.contains("://") {
        return Err(format!("bad path: {path}"));
    }
    {
        let g = DETAILS.lock().expect("nexus details poisoned");
        if let Some(d) = g.as_ref().and_then(|m| m.get(path)) {
            if d.at.elapsed() < DETAIL_TTL {
                return serde_json::from_str(&d.body).map_err(|e| e.to_string());
            }
        }
    }

    let url = format!("https://api.entropianexus.com{path}");
    let body = ureq::get(&url)
        .set("User-Agent", UA)
        .set("Accept", "application/json")
        .call()
        .map_err(|e| e.to_string())?
        .into_string()
        .map_err(|e| e.to_string())?;
    let val: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;

    let mut g = DETAILS.lock().expect("nexus details poisoned");
    g.get_or_insert_with(HashMap::new)
        .insert(path.to_string(), Detail { at: Instant::now(), body });
    Ok(val)
}

fn fetch_tt() -> HashMap<String, f64> {
    let mut map = HashMap::new();
    let resp = ureq::get("https://api.entropianexus.com/items")
        .set("User-Agent", UA)
        .set("Accept", "application/json")
        .call();
    if let Ok(v) = resp.and_then(|r| r.into_json::<serde_json::Value>().map_err(Into::into)) {
        if let Some(arr) = v.as_array() {
            for it in arr {
                let name = it["Name"].as_str();
                let val = it["Properties"]["Economy"]["Value"].as_f64();
                if let (Some(name), Some(val)) = (name, val) {
                    map.insert(name.to_lowercase(), val);
                }
            }
        }
    }
    map
}

fn fetch_mu() -> HashMap<String, f64> {
    let mut map = HashMap::new();
    let resp = ureq::get("https://entropianexus.com/api/market/prices/snapshots/latest?all=true")
        .set("User-Agent", UA)
        .set("Accept", "application/json")
        .call();
    if let Ok(v) = resp.and_then(|r| r.into_json::<serde_json::Value>().map_err(Into::into)) {
        if let Some(arr) = v.as_array() {
            for r in arr {
                let name = r["item_name"].as_str().unwrap_or("");
                let num = |k: &str| r[k].as_f64().or_else(|| r[k].as_str().and_then(|s| s.parse().ok()));
                let mu = num("markup_30d").or_else(|| num("markup_7d"));
                if let Some(mu) = mu {
                    if !name.is_empty() && mu > 0.0 {
                        map.insert(name.to_lowercase(), mu);
                    }
                }
            }
        }
    }
    map
}

/// Look up an item's TT + markup, refreshing the cache past its TTL. Network I/O
/// happens outside the lock so lookups don't serialise on a slow fetch.
pub fn lookup(name: &str) -> NexusItem {
    let stale = {
        let g = CACHE.lock().expect("nexus poisoned");
        g.as_ref().map_or(true, |c| c.at.elapsed() >= TTL)
    };
    if stale {
        let tt = fetch_tt();
        let mu = fetch_mu();
        let mut g = CACHE.lock().expect("nexus poisoned");
        if g.as_ref().map_or(true, |c| c.at.elapsed() >= TTL) {
            *g = Some(Cache { tt, mu, at: Instant::now() });
        }
    }

    let g = CACHE.lock().expect("nexus poisoned");
    let c = g.as_ref();
    let key = name.trim().to_lowercase();
    // Fall back to the base name without a trailing "(L)" / "(Improved)" suffix.
    let base = key.split(" (").next().unwrap_or(&key).to_string();
    let get = |m: &HashMap<String, f64>| m.get(&key).or_else(|| m.get(&base)).copied();

    let tt = c.and_then(|c| get(&c.tt));
    let markup = c.and_then(|c| get(&c.mu));
    let value = match (tt, markup) {
        (Some(t), Some(m)) => Some(t * m / 100.0),
        _ => None,
    };
    NexusItem {
        name: name.to_string(),
        tt,
        markup,
        value,
        found: tt.is_some() || markup.is_some(),
    }
}

// ═══ Self-refreshing index snapshot ═══════════════════════════════════════
// Nexus is the single source of truth. The bundled /public/nexus files are a
// first-run seed; this rebuilds the same slim indices straight from live Nexus
// into app_data_dir/nexus, so the directory + reverse graphs stay current.
// Derived from just four bulk endpoints: /items, /mobs, /blueprints,
// /refiningrecipes (mobs embed their loot, so item→mob drops fall out of /mobs).

const REFRESH_TTL: Duration = Duration::from_secs(24 * 3600);

fn fetch_list(path: &str) -> Result<Vec<Value>, String> {
    let url = format!("https://api.entropianexus.com{path}");
    // NB: ureq's `into_string()` hard-caps the body at 10 MB and /mobs is ~14 MB,
    // which silently failed the whole rebuild. Parse straight from the reader.
    let v: Value = ureq::get(&url)
        .set("User-Agent", UA)
        .set("Accept", "application/json")
        .call()
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;
    if let Some(arr) = v.as_array() {
        Ok(arr.clone())
    } else if let Some(arr) = v.get("data").and_then(|d| d.as_array()) {
        Ok(arr.clone())
    } else {
        Err(format!("{path}: not a list"))
    }
}

fn write_index(dir: &Path, name: &str, val: &Value) -> Result<(), String> {
    let s = serde_json::to_string(val).map_err(|e| e.to_string())?;
    fs::write(dir.join(format!("{name}.json")), s).map_err(|e| e.to_string())
}

/// True when the on-disk snapshot is missing or older than the refresh TTL.
pub fn is_stale(dir: &Path) -> bool {
    let raw = match fs::read_to_string(dir.join("manifest.json")) {
        Ok(s) => s,
        Err(_) => return true,
    };
    let built = serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|m| m["builtAt"].as_str().map(str::to_owned))
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok());
    match built {
        Some(ts) => {
            let age = chrono::Utc::now().signed_duration_since(ts.with_timezone(&chrono::Utc));
            age.num_seconds().unsigned_abs() >= REFRESH_TTL.as_secs()
        }
        None => true,
    }
}

/// Rebuild every slim index from live Nexus into `dir`. Returns the manifest.
pub fn rebuild(dir: &Path) -> Result<Value, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    // --- directory (/items) + item→mob drops (/mobs) ---
    let items = fetch_list("/items")?;
    let mut search: Vec<Value> = Vec::with_capacity(items.len());
    for it in &items {
        let name = it["Name"].as_str().unwrap_or("");
        let url = it["Links"]["$Url"].as_str().unwrap_or("");
        if name.is_empty() || url.is_empty() {
            continue;
        }
        let kind = url.split('/').nth(1).unwrap_or("");
        let econ = &it["Properties"]["Economy"];
        let tt = econ["Value"].as_f64().or_else(|| econ["MaxTT"].as_f64());
        search.push(json!({ "name": name, "url": url, "kind": kind, "tt": tt }));
    }

    let mobs = fetch_list("/mobs")?;
    let mut drops: HashMap<String, Vec<Value>> = HashMap::new();
    for m in &mobs {
        let name = m["Name"].as_str().unwrap_or("");
        let url = m["Links"]["$Url"].as_str().unwrap_or("");
        if !name.is_empty() && !url.is_empty() {
            search.push(json!({ "name": name, "url": url, "kind": "mobs", "tt": Value::Null }));
        }
        let mob_id = m["Id"].as_i64().unwrap_or(0);
        let planet = m["Planet"]["Name"].as_str().unwrap_or("");
        for l in m["Loots"].as_array().into_iter().flatten() {
            let item = l["Item"]["Name"].as_str().unwrap_or("");
            if item.is_empty() {
                continue;
            }
            drops.entry(item.to_string()).or_default().push(json!({
                "mobName": name,
                "mobId": mob_id,
                "maturity": l["Maturity"]["Name"].clone(),
                "frequency": l["Frequency"].as_str().unwrap_or(""),
                "planet": planet,
                "isDropping": l["IsDropping"].as_bool().unwrap_or(true),
                "lastVU": l["LastVU"].as_str().unwrap_or(""),
            }));
        }
    }
    search.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    let n_search = search.len();
    let n_drops = drops.len();
    write_index(dir, "search-index", &Value::Array(search))?;
    write_index(dir, "item-drops", &serde_json::to_value(&drops).map_err(|e| e.to_string())?)?;

    // --- crafting edges (/blueprints) ---
    let bps = fetch_list("/blueprints")?;
    let mut craft = serde_json::Map::new();
    let mut usage: HashMap<String, Vec<String>> = HashMap::new();
    for bp in &bps {
        let product = bp["Product"]["Name"].as_str().unwrap_or("");
        let mats = match bp["Materials"].as_array() {
            Some(m) if !m.is_empty() => m,
            _ => continue,
        };
        if product.is_empty() {
            continue;
        }
        let is_ltd = bp["Name"].as_str().unwrap_or("").contains("(L)");
        if craft.contains_key(product) && is_ltd {
            continue; // keep the unlimited recipe
        }
        let m_arr: Vec<Value> = mats
            .iter()
            .map(|m| {
                json!({
                    "n": m["Item"]["Name"].as_str().unwrap_or(""),
                    "a": m["Amount"].as_f64().unwrap_or(0.0),
                    "u": m["Item"]["Links"]["$Url"].as_str(),
                })
            })
            .collect();
        craft.insert(
            product.to_string(),
            json!({
                "u": bp["Product"]["Links"]["$Url"].as_str(),
                "p": bp["Profession"]["Name"].as_str(),
                "l": bp["Properties"]["Level"].as_i64(),
                "q": bp["Properties"]["MinimumCraftAmount"].as_i64().unwrap_or(1),
                "m": m_arr,
            }),
        );
        for m in mats {
            if let Some(mn) = m["Item"]["Name"].as_str() {
                usage.entry(mn.to_string()).or_default().push(product.to_string());
            }
        }
    }
    for v in usage.values_mut() {
        v.sort();
        v.dedup();
        v.truncate(80);
    }
    let n_craft = craft.len();
    write_index(dir, "craft-index", &Value::Object(craft))?;
    write_index(dir, "material-usage", &serde_json::to_value(&usage).map_err(|e| e.to_string())?)?;

    // --- refining (/refiningrecipes) ---
    let recs = fetch_list("/refiningrecipes")?;
    let refining: Vec<Value> = recs
        .iter()
        .map(|r| {
            let ings: Vec<Value> = r["Ingredients"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|i| json!({ "Amount": i["Amount"], "Item": { "Name": i["Item"]["Name"], "Links": i["Item"]["Links"] } }))
                .collect();
            json!({
                "Id": r["Id"],
                "Amount": r["Amount"],
                "Ingredients": ings,
                "Product": { "Name": r["Product"]["Name"], "Links": r["Product"]["Links"] },
            })
        })
        .collect();
    let n_refine = refining.len();
    write_index(dir, "refining", &Value::Array(refining))?;

    // --- manifest ---
    let manifest = json!({
        "builtAt": chrono::Utc::now().to_rfc3339(),
        "source": "nexus live",
        "counts": {
            "search-index": n_search,
            "item-drops": n_drops,
            "craft-index": n_craft,
            "refining": n_refine,
        },
    });
    write_index(dir, "manifest", &manifest)?;
    Ok(manifest)
}
