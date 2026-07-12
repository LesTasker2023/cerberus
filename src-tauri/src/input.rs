//! Win32 input helpers for the position-capture flow: locate + focus the
//! Entropia window, synthesize the `<` keypress (Shift + comma) so the game
//! prints the player's location, and restore the previous foreground window.
//! Windows-only; no-ops elsewhere so the crate still builds cross-platform.

#[cfg(windows)]
use winapi::shared::windef::HWND;

/// Find a visible window whose title contains "Entropia" and focus it.
/// Returns false if no such window exists (game not running).
#[cfg(windows)]
pub fn focus_entropia() -> bool {
    use winapi::shared::minwindef::{BOOL, FALSE, LPARAM, TRUE};
    use winapi::um::winuser::{
        EnumWindows, GetWindowTextW, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow,
        SW_RESTORE,
    };

    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if IsWindowVisible(hwnd) == 0 {
            return TRUE;
        }
        let mut buf = [0u16; 256];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if len > 0 {
            let title = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase();
            if title.contains("entropia") {
                *(lparam as *mut HWND) = hwnd;
                return FALSE; // found — stop enumerating
            }
        }
        TRUE
    }

    unsafe {
        let mut found: HWND = std::ptr::null_mut();
        EnumWindows(Some(cb), &mut found as *mut HWND as LPARAM);
        if found.is_null() {
            return false;
        }
        if IsIconic(found) != 0 {
            ShowWindow(found, SW_RESTORE);
        }
        SetForegroundWindow(found);
        true
    }
}

/// Synthesize `<` (Shift + comma) as HARDWARE SCANCODES. CryEngine (Entropia)
/// reads input via DirectInput / Raw Input, which ignores virtual-key SendInput
/// but sees scancodes. A real down→hold→up is required — an instant down+up in
/// one batch is dropped between game frames.
#[cfg(windows)]
pub fn send_position_key() {
    use winapi::um::winuser::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE,
    };

    const SC_LSHIFT: u16 = 0x2A;
    const SC_COMMA: u16 = 0x33; // the ',' / '<' key

    unsafe fn key(scan: u16, up: bool) -> INPUT {
        let mut input: INPUT = std::mem::zeroed();
        input.type_ = INPUT_KEYBOARD;
        let ki: &mut KEYBDINPUT = input.u.ki_mut();
        ki.wVk = 0;
        ki.wScan = scan;
        ki.dwFlags = KEYEVENTF_SCANCODE | if up { KEYEVENTF_KEYUP } else { 0 };
        input
    }

    unsafe {
        let size = std::mem::size_of::<INPUT>() as i32;
        let mut down = [key(SC_LSHIFT, false), key(SC_COMMA, false)];
        SendInput(down.len() as u32, down.as_mut_ptr(), size);
        std::thread::sleep(std::time::Duration::from_millis(55));
        let mut up = [key(SC_COMMA, true), key(SC_LSHIFT, true)];
        SendInput(up.len() as u32, up.as_mut_ptr(), size);
    }
}

// ── Non-Windows stubs ──
#[cfg(not(windows))]
pub fn focus_entropia() -> bool {
    false
}
#[cfg(not(windows))]
pub fn send_position_key() {}
