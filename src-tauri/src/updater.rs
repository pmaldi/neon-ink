//! Mise à jour depuis les Releases GitHub.
//!
//! L'interface consulte GitHub au démarrage puis régulièrement, et signale ici la nouvelle
//! version. Avec les mises à jour automatiques (par défaut), elle est installée dès que
//! NeonInk est inactif : ni dessin en cours, ni tracé gardé en mémoire. Sinon l'entrée du
//! menu de l'icône propose de l'installer.
//!
//! Version installée (présence de `uninstall.exe`) : la tâche système créée par l'installateur
//! remplace l'exécutable sans demande d'autorisation (voir `system_update`), puis NeonInk
//! redémarre dès qu'il ne sert pas. Sans cette tâche (installation antérieure à 0.8.0),
//! l'installateur est lancé en mode passif (`/P /R`) et Windows demande les droits administrateur.
//! Version portable : l'exécutable se remplace lui-même puis redémarre.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};
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
    /// Version dont l'installation automatique a échoué ou a été refusée : on ne la relance pas seul.
    declined: Mutex<Option<String>>,
    busy: AtomicBool,
    auto: AtomicBool,
}

impl Updates {
    pub fn new(item: MenuItem<Wry>, auto: bool) -> Self {
        Self {
            item,
            pending: Mutex::new(None),
            declined: Mutex::new(None),
            busy: AtomicBool::new(false),
            auto: AtomicBool::new(auto),
        }
    }

    fn label(&self, text: &str) {
        let _ = self.item.set_text(text);
    }
}

#[derive(Serialize)]
pub struct UpdateConfig {
    /// `NEONINK_NO_UPDATE` désactive toute recherche (tests automatisés).
    enabled: bool,
}

#[tauri::command]
pub fn update_config() -> UpdateConfig {
    UpdateConfig { enabled: std::env::var_os("NEONINK_NO_UPDATE").is_none() }
}

#[tauri::command]
pub fn update_available(app: AppHandle, state: State<Updates>, update: Update) {
    if state.busy.load(Ordering::SeqCst) {
        return;
    }
    state.label(&format!("Installer la version {}", update.version));
    *state.pending.lock().unwrap() = Some(update);
    install_if_idle(&app);
}

#[tauri::command]
pub fn update_status(state: State<Updates>, text: String) {
    if !state.busy.load(Ordering::SeqCst) {
        state.label(&text);
    }
}

pub fn set_auto(app: &AppHandle, on: bool) {
    app.state::<Updates>().auto.store(on, Ordering::SeqCst);
    if on {
        install_if_idle(app);
    }
}

/// Installe la mise à jour en attente si les mises à jour automatiques sont actives
/// et que NeonInk ne sert pas en ce moment.
pub fn install_if_idle(app: &AppHandle) {
    let state = app.state::<Updates>();
    if !state.auto.load(Ordering::SeqCst) || !crate::is_idle() {
        return;
    }
    let Some(update) = state.pending.lock().unwrap().clone() else { return };
    if state.declined.lock().unwrap().as_deref() == Some(update.version.as_str()) {
        return;
    }
    start(app, update, false);
}

pub fn on_menu_click(app: &AppHandle) {
    let pending = app.state::<Updates>().pending.lock().unwrap().clone();
    match pending {
        Some(update) => start(app, update, true),
        None => {
            app.state::<Updates>().label("Recherche en cours…");
            let _ = app.emit("check-update", ());
        }
    }
}

fn start(app: &AppHandle, update: Update, manual: bool) {
    let state = app.state::<Updates>();
    if state.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    state.label(&format!("Téléchargement de la version {}…", update.version));
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(err) = install(&app, &update) {
            eprintln!("mise à jour impossible : {err}");
            // Demandée depuis le menu : on ouvre la page de téléchargement. Automatique : on
            // n'insiste pas, l'entrée du menu reste disponible.
            if manual {
                open_in_browser(&update.page);
            }
            let state = app.state::<Updates>();
            *state.declined.lock().unwrap() = Some(update.version.clone());
            state.label(&format!("Installer la version {}", update.version));
            state.busy.store(false, Ordering::SeqCst);
        }
    });
}

fn install(app: &AppHandle, update: &Update) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("dossier de l'exécutable introuvable")?;

    if dir.join("uninstall.exe").exists() {
        if silent_install(app, update, &exe, dir, manual)? {
            return Ok(());
        }
        let url = update.setup.as_deref().ok_or("pas d'installateur dans la release")?;
        let setup = std::env::temp_dir().join(format!("NeonInk_{}_setup.exe", update.version));
        download(url, &setup)?;
        // /P : installation passive, sans question. /R : relancer NeonInk à la fin.
        run_elevated(&setup, "/P /R")?;
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

fn modified(p: &Path) -> Option<SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// Mise à jour par la tâche système, sans demande d'autorisation. Faux si la tâche n'existe pas.
fn silent_install(app: &AppHandle, update: &Update, exe: &Path, dir: &Path, manual: bool) -> Result<bool, String> {
    let before = modified(exe);
    let since = SystemTime::now();
    if !crate::system_update::trigger() {
        return Ok(false);
    }
    let state = app.state::<Updates>();
    state.label(&format!("Installation de la version {}…", update.version));
    let deadline = Instant::now() + Duration::from_secs(600);
    while modified(exe) == before {
        std::thread::sleep(Duration::from_secs(1));
        match crate::system_update::status_since(dir, since) {
            Some(s) if s.starts_with("ok") => {}
            Some(s) => return Err(format!("tâche de mise à jour : {s}")),
            None if Instant::now() > deadline => return Err("tâche de mise à jour sans réponse".into()),
            None => {}
        }
    }
    // Le nouvel exécutable est en place : on redémarre dessus, sans interrompre un dessin.
    state.label(&format!("Version {} prête, redémarrage au prochain moment libre", update.version));
    while !manual && !crate::is_idle() {
        std::thread::sleep(Duration::from_secs(1));
    }
    Command::new(exe).arg(AFTER_UPDATE_ARG).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(true)
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
fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    s.encode_wide().chain(Some(0)).collect()
}

#[cfg(windows)]
fn download(url: &str, to: &Path) -> Result<(), String> {
    use windows_sys::Win32::System::Com::Urlmon::URLDownloadToFileW;

    let (url_w, to_w) = (wide(std::ffi::OsStr::new(url)), wide(to.as_os_str()));
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

/// Lance un programme qui exige les droits administrateur : Windows affiche sa demande
/// d'autorisation. `Command::spawn` échouerait (ERROR_ELEVATION_REQUIRED).
#[cfg(windows)]
fn run_elevated(program: &Path, args: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb = wide(std::ffi::OsStr::new("open"));
    let file = wide(program.as_os_str());
    let params = wide(std::ffi::OsStr::new(args));
    let code = unsafe {
        ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), file.as_ptr(), params.as_ptr(), std::ptr::null(), SW_SHOWNORMAL)
    } as isize;
    // Une valeur supérieure à 32 signale un succès ; sinon l'utilisateur a refusé ou le lancement a échoué.
    if code > 32 { Ok(()) } else { Err(format!("installateur non lancé (code {code})")) }
}

#[cfg(not(windows))]
fn download(_url: &str, _to: &Path) -> Result<(), String> {
    Err("mise à jour automatique disponible sous Windows uniquement".into())
}

#[cfg(not(windows))]
fn run_elevated(_program: &Path, _args: &str) -> Result<(), String> {
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
