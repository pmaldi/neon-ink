; Points d'accroche de l'installateur NSIS généré par Tauri.

!macro NSIS_HOOK_PREINSTALL
  ; NeonInk doit être fermé pour remplacer son exécutable, quel que soit le dossier d'où il a été
  ; lancé (deuxième copie, ancienne installation, lancement en administrateur…).
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM NeonInk.exe'
  Pop $R9
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM neon-ink.exe'
  Pop $R9
  Sleep 500

  ; Les versions 0.3.x et antérieures s'installaient pour l'utilisateur seul, dans
  ; %LOCALAPPDATA%\NeonInk. On désinstalle cette copie pour n'en garder qu'une, dans Program Files.
  SetShellVarContext current
  StrCpy $R9 "$LOCALAPPDATA\${PRODUCTNAME}"
  SetShellVarContext all
  ${If} ${FileExists} "$R9\uninstall.exe"
  ${AndIf} "$R9" != "$INSTDIR"
    DetailPrint "Suppression de l'ancienne installation : $R9"
    ExecWait '"$R9\uninstall.exe" /S _?=$R9'
    Delete "$R9\uninstall.exe"
    RMDir "$R9"
  ${EndIf}
!macroend
