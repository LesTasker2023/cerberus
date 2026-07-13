# Cerberus dev launcher — loads the MSVC build environment, then starts Tauri.
# Run from PowerShell (NOT Git Bash):  .\dev.ps1
$ErrorActionPreference = "Stop"

# Kill any running app instance + free the Vite dev/HMR ports (1420, 1421).
Write-Host "Stopping any running Cerberus / dev servers..." -ForegroundColor DarkGray
Get-Process cerberus -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
foreach ($port in 1420, 1421) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

$vcvars = "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if (-not (Test-Path $vcvars)) {
  Write-Host "vcvars64.bat not found at:`n  $vcvars" -ForegroundColor Red
  Write-Host "Edit dev.ps1 to point at your Visual Studio BuildTools install." -ForegroundColor Yellow
  exit 1
}

Write-Host "Loading MSVC environment + starting Tauri dev..." -ForegroundColor Cyan
cmd /c "`"$vcvars`" && npm run tauri dev"
