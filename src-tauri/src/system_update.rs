//! Mise à jour silencieuse de la version installée dans Program Files.
//!
//! Remplacer un fichier de Program Files demande les droits administrateur. Pour ne pas
//! afficher la demande d'autorisation de Windows à chaque version, l'installateur (qui a
//! ces droits) crée une tâche planifiée exécutée par le compte système, que tout utilisateur
//! a le droit de lancer. Comme les services de mise à jour de Chrome ou Edge :
//!
//! - l'application lance la tâche (`trigger`) quand une version plus récente existe ;
//! - la tâche (`NeonInk.exe --system-update`) consulte elle-même la dernière release GitHub,
//!   télécharge l'exécutable dans le dossier d'installation et le met à la place de l'ancien
//!   (un exécutable en cours d'utilisation peut être renommé) ;
//! - l'application voit le nouveau fichier et redémarre dessus dès qu'elle ne sert pas.
//!
//! La tâche ne reçoit aucun paramètre de l'utilisateur : elle ne télécharge que depuis le dépôt
//! GitHub de NeonInk, ou depuis l'adresse `UpdateUrl` de HKLM\Software\NeonInk (modifiable par
//! un administrateur seulement, pour les tests).

use std::path::{Path, PathBuf};
use std::process::Command;

pub const TASK_NAME: &str = "NeonInk Update";
pub const RUN_ARG: &str = "--system-update";
pub const REGISTER_ARG: &str = "--register-update-task";
pub const UNREGISTER_ARG: &str = "--unregister-update-task";
const API: &str = "https://api.github.com/repos/pmaldi/neon-ink/releases/latest";
/// Résultat de la dernière exécution de la tâche, lu par l'application.
pub const STATUS_FILE: &str = "update-status.txt";

/// Modes en ligne de commande, traités avant le démarrage de l'interface. Rend le code de sortie.
pub fn run_cli() -> Option<i32> {
    let arg = std::env::args().nth(1)?;
    let result = match arg.as_str() {
        RUN_ARG => run(),
        REGISTER_ARG => register(),
        UNREGISTER_ARG => schtasks(&["/Delete", "/TN", TASK_NAME, "/F"]).map(|_| ()),
        _ => return None,
    };
    Some(match result {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e}");
            1
        }
    })
}

/// Commande sans fenêtre de console.
fn hidden(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn system32(exe: &str) -> PathBuf {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    Path::new(&root).join("System32").join(exe)
}

fn schtasks(args: &[&str]) -> Result<String, String> {
    let out = hidden(system32("schtasks.exe")).args(args).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(format!("schtasks {} : {}", args[0], String::from_utf8_lossy(&out.stderr).trim()))
    }
}

// ───────────────────────── Côté application ─────────────────────────

/// Lance la tâche de mise à jour. Faux si elle n'existe pas (installation antérieure à 0.8.0).
pub fn trigger() -> bool {
    schtasks(&["/Run", "/TN", TASK_NAME]).is_ok()
}

/// Dernier résultat écrit par la tâche après `since`, s'il y en a un.
pub fn status_since(dir: &Path, since: std::time::SystemTime) -> Option<String> {
    let p = dir.join(STATUS_FILE);
    let modified = std::fs::metadata(&p).and_then(|m| m.modified()).ok()?;
    if modified < since {
        return None;
    }
    std::fs::read_to_string(p).ok().map(|s| s.trim().to_string())
}

// ───────────────────────── Installation de la tâche ─────────────────────────

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Définition de la tâche : compte système, lancement à la demande seulement (l'application
/// choisit le moment), et droit de la lancer pour tout utilisateur connecté (GRGX pour AU).
pub fn task_xml(exe: &Path) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>NeonInk</Author>
    <Description>Installe les nouvelles versions de NeonInk sans demander les droits administrateur. Lancée par NeonInk quand une mise à jour est disponible.</Description>
    <SecurityDescriptor>D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;AU)</SecurityDescriptor>
  </RegistrationInfo>
  <Principals>
    <Principal id="System">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="System">
    <Exec>
      <Command>"{}"</Command>
      <Arguments>{RUN_ARG}</Arguments>
    </Exec>
  </Actions>
</Task>
"#,
        xml_escape(&exe.to_string_lossy())
    )
}

/// Appelé par l'installateur (droits administrateur) : crée ou remplace la tâche.
fn register() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let xml = std::env::temp_dir().join("NeonInk-update-task.xml");
    // schtasks attend un fichier UTF-16 avec BOM.
    let mut bytes = vec![0xFF, 0xFE];
    bytes.extend(task_xml(&exe).encode_utf16().flat_map(u16::to_le_bytes));
    std::fs::write(&xml, bytes).map_err(|e| e.to_string())?;
    let result = schtasks(&["/Create", "/TN", TASK_NAME, "/XML", &xml.to_string_lossy(), "/F"]);
    let _ = std::fs::remove_file(&xml);
    result.map(|_| ())
}

// ───────────────────────── La tâche elle-même (compte système) ─────────────────────────

