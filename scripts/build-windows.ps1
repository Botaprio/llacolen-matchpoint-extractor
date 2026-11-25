$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $PSScriptRoot)

# Sólo la sección de dependencias decide si npm install debe repetirse.
# Cambiar versión, README o código fuente ya no fuerza una descarga completa.
$package = Get-Content -Path "package.json" -Raw | ConvertFrom-Json
$dependencyDescriptor = [ordered]@{
  dependencies = $package.dependencies
  devDependencies = $package.devDependencies
} | ConvertTo-Json -Depth 20 -Compress
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($dependencyDescriptor)
  $dependencyHash = ([System.BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace("-", "")
} finally {
  $sha256.Dispose()
}

$dependencyStamp = "node_modules\.llacolen-dependencies.hash"
$dependenciesReady = (
  (Test-Path "node_modules") -and
  (Test-Path "node_modules\.bin\electron.cmd") -and
  (Test-Path $dependencyStamp) -and
  ((Get-Content -Path $dependencyStamp -Raw).Trim() -eq $dependencyHash)
)

if ($dependenciesReady) {
  Write-Host "Dependencias ya instaladas; se reutilizaran." -ForegroundColor Green
} else {
  Write-Host "Instalando o actualizando dependencias (solo si cambiaron)..." -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -ne 0) { throw "Fallo la instalacion de dependencias." }
  Set-Content -Path $dependencyStamp -Value $dependencyHash -NoNewline
}

Write-Host "Ejecutando pruebas..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { throw "Las pruebas fallaron. No se generara el ejecutable." }
npm run check
if ($LASTEXITCODE -ne 0) { throw "La validacion de codigo fallo. No se generara el ejecutable." }

Write-Host "Generando instalador y version portable para Windows..." -ForegroundColor Cyan
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw "No se pudo generar el ejecutable de Windows." }

Write-Host "Listo. Revisa la carpeta dist." -ForegroundColor Green
