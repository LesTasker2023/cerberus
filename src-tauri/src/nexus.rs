//! Entropia Nexus item enrichment — live TT value + market markup for the feed.
//! Both endpoints return the whole catalog, so we fetch once and cache in memory
//! on a TTL. Needs a browser User-Agent (Nexus 403s non-browser clients and
//! blocks CORS, so this can't run from the webview — it lives here in Rust).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

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
