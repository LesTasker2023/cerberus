//! Screen-region OCR. Grabs a rectangle of the desktop with GDI (`BitBlt`) and
//! runs it through the built-in Windows OCR engine (`Windows.Media.Ocr`) — no
//! external engine or trained-data to bundle. Windows-only.

/// Screenshot a screen rectangle and OCR it, returning the recognized text.
#[cfg(windows)]
pub fn read_region(x: i32, y: i32, w: i32, h: i32) -> Result<String, String> {
    let bgra = screenshot(x, y, w, h)?;
    recognize(&bgra, w, h)
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

/// OCR a top-down BGRA buffer via the Windows OCR engine.
#[cfg(windows)]
fn recognize(bgra: &[u8], w: i32, h: i32) -> Result<String, String> {
    use winapi::um::combaseapi::CoInitializeEx;
    use winapi::um::objbase::COINIT_MULTITHREADED;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    // The WinRT OCR APIs need a COM apartment on this thread. Tauri command /
    // hotkey threads aren't guaranteed to have one, so ensure it (idempotent —
    // a second call just returns S_FALSE / RPC_E_CHANGED_MODE, which we ignore).
    unsafe {
        CoInitializeEx(std::ptr::null_mut(), COINIT_MULTITHREADED);
    }

    (|| -> windows::core::Result<String> {
        let writer = DataWriter::new()?;
        writer.WriteBytes(bgra)?;
        let buffer = writer.DetachBuffer()?;
        let bmp = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w, h)?;
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
        let result = engine.RecognizeAsync(&bmp)?.get()?;
        Ok(result.Text()?.to_string())
    })()
    .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn read_region(_x: i32, _y: i32, _w: i32, _h: i32) -> Result<String, String> {
    Err("OCR is only available on Windows".into())
}
