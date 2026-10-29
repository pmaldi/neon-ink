//! Mise à jour depuis les Releases GitHub.
//!
//! L'interface consulte GitHub et signale ici la nouvelle version ; l'entrée du menu de
//! l'icône propose alors de l'installer. Version installée (présence de `uninstall.exe`) :
//! on télécharge et lance l'installateur. Version portable : on remplace l'exécutable
//! lui-même, puis on relance. En cas d'échec, la page de la release s'ouvre dans le navigateur.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{menu::MenuItem, AppHandle, Emitter, Manager, State, Wry};

pub const CHECK_LABEL: &str = "Rechercher une mise à jour";
/// Argument passé à la nouvelle version portable : elle attend que l'ancienne soit fermée.
pub const AFTER_UPDATE_ARG: &str = "--after-update";

#[derive(Clone, Deserialize)]
pub struct Update {
    version: String,
    page: String,
    setup: Option<String>,
    portable: Option<String>,
}

pub struct Updates {
    item: MenuItem<Wry>,
    pending: Mutex<Option<Update>>,
    busy: AtomicBool,
}

impl Updates {
    pub fn new(item: MenuItem<Wry>) -> Self {
        Self { item, pending: Mutex::new(None), busy: AtomicBool::new(false) }
    }

    fn label(&self, text: &str) {
        let _ = self.item.set_text(text);
    }
}

#[tauri::command]
pub fn update_available(state: State<Updates>, update: Update) {
    if state.busy.load(Ordering::SeqCst) {
        return;
    }
    state.label(&format!("Installer la version {}", update.version));
    *state.pending.lock().unwrap() = Some(update);
}

#[tauri::command]
pub fn update_status(state: State<Updates>, text: String) {
    if !state.busy.load(Ordering::SeqCst) {
        state.label(&text);
    }
}

pub fn on_menu_click(app: &AppHandle) {
    let state = app.state::<Updates>();
    if state.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let pending = state.pending.lock().unwrap().clone();
    match pending {
        Some(update) => {
            state.label(&format!("Téléchargement de la version {}…", update.version));
            let app = app.clone();
            std::thread::spawn(move || {
                if let Err(err) = install(&app, &update) {
                    eprintln!("mise à jour impossible : {err}");
                    open_in_browser(&update.page);
                    let state = app.state::<Updates>();
                    state.label(&format!("Installer la version {}", update.version));
                    state.busy.store(false, Ordering::SeqCst);
                }
            });
        }
        None => {
            state.label("Recherche en cours…");
            state.busy.store(false, Ordering::SeqCst);
            let _ = app.emit("check-update", ());
        }
    }
}

fn install(app: &AppHandle, update: &Update) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("dossier de l'exécutable introuvable")?;

    if dir.join("uninstall.exe").exists() {
        let url = update.setup.as_deref().ok_or("pas d'installateur dans la release")?;
        let setup = std::env::temp_dir().join(format!("NeonInk_{}_setup.exe", update.version));
        download(url, &setup)?;
        Command::new(&setup).spawn().map_err(|e| e.to_string())?;
    } else {
        let url = update.portable.as_deref().ok_or("pas d'exécutable portable dans la release")?;
        let fresh = exe.with_extension("new");
        download(url, &fresh)?;
        // Windows autorise à renommer un exécutable en cours d'utilisation.
        let old = old_path(&exe);
        let _ = std::fs::remove_file(&old);
        std::fs::rename(&exe, &old).map_err(|e| e.to_string())?;
        if let Err(e) = std::fs::rename(&fresh, &exe) {
            let _ = std::fs::rename(&old, &exe);
            return Err(e.to_string());
        }
        Command::new(&exe).arg(AFTER_UPDATE_ARG).spawn().map_err(|e| e.to_string())?;
    }
    app.exit(0);
    Ok(())
}

fn old_path(exe: &Path) -> PathBuf {
    exe.with_extension("old")
}

/// Supprime l'ancien exécutable laissé par une mise à jour portable.
pub fn cleanup_previous_version() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(old_path(&exe));
    }
}

#[cfg(windows)]
fn download(url: &str, to: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Com::Urlmon::URLDownloadToFileW;

    let wide = |s: &std::ffi::OsStr| s.encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let url_w = wide(std::ffi::OsStr::new(url));
    let to_w = wide(to.as_os_str());
    let hr = unsafe {
        URLDownloadToFileW(std::ptr::null_mut(), url_w.as_ptr(), to_w.as_ptr(), 0, std::ptr::null_mut())
    };
    if hr == 0 {
        Ok(())
    } else {
        let _ = std::fs::remove_file(to);
        Err(format!("téléchargement échoué (0x{:08X})", hr as u32))
    }
}

#[cfg(not(windows))]
fn download(_url: &str, _to: &Path) -> Result<(), String> {
    Err("mise à jour automatique disponible sous Windows uniquement".into())
}

fn open_in_browser(url: &str) {
    #[cfg(windows)]
    let _ = Command::new("explorer.exe").arg(url).spawn();
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = Command::new("xdg-open").arg(url).spawn();
}
