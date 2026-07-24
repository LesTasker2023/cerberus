//! Screen-region OCR. Grabs a rectangle of the desktop with GDI (`BitBlt`) and
//! runs it through the built-in Windows OCR engine (`Windows.Media.Ocr`) — no
//! external engine or trained-data to bundle. Windows-only.

/// Screenshot a screen rectangle and OCR it, returning the recognized text.
#[cfg(windows)]
pub fn read_region(x: i32, y: i32, w: i32, h: i32) -> Result<String, String> {
    let bgra = screenshot(x, y, w, h)?;
    recognize(&bgra, w, h)
}

/// Grab a raw top-down BGRA screenshot of a screen rectangle (no OCR). Used by
/// the minimap blip scan, which reads pixel colour, not text.
#[cfg(windows)]
pub fn grab(x: i32, y: i32, w: i32, h: i32) -> Result<Vec<u8>, String> {
    screenshot(x, y, w, h)
}
#[cfg(not(windows))]
pub fn grab(_x: i32, _y: i32, _w: i32, _h: i32) -> Result<Vec<u8>, String> {
    Err("screenshot is only available on Windows".into())
}

/// Grab `w`×`h` pixels at screen `(x, y)` as top-down BGRA (alpha forced opaque).
#[cfg(windows)]
fn screenshot(x: i32, y: i32, w: i32, h: i32) -> Result<Vec<u8>, String> {
    use std::ptr::null_mut;
    use winapi::um::wingdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };
    use winapi::um::winuser::{GetDC, ReleaseDC};

    unsafe {
        let screen = GetDC(null_mut());
        if screen.is_null() {
            return Err("GetDC failed".into());
        }
        let mem = CreateCompatibleDC(screen);
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bmp as *mut _);

        let blit = BitBlt(mem, 0, 0, w, h, screen, x, y, SRCCOPY);

        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = w;
        info.bmiHeader.biHeight = -h; // negative → top-down rows
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;

        let mut buf = vec![0u8; (w as usize) * (h as usize) * 4];
        let scanned = GetDIBits(
            mem,
            bmp,
            0,
            h as u32,
            buf.as_mut_ptr() as *mut _,
            &mut info,
            DIB_RGB_COLORS,
        );

        SelectObject(mem, old);
        DeleteObject(bmp as *mut _);
        DeleteDC(mem);
        ReleaseDC(null_mut(), screen);

        if blit == 0 || scanned == 0 {
            return Err("Screen capture failed".into());
        }
        // BitBlt leaves alpha at 0; force opaque so OCR sees the pixels.
        for px in buf.chunks_mut(4) {
            px[3] = 255;
        }
        Ok(buf)
    }
}

/// Upscale factor applied before OCR. Windows OCR is strongly size-sensitive:
/// small game text is where it invents `l→i` / `8→B` slips, so we hand it
/// bigger, higher-contrast glyphs.
const SCALE: i32 = 3;

/// Clean a raw BGRA grab for OCR: grayscale → contrast-stretch → bilinear
/// upscale by `SCALE`. Returns a fresh BGRA buffer (gray in all channels) plus
/// its new dimensions. Contrast-stretch fixes the low light-on-dark contrast of
/// the game HUD; upscaling gives the engine the glyph resolution it wants.
#[cfg(windows)]
fn preprocess(bgra: &[u8], w: i32, h: i32) -> (Vec<u8>, i32, i32) {
    let (wu, hu) = (w as usize, h as usize);

    // Grayscale (Rec.709 luma) while tracking the value range for stretching.
    let mut gray = vec![0u8; wu * hu];
    let (mut lo, mut hi) = (255u8, 0u8);
    for i in 0..wu * hu {
        let b = bgra[i * 4] as u32;
        let g = bgra[i * 4 + 1] as u32;
        let r = bgra[i * 4 + 2] as u32;
        let l = ((r * 54 + g * 183 + b * 19) >> 8) as u8;
        gray[i] = l;
        lo = lo.min(l);
        hi = hi.max(l);
    }
    // Linear contrast stretch lo..hi → 0..255.
    let range = (hi as i32 - lo as i32).max(1);
    for l in gray.iter_mut() {
        *l = (((*l as i32 - lo as i32) * 255) / range).clamp(0, 255) as u8;
    }

    // Bilinear upscale.
    let (nw, nh) = (w * SCALE, h * SCALE);
    let (nwu, nhu) = (nw as usize, nh as usize);
    let mut out = vec![0u8; nwu * nhu * 4];
    let sample = |x: i32, y: i32| -> u8 {
        gray[y.clamp(0, h - 1) as usize * wu + x.clamp(0, w - 1) as usize]
    };
    for oy in 0..nh {
        let fy = (oy as f32 + 0.5) / SCALE as f32 - 0.5;
        let y0 = fy.floor() as i32;
        let wy = fy - y0 as f32;
        for ox in 0..nw {
            let fx = (ox as f32 + 0.5) / SCALE as f32 - 0.5;
            let x0 = fx.floor() as i32;
            let wx = fx - x0 as f32;
            let top = sample(x0, y0) as f32 * (1.0 - wx) + sample(x0 + 1, y0) as f32 * wx;
            let bot = sample(x0, y0 + 1) as f32 * (1.0 - wx) + sample(x0 + 1, y0 + 1) as f32 * wx;
            let v = (top * (1.0 - wy) + bot * wy).round().clamp(0.0, 255.0) as u8;
            let o = (oy as usize * nwu + ox as usize) * 4;
            out[o] = v;
            out[o + 1] = v;
            out[o + 2] = v;
            out[o + 3] = 255;
        }
    }
    (out, nw, nh)
}

