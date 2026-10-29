//! Configuration modifiable par l'utilisateur : `%APPDATA%\com.patrice.neonink\config.json`.
//!
//! Le fichier est créé avec les valeurs d'origine au premier lancement, puis surveillé :
//! chaque enregistrement est appliqué aussitôt (raccourci global réenregistré, interface prévenue).
//! Les clés absentes reprennent leur valeur d'origine, si bien qu'un fichier partiel reste valable.

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

const DEFAULT: &str = include_str!("../../src/config.default.json");

pub struct Config {
    current: Mutex<Value>,
}

impl Config {
    pub fn new(app: &AppHandle) -> Self {
        Self { current: Mutex::new(read(app)) }
    }
}

pub fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("config.json"))
}

/// Crée le fichier avec les valeurs d'origine s'il n'existe pas encore.
pub fn ensure_file(app: &AppHandle) -> Option<PathBuf> {
    let p = path(app)?;
    if !p.exists() {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&p, DEFAULT);
    }
    Some(p)
}

/// Valeurs d'origine complétées par le fichier de l'utilisateur. `erreurs` liste les problèmes trouvés.
fn read(app: &AppHandle) -> Value {
    let mut config: Value = serde_json::from_str(DEFAULT).expect("config.default.json invalide");
    let mut errors: Vec<String> = Vec::new();

    if let Some(text) = ensure_file(app).and_then(|p| std::fs::read_to_string(p).ok()) {
        match serde_json::from_str::<Value>(&text) {
            Ok(user) => {
                if let Some(keys) = user.get("raccourcis").and_then(Value::as_object) {
                    for (action, combo) in keys {
                        config["raccourcis"][action] = combo.clone();
                    }
                }
                if let Some(links) = user.get("liens").filter(|l| l.is_array()) {
                    config["liens"] = links.clone();
                }
            }
            Err(e) => errors.push(format!("config.json illisible (ligne {}) : réglages d'origine utilisés", e.line())),
        }
    }

    if global_shortcut(&config).is_none() {
        errors.push("Raccourci « basculerDessin » invalide : F10 utilisé".into());
    }
    config["erreurs"] = json!(errors);
    config
}

/// Premier raccourci valide de « basculerDessin ».
fn global_shortcut(config: &Value) -> Option<Shortcut> {
    let combos = match &config["raccourcis"]["basculerDessin"] {
        Value::String(s) => vec![s.clone()],
        Value::Array(list) => list.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
        _ => vec![],
    };
    combos.iter().find_map(|c| Shortcut::from_str(&c.replace("Échap", "Escape").replace("Maj", "Shift")).ok())
}

/// Enregistre le raccourci global (F10 par défaut) selon la configuration.
pub fn register_global_shortcut(app: &AppHandle, config: &Value) {
    let shortcut = global_shortcut(config).unwrap_or_else(|| Shortcut::from_str("F10").unwrap());
    let manager = app.global_shortcut();
    let _ = manager.unregister_all();
    if let Err(e) = manager.register(shortcut) {
        eprintln!("raccourci global indisponible : {e}");
    }
}

pub fn get_config_value(config: &Config) -> Value {
    config.current.lock().unwrap().clone()
}

#[tauri::command]
pub fn get_config(state: State<Config>) -> Value {
    get_config_value(&state)
}

/// Les liens ouverts depuis l'interface doivent figurer dans la configuration.
#[tauri::command]
pub fn open_link(state: State<Config>, url: String) {
    let allowed = state.current.lock().unwrap()["liens"]
        .as_array()
        .is_some_and(|links| links.iter().any(|l| l["url"].as_str() == Some(url.as_str())));
    if allowed && (url.starts_with("https://") || url.starts_with("http://")) {
        open(&url);
    }
}

/// Ouvre le fichier de configuration dans le Bloc-notes (ou l'éditeur par défaut ailleurs).
pub fn edit(app: &AppHandle) {
    let Some(p) = ensure_file(app) else { return };
    #[cfg(windows)]
    let _ = std::process::Command::new("notepad.exe").arg(&p).spawn();
    #[cfg(not(windows))]
    open(&p.to_string_lossy());
}

fn open(target: &str) {
    #[cfg(windows)]
    let _ = std::process::Command::new("explorer.exe").arg(target).spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(target).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(target).spawn();
}

/// Surveille le fichier et applique chaque modification.
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        let modified = |app: &AppHandle| -> Option<SystemTime> {
            std::fs::metadata(path(app)?).and_then(|m| m.modified()).ok()
        };
        let mut last = modified(&app);
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            let now = modified(&app);
            if now == last {
                continue;
            }
            last = now;
            let config = read(&app);
            register_global_shortcut(&app, &config);
            *app.state::<Config>().current.lock().unwrap() = config.clone();
            let _ = app.emit("config-changed", config);
        }
    });
}
