//! EntropiaCentral live intel — subscribes to EC's public SignalR hubs and streams
//! universe-wide events to the UI. Completely independent of the local chat.log:
//! globals and trades are pushed from EC's servers whether or not Entropia is
//! running or the tail is active. Two reconnecting threads, one per hub, started
//! once at boot and left running for the app's lifetime.
//!
//! Protocol: SignalR JSON. Negotiate over HTTPS for a connection token, open a
//! WebSocket, send the `{"protocol":"json","version":1}` handshake, then read
//! `\x1e`-framed messages. Invocation frames (`type:1`) carry the hub method +
//! arguments; ping frames (`type:6`) are echoed back to keep the socket alive.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tungstenite::{Message, WebSocket};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                  (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ORIGIN: &str = "https://www.entropiacentral.com";
const RS: char = '\u{1e}'; // SignalR record separator
const RECONNECT: Duration = Duration::from_secs(15);

/// A hub subscription: its path, the invocation method it pushes, and the Tauri
/// event we re-emit each message on.
struct Hub {
    path: &'static str,
    method: &'static str,
    event: &'static str,
}

const HUBS: &[Hub] = &[
    Hub { path: "globals", method: "ReceiveGlobal", event: "ec:global" },
    Hub { path: "trademessages", method: "ReceiveTradeMessage", event: "ec:trade" },
];

/// Launch the EC intel client — one reconnecting thread per hub. Call once at startup.
pub fn start(app: AppHandle) {
    for hub in HUBS {
        let app = app.clone();
        thread::spawn(move || run_hub(app, hub));
    }
}

fn run_hub(app: AppHandle, hub: &'static Hub) {
    loop {
        let _ = connect_once(&app, hub);
        // Any exit (handshake fail, drop, error) falls through to a backoff retry.
        thread::sleep(RECONNECT);
    }
}

/// POST the negotiate endpoint and pull out the connection token.
fn negotiate(path: &str) -> Option<String> {
    let url = format!("https://api.entropiacentral.com/hubs/{path}/negotiate?negotiateVersion=1");
    let resp = ureq::post(&url)
        .set("User-Agent", UA)
        .set("Origin", ORIGIN)
        .call()
        .ok()?;
    let v: Value = resp.into_json().ok()?;
    v.get("connectionToken")
        .or_else(|| v.get("connectionId"))
        .and_then(|t| t.as_str())
        .map(str::to_string)
}

/// Percent-encode the connection token for the `id` query param (SignalR tokens
/// are base64 and can contain `+` `/` `=`).
fn enc(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u32 & 0xFF),
        })
        .collect()
}

/// One connection attempt: negotiate → WS → handshake → read loop. Returns on any
/// disconnect or error so the caller can back off and retry.
fn connect_once(app: &AppHandle, hub: &Hub) -> Result<(), String> {
    use tungstenite::client::IntoClientRequest;

    let token = negotiate(hub.path).ok_or("negotiate failed")?;
    let url = format!(
        "wss://api.entropiacentral.com/hubs/{}?id={}",
        hub.path,
        enc(&token)
    );

    let mut req = url.into_client_request().map_err(|e| e.to_string())?;
    let h = req.headers_mut();
    if let Ok(v) = UA.parse() {
        h.insert("User-Agent", v);
    }
    if let Ok(v) = ORIGIN.parse() {
        h.insert("Origin", v);
    }

    let (mut ws, _resp) = tungstenite::connect(req).map_err(|e| e.to_string())?;
    ws.send(Message::text(format!("{{\"protocol\":\"json\",\"version\":1}}{RS}")))
        .map_err(|e| e.to_string())?;

    loop {
        match ws.read().map_err(|e| e.to_string())? {
            Message::Text(t) => handle(app, t.as_str(), hub, &mut ws)?,
            Message::Binary(b) => handle(app, &String::from_utf8_lossy(&b), hub, &mut ws)?,
            Message::Ping(p) => {
                let _ = ws.send(Message::Pong(p));
            }
            Message::Close(_) => return Ok(()),
            _ => {}
        }
    }
}

/* ── Avatar scouting (EC REST) ── */

