//! Entropia Universe auction "last calls" — the 10 soonest-ending auctions per
//! planet. POST-only endpoint; needs a browser User-Agent. Flattened into a flat
//! list with the planet name attached, for the DelBoy bargain hunter.

use serde::Serialize;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                  (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const URL: &str = "https://account.entropiauniverse.com/api/auctions/getauctionlastcalls";

#[derive(Serialize, Clone)]
pub struct Auction {
    pub planet: String,
    pub name: String,
    pub quantity: i64,
    /// TT value in PED.
    pub value_ped: f64,
    pub start_bid_ped: f64,
    pub current_bid_ped: f64,
    pub bid_count: i64,
    /// Server time, "YYYY-MM-DD HH:MM:SS".
    pub end_time: String,
}

/// Fetch and flatten the current auction last-calls across every planet.
pub fn last_calls() -> Result<Vec<Auction>, String> {
    let body = ureq::post(URL)
        .set("User-Agent", UA)
        .set("Content-Type", "application/json")
        .set("Accept", "application/json")
        .send_string("{}")
        .map_err(|e| e.to_string())?
        .into_string()
        .map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;

    let planets = v["lastCalls"]["planets"]
        .as_array()
        .ok_or("unexpected auction payload")?;

    let mut out = Vec::new();
    for p in planets {
        let planet = p["planetName"].as_str().unwrap_or("").to_string();
        for a in p["auctions"].as_array().into_iter().flatten() {
            out.push(Auction {
                planet: planet.clone(),
                name: a["name"].as_str().unwrap_or("").to_string(),
                quantity: a["quantity"].as_i64().unwrap_or(1),
                value_ped: a["valuePED"].as_f64().unwrap_or(0.0),
                start_bid_ped: a["startBidPED"].as_f64().unwrap_or(0.0),
                current_bid_ped: a["currentBidPED"].as_f64().unwrap_or(0.0),
                bid_count: a["bidCount"].as_i64().unwrap_or(0),
                end_time: a["endTime"].as_str().unwrap_or("").to_string(),
            });
        }
    }
    Ok(out)
}
