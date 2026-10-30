//! Plugins téléchargés à la demande depuis les releases GitHub de NeonInk.
//!
//! Le catalogue `plugins.json` et les fichiers `plugin-<id>.js` sont publiés avec chaque
//! release (voir scripts/build-plugins.js). Un plugin installé est rangé dans
//! `%APPDATA%\com.patrice.neonink\plugins` : `<id>.js` (le code) et `<id>.json` (sa fiche).
//! Seuls les fichiers des releases de ce dépôt sont acceptés.

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const CATALOG: &str = "https://github.com/pmaldi/neon-ink/releases/latest/download/plugins.json";
const DOWNLOADS: &str = "https://github.com/pmaldi/neon-ink/releases/download/";

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_config_dir().map_err(|e| e.to_string())?.join("plugins");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// Identifiant sûr pour un nom de fichier : minuscules, chiffres et tirets.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Plugins installés, avec leur code, pour les charger au démarrage.
#[tauri::command]
pub fn plugin_list(app: AppHandle) -> Result<Vec<Value>, String> {
    let d = dir(&app)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&d).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let manifest: Value = match std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()) {
            Some(m) => m,
            None => continue,
        };
        let Some(code) = std::fs::read_to_string(path.with_extension("js")).ok() else { continue };
        out.push(json!({ "manifest": manifest, "code": code }));
    }
    Ok(out)
}

fn catalog() -> Result<Vec<Value>, String> {
    let bytes = crate::system_update::curl(&[CATALOG])?;
    let list: Value = serde_json::from_slice(&bytes).map_err(|e| format!("catalogue illisible : {e}"))?;
    Ok(list.as_array().cloned().unwrap_or_default())
}

/// Catalogue des plugins de la dernière release.
#[tauri::command]
pub async fn plugin_catalog() -> Result<Vec<Value>, String> {
    catalog()
}

/// Télécharge et installe (ou met à jour) un plugin du catalogue.
#[tauri::command]
pub async fn plugin_install(app: AppHandle, id: String) -> Result<Value, String> {
    if !valid_id(&id) {
        return Err("plugin inconnu".into());
    }
    let entry = catalog()?
        .into_iter()
        .find(|e| e["id"].as_str() == Some(id.as_str()))
        .ok_or("plugin absent du catalogue")?;
    let url = entry["url"].as_str().ok_or("adresse manquante")?;
    if !url.starts_with(DOWNLOADS) {
        return Err("adresse de téléchargement refusée".into());
    }
    let code = String::from_utf8(crate::system_update::curl(&[url])?).map_err(|_| "fichier invalide")?;
    let d = dir(&app)?;
    std::fs::write(d.join(format!("{id}.js")), &code).map_err(|e| e.to_string())?;
    std::fs::write(d.join(format!("{id}.json")), serde_json::to_string_pretty(&entry).unwrap_or_default())
        .map_err(|e| e.to_string())?;
    Ok(json!({ "manifest": entry, "code": code }))
}

#[tauri::command]
pub fn plugin_remove(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("plugin inconnu".into());
    }
    let d = dir(&app)?;
    let _ = std::fs::remove_file(d.join(format!("{id}.js")));
    let _ = std::fs::remove_file(d.join(format!("{id}.json")));
    Ok(())
}