/// A player dossier pulled from EntropiaCentral — the intel that matters for
/// picking (and surviving) a target: how active/rich they are, whether they're a
/// space miner, and whether they can shoot back.
#[derive(Serialize, Clone, Default)]
pub struct Avatar {
    pub found: bool,
    pub name: String,
    pub slug: String,
    pub ec_rank: Option<i64>,
    pub total_globals: Option<i64>,
    pub total_value: Option<i64>,
    pub largest_global: Option<i64>,
    pub largest_detail: String,
    pub largest_type: String,
    pub hunting_globals: Option<i64>,
    pub mining_globals: Option<i64>,
    pub space_mining_globals: Option<i64>,
    pub space_mining_value: Option<i64>,
    pub largest_space_deposit: String,
    pub pvp_kills: Option<i64>,
    pub pvp_rank: Option<i64>,
    pub last_global_at: String,
    pub first_global_at: String,
}

const AVATAR_TTL: Duration = Duration::from_secs(10 * 60);
static AVATAR_CACHE: Mutex<Option<(Instant, HashMap<String, Avatar>)>> = Mutex::new(None);

fn get_json(url: &str) -> Option<Value> {
    ureq::get(url)
        .set("User-Agent", UA)
        .set("Origin", ORIGIN)
        .set("Accept", "application/json")
        .call()
        .ok()?
        .into_json()
        .ok()
}

/// Derive an avatar's EC slug from its name — lowercase kebab-case, e.g.
/// "Rubi Bix Cube" → "rubi-bix-cube". EC slugs collapse any run of
/// non-alphanumeric characters to a single hyphen.
fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut dash = false;
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    out.trim_end_matches('-').to_string()
}

fn map_avatar(name: &str, slug: &str, v: &Value) -> Avatar {
    let int = |k: &str| v.get(k).and_then(Value::as_i64);
    let text = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    Avatar {
        found: true,
        name: v.get("name").and_then(Value::as_str).unwrap_or(name).to_string(),
        slug: slug.to_string(),
        ec_rank: int("ecRank"),
        total_globals: int("totalGlobals"),
        total_value: int("totalValue"),
        largest_global: int("largestGlobalValue"),
        largest_detail: text("largestGlobalDetail"),
        largest_type: text("largestGlobalType"),
        hunting_globals: int("huntingGlobals"),
        mining_globals: int("miningGlobals"),
        space_mining_globals: int("spaceMiningGlobals"),
        space_mining_value: int("spaceMiningValue"),
        largest_space_deposit: text("largestSpaceMiningDeposit"),
        pvp_kills: int("pvpKills"),
        pvp_rank: int("pvpRank"),
        last_global_at: text("lastGlobalAt"),
        first_global_at: text("firstGlobalAt"),
    }
}

/// Look up a player's dossier, cached for 10 minutes.
pub fn avatar(name: &str) -> Avatar {
    let key = name.trim().to_lowercase();
    {
        let g = AVATAR_CACHE.lock().expect("ec avatar poisoned");
        if let Some((at, map)) = g.as_ref() {
            if at.elapsed() < AVATAR_TTL {
                if let Some(a) = map.get(&key) {
                    return a.clone();
                }
            }
        }
    }

    let slug = slugify(name);
    let dossier = if slug.is_empty() {
        Avatar { name: name.to_string(), ..Default::default() }
    } else {
        match get_json(&format!("https://api.entropiac.com/avatars/{slug}")) {
            Some(v) => map_avatar(name, &slug, &v),
            None => Avatar { name: name.to_string(), slug, ..Default::default() },
        }
    };

    let mut g = AVATAR_CACHE.lock().expect("ec avatar poisoned");
    match g.as_mut() {
        Some((at, map)) if at.elapsed() < AVATAR_TTL => {
            map.insert(key, dossier.clone());
        }
        _ => {
            let mut map = HashMap::new();
            map.insert(key, dossier.clone());
            *g = Some((Instant::now(), map));
        }
    }
    dossier
}

/* ── Media (Twitch / YouTube / Steam news) ── */

/// A live Twitch broadcast — the thumbnail is a near-live peek at their screen.
#[derive(Serialize, Clone, Default)]
pub struct EcStream {
    pub user_name: String,
    pub user_login: String,
    pub title: String,
    pub viewers: i64,
    pub started_at: String,
    pub thumbnail: String,
}

/// A recent community YouTube video.
#[derive(Serialize, Clone, Default)]
pub struct EcVideo {
    pub video_id: String,
    pub title: String,
    pub channel: String,
    pub published: String,
    pub thumbnail: String,
}

/// A Steam news / patch-note item (BBCode stripped, trimmed to a preview).
#[derive(Serialize, Clone, Default)]
pub struct EcNews {
    pub title: String,
    pub contents: String,
    pub date: i64,
    pub url: String,
}

