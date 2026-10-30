//! Capture d'écran avec les dessins.
//!
//! `capture_screen` photographie l'écran sous le calque, sans le calque lui-même : la fenêtre
//! est exclue des captures le temps d'une image (sans cela on verrait aussi la barre d'état et
//! le liseré). L'interface superpose ensuite ses tracés et renvoie le PNG à `save_capture`,
//! qui l'enregistre dans Images\NeonInk.

use tauri::{ipc::Response, AppHandle, Manager, WebviewWindow};

/// Pixels de l'écran sous le calque : largeur et hauteur (u32 petit-boutiste), puis BGRA.
#[tauri::command]
pub fn capture_screen(window: WebviewWindow) -> Result<Response, String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    grab(hwnd).map(Response::new)
}

/// Enregistre le PNG reçu et renvoie son chemin.
#[tauri::command]
pub fn save_capture(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else {
        return Err("image manquante".into());
    };
    if !png.starts_with(b"\x89PNG") {
        return Err("image invalide".into());
    }
    let dir = app.path().picture_dir().map_err(|e| e.to_string())?.join("NeonInk");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = timestamp();
    let mut path = dir.join(format!("NeonInk {stamp}.png"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("NeonInk {stamp} ({n}).png"));
        n += 1;
    }
    std::fs::write(&path, png).map_err(|e| format!("capture non enregistrée ({e})"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Ouvre le dossier des captures dans l'Explorateur.
#[tauri::command]
pub fn open_captures(app: AppHandle) {
    if let Ok(dir) = app.path().picture_dir().map(|d| d.join("NeonInk")) {
        let _ = std::fs::create_dir_all(&dir);
        #[cfg(windows)]
        let _ = std::process::Command::new("explorer.exe").arg(&dir).spawn();
    }
}

#[cfg(windows)]
fn timestamp() -> String {
    use windows_sys::Win32::System::SystemInformation::GetLocalTime;
    let mut t = unsafe { std::mem::zeroed() };
    unsafe { GetLocalTime(&mut t) };
    format!("{:04}-{:02}-{:02} à {:02}.{:02}.{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond)
}

#[cfg(not(windows))]
fn timestamp() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    secs.to_string()
}

#[cfg(windows)]
fn grab(hwnd: isize) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::Graphics::Dwm::DwmFlush;
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, SRCCOPY,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    let hwnd = hwnd as HWND;
    let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return Err("position du calque inconnue".into());
    }
    let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
    if w <= 0 || h <= 0 {
        return Err("calque sans taille".into());
    }

    unsafe {
        // Exclusion seulement pendant la capture : un partage d'écran (Teams, OBS…) doit
        // continuer à montrer les dessins. Windows 10 2004 au minimum ; sinon on capture tel quel.
        let excluded = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) != 0;
        if excluded {
            // Laisse le gestionnaire de fenêtres composer une image sans le calque.
            DwmFlush();
            DwmFlush();
        }

        let screen = GetDC(std::ptr::null_mut());
        let mem = CreateCompatibleDC(screen);
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h, // lignes de haut en bas
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..std::mem::zeroed()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let bitmap = CreateDIBSection(mem, &info, DIB_RGB_COLORS, &mut bits, std::ptr::null_mut(), 0);
        let mut result = Err("capture impossible".to_string());
        if !bitmap.is_null() && !bits.is_null() {
            let old = SelectObject(mem, bitmap);
            if BitBlt(mem, 0, 0, w, h, screen, rect.left, rect.top, SRCCOPY | CAPTUREBLT) != 0 {
                let len = (w * h * 4) as usize;
                let mut out = Vec::with_capacity(8 + len);
                out.extend_from_slice(&(w as u32).to_le_bytes());
                out.extend_from_slice(&(h as u32).to_le_bytes());
                out.extend_from_slice(std::slice::from_raw_parts(bits as *const u8, len));
                result = Ok(out);
            }
            SelectObject(mem, old);
            DeleteObject(bitmap);
        }
        DeleteDC(mem);
        ReleaseDC(std::ptr::null_mut(), screen);
        if excluded {
            SetWindowDisplayAffinity(hwnd, WDA_NONE);
        }
        result
    }
}

#[cfg(not(windows))]
fn grab(_hwnd: isize) -> Result<Vec<u8>, String> {
    Err("capture disponible sous Windows uniquement".into())
}
