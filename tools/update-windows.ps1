# Updates the EKA Hosting builder to the latest version from GitHub.
# Keeps your sites (data folder) and settings.txt exactly as they are.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$url  = 'https://github.com/EthanAkam12/eka-hosting/archive/HEAD.zip'
$tmp  = Join-Path $env:TEMP ('eka-update-' + [guid]::NewGuid().ToString('N'))

try {
  New-Item -ItemType Directory -Path $tmp | Out-Null
  Write-Host ''
  Write-Host '  Downloading the latest version...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile (Join-Path $tmp 'update.zip') -UseBasicParsing

  Write-Host '  Unpacking...'
  Expand-Archive -Path (Join-Path $tmp 'update.zip') -DestinationPath (Join-Path $tmp 'x') -Force
  $src = Get-ChildItem -Path (Join-Path $tmp 'x') -Directory | Select-Object -First 1
  if (-not $src -or -not (Test-Path (Join-Path $src.FullName 'server\index.js'))) {
    throw 'The download did not look like the builder. Nothing was changed.'
  }

  # A quick backup of your sites and settings, just in case.
  $backup = Join-Path $here ('backups\before-update-' + (Get-Date -Format 'yyyy-MM-dd-HHmm'))
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  if (Test-Path (Join-Path $here 'data')) { Copy-Item (Join-Path $here 'data') $backup -Recurse -Force }
  if (Test-Path (Join-Path $here 'settings.txt')) { Copy-Item (Join-Path $here 'settings.txt') $backup -Force }

  Write-Host '  Installing the new version (your sites and settings are kept)...'
  # robocopy merges folders properly; these are never touched:
  robocopy $src.FullName $here /E /NFL /NDL /NJH /NJS /NP /XD data node_modules backups /XF settings.txt | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying the new files failed (robocopy code $LASTEXITCODE)." }

  Set-Location $here
  Write-Host '  Updating the parts the builder needs (this can take a minute)...'
  & npm install --omit=dev --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { throw 'Installing the new parts failed. Check your internet connection and run the update again.' }

  Write-Host ''
  Write-Host '  Done! The builder is up to date.' -ForegroundColor Green
  Write-Host "  A backup of your sites from before the update is in: $backup"
  exit 0
}
catch {
  Write-Host ''
  Write-Host "  Update failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '  Your sites and settings have not been changed.'
  exit 1
}
finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
