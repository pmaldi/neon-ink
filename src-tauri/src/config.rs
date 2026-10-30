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

/// Touches ajoutées aux valeurs d'origine après coup. Une configuration existante les reçoit une
/// seule fois (notées dans `_ajouts`), si personne d'autre ne les utilise : retirées ensuite par
/// l'utilisateur, elles ne reviennent pas.
const ADDED_DEFAULTS: &[(&str, &str)] = &[("formes", "Mouse3")];

pub struct Config {
    current: Mutex<Value>,
}

impl Config {
    pub fn new(app: &AppHandle) -> Self {
        if let Some(p) = path(app) {
            add_new_defaults(&p);
        }
        Self { current: Mutex::new(read(app)) }
    }
}

/// Ajoute à config.json les touches de `ADDED_DEFAULTS` pas encore proposées. Rend vrai si modifié.
fn add_new_defaults(p: &std::path::Path) -> bool {
    let Some(mut user) = std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
        return false;
    };
    if !migrate(&mut user) {
        return false;
    }
    serde_json::to_string_pretty(&user).ok().is_some_and(|t| std::fs::write(p, t).is_ok())
}

fn migrate(user: &mut Value) -> bool {
    let Some(obj) = user.as_object_mut() else { return false };
    let done: Vec<String> = obj
        .get("_ajouts")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let mut changed = false;
    for (action, combo) in ADDED_DEFAULTS {
        let mark = format!("{action}:{combo}");
        if done.contains(&mark) {
            continue;
        }
        changed = true;
        let keys = obj.entry("raccourcis").or_insert_with(|| json!({}));
        let Some(keys) = keys.as_object_mut() else { continue };
        let used = keys.values().any(|v| match v {
            Value::String(s) => s.eq_ignore_ascii_case(combo),
            Value::Array(list) => list.iter().any(|x| x.as_str().is_some_and(|s| s.eq_ignore_ascii_case(combo))),
            _ => false,
        });
        // Une action absente du fichier reprend déjà les valeurs d'origine, nouveauté comprise.
        if !used {
            if let Some(current) = keys.get_mut(*action) {
                let mut list = match current.take() {
                    Value::Array(list) => list,
                    Value::String(s) => vec![Value::String(s)],
                    _ => vec![],
                };
                list.push(json!(combo));
                *current = Value::Array(list);
            }
        }
        let marks = obj.entry("_ajouts").or_insert_with(|| json!([]));
        if let Some(list) = marks.as_array_mut() {
            list.push(json!(mark));
        }
    }
    changed
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

fn register(app: &AppHandle, shortcut: Shortcut) -> Result<(), String> {
    let manager = app.global_shortcut();
    let _ = manager.unregister_all();
    manager.register(shortcut).map_err(|e| format!("touche déjà prise par une autre application ({e})"))
}

/// Enregistre le raccourci global (F10 par défaut) selon la configuration.
pub fn register_global_shortcut(app: &AppHandle, config: &Value) {
    let shortcut = global_shortcut(config).unwrap_or_else(|| Shortcut::from_str("F10").unwrap());
    if let Err(e) = register(app, shortcut) {
        eprintln!("raccourci global indisponible : {e}");
    }
}

/// Remplace la section `raccourcis` de config.json en gardant le reste du fichier (liens…).
fn write_shortcuts(app: &AppHandle, shortcuts: &Value) -> Result<(), String> {
    let p = ensure_file(app).ok_or("dossier de configuration introuvable")?;
    let mut user = std::fs::read_to_string(&p)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| serde_json::from_str(DEFAULT).unwrap());
    user["raccourcis"] = shortcuts.clone();
    let text = serde_json::to_string_pretty(&user).map_err(|e| e.to_string())?;
    std::fs::write(&p, text).map_err(|e| format!("config.json non enregistré ({e})"))
}

/// Applique et enregistre les raccourcis modifiés depuis l'aide. Le raccourci global est
/// vérifié d'abord : s'il est refusé, rien n'est changé.
fn apply_shortcuts(app: &AppHandle, state: &Config, shortcuts: Value) -> Result<Value, String> {
    let previous = state.current.lock().unwrap().clone();
    let mut config = previous.clone();
    config["raccourcis"] = shortcuts;
    let shortcut = global_shortcut(&config).ok_or("cette touche ne peut pas servir de raccourci global")?;
    if let Err(e) = register(app, shortcut) {
        register_global_shortcut(app, &previous);
        return Err(e);
    }
    write_shortcuts(app, &config["raccourcis"])?;
    config["erreurs"] = json!([]);
    *state.current.lock().unwrap() = config.clone();
    Ok(config)
}

#[tauri::command]
pub fn save_shortcuts(app: AppHandle, state: State<Config>, raccourcis: Value) -> Result<Value, String> {
    apply_shortcuts(&app, &state, raccourcis)
}

#[tauri::command]
pub fn reset_shortcuts(app: AppHandle, state: State<Config>) -> Result<Value, String> {
    let defaults: Value = serde_json::from_str(DEFAULT).unwrap();
    apply_shortcuts(&app, &state, defaults["raccourcis"].clone())
}

/// Pendant la saisie d'une nouvelle touche dans l'aide, le raccourci global est libéré :
/// sinon Windows intercepterait F10 avant l'interface.
#[tauri::command]
pub fn capture_shortcut(app: AppHandle, state: State<Config>, on: bool) {
    if on {
        let _ = app.global_shortcut().unregister_all();
    } else {
        register_global_shortcut(&app, &state.current.lock().unwrap());
    }
}

#[tauri::command]
pub fn open_config_file(app: AppHandle) {
    edit(&app);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_default_added_once() {
        let mut user = json!({ "raccourcis": { "formes": "M", "stylo": "D" } });
        assert!(migrate(&mut user));
        assert_eq!(user["raccourcis"]["formes"], json!(["M", "Mouse3"]));
        assert_eq!(user["_ajouts"], json!(["formes:Mouse3"]));
        // Retirée ensuite par l'utilisateur : elle ne revient pas.
        user["raccourcis"]["formes"] = json!("M");
        assert!(!migrate(&mut user));
        assert_eq!(user["raccourcis"]["formes"], json!("M"));
    }

    #[test]
    fn new_default_not_stolen() {
        let mut user = json!({ "raccourcis": { "formes": "M", "reseau.reseau": ["J", "mouse3"] } });
        assert!(migrate(&mut user));
        assert_eq!(user["raccourcis"]["formes"], json!("M"));
        assert_eq!(user["raccourcis"]["reseau.reseau"], json!(["J", "mouse3"]));
    }
}
