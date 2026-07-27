//! Entropia Universe forum client — `forum.entropiauniverse.com` runs Discourse,
//! so every route has a `.json` twin and reads need no auth at all. That gives us
//! the whole PlanetCalypsoForum archive (4.6M posts back to 2005) plus the live
//! feed behind plain GETs.
//!
//! Two halves:
//!   * on-demand lookups (`latest`, `topic`, `search`, `user`) driven by commands;
//!   * a background watcher thread that polls `/posts.json` and emits `forum:post`
//!     for anything new, so Space activity can raise a notification.
//!
//! The watcher polls rather than riding Discourse's `message-bus` long-poll. The
//! forum only moves ~75 posts/day, so a 90s poll costs 960 requests/day, catches
//! everything, and has no reconnect/sequence state to get wrong. Revisit only if
//! sub-minute latency ever matters.

use std::collections::HashMap;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

const BASE: &str = "https://forum.entropiauniverse.com";
/// Identify ourselves honestly — this is a community forum, not an API we're
/// entitled to. Verified accepted (a generic browser UA works too).
const UA: &str = "Cerberus/0.7 (+https://github.com/LesTasker2023/cerberus)";

/// How often the watcher checks for new posts.
const POLL: Duration = Duration::from_secs(90);
/// Category-tree cache lifetime — the tree effectively never changes.
const CATS_TTL: Duration = Duration::from_secs(6 * 60 * 60);

/// The boards worth surfacing, in the order they should appear as filter tabs.
/// Space leads — it's the one Cerberus exists for. Ids are stable Discourse
/// category ids; the whole 70-category tree is still reachable via `latest(None)`.
pub const BOARDS: &[(i64, &str)] = &[
    (SPACE, "Space"),
    (51, "Trading"),
    (39, "Hall of Fame"),
    (40, "Hunting"),
    (29, "Items"),
    (22, "Entropia News"),
];

/// Beyond Calypso / Space — the category the watcher treats as notification-worthy.
pub const SPACE: i64 = 108;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct Topic {
    pub id: i64,
    pub title: String,
    pub url: String,
    pub category_id: i64,
    /// Human category name, e.g. "Beyond Calypso / Space".
    pub category: String,
    pub posts_count: i64,
    pub views: i64,
    pub created_at: String,
    pub last_posted_at: String,
    pub last_poster: String,
    pub excerpt: String,
    pub tags: Vec<String>,
    pub closed: bool,
    pub pinned: bool,
}

#[derive(Serialize, Clone)]
pub struct Post {
    pub id: i64,
    pub topic_id: i64,
    pub topic_title: String,
    pub url: String,
    pub username: String,
    pub avatar: String,
    pub created_at: String,
    pub post_number: i64,
    /// Plain text — HTML stripped and the migrated vBulletin BBCode scrubbed.
    pub body: String,
}

/// A forum dossier on an avatar — pairs with the EntropiaCentral one in `ec.rs`
/// for scouting someone you just met in a lootable zone.
#[derive(Serialize, Clone, Default)]
pub struct ForumUser {
    pub found: bool,
    pub username: String,
    pub name: String,
    pub avatar: String,
    pub url: String,
    /// Account creation — a 2005 join date says a lot about who you're facing.
    pub created_at: String,
    pub last_seen_at: String,
    pub trust_level: i64,
    pub post_count: i64,
    pub topic_count: i64,
    pub likes_received: i64,
    pub title: String,
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/// GET a forum path and parse it as JSON. `into_json()` rather than
/// `into_string()` — no 10 MB cap, and topic streams can get large.
fn get(path: &str) -> Result<Value, String> {
    ureq::get(&format!("{BASE}{path}"))
        .set("User-Agent", UA)
        .set("Accept", "application/json")
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())
}