/// Compare deux versions « x.y.z » : vrai si `a` est plus récente que `b`.
pub fn newer(a: &str, b: &str) -> bool {
    let parse = |v: &str| v.trim_start_matches('v').split('.').map(|n| n.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parse(a) > parse(b)
}

fn run() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("dossier introuvable")?.to_path_buf();
    let result = update(&exe, &dir);
    let status = match &result {
        Ok(Some(v)) => format!("ok {v}"),
        Ok(None) => "a-jour".to_string(),
        Err(e) => format!("erreur {e}"),
    };
    let _ = std::fs::write(dir.join(STATUS_FILE), status);
    result.map(|_| ())
}

fn curl(args: &[&str]) -> Result<Vec<u8>, String> {
    let out = hidden(system32("curl.exe"))
        .args(["-fsSL", "--retry", "2", "--max-time", "300", "-A", "NeonInk-updater"])
        .args(args)
        .output()
        .map_err(|e| format!("curl : {e}"))?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        Err(format!("téléchargement échoué : {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}

/// Installe la dernière version si elle est plus récente. Rend la version installée.
fn update(exe: &Path, dir: &Path) -> Result<Option<String>, String> {
    if !dir.join("uninstall.exe").exists() {
        return Err("NeonInk n'est pas installé ici".into());
    }
    let api = registry_override().unwrap_or_else(|| API.to_string());
    let release: serde_json::Value =
        serde_json::from_slice(&curl(&[&api])?).map_err(|e| format!("réponse GitHub illisible : {e}"))?;
    let version = release["tag_name"].as_str().ok_or("version absente")?.trim_start_matches('v').to_string();
    if release["draft"].as_bool() == Some(true) || release["prerelease"].as_bool() == Some(true)
        || !newer(&version, env!("CARGO_PKG_VERSION"))
    {
        return Ok(None);
    }
    let url = release["assets"]
        .as_array()
        .and_then(|assets| {
            assets.iter().find(|a| a["name"].as_str().is_some_and(|n| n.to_lowercase().ends_with("_portable.exe")))
        })
        .and_then(|a| a["browser_download_url"].as_str())
        .ok_or("pas d'exécutable dans la release")?;
    if !(url.starts_with("https://") || (api != API && url.starts_with("http://"))) {
        return Err("adresse de téléchargement refusée".into());
    }

    // Téléchargé dans Program Files même : un utilisateur ne peut pas y glisser un autre fichier.
    let fresh = exe.with_extension("new");
    let _ = std::fs::remove_file(&fresh);
    curl(&["-o", &fresh.to_string_lossy(), url])?;
    let head = std::fs::read(&fresh).map(|b| b.len() > 500_000 && b.starts_with(b"MZ")).unwrap_or(false);
    if !head {
        let _ = std::fs::remove_file(&fresh);
        return Err("fichier téléchargé invalide".into());
    }

    let old = exe.with_extension("old");
    let _ = std::fs::remove_file(&old);
    std::fs::rename(exe, &old).map_err(|e| format!("remplacement impossible : {e}"))?;
    if let Err(e) = std::fs::rename(&fresh, exe) {
        let _ = std::fs::rename(&old, exe);
        return Err(format!("remplacement impossible : {e}"));
    }
    set_display_version(&version);
    Ok(Some(version))
}

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// Adresse de test définie par un administrateur (HKLM\Software\NeonInk, valeur UpdateUrl).
#[cfg(windows)]
fn registry_override() -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    let (key, value) = (wide("Software\\NeonInk"), wide("UpdateUrl"));
    let mut buf = [0u16; 1024];
    let mut size = (buf.len() * 2) as u32;
    let ok = unsafe {
        RegGetValueW(HKEY_LOCAL_MACHINE, key.as_ptr(), value.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size)
    } == 0;
    let len = (size as usize / 2).saturating_sub(1);
    let url = String::from_utf16_lossy(&buf[..len]);
    (ok && !url.is_empty()).then_some(url)
}

/// Version affichée dans « Applications installées ».
#[cfg(windows)]
fn set_display_version(version: &str) {
    use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_LOCAL_MACHINE, REG_SZ};
    let key = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NeonInk");
    let name = wide("DisplayVersion");
    let data = wide(version);
    unsafe {
        RegSetKeyValueW(HKEY_LOCAL_MACHINE, key.as_ptr(), name.as_ptr(), REG_SZ, data.as_ptr().cast(), (data.len() * 2) as u32);
    }
}

#[cfg(not(windows))]
fn registry_override() -> Option<String> {
    None
}

#[cfg(not(windows))]
fn set_display_version(_version: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert!(newer("0.8.0", "0.7.9"));
        assert!(newer("v1.0.0", "0.9.12"));
        assert!(newer("0.10.0", "0.9.0"));
        assert!(!newer("0.7.0", "0.7.0"));
        assert!(!newer("0.6.9", "0.7.0"));
    }

    #[test]
    fn task_definition() {
        let xml = task_xml(Path::new("C:\\Program Files\\Neon & Ink\\NeonInk.exe"));
        assert!(xml.contains("<UserId>S-1-5-18</UserId>"));
        assert!(xml.contains("\"C:\\Program Files\\Neon &amp; Ink\\NeonInk.exe\""));
        assert!(xml.contains("<Arguments>--system-update</Arguments>"));
        assert!(xml.contains("(A;;GRGX;;;AU)"));
    }
}
