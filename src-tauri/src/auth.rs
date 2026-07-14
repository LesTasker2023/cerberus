//! Discord OAuth2 login (implicit grant) + clan-membership gate. No backend and
//! no client secret: the browser hands an access token back to a loopback
//! redirect via the URL fragment, which a tiny local page posts to our server.
//! We then read the user's identity and their member object (roles) in the clan
//! guild to decide whether to unlock the app. Windows desktop.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::AppState;

// ── Config: PUBLIC values, safe to commit (they appear in the OAuth URL). Fill
//    these in from your Discord application + clan server. ──
/// Discord application Client ID (Developer Portal → your app → OAuth2).
const CLIENT_ID: &str = "1526331077747282070";
/// Your clan's Discord server (guild) ID.
const GUILD_ID: &str = "1495207366319407255";
/// Optional: require a specific role ID. Empty string = any guild member passes.
const REQUIRED_ROLE_ID: &str = "1516180013810978926"; // Cerberus Seniors
/// Loopback redirect port. Register `http://127.0.0.1:53127/callback` as a
/// redirect URI in the Discord app's OAuth2 settings (must match exactly).
const REDIRECT_PORT: u16 = 53127;
const SCOPES: &str = "identify guilds guilds.members.read";

/// Signed-in user + clan-gate result. Persisted locally; the access token is
/// stripped before this ever reaches the frontend (see `public`).
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Session {
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub avatar_url: String,
    /// True if the user is in the clan guild.
    pub is_member: bool,
    pub roles: Vec<String>,
    /// True if `REQUIRED_ROLE_ID` is empty or the user holds it.
    pub has_required_role: bool,
    pub access_token: String,
    /// Unix seconds when the token expires.
    pub expires_at: i64,
}

impl Session {
    /// A copy safe to send to the frontend — no bearer token.
    pub fn public(&self) -> Session {
        Session {
            access_token: String::new(),
            ..self.clone()
        }
    }
    pub fn expired(&self) -> bool {
        self.expires_at <= chrono::Utc::now().timestamp()
    }
}

/// Persisted session store.
pub struct AuthState {
    path: PathBuf,
    session: Mutex<Option<Session>>,
}

impl AuthState {
    pub fn open(path: PathBuf) -> Self {
        let session = std::fs::read_to_string(&path)
            .ok()
            .and_then(|j| serde_json::from_str(&j).ok());
        Self {
            path,
            session: Mutex::new(session),
        }
    }

    pub fn get(&self) -> Option<Session> {
        self.session.lock().expect("auth poisoned").clone()
    }

    pub fn set(&self, s: Option<Session>) {
        *self.session.lock().expect("auth poisoned") = s.clone();
        match s {
            Some(s) => {
                if let Ok(j) = serde_json::to_string_pretty(&s) {
                    let _ = std::fs::write(&self.path, j);
                }
            }
            None => {
                let _ = std::fs::remove_file(&self.path);
            }
        }
    }
}

/* ── OAuth flow ── */

/// Whether the Discord app IDs are filled in. The clan gate stays inert (the app
/// is usable without signing in) until this is true.
pub fn is_configured() -> bool {
    !CLIENT_ID.starts_with("REPLACE_") && !GUILD_ID.starts_with("REPLACE_")
}

/// Run the whole login: open Discord in the browser, capture the token on the
/// loopback, resolve identity + clan membership, store and return the session.
pub fn login(app: &AppHandle) -> Result<Session, String> {
    if !is_configured() {
        return Err("Discord login isn't configured yet (set CLIENT_ID / GUILD_ID in auth.rs).".into());
    }

    let state_tok = rand_hex();
    let redirect = format!("http://127.0.0.1:{REDIRECT_PORT}/callback");
    let auth_url = format!(
        "https://discord.com/oauth2/authorize?response_type=token&client_id={CLIENT_ID}\
         &scope={scope}&redirect_uri={redirect}&state={state_tok}&prompt=consent",
        scope = url_encode(SCOPES),
        redirect = url_encode(&redirect),
    );

    // Bind the loopback BEFORE opening the browser so we can't miss the redirect.
    let server = tiny_http::Server::http(("127.0.0.1", REDIRECT_PORT))
        .map_err(|e| format!("Couldn't start local login server on port {REDIRECT_PORT}: {e}"))?;

    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|e| format!("Couldn't open the browser: {e}"))?;

    let (token, expires_in) = wait_for_token(&server, &state_tok)?;
    let session = resolve_session(token, expires_in)?;
    app.state::<AppState>().auth.set(Some(session.clone()));
    Ok(session.public())
}

