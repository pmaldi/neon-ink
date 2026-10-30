# Teste l'installateur sur une vraie machine Windows :
#  1. une ancienne version (0.3.1, installée pour l'utilisateur seul dans AppData) tourne ;
#  2. le nouvel installateur la ferme, la désinstalle et s'installe dans Program Files ;
#  3. une mise à jour passive (/P /R) remplace l'application en cours et la relance ;
#  4. la désinstallation nettoie tout.
param([Parameter(Mandatory)] [string] $Setup)

$ErrorActionPreference = 'Stop'
$failures = @()
function Check($ok, $label) {
  $mark = if ($ok) { 'OK ' } else { 'ÉCHEC' }
  Write-Host "[$mark] $label"
  if (-not $ok) { $script:failures += $label }
  "- $(if ($ok) { '✅' } else { '❌' }) $label" | Out-File -Append -Encoding utf8 $env:GITHUB_STEP_SUMMARY
}
# Attend la fin du programme lui-même (pas de ses descendants : l'installateur relance NeonInk), 3 minutes au plus.
function Run($file, $arguments) {
  $p = Start-Process -FilePath $file -ArgumentList $arguments -PassThru
  $null = $p.Handle  # sans cela, PowerShell ne conserve pas le code de retour
  if (-not $p.WaitForExit(180000)) {
    $p | Stop-Process -Force
    Write-Host "Délai dépassé : $file $arguments"
    return -1
  }
  return $p.ExitCode
}
function NeonInkProcesses { Get-Process -Name NeonInk, neon-ink -ErrorAction SilentlyContinue }

"### Installation" | Out-File -Append -Encoding utf8 $env:GITHUB_STEP_SUMMARY
$env:NEONINK_NO_UPDATE = '1'
$programDir = Join-Path $env:ProgramFiles 'NeonInk'
$userDir = Join-Path $env:LOCALAPPDATA 'NeonInk'

# 1. Ancienne version installée pour l'utilisateur, en cours d'exécution
gh release download v0.3.1 -p '*-setup.exe' -D old --clobber
$oldSetup = Get-ChildItem old\*-setup.exe | Select-Object -First 1
Check ((Run $oldSetup.FullName '/S') -eq 0) 'Ancienne version 0.3.1 installée (AppData)'
Check (Test-Path "$userDir\neon-ink.exe") "Ancienne version présente dans $userDir"
Start-Process "$userDir\neon-ink.exe"
Start-Sleep 4
Check ($null -ne (NeonInkProcesses)) 'Ancienne version lancée'

# 2. Nouvel installateur, l'ancienne version tournant encore
$code = Run $Setup '/S'
Check ($code -eq 0) "Nouvel installateur terminé sans erreur (code $code)"
Check (Test-Path "$programDir\NeonInk.exe") "Installé dans $programDir"
Check (Test-Path "$programDir\uninstall.exe") 'Désinstalleur présent'
Check (-not (Test-Path "$userDir\neon-ink.exe")) 'Ancienne installation AppData supprimée'
Check (-not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NeonInk')) 'Ancienne entrée « Applications installées » supprimée'
$key = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NeonInk' -ErrorAction SilentlyContinue
Check ($null -ne $key) 'Entrée « Applications installées » pour tous les utilisateurs'
if ($key) { Write-Host "Version $($key.DisplayVersion) · éditeur $($key.Publisher) · $($key.InstallLocation)" }
$shortcut = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\NeonInk.lnk'
Check (Test-Path $shortcut) 'Raccourci du menu Démarrer pour tous les utilisateurs'
Get-ChildItem $programDir | Format-Table Name, Length | Out-String | Write-Host

# 3. Mise à jour passive pendant que l'application tourne, avec relance
NeonInkProcesses | Stop-Process -Force
Start-Process "$programDir\NeonInk.exe"
Start-Sleep 4
$before = (Get-Process -Name NeonInk -ErrorAction SilentlyContinue).Id
Check ($null -ne $before) 'Nouvelle version lancée depuis Program Files'
$code = Run $Setup '/P /R'
Check ($code -eq 0) "Mise à jour passive terminée sans erreur (code $code)"
Start-Sleep 6
$after = Get-Process -Name NeonInk -ErrorAction SilentlyContinue
Check ($null -ne $after -and $after.Id -ne $before) 'NeonInk relancé après la mise à jour'
if ($after) { Write-Host "Relancé depuis $($after.Path)" }

# 4. Désinstallation
NeonInkProcesses | Stop-Process -Force
$code = Run "$programDir\uninstall.exe" "/S _?=$programDir"
Check ($code -eq 0) "Désinstallation sans erreur (code $code)"
Check (-not (Test-Path "$programDir\NeonInk.exe")) 'Fichiers supprimés'
Check (-not (Test-Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NeonInk')) 'Entrée « Applications installées » supprimée'

if ($failures.Count) { Write-Host "$($failures.Count) vérification(s) en échec"; exit 1 }
