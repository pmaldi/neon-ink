# Teste l'installateur sur une vraie machine Windows :
#  1. une ancienne version (0.3.1, installée pour l'utilisateur seul dans AppData) tourne ;
#  2. le nouvel installateur la ferme, la désinstalle et s'installe dans Program Files ;
#  3. la tâche système de mise à jour, lancée par un utilisateur standard, remplace l'exécutable
#     sans demande d'autorisation ;
#  4. une mise à jour passive (/P /R) remplace l'application en cours et la relance ;
#  5. la désinstallation nettoie tout.
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

# 3. Mise à jour silencieuse par la tâche système, lancée par un utilisateur sans droits administrateur
$task = 'NeonInk Update'
& schtasks.exe /Query /TN $task /XML | Out-String | Write-Host
Check ($LASTEXITCODE -eq 0) 'Tâche de mise à jour créée par l''installateur'
# Fausse release 99.0.0 servie en local ; l'adresse de test se règle dans HKLM (administrateurs seulement).
$realVersion = (Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NeonInk').DisplayVersion
$fake = Join-Path $env:RUNNER_TEMP 'fake-release'
New-Item -ItemType Directory -Force $fake | Out-Null
$asset = Join-Path $fake 'NeonInk_99.0.0_x64_portable.exe'
Copy-Item "$programDir\NeonInk.exe" $asset
[IO.File]::AppendAllText($asset, 'version de test')  # contenu différent, toujours exécutable
$expected = (Get-FileHash $asset).Hash
@{ tag_name = 'v99.0.0'; draft = $false; prerelease = $false
   assets = @(@{ name = 'NeonInk_99.0.0_x64_portable.exe'; browser_download_url = 'http://127.0.0.1:8778/NeonInk_99.0.0_x64_portable.exe' }) } |
  ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $fake 'release.json')
$server = Start-Process python -ArgumentList '-m', 'http.server', '8778', '--bind', '127.0.0.1' -WorkingDirectory $fake -PassThru -WindowStyle Hidden
New-Item -Force 'HKLM:\Software\NeonInk' | Out-Null
Set-ItemProperty 'HKLM:\Software\NeonInk' UpdateUrl 'http://127.0.0.1:8778/release.json'
Start-Sleep 2

NeonInkProcesses | Stop-Process -Force
Start-Process "$programDir\NeonInk.exe"  # l'application tourne pendant le remplacement
Start-Sleep 4
# 14 caractères au plus : au-delà, « net user » pose une question et n'ajoute pas le compte.
$password = 'Nn-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '!a1'
& net.exe user neontest $password /add
Check ($LASTEXITCODE -eq 0) 'Compte de test sans droits administrateur créé'
$cred = New-Object PSCredential('neontest', (ConvertTo-SecureString $password -AsPlainText -Force))
$out = 'C:\Users\Public\neontest-run.txt'
$p = Start-Process cmd.exe -ArgumentList '/c', "schtasks.exe /Run /TN `"$task`" > $out 2>&1 & whoami >> $out" -Credential $cred -WorkingDirectory 'C:\Users\Public' -PassThru -WindowStyle Hidden
$null = $p.Handle
$p.WaitForExit(60000) | Out-Null
Get-Content $out -ErrorAction SilentlyContinue | Write-Host
Check ($p.ExitCode -eq 0) "Utilisateur standard : lancement de la tâche autorisé (code $($p.ExitCode))"
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline -and (Get-FileHash "$programDir\NeonInk.exe").Hash -ne $expected) { Start-Sleep 2 }
Get-Content "$programDir\update-status.txt" -ErrorAction SilentlyContinue | Write-Host
Check ((Get-FileHash "$programDir\NeonInk.exe").Hash -eq $expected) 'Exécutable remplacé par la tâche, sans demande d''autorisation'
Check ((Get-Content "$programDir\update-status.txt" -ErrorAction SilentlyContinue) -eq 'ok 99.0.0') 'Résultat « ok 99.0.0 » transmis à l''application'
$key = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NeonInk'
Check ($key.DisplayVersion -eq '99.0.0') "Version affichée dans « Applications installées » : $($key.DisplayVersion)"
Check ($null -ne (Get-Process -Name NeonInk -ErrorAction SilentlyContinue)) 'L''application en cours n''a pas été interrompue'
Remove-Item -Recurse -Force 'HKLM:\Software\NeonInk'
# L'étape suivante réinstalle la vraie version : on retire la fausse 99.0.0 pour ne pas simuler un retour en arrière.
Set-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NeonInk' DisplayVersion $realVersion
$server | Stop-Process -Force
& net.exe user neontest /delete | Out-Null

# 4. Mise à jour passive pendant que l'application tourne, avec relance
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

# 5. Désinstallation
NeonInkProcesses | Stop-Process -Force
$code = Run "$programDir\uninstall.exe" "/S _?=$programDir"
Check ($code -eq 0) "Désinstallation sans erreur (code $code)"
Check (-not (Test-Path "$programDir\NeonInk.exe")) 'Fichiers supprimés'
Check (-not (Test-Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NeonInk')) 'Entrée « Applications installées » supprimée'
& schtasks.exe /Query /TN $task 2>$null | Out-Null
Check ($LASTEXITCODE -ne 0) 'Tâche de mise à jour supprimée'
Check (-not (Test-Path "$programDir\NeonInk.old")) 'Ancien exécutable de la mise à jour silencieuse supprimé'

if ($failures.Count) { Write-Host "$($failures.Count) vérification(s) en échec"; exit 1 }
