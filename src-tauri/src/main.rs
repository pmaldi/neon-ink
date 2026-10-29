// Pas de console noire en version finale sous Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, Shortcut, ShortcutState};

static DRAW_MODE: AtomicBool = AtomicBool::new(false);

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

/// Active le dessin (le calque capte souris et clavier) ou le désactive
/// (le calque devient « transparent aux clics » mais les tracés restent visibles).
fn apply_draw_mode(app: &AppHandle, on: bool) {
    DRAW_MODE.store(on, Ordering::SeqCst);
    if let Some(win) = overlay(app) {
        if on {
            fit_to_cursor_monitor(&win);
            let _ = win.show();
            let _ = win.set_ignore_cursor_events(false);
            let _ = win.set_always_on_top(true);
            let _ = win.set_focus();
        } else {
            let _ = win.set_ignore_cursor_events(true);
        }
    }
    let _ = app.emit("draw-mode", on);
}

fn toggle_draw_mode(app: &AppHandle) {
    apply_draw_mode(app, !DRAW_MODE.load(Ordering::SeqCst));
}

#[tauri::command]
fn set_draw_mode(app: AppHandle, on: bool) {
    apply_draw_mode(&app, on);
}

/// Appelé par l'interface quand il n'y a plus rien à afficher : on masque la fenêtre
/// pour ne gêner aucune autre application.
#[tauri::command]
fn hide_overlay(app: AppHandle) {
    if !DRAW_MODE.load(Ordering::SeqCst) {
        if let Some(win) = overlay(&app) {
            let _ = win.hide();
        }
    }
}

fn main() {
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
        .invoke_handler(tauri::generate_handler![set_draw_mode, hide_overlay])
        .on_window_event(|window, event| {
            // Alt+F4 ne ferme pas l'application : il quitte seulement le mode dessin.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                apply_draw_mode(window.app_handle(), false);
            }
        })
        .setup(|app| {
            let toggle = MenuItem::with_id(app, "toggle", "Dessiner  (F10)", true, None::<&str>)?;
            let clear = MenuItem::with_id(app, "clear", "Tout effacer", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter NeonInk", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &clear, &separator, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("NeonInk — F10 pour dessiner")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_draw_mode(app),
                    "clear" => {
                        let _ = app.emit("clear-all", ());
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
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de NeonInk");
}
