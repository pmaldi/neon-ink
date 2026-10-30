// Pas de console noire en version finale sous Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;
mod config;
mod plugins;
mod settings;
mod system_update;
mod updater;

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::ShortcutState;

static DRAW_MODE: AtomicBool = AtomicBool::new(false);
/// Vrai quand le calque n'a plus aucun tracé : au prochain F10, il suit l'écran de la souris.
/// Sinon il revient sur l'écran où les tracés ont été faits.
static EMPTY: AtomicBool = AtomicBool::new(true);
/// Un calque de plugin est affiché (minuteur…) : F10 ne masque pas la fenêtre, il la rend
/// seulement transparente aux clics.
static OVERLAY_SHOWN: AtomicBool = AtomicBool::new(false);
/// F10 a laissé la fenêtre visible à cause d'un calque : elle sera masquée quand il disparaîtra.
static HIDE_AFTER_OVERLAY: AtomicBool = AtomicBool::new(false);

/// Rien en cours : ni dessin, ni tracé gardé en mémoire. Une mise à jour peut redémarrer l'application.
pub fn is_idle() -> bool {
    !DRAW_MODE.load(Ordering::SeqCst) && EMPTY.load(Ordering::SeqCst)
}

/// Sous Windows, on mémorise la fenêtre active avant de prendre la main, pour lui
/// rendre le clavier en quittant le dessin (sinon la frappe semble « gelée »).
#[cfg(windows)]
mod focus {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

    static PREVIOUS: AtomicIsize = AtomicIsize::new(0);

    pub fn remember(own: isize) {
        let current = unsafe { GetForegroundWindow() } as isize;
        if current != 0 && current != own {
            PREVIOUS.store(current, Ordering::SeqCst);
        }
    }

    pub fn restore() {
        let previous = PREVIOUS.swap(0, Ordering::SeqCst);
        if previous != 0 {
            unsafe { SetForegroundWindow(previous as _) };
        }
    }
}

