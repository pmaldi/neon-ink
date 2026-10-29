// Pas de console noire en version finale sous Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod updater;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent,
};
use serde_json::json;
use tauri_plugin_global_shortcut::{Code, Shortcut, ShortcutState};

static DRAW_MODE: AtomicBool = AtomicBool::new(false);
/// Vrai quand le calque n'a plus aucun tracé : au prochain F10, il suit l'écran de la souris.
/// Sinon il revient sur l'écran où les tracés ont été faits.
static EMPTY: AtomicBool = AtomicBool::new(true);

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
    let _ = win.set_size(PhysicalSize::new(m.size().width, m.size().height));
}

/// Active le dessin (le calque capte souris et clavier) ou le désactive.
/// Désactivé, le calque est masqué et ses tracés gardés en mémoire pour le prochain F10,
/// sauf avec `keep_visible` (Échap) : les tracés finissent de se consumer, transparents aux clics.
fn apply_draw_mode(app: &AppHandle, on: bool, keep_visible: bool) {
    DRAW_MODE.store(on, Ordering::SeqCst);
    if let Some(win) = overlay(app) {
        if on {
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
            if !keep_visible {
                let _ = win.hide();
            }
            #[cfg(windows)]
            focus::restore();
        }
    }
    let _ = app.emit("draw-mode", json!({ "on": on, "keepVisible": keep_visible }));
}

fn toggle_draw_mode(app: &AppHandle) {
    apply_draw_mode(app, !DRAW_MODE.load(Ordering::SeqCst), false);
}

#[tauri::command]
fn set_draw_mode(app: AppHandle, on: bool, keep_visible: Option<bool>) {
    apply_draw_mode(&app, on, keep_visible.unwrap_or(false));
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
    }
}

fn main() {
    // Après une mise à jour portable, l'ancienne version doit d'abord libérer F10.
    if std::env::args().any(|a| a == updater::AFTER_UPDATE_ARG) {
        std::thread::sleep(std::time::Duration::from_millis(1500));
    }

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut(Shortcut::new(None, Code::F10))
                .expect("raccourci F10 invalide")
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
            let toggle = MenuItem::with_id(app, "toggle", "Dessiner  (F10)", true, None::<&str>)?;
            let clear = MenuItem::with_id(app, "clear", "Tout effacer", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "update", updater::CHECK_LABEL, true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter NeonInk", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &toggle,
                    &clear,
                    &PredefinedMenuItem::separator(app)?,
                    &update,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?;
            app.manage(updater::Updates::new(update));
            updater::cleanup_previous_version();

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("NeonInk — F10 pour dessiner")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_draw_mode(app),
                    "clear" => {
                        let _ = app.emit("clear-all", ());
                    }
                    "update" => updater::on_menu_click(app),
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
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de NeonInk");
}
