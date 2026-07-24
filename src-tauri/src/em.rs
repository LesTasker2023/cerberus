//! EM assist — the "engage mob" accessibility loop.
//!
//! One closed loop, gated on Entropia being focused:
//!   1. press Engage (F). Wait, then check whether damage landed.
//!   2. hit registered  → a mob is engaged; stop (success).
//!   3. no hit → snap the game minimap, find the nearest red blip, rotate the
//!      view (Z/C) until it sits at 12 o'clock, step forward (W), repeat.
//!
//! Everything game-specific — the minimap circle, blip colour, which key turns
//! which way, timings, weapon range — is passed in from the UI as `EmConfig`,
//! because none of it can be hard-coded reliably across setups.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct EmState {
    pub running: AtomicBool,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmConfig {
    /// Minimap circle centre + radius, physical screen px.
    pub cx: i32,
    pub cy: i32,
    pub radius: i32,
    /// Weapon range as a fraction (0..1) of the radar radius — "2 rings".
    pub range_frac: f64,
    /// Blip colour test: red at least `red_min`, green & blue at most `other_max`.
    pub red_min: u8,
    pub other_max: u8,
    /// Scancodes. Turn keys rotate the view; forward closes distance.
    pub turn_left: u16,
    pub turn_right: u16,
    pub forward: u16,
    pub engage: u16,
    /// Timings, ms.
    pub turn_tap: u64,
    pub forward_tap: u64,
    /// How long to wait after Engage before judging whether a hit landed.
    pub settle: u64,
    /// A blip within this many degrees of straight-up counts as "ahead".
    pub aim_tol_deg: f64,
    /// Hard cap — the loop always stops after this many seconds.
    pub max_seconds: u64,
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A detected minimap blip, relative to the player at centre.
struct Blip {
    /// Degrees from straight-up; positive = clockwise (to the right).
    ang: f64,
    /// Distance from centre as a fraction (0..1) of the radar radius.
    rad: f64,
}

/// Scan the minimap for red blips and reduce them to (angle, radius) targets.
/// Red pixels are clustered by proximity so a multi-pixel dot is one blip.
fn find_blips(cfg: &EmConfig) -> Vec<Blip> {
    let r = cfg.radius.max(1);
    let d = r * 2;
    let (x0, y0) = (cfg.cx - r, cfg.cy - r);
    let Ok(bgra) = crate::ocr::grab(x0, y0, d, d) else {
        return Vec::new();
    };
    let (w, h) = (d as usize, d as usize);

    // Collect red pixels inside the circle, ignoring the very centre (the player
    // triangle sits there and dead-centre noise isn't a real target).
    let mut pts: Vec<(i32, i32)> = Vec::new();
    for py in 0..h {
        for px in 0..w {
            let o = (py * w + px) * 4;
            let (b, g, red) = (bgra[o], bgra[o + 1], bgra[o + 2]);
            if red >= cfg.red_min && g <= cfg.other_max && b <= cfg.other_max {
                let dx = px as i32 - r;
                let dy = py as i32 - r;
                let rr = ((dx * dx + dy * dy) as f64).sqrt();
                if rr <= r as f64 && rr >= r as f64 * 0.06 {
                    pts.push((px as i32, py as i32));
                }
            }
        }
    }
    if pts.is_empty() {
        return Vec::new();
    }

    // Greedy proximity clustering — cheap and fine for a handful of blips on a
    // small radar. Points within `merge` px join the same cluster.
    let merge = (r as f64 * 0.08).max(4.0);
    let merge2 = merge * merge;
    let mut used = vec![false; pts.len()];
    let mut blips = Vec::new();
    for i in 0..pts.len() {
        if used[i] {
            continue;
        }
        let (mut sx, mut sy, mut n) = (0i64, 0i64, 0i64);
        let mut stack = vec![i];
        used[i] = true;
        while let Some(k) = stack.pop() {
            let (kx, ky) = pts[k];
            sx += kx as i64;
            sy += ky as i64;
            n += 1;
            for (j, used_j) in used.iter_mut().enumerate() {
                if *used_j {
                    continue;
                }
                let (jx, jy) = pts[j];
                let (ddx, ddy) = ((jx - kx) as f64, (jy - ky) as f64);
                if ddx * ddx + ddy * ddy <= merge2 {
                    *used_j = true;
                    stack.push(j);
                }
            }
        }
        // Discard specks — a real blip is a few pixels at least.
        if n < 2 {
            continue;
        }
        let cxp = sx as f64 / n as f64 - r as f64;
        let cyp = sy as f64 / n as f64 - r as f64;
        // 12 o'clock = straight up = -y. Clockwise positive.
        let ang = cxp.atan2(-cyp).to_degrees();
        let rad = (cxp * cxp + cyp * cyp).sqrt() / r as f64;
        blips.push(Blip { ang, rad });
    }
    blips
}

fn emit(app: &AppHandle, running: bool, phase: &str, detail: impl Into<String>) {
    let _ = app.emit(
        "em:status",
        serde_json::json!({ "running": running, "phase": phase, "detail": detail.into() }),
    );
}

/// The seek loop. Runs on its own thread until `running` clears, the time cap is
/// hit, or a hit registers.
pub fn run(app: AppHandle, cfg: EmConfig, state: Arc<EmState>) {
    let start = epoch_ms();

    while state.running.load(Ordering::Relaxed) {
        if epoch_ms().saturating_sub(start) > cfg.max_seconds.saturating_mul(1000) {
            emit(&app, false, "stopped", "Time limit reached");
            break;
        }

        // Never send input unless the game is the foreground window.
        if !crate::input::entropia_is_focused() {
            emit(&app, true, "paused", "Entropia not focused");
            std::thread::sleep(Duration::from_millis(400));
            continue;
        }

        // Engage, then see whether a hit lands.
        let before = crate::combat::last_damage_ms();
        crate::input::press_key(cfg.engage, 60);
        std::thread::sleep(Duration::from_millis(cfg.settle));
        if crate::combat::last_damage_ms() > before {
            emit(&app, false, "engaged", "Damage registered — mob engaged");
            break;
        }

        // No hit — find the nearest mob and turn/step toward it.
        let target = find_blips(&cfg)
            .into_iter()
            .min_by(|a, b| a.rad.partial_cmp(&b.rad).unwrap_or(std::cmp::Ordering::Equal));

        let Some(t) = target else {
            emit(&app, true, "searching", "No targets — sweeping");
            crate::input::press_key(cfg.turn_right, cfg.turn_tap);
            std::thread::sleep(Duration::from_millis(150));
            continue;
        };

        if t.ang.abs() > cfg.aim_tol_deg {
            let key = if t.ang > 0.0 { cfg.turn_right } else { cfg.turn_left };
            emit(&app, true, "turning", format!("{:.0}° off centre", t.ang));
            crate::input::press_key(key, cfg.turn_tap);
        } else if t.rad > cfg.range_frac {
            emit(&app, true, "closing", format!("range {:.0}%", t.rad * 100.0));
            crate::input::press_key(cfg.forward, cfg.forward_tap);
        } else {
            emit(&app, true, "in-range", "Aligned & in range");
        }
        std::thread::sleep(Duration::from_millis(120));
    }

    state.running.store(false, Ordering::Relaxed);
    emit(&app, false, "stopped", "");
}