/// Percent-encode a query-string value.
fn enc(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => {
                let mut b = [0u8; 4];
                c.encode_utf8(&mut b)
                    .bytes()
                    .map(|x| format!("%{x:02X}"))
                    .collect()
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Category names
// ---------------------------------------------------------------------------

static CATS: Mutex<Option<(Instant, HashMap<i64, String>)>> = Mutex::new(None);

/// Map of category id → "Parent / Child" display name, from `/site.json`.
fn categories() -> HashMap<i64, String> {
    {
        let g = CATS.lock().expect("forum cats poisoned");
        if let Some((at, m)) = g.as_ref() {
            if at.elapsed() < CATS_TTL {
                return m.clone();
            }
        }
    }

    let mut map = HashMap::new();
    if let Ok(v) = get("/site.json") {
        let list: Vec<&Value> = v["categories"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
        let names: HashMap<i64, &str> = list
            .iter()
            .filter_map(|c| Some((c["id"].as_i64()?, c["name"].as_str()?)))
            .collect();
        for c in &list {
            let Some(id) = c["id"].as_i64() else { continue };
            let own = c["name"].as_str().unwrap_or("").to_string();
            let full = match c["parent_category_id"].as_i64().and_then(|p| names.get(&p)) {
                Some(parent) => format!("{parent} / {own}"),
                None => own,
            };
            map.insert(id, full);
        }
    }

    if !map.is_empty() {
        *CATS.lock().expect("forum cats poisoned") = Some((Instant::now(), map.clone()));
    }
    map
}

// ---------------------------------------------------------------------------
// Text cleanup
// ---------------------------------------------------------------------------

/// Discourse's `cooked` HTML still carries raw vBulletin BBCode from the forum
/// migration — `[SIZE=4]`, `[B]`, `[QUOTE=Name;12345]` leak through as literal
/// text, and some `<a>` tags lost their href. Reduce a post to readable plain
/// text: block tags become newlines, all tags drop, entities decode, BBCode goes.
fn to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut chars = html.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '<' => {
                let mut tag = String::new();
                for t in chars.by_ref() {
                    if t == '>' {
                        break;
                    }
                    tag.push(t);
                }
                let name = tag.trim_start_matches('/').split([' ', '\t', '\n']).next().unwrap_or("");
                if matches!(
                    name.to_ascii_lowercase().as_str(),
                    "p" | "br" | "div" | "li" | "tr" | "blockquote" | "h1" | "h2" | "h3" | "h4"
                ) {
                    out.push('\n');
                }
            }
            '[' => {
                // Only swallow it if it closes like a BBCode tag on the same line.
                let rest: String = chars.clone().take(40).collect();
                match rest.find(']') {
                    Some(i) if !rest[..i].contains('\n') && is_bbcode(&rest[..i]) => {
                        for _ in 0..=i {
                            chars.next();
                        }
                    }
                    _ => out.push('['),
                }
            }
            _ => out.push(c),
        }
    }

    decode_entities(&out)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Does `body` (the text between `[` and `]`) look like a BBCode tag rather than
/// prose or an in-game item reference like `[Modified Mercenary]`?
fn is_bbcode(body: &str) -> bool {
    let name = body.trim_start_matches('/').split(['=', ':']).next().unwrap_or("").trim();
    !name.is_empty()
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '*')
        && matches!(
            name.to_ascii_lowercase().as_str(),
            "b" | "i" | "u" | "s" | "size" | "color" | "colour" | "font" | "center" | "left"
                | "right" | "quote" | "url" | "img" | "code" | "list" | "spoiler" | "indent"
                | "highlight" | "email" | "table" | "tr" | "td" | "*"
        )
}

fn decode_entities(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&hellip;", "…")
        .replace("&amp;", "&")
}

/// Expand Discourse's `avatar_template` ("/user_avatar/host/x/{size}/y.png") into
/// an absolute URL at the given size.
fn avatar_url(template: &str, size: u32) -> String {
    if template.is_empty() {
        return String::new();
    }
    let path = template.replace("{size}", &size.to_string());
    if path.starts_with("http") {
        path
    } else {
        format!("{BASE}{path}")
    }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

fn map_topic(t: &Value, cats: &HashMap<i64, String>) -> Option<Topic> {
    let id = t["id"].as_i64()?;
    let slug = t["slug"].as_str().unwrap_or("topic");
    let category_id = t["category_id"].as_i64().unwrap_or(0);
    Some(Topic {
        id,
        title: t["title"].as_str().unwrap_or("").to_string(),
        url: format!("{BASE}/t/{slug}/{id}"),
        category_id,
        category: cats.get(&category_id).cloned().unwrap_or_default(),
        posts_count: t["posts_count"].as_i64().unwrap_or(0),
        views: t["views"].as_i64().unwrap_or(0),
        created_at: t["created_at"].as_str().unwrap_or("").to_string(),
        last_posted_at: t["last_posted_at"].as_str().unwrap_or("").to_string(),
        last_poster: t["last_poster_username"].as_str().unwrap_or("").to_string(),
        excerpt: to_text(t["excerpt"].as_str().unwrap_or("")),
        tags: t["tags"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| Some(x.as_str()?.to_string())).collect())
            .unwrap_or_default(),
        closed: t["closed"].as_bool().unwrap_or(false),
        pinned: t["pinned"].as_bool().unwrap_or(false),
    })
}

/// Newest topics, optionally scoped to one category id (see `SPACE` etc.).
pub fn latest(category: Option<i64>, page: u32) -> Result<Vec<Topic>, String> {
    let mut path = format!("/latest.json?page={page}");
    if let Some(c) = category {
        path.push_str(&format!("&category={c}"));
    }
    let v = get(&path)?;
    let cats = categories();
    Ok(v["topic_list"]["topics"]
        .as_array()
        .ok_or("unexpected topic list payload")?
        .iter()
        .filter_map(|t| map_topic(t, &cats))
        .collect())
}