#[derive(Serialize, Clone, Default)]
pub struct EcMedia {
    pub streams: Vec<EcStream>,
    pub videos: Vec<EcVideo>,
    pub news: Vec<EcNews>,
}

const MEDIA_TTL: Duration = Duration::from_secs(60);
static MEDIA_CACHE: Mutex<Option<(Instant, EcMedia)>> = Mutex::new(None);

fn map_streams(v: &Value) -> Vec<EcStream> {
    v.get("data")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    let str_of = |k: &str| s.get(k).and_then(Value::as_str).unwrap_or("").to_string();
                    Some(EcStream {
                        user_name: s.get("user_name").and_then(Value::as_str)?.to_string(),
                        user_login: str_of("user_login"),
                        title: str_of("title"),
                        viewers: s.get("viewer_count").and_then(Value::as_i64).unwrap_or(0),
                        started_at: str_of("started_at"),
                        thumbnail: str_of("thumbnail_url")
                            .replace("{width}", "440")
                            .replace("{height}", "248"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn map_videos(v: &Value) -> Vec<EcVideo> {
    v.get("items")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|it| {
                    let vid = it.get("id").and_then(|i| i.get("videoId")).and_then(Value::as_str)?;
                    let sn = it.get("snippet")?;
                    let str_of = |k: &str| sn.get(k).and_then(Value::as_str).unwrap_or("").to_string();
                    Some(EcVideo {
                        video_id: vid.to_string(),
                        title: str_of("title"),
                        channel: str_of("channelTitle"),
                        published: str_of("publishedAt"),
                        thumbnail: sn
                            .get("thumbnails")
                            .and_then(|t| t.get("medium"))
                            .and_then(|m| m.get("url"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Strip Steam's BBCode (`[p]`, `[list]`, `[*]`, `[url=…]`, …) and collapse whitespace.
fn strip_bbcode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '[' => in_tag = true,
            ']' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn map_news(v: &Value) -> Vec<EcNews> {
    v.get("appnews")
        .and_then(|a| a.get("newsitems"))
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .take(8)
                .filter_map(|n| {
                    Some(EcNews {
                        title: n.get("title").and_then(Value::as_str)?.to_string(),
                        contents: strip_bbcode(n.get("contents").and_then(Value::as_str).unwrap_or(""))
                            .chars()
                            .take(280)
                            .collect(),
                        date: n.get("date").and_then(Value::as_i64).unwrap_or(0),
                        url: n.get("url").and_then(Value::as_str).unwrap_or("").to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Fetch the community media feeds (live streams, videos, news), cached 60s.
pub fn media() -> EcMedia {
    {
        let g = MEDIA_CACHE.lock().expect("ec media poisoned");
        if let Some((at, m)) = g.as_ref() {
            if at.elapsed() < MEDIA_TTL {
                return m.clone();
            }
        }
    }

    let base = "https://api.entropiacentral.com";
    let m = EcMedia {
        streams: get_json(&format!("{base}/twitch/streams")).map(|v| map_streams(&v)).unwrap_or_default(),
        videos: get_json(&format!("{base}/youtube/videos")).map(|v| map_videos(&v)).unwrap_or_default(),
        news: get_json(&format!("{base}/steam-news")).map(|v| map_news(&v)).unwrap_or_default(),
    };

    *MEDIA_CACHE.lock().expect("ec media poisoned") = Some((Instant::now(), m.clone()));
    m
}

/// Split a WS payload into SignalR frames and re-emit each invocation for this
/// hub's method. Echoes `type:6` keep-alive pings.
fn handle<S: Read + Write>(
    app: &AppHandle,
    payload: &str,
    hub: &Hub,
    ws: &mut WebSocket<S>,
) -> Result<(), String> {
    for part in payload.split(RS) {
        if part.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(part) else {
            continue;
        };
        match v.get("type").and_then(Value::as_u64) {
            Some(6) => {
                let _ = ws.send(Message::text(format!("{{\"type\":6}}{RS}")));
            }
            Some(1) => {
                if v.get("target").and_then(Value::as_str) == Some(hub.method) {
                    if let Some(arg) = v
                        .get("arguments")
                        .and_then(Value::as_array)
                        .and_then(|a| a.first())
                    {
                        let _ = app.emit(hub.event, arg);
                    }
                }
            }
            _ => {}
        }
    }
    Ok(())
}
