param(
  [string]$ServerDirectory = (Join-Path $env:USERPROFILE "ESMARK-Supabase"),
  [switch]$BuildInstaller
)

. (Join-Path $PSScriptRoot "Common.ps1")

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$serverEnvPath = Join-Path ([System.IO.Path]::GetFullPath($ServerDirectory)) ".env"
$migrationMarker = Join-Path ([System.IO.Path]::GetFullPath($ServerDirectory)) ".esmark-cloud-migration-complete"

if (-not (Test-Path -LiteralPath $serverEnvPath)) {
  throw "No existe la configuracion del servidor local."
}
if (-not (Test-Path -LiteralPath $migrationMarker)) {
  throw "La migracion local aun no esta verificada. Ejecuta primero 2-Migrar-Desde-Nube.ps1."
}

$publicUrl = Get-DotEnvValue -Path $serverEnvPath -Key "SUPABASE_PUBLIC_URL"
$anonKey = Get-DotEnvValue -Path $serverEnvPath -Key "ANON_KEY"
if ([string]::IsNullOrWhiteSpace($publicUrl) -or [string]::IsNullOrWhiteSpace($anonKey)) {
  throw "Faltan SUPABASE_PUBLIC_URL o ANON_KEY en la configuracion del servidor."
}

Wait-SupabaseHealth -PublicUrl $publicUrl -AnonKey $anonKey
$restResponse = Invoke-WebRequest `
  -UseBasicParsing `
  -Uri "$($publicUrl.TrimEnd('/'))/rest/v1/" `
  -Headers @{ apikey = $anonKey; Authorization = "Bearer $anonKey" } `
  -TimeoutSec 10
if ($restResponse.StatusCode -lt 200 -or $restResponse.StatusCode -ge 300) {
  throw "La API local no paso la verificacion. No se cambiara la aplicacion."
}

$existingEnvPath = Join-Path $repoRoot "apps\windows\.env"
$trelloBoardId = Get-DotEnvValue -Path $existingEnvPath -Key "VITE_TRELLO_BOARD_ID"
if ([string]::IsNullOrWhiteSpace($trelloBoardId)) {
  $trelloBoardId = "3cv4PjjJ"
}

$localEnvPath = Join-Path $repoRoot "apps\windows\.env.local"
Set-DotEnvValues -Path $localEnvPath -Values @{
  "VITE_SUPABASE_URL"      = $publicUrl
  "VITE_SUPABASE_ANON_KEY" = $anonKey
  "VITE_TRELLO_BOARD_ID"   = $trelloBoardId
}

Write-Host "ESMARK Control quedo configurado para compilar contra $publicUrl" -ForegroundColor Green
Write-Host "La clave de servicio privada no fue incluida en la aplicacion."

if ($BuildInstaller) {
  Push-Location $repoRoot
  try {
    if ((Invoke-NativeCommand -FilePath "npm.cmd" -Arguments @("--workspace", "@esmark/windows", "run", "electron:build")) -ne 0) {
      throw "La configuracion local se guardo, pero fallo la construccion del instalador."
    }
  } finally {
    Pop-Location
  }

  Write-Host "Instalador listo en apps/windows/release" -ForegroundColor Green
} else {
  Write-Host "Para crear el instalador ejecuta nuevamente con -BuildInstaller."
}
