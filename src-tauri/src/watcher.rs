//! chat.log watcher — tails the Entropia Universe log and streams new lines to
//! the UI. Strategy: track a byte offset, re-read only the delta each poll, and
//! reset to 0 when the file shrinks (a game restart truncates it). Each new line
//! is lightly parsed into a [`LogLine`] and emitted on the `log:line` channel.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const POLL_INTERVAL: Duration = Duration::from_millis(400);

/// One parsed log line pushed to the UI.
///
/// EU chat.log lines look like:
/// `2024-06-01 12:34:56 [Globals] [] Ace Combat killed a creature ...`
/// We keep the `raw` line verbatim and pull out the pieces we can.
#[derive(Serialize, Clone)]
pub struct LogLine {
    /// Timestamp text as it appeared in the log (falls back to receipt time).
    pub at: String,
    /// Channel token, e.g. "Globals", "System", "Team" — `None` if absent.
    pub channel: Option<String>,
    /// Speaker/subject token in the second bracket — `None` if empty/absent.
    pub speaker: Option<String>,
    /// The message body after the bracket tokens (or the whole line if unparsed).
    pub text: String,
    /// The untouched original line.
    pub raw: String,
}

/// Candidate chat.log locations on Windows, in priority order.
pub fn default_log_path() -> Option<PathBuf> {
    let home = std::env::var("USERPROFILE").ok()?;
    let home = PathBuf::from(home);
    let candidates = [
        home.join("Documents/Entropia Universe/chat.log"),
        home.join("OneDrive/Documents/Entropia Universe/chat.log"),
        PathBuf::from("C:/Program Files (x86)/Steam/steamapps/common/Entropia Universe/chat.log"),
        PathBuf::from("D:/SteamLibrary/steamapps/common/Entropia Universe/chat.log"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

/// Parse a raw log line into its pieces. Best-effort — anything we can't split
/// cleanly is returned whole in `text` with the receipt time as `at`.
pub fn parse_line(raw: &str) -> LogLine {
    let line = raw.trim_end();

    // Leading "YYYY-MM-DD HH:MM:SS " timestamp (19 chars + a space).
    let (at, rest) = if line.len() > 20
        && line.as_bytes()[4] == b'-'
        && line.as_bytes()[7] == b'-'
        && line.as_bytes()[13] == b':'
    {
        (line[..19].to_string(), line[20..].trim_start())
    } else {
        (chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(), line)
    };

    // Optional "[Channel] [Speaker] " bracket tokens.
    let (channel, after_channel) = take_bracket(rest);
    let (speaker, body) = if channel.is_some() {
        take_bracket(after_channel)
    } else {
        (None, after_channel)
    };

    LogLine {
        at,
        channel: channel.filter(|s| !s.is_empty()),
        speaker: speaker.filter(|s| !s.is_empty()),
        text: body.trim().to_string(),
        raw: raw.to_string(),
    }
}

/// If `s` starts with `[...]`, return the inner text and the remainder after it.
fn take_bracket(s: &str) -> (Option<String>, &str) {
    let s = s.trim_start();
    if let Some(stripped) = s.strip_prefix('[') {
        if let Some(end) = stripped.find(']') {
            let inner = stripped[..end].trim().to_string();
            let rest = stripped[end + 1..].trim_start();
            return (Some(inner), rest);
        }
    }
    (None, s)
}

/// Spawn a polling tail thread. Stops when `running` flips to `false`.
pub fn spawn(path: PathBuf, running: Arc<AtomicBool>, app: AppHandle) {
    thread::spawn(move || {
        // Start at end of file: only lines from now on are streamed.
        let mut last_pos = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

        while running.load(Ordering::Relaxed) {
            if let Some(text) = read_new(&path, &mut last_pos) {
                for line in text.lines().filter(|l| !l.trim().is_empty()) {
                    let _ = app.emit("log:line", parse_line(line));
                }
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

/// Read whatever has been appended since `last_pos`, advancing it. Returns `None`
/// when there is nothing new (or the file is unreadable this tick).
fn read_new(path: &Path, last_pos: &mut u64) -> Option<String> {
    let size = fs::metadata(path).ok()?.len();
    if size < *last_pos {
        // File was truncated (game restart) — start over.
        *last_pos = 0;
    }
    if size <= *last_pos {
        return None;
    }

    let mut file = File::open(path).ok()?;
    file.seek(SeekFrom::Start(*last_pos)).ok()?;
    let mut buf = Vec::with_capacity((size - *last_pos) as usize);
    file.take(size - *last_pos).read_to_end(&mut buf).ok()?;
    *last_pos = size;
    Some(String::from_utf8_lossy(&buf).into_owned())
}