/// Every post in a topic, oldest first. Discourse returns the first ~20 in
/// `post_stream.posts` and the rest of the ids in `post_stream.stream`; we walk
/// the remainder in chunks so callers get the whole thread.
pub fn topic(id: i64, max_posts: usize) -> Result<Vec<Post>, String> {
    let v = get(&format!("/t/{id}.json"))?;
    let title = v["title"].as_str().unwrap_or("").to_string();
    let slug = v["slug"].as_str().unwrap_or("topic").to_string();

    let mut posts: Vec<Post> = v["post_stream"]["posts"]
        .as_array()
        .map(|a| a.iter().filter_map(|p| map_post(p, &title, &slug)).collect())
        .unwrap_or_default();

    let stream: Vec<i64> = v["post_stream"]["stream"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default();
    let have: Vec<i64> = posts.iter().map(|p| p.id).collect();
    let missing: Vec<i64> = stream.into_iter().filter(|s| !have.contains(s)).collect();

    for chunk in missing.chunks(20) {
        if posts.len() >= max_posts {
            break;
        }
        let q: String = chunk.iter().map(|i| format!("&post_ids[]={i}")).collect();
        let Ok(more) = get(&format!("/t/{id}/posts.json?{}", q.trim_start_matches('&'))) else {
            break;
        };
        if let Some(arr) = more["post_stream"]["posts"].as_array() {
            posts.extend(arr.iter().filter_map(|p| map_post(p, &title, &slug)));
        }
    }

    posts.sort_by_key(|p| p.post_number);
    posts.truncate(max_posts);
    Ok(posts)
}

fn map_post(p: &Value, topic_title: &str, topic_slug: &str) -> Option<Post> {
    let id = p["id"].as_i64()?;
    let topic_id = p["topic_id"].as_i64().unwrap_or(0);
    let post_number = p["post_number"].as_i64().unwrap_or(1);
    let title = if topic_title.is_empty() {
        p["topic_title"].as_str().unwrap_or("").to_string()
    } else {
        topic_title.to_string()
    };
    let slug = if topic_slug.is_empty() {
        p["topic_slug"].as_str().unwrap_or("topic")
    } else {
        topic_slug
    };
    Some(Post {
        id,
        topic_id,
        topic_title: title,
        url: format!("{BASE}/t/{slug}/{topic_id}/{post_number}"),
        username: p["username"].as_str().unwrap_or("").to_string(),
        avatar: avatar_url(p["avatar_template"].as_str().unwrap_or(""), 48),
        created_at: p["created_at"].as_str().unwrap_or("").to_string(),
        post_number,
        body: to_text(p["cooked"].as_str().unwrap_or("")),
    })
}

/// Full-text search across the archive. Discourse query syntax passes straight
/// through, so callers can use `@username`, `#category:sub`, `after:2026-01-01`,
/// `in:title` — e.g. `pirate #beyond-calypso:space after:2026-01-01`.
pub fn search(query: &str) -> Result<Vec<Topic>, String> {
    let v = get(&format!("/search.json?q={}", enc(query)))?;
    let cats = categories();
    Ok(v["topics"]
        .as_array()
        .map(|a| a.iter().filter_map(|t| map_topic(t, &cats)).collect())
        .unwrap_or_default())
}

/// Forum dossier for an avatar name. Never errors on a miss — an avatar with no
/// forum account is the common case, so it returns `found: false`.
pub fn user(name: &str) -> ForumUser {
    let Ok(v) = get(&format!("/u/{}.json", enc(name))) else {
        return ForumUser { username: name.to_string(), ..Default::default() };
    };
    let u = &v["user"];
    let username = u["username"].as_str().unwrap_or(name).to_string();
    ForumUser {
        found: u["id"].as_i64().is_some(),
        url: format!("{BASE}/u/{username}"),
        name: u["name"].as_str().unwrap_or("").to_string(),
        avatar: avatar_url(u["avatar_template"].as_str().unwrap_or(""), 120),
        created_at: u["created_at"].as_str().unwrap_or("").to_string(),
        last_seen_at: u["last_seen_at"].as_str().unwrap_or("").to_string(),
        trust_level: u["trust_level"].as_i64().unwrap_or(0),
        post_count: u["post_count"].as_i64().or(u["stats"]["post_count"].as_i64()).unwrap_or(0),
        topic_count: u["topic_count"].as_i64().unwrap_or(0),
        likes_received: u["likes_received"].as_i64().unwrap_or(0),
        title: u["title"].as_str().unwrap_or("").to_string(),
        username,
    }
}

/// Site-wide firehose — the last 50 posts across every category.
pub fn recent_posts() -> Result<Vec<Post>, String> {
    let v = get("/posts.json")?;
    Ok(v["latest_posts"]
        .as_array()
        .ok_or("unexpected posts payload")?
        .iter()
        .filter_map(|p| map_post(p, "", ""))
        .collect())
}

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

/// The boards offered as filter tabs, `[{ id, name }]`.
pub fn boards() -> Vec<Value> {
    BOARDS
        .iter()
        .map(|(id, name)| serde_json::json!({ "id": id, "name": name }))
        .collect()
}

/// Poll the firehose and emit `forum:post` for each new post, oldest first. The
/// payload flags Space posts so the UI can notify on those and treat the rest as
/// feed. The first pass only records the high-water mark — no burst of 50
/// notifications at boot.
pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let cats = categories();
        let mut seen: i64 = -1;

        loop {
            if let Ok(posts) = recent_posts() {
                let high = posts.iter().map(|p| p.id).max().unwrap_or(seen);
                if seen >= 0 {
                    let mut fresh: Vec<&Post> = posts.iter().filter(|p| p.id > seen).collect();
                    fresh.sort_by_key(|p| p.id);
                    for p in fresh {
                        let (category_id, category) = topic_category(p.topic_id, &cats);
                        let _ = app.emit(
                            "forum:post",
                            serde_json::json!({
                                "post": p,
                                "category_id": category_id,
                                "category": category,
                                "space": category_id == SPACE,
                            }),
                        );
                    }
                }
                seen = high.max(seen);
            }
            thread::sleep(POLL);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real `cooked` HTML from topic 283241 — a migrated vBulletin trade thread,
    /// BBCode leakage and href-less anchors included.
    #[test]
    fn strips_migrated_bbcode() {
        let html = "<p>[SIZE=4]<span class=\"bbcode-b\">Unlocked Sale Items:</span>[/SIZE]</p>\n\
                    <p><a>Omegaton Swine Deluxe</a> T6.07 - TT+2,000 PED<br>\n\
                    <a>Warmonger (M)</a> all pieces T0.99 - TT+700</p>";
        assert_eq!(
            to_text(html),
            "Unlocked Sale Items:\nOmegaton Swine Deluxe T6.07 - TT+2,000 PED\nWarmonger (M) all pieces T0.99 - TT+700"
        );
    }

    /// Item names in square brackets are how the game itself writes them — they
    /// must survive the BBCode pass.
    #[test]
    fn keeps_item_brackets() {
        assert_eq!(to_text("<p>WTB [Modified Mercenary] paying 120%</p>"), "WTB [Modified Mercenary] paying 120%");
        assert_eq!(to_text("[b]bold[/b] [Ares Ring]"), "bold [Ares Ring]");
    }

    #[test]
    fn decodes_entities_and_quotes() {
        assert_eq!(to_text("<p>[QUOTE=Bob;1234]hi&amp;bye[/QUOTE]</p>"), "hi&bye");
        assert_eq!(to_text("A &lt;tag&gt; &quot;quoted&quot;"), "A <tag> \"quoted\"");
    }

    #[test]
    fn builds_avatar_urls() {
        assert_eq!(
            avatar_url("/user_avatar/forum.entropiauniverse.com/akiranblade/{size}/915_2.png", 48),
            "https://forum.entropiauniverse.com/user_avatar/forum.entropiauniverse.com/akiranblade/48/915_2.png"
        );
        assert_eq!(avatar_url("", 48), "");
    }

    #[test]
    fn encodes_search_queries() {
        assert_eq!(enc("pirate #beyond-calypso:space"), "pirate%20%23beyond-calypso%3Aspace");
    }
}

/// `/posts.json` carries no category, so resolve it from the topic. Cached per
/// topic for the process lifetime — a topic never changes category in practice,
/// and busy threads would otherwise refetch on every poll.
fn topic_category(topic_id: i64, cats: &HashMap<i64, String>) -> (i64, String) {
    static SEEN: Mutex<Option<HashMap<i64, (i64, String)>>> = Mutex::new(None);

    if let Some(hit) = SEEN
        .lock()
        .expect("forum topic cats poisoned")
        .get_or_insert_with(HashMap::new)
        .get(&topic_id)
    {
        return hit.clone();
    }

    let id = get(&format!("/t/{topic_id}.json"))
        .ok()
        .and_then(|v| v["category_id"].as_i64())
        .unwrap_or(0);
    let found = (id, cats.get(&id).cloned().unwrap_or_default());

    SEEN.lock()
        .expect("forum topic cats poisoned")
        .get_or_insert_with(HashMap::new)
        .insert(topic_id, found.clone());
    found
}
