# Turns "start Jarvis when Windows starts" on or off, by adding or removing a
# JARVIS shortcut in your Startup folder. Usage: autostart.ps1 on|off|toggle
param([string]$Mode = 'toggle')
$ErrorActionPreference = 'Stop'
$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'JARVIS.lnk'
$vbs = Join-Path $PSScriptRoot 'start-hidden.vbs'

if ($Mode -eq 'toggle') { $Mode = if (Test-Path $link) { 'off' } else { 'on' } }

if ($Mode -eq 'on') {
  $shell = New-Object -ComObject WScript.Shell
  $s = $shell.CreateShortcut($link)
  $s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $s.Arguments = '"' + $vbs + '"'
  $s.WorkingDirectory = Split-Path -Parent $PSScriptRoot
  $s.Description = 'Start JARVIS'
  $s.Save()
  Write-Host ''
  Write-Host '  Jarvis will now start by itself when you log in to Windows.'
  Write-Host '  Starting it now as well...'
  Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') ('"' + $vbs + '"')
} else {
  if (Test-Path $link) { Remove-Item $link -Force }
  Write-Host ''
  Write-Host '  Jarvis will no longer start by itself.'
  Write-Host '  (If it is running now, it keeps running until you restart or sign out.)'
}