/// Loop over loopback requests until the token comes back (or we time out).
/// The implicit-grant token arrives in the URL *fragment*, which the browser
/// never sends to us — so `/callback` serves a page whose JS reposts the
/// fragment as a query string to `/capture`.
fn wait_for_token(server: &tiny_http::Server, expect_state: &str) -> Result<(String, i64), String> {
    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline {
        let req = match server.recv_timeout(Duration::from_secs(2)) {
            Ok(Some(r)) => r,
            Ok(None) => continue,
            Err(_) => continue,
        };
        let url = req.url().to_string();
        if url.starts_with("/callback") {
            let _ = req.respond(html(CALLBACK_HTML));
        } else if url.starts_with("/capture") {
            let query = url.splitn(2, '?').nth(1).unwrap_or("").to_string();
            let _ = req.respond(html(DONE_HTML));
            let params = parse_query(&query);
            if params.get("state").map(String::as_str) != Some(expect_state) {
                return Err("Login state mismatch — please try again.".into());
            }
            if let Some(err) = params.get("error") {
                return Err(format!("Discord denied the login: {err}"));
            }
            let token = params
                .get("access_token")
                .cloned()
                .ok_or("Discord didn't return an access token.")?;
            let expires_in = params
                .get("expires_in")
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(604800);
            return Ok((token, expires_in));
        } else {
            let _ = req.respond(html("<h3>Cerberus</h3>"));
        }
    }
    Err("Login timed out. Please try again.".into())
}

/// Fetch identity + clan-member object with the token and build a Session.
fn resolve_session(token: String, expires_in: i64) -> Result<Session, String> {
    let me: serde_json::Value = ureq::get("https://discord.com/api/v10/users/@me")
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|e| format!("Couldn't read your Discord profile: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;

    let user_id = me["id"].as_str().unwrap_or_default().to_string();
    let username = me["username"].as_str().unwrap_or_default().to_string();
    let display_name = me["global_name"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or(&username)
        .to_string();
    let avatar = me["avatar"].as_str().unwrap_or_default();
    let avatar_url = if avatar.is_empty() {
        String::new()
    } else {
        format!("https://cdn.discordapp.com/avatars/{user_id}/{avatar}.png?size=64")
    };

    // Member object in the clan guild: 200 = member (with roles), 404 = not in it.
    let (is_member, roles) = match ureq::get(&format!(
        "https://discord.com/api/v10/users/@me/guilds/{GUILD_ID}/member"
    ))
    .set("Authorization", &format!("Bearer {token}"))
    .call()
    {
        Ok(resp) => {
            let m: serde_json::Value = resp.into_json().unwrap_or_default();
            let roles = m["roles"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            (true, roles)
        }
        Err(ureq::Error::Status(404, _)) => (false, Vec::new()),
        Err(ureq::Error::Status(code, _)) => {
            return Err(format!("Couldn't check clan membership (Discord {code})."))
        }
        Err(e) => return Err(format!("Couldn't check clan membership: {e}")),
    };

    let has_required_role =
        REQUIRED_ROLE_ID.is_empty() || roles.iter().any(|r| r == REQUIRED_ROLE_ID);

    Ok(Session {
        user_id,
        username,
        display_name,
        avatar_url,
        is_member,
        roles,
        has_required_role,
        access_token: token,
        expires_at: chrono::Utc::now().timestamp() + expires_in,
    })
}

/* ── Small helpers (no extra deps) ── */

fn rand_hex() -> String {
    let mut b = [0u8; 16];
    let _ = getrandom::getrandom(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn html(body: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let mut r = tiny_http::Response::from_string(body);
    if let Ok(h) = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]) {
        r.add_header(h);
    }
    r
}

/// Percent-encode for query values (RFC 3986 unreserved kept; space → %20).
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn url_decode(s: &str) -> String {
    let bytes = s.replace('+', " ");
    let bytes = bytes.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&format!("{}{}", bytes[i + 1] as char, bytes[i + 2] as char), 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_query(q: &str) -> std::collections::HashMap<String, String> {
    q.split('&')
        .filter(|p| !p.is_empty())
        .filter_map(|p| {
            let mut it = p.splitn(2, '=');
            Some((url_decode(it.next()?), url_decode(it.next().unwrap_or(""))))
        })
        .collect()
}

const CALLBACK_HTML: &str = "<!doctype html><meta charset=utf-8><title>Cerberus</title>\
<body style=\"background:#06070b;color:#e6e9f2;font-family:system-ui;text-align:center;padding-top:14vh\">\
<h2 style=\"letter-spacing:3px\">CERBERUS</h2><p>Finishing sign-in…</p>\
<script>location.replace('/capture?'+location.hash.substring(1));</script></body>";

const DONE_HTML: &str = "<!doctype html><meta charset=utf-8><title>Cerberus</title>\
<body style=\"background:#06070b;color:#e6e9f2;font-family:system-ui;text-align:center;padding-top:14vh\">\
<h2 style=\"letter-spacing:3px\">CERBERUS</h2><p>✓ Signed in — you can close this tab and return to the app.</p></body>";