/// OCR a top-down BGRA buffer via the Windows OCR engine.
#[cfg(windows)]
fn recognize(bgra: &[u8], w: i32, h: i32) -> Result<String, String> {
    use winapi::um::combaseapi::CoInitializeEx;
    use winapi::um::objbase::COINIT_MULTITHREADED;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    let (clean, cw, ch) = preprocess(bgra, w, h);

    // The WinRT OCR APIs need a COM apartment on this thread. Tauri command /
    // hotkey threads aren't guaranteed to have one, so ensure it (idempotent —
    // a second call just returns S_FALSE / RPC_E_CHANGED_MODE, which we ignore).
    unsafe {
        CoInitializeEx(std::ptr::null_mut(), COINIT_MULTITHREADED);
    }

    (|| -> windows::core::Result<String> {
        let writer = DataWriter::new()?;
        writer.WriteBytes(&clean)?;
        let buffer = writer.DetachBuffer()?;
        let bmp = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, cw, ch)?;
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
        let result = engine.RecognizeAsync(&bmp)?.get()?;

        // The engine's own line grouping splits wide two-column layouts (e.g. the
        // trade window's "name … value") into separate lines. Rebuild true visual
        // rows from each word's bounding box: cluster by vertical centre, then
        // order left→right. This rejoins name + value on one line.
        struct W {
            text: String,
            x: f32,
            cy: f32,
            h: f32,
        }
        let mut words: Vec<W> = Vec::new();
        let lines = result.Lines()?;
        for i in 0..lines.Size()? {
            let line = lines.GetAt(i)?;
            let ws = line.Words()?;
            for j in 0..ws.Size()? {
                let word = ws.GetAt(j)?;
                let r = word.BoundingRect()?;
                words.push(W {
                    text: word.Text()?.to_string(),
                    x: r.X,
                    cy: r.Y + r.Height / 2.0,
                    h: r.Height,
                });
            }
        }
        if words.is_empty() {
            return Ok(result.Text()?.to_string());
        }

        let cmp = |a: &f32, b: &f32| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal);
        // Row threshold = ~0.6× the median glyph height.
        let mut heights: Vec<f32> = words.iter().map(|w| w.h).collect();
        heights.sort_by(cmp);
        let thr = heights[heights.len() / 2] * 0.6;

        // Sort top→bottom, then cluster consecutive words into rows.
        words.sort_by(|a, b| cmp(&a.cy, &b.cy).then(cmp(&a.x, &b.x)));
        let mut rows: Vec<Vec<W>> = Vec::new();
        let (mut sum, mut n) = (0.0f32, 0.0f32);
        for w in words {
            let same = matches!(rows.last(), Some(_) if (w.cy - sum / n).abs() <= thr);
            if !same {
                rows.push(Vec::new());
                sum = 0.0;
                n = 0.0;
            }
            sum += w.cy;
            n += 1.0;
            rows.last_mut().unwrap().push(w);
        }

        let mut out = String::new();
        for row in &mut rows {
            row.sort_by(|a, b| cmp(&a.x, &b.x));
            let joined: Vec<&str> = row.iter().map(|w| w.text.as_str()).collect();
            out.push_str(&joined.join(" "));
            out.push('\n');
        }
        Ok(out)
    })()
    .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn read_region(_x: i32, _y: i32, _w: i32, _h: i32) -> Result<String, String> {
    Err("OCR is only available on Windows".into())
}