/// Le calque doit rester une « fenêtre outil » (WS_EX_TOOLWINDOW).
///
/// Chrome, Edge, Teams, Discord, VS Code… cessent de se dessiner quand une fenêtre opaque
/// les recouvre entièrement : leur image se fige. Ils ignorent toutefois les fenêtres
/// transparentes aux clics et les fenêtres outils. En mode dessin le calque capte les clics,
/// il doit donc être une fenêtre outil. Comme Tauri réécrit tous les styles à chaque
/// changement d'état (afficher, masquer, transparence aux clics), on intercepte ces
/// réécritures pour y remettre WS_EX_TOOLWINDOW.
#[cfg(windows)]
mod tool_window {
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, STYLESTRUCT, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WM_STYLECHANGING, WS_EX_APPWINDOW,
        WS_EX_TOOLWINDOW,
    };

    unsafe extern "system" fn keep_tool_style(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if msg == WM_STYLECHANGING && wparam as i32 == GWL_EXSTYLE {
            let style = &mut *(lparam as *mut STYLESTRUCT);
            style.styleNew = (style.styleNew | WS_EX_TOOLWINDOW) & !WS_EX_APPWINDOW;
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    /// À appeler depuis le fil principal (celui qui possède la fenêtre).
    pub fn install(hwnd: isize) {
        let hwnd = hwnd as HWND;
        unsafe {
            SetWindowSubclass(hwnd, Some(keep_tool_style), 1, 0);
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW as isize);
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

fn overlay(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("overlay")
}

/// Place le calque sur l'écran où se trouve la souris (multi-écrans).
fn fit_to_cursor_monitor(win: &WebviewWindow) {
    let Ok(monitors) = win.available_monitors() else { return };
    let under_cursor = win.cursor_position().ok().and_then(|c| {
        monitors
            .iter()
            .find(|m| {
                let (p, s) = (m.position(), m.size());
                c.x >= p.x as f64
                    && c.x < p.x as f64 + s.width as f64
                    && c.y >= p.y as f64
                    && c.y < p.y as f64 + s.height as f64
            })
            .cloned()
    });
    let Some(m) = under_cursor.or_else(|| win.primary_monitor().ok().flatten()) else { return };
    let _ = win.set_position(PhysicalPosition::new(m.position().x, m.position().y));
    // Un pixel de moins que l'écran : une fenêtre sans bordure qui le couvre exactement est
    // prise pour un jeu en plein écran, ce qui peut changer la façon dont Windows compose l'affichage.
    let _ = win.set_size(PhysicalSize::new(m.size().width, m.size().height.saturating_sub(1)));
}

/// Active le dessin (le calque capte souris et clavier) ou le désactive.
/// Désactivé, le calque est masqué et ses tracés gardés en mémoire pour le prochain F10,
/// sauf avec `keep_visible` (Échap) : les tracés finissent de se consumer, transparents aux clics.
fn apply_draw_mode(app: &AppHandle, on: bool, keep_visible: bool) {
    DRAW_MODE.store(on, Ordering::SeqCst);
    if let Some(win) = overlay(app) {
        if on {
            HIDE_AFTER_OVERLAY.store(false, Ordering::SeqCst);
            #[cfg(windows)]
            focus::remember(win.hwnd().map(|h| h.0 as isize).unwrap_or(0));
            if EMPTY.swap(false, Ordering::SeqCst) {
                fit_to_cursor_monitor(&win);
            }
            let _ = win.show();
            let _ = win.set_ignore_cursor_events(false);
            let _ = win.set_always_on_top(true);
            let _ = win.set_focus();
        } else {
            let _ = win.set_ignore_cursor_events(true);
            let hide = !keep_visible;
            let overlay_shown = OVERLAY_SHOWN.load(Ordering::SeqCst);
            HIDE_AFTER_OVERLAY.store(hide && overlay_shown, Ordering::SeqCst);
            if hide && !overlay_shown {
                let _ = win.hide();
            }
            #[cfg(windows)]
            focus::restore();
        }
    }
    let _ = app.emit("draw-mode", json!({ "on": on, "keepVisible": keep_visible }));
    if !on {
        updater::install_if_idle(app);
    }
}

fn toggle_draw_mode(app: &AppHandle) {
    apply_draw_mode(app, !DRAW_MODE.load(Ordering::SeqCst), false);
}

#[tauri::command]
fn set_draw_mode(app: AppHandle, on: bool, keep_visible: Option<bool>) {
    apply_draw_mode(&app, on, keep_visible.unwrap_or(false));
}

/// L'interface signale qu'un calque de plugin est affiché, ou ne l'est plus.
#[tauri::command]
fn overlay_shown(app: AppHandle, on: bool) {
    OVERLAY_SHOWN.store(on, Ordering::SeqCst);
    if !on && !DRAW_MODE.load(Ordering::SeqCst) && HIDE_AFTER_OVERLAY.swap(false, Ordering::SeqCst) {
        if let Some(win) = overlay(&app) {
            let _ = win.hide();
        }
    }
}

/// Appelé par l'interface quand il n'y a plus rien à afficher : on masque la fenêtre
/// pour ne gêner aucune autre application.
#[tauri::command]
fn hide_overlay(app: AppHandle) {
    if !DRAW_MODE.load(Ordering::SeqCst) {
        EMPTY.store(true, Ordering::SeqCst);
        if let Some(win) = overlay(&app) {
            let _ = win.hide();
        }
        updater::install_if_idle(&app);
    }
}

fn main() {
    // Modes sans interface : tâche de mise à jour (compte système), installation de cette tâche.
    if let Some(code) = system_update::run_cli() {
        std::process::exit(code);
    }

    // Après une mise à jour, l'ancienne version doit d'abord se fermer : sinon la protection
    // « une seule instance » croirait NeonInk déjà lancé et fermerait la nouvelle version.
    if std::env::args().any(|a| a == updater::AFTER_UPDATE_ARG) {
        updater::wait_for_previous_version();
    }

    tauri::Builder::default()
        // Relancer NeonInk alors qu'il tourne déjà (menu Démarrer…) active simplement le dessin.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            apply_draw_mode(app, true, false);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            // Le raccourci lui-même (F10 par défaut) vient de config.json : voir config::register_global_shortcut.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_draw_mode(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_draw_mode,
            hide_overlay,
            overlay_shown,
            capture::capture_screen,
            capture::save_capture,
            capture::open_captures,
            config::get_config,
            config::open_link,
            plugins::plugin_list,
            plugins::plugin_catalog,
            plugins::plugin_install,
            plugins::plugin_remove,
            config::save_shortcuts,
            config::reset_shortcuts,
            config::capture_shortcut,
            config::open_config_file,
            updater::update_config,
            updater::update_available,
            updater::update_status
        ])
        .on_window_event(|window, event| {
            // Alt+F4 ne ferme pas l'application : il quitte seulement le mode dessin.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                apply_draw_mode(window.app_handle(), false, false);
            }
        })
        .setup(|app| {
            let config = config::Config::new(app.handle());
            config::register_global_shortcut(app.handle(), &config::get_config_value(&config));
            app.manage(config);
            config::watch(app.handle().clone());

            let mut settings = settings::Settings::load(app.handle());
            let autostart = app.autolaunch();
            if !settings.first_run_done {
                // Premier lancement : NeonInk démarre avec Windows (décochable dans le menu de l'icône).
                settings.first_run_done = true;
                settings.save(app.handle());
                let _ = autostart.enable();
            } else if autostart.is_enabled().unwrap_or(false) {
                // Le chemin de l'exécutable peut avoir changé (passage à Program Files) : on le réécrit.
                let _ = autostart.enable();
            }

            let version = app.package_info().version.to_string();
            let toggle = MenuItem::with_id(app, "toggle", "Dessiner", true, None::<&str>)?;
            let clear = MenuItem::with_id(app, "clear", "Tout effacer", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "update", updater::CHECK_LABEL, true, None::<&str>)?;
            let auto_update = CheckMenuItem::with_id(
                app,
                "auto-update",
                "Installer les mises à jour automatiquement",
                true,
                settings.auto_update,
                None::<&str>,
            )?;
            let shortcuts = MenuItem::with_id(app, "shortcuts", "Aide, raccourcis et plugins…", true, None::<&str>)?;
            let launch_at_login = CheckMenuItem::with_id(
                app,
                "autostart",
                "Lancer avec Windows",
                true,
                autostart.is_enabled().unwrap_or(false),
                None::<&str>,
            )?;
            let about = MenuItem::with_id(app, "about", format!("NeonInk {version}"), false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter NeonInk", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &toggle,
                    &clear,
                    &PredefinedMenuItem::separator(app)?,
                    &update,
                    &auto_update,
                    &launch_at_login,
                    &shortcuts,
                    &PredefinedMenuItem::separator(app)?,
                    &about,
                    &quit,
                ],
            )?;
            app.manage(updater::Updates::new(update, settings.auto_update));
            updater::cleanup_previous_version();

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip(format!("NeonInk {version} — F10 pour dessiner"))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "toggle" => toggle_draw_mode(app),
                    "clear" => {
                        let _ = app.emit("clear-all", ());
                    }
                    "update" => updater::on_menu_click(app),
                    "shortcuts" => {
                        // L'aide s'ouvre en mode dessin : chaque touche s'y modifie d'un clic.
                        apply_draw_mode(app, true, false);
                        let _ = app.emit("open-help", ());
                    }
                    "auto-update" => {
                        let on = auto_update.is_checked().unwrap_or(true);
                        let mut s = settings::Settings::load(app);
                        s.auto_update = on;
                        s.save(app);
                        updater::set_auto(app, on);
                    }
                    "autostart" => {
                        let launcher = app.autolaunch();
                        let on = launch_at_login.is_checked().unwrap_or(false);
                        let _ = if on { launcher.enable() } else { launcher.disable() };
                        let _ = launch_at_login.set_checked(launcher.is_enabled().unwrap_or(on));
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_draw_mode(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            if let Some(win) = overlay(app.handle()) {
                win.set_ignore_cursor_events(true)?;
                #[cfg(windows)]
                if let Ok(hwnd) = win.hwnd() {
                    tool_window::install(hwnd.0 as isize);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de NeonInk");
}
