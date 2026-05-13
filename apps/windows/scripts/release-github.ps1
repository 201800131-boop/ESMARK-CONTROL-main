$ErrorActionPreference = 'Stop'

Set-Location (Join-Path $PSScriptRoot '..')

$required = @('GH_TOKEN', 'GH_OWNER', 'GH_REPO')
$missing = @()

foreach ($name in $required) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    $missing += $name
  }
}

if ($missing.Count -gt 0) {
  Write-Error "Faltan variables de entorno: $($missing -join ', ')."
}

Write-Host 'Limpieza previa de release...' -ForegroundColor Cyan
if (Test-Path 'release') {
  try {
    Remove-Item -Recurse -Force 'release' -ErrorAction Stop
  }
  catch {
    Write-Warning 'No se pudo borrar release completo (archivo bloqueado). Se continuara con el build.'
  }
}

Write-Host 'Compilando app...' -ForegroundColor Cyan
npm.cmd run build

Write-Host 'Publicando release en GitHub...' -ForegroundColor Cyan
npx.cmd electron-builder --publish always

Write-Host 'Release publicado correctamente.' -ForegroundColor Green
