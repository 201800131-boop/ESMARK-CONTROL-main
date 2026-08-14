param(
  [string]$InstallDirectory = (Join-Path $env:USERPROFILE "ESMARK-Supabase"),
  [string]$PublicUrl = "http://$($env:COMPUTERNAME):8000",
  [switch]$SkipStart,
  [switch]$SkipFirewall
)

. (Join-Path $PSScriptRoot "Common.ps1")

$PinnedSupabaseCommit = "f8e682c4431373a501f4847c77424dc6799685a9"
$PublicUrl = $PublicUrl.TrimEnd("/")
[void](Assert-HttpUrl -Url $PublicUrl)

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$serverDirectoryFull = [System.IO.Path]::GetFullPath($InstallDirectory)
$isNewInstallation = -not (Test-Path -LiteralPath (Join-Path $serverDirectoryFull "docker-compose.yml"))

if ($isNewInstallation) {
  New-Item -ItemType Directory -Path $serverDirectoryFull -Force | Out-Null

  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $tempDirectory = [System.IO.Path]::GetFullPath(
    (Join-Path $tempRoot "esmark-supabase-$([guid]::NewGuid().ToString('N'))")
  )

  if (-not $tempDirectory.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "No se pudo validar el directorio temporal."
  }

  New-Item -ItemType Directory -Path $tempDirectory | Out-Null
  try {
    $git = Get-GitExecutable
    $checkoutDirectory = Join-Path $tempDirectory "supabase"
    Write-Host "Descargando solamente la configuracion Docker fijada de Supabase..."
    if ((Invoke-NativeCommand -FilePath $git -Arguments @("clone", "--filter=blob:none", "--no-checkout", "--depth", "1", "https://github.com/supabase/supabase.git", $checkoutDirectory) -Quiet) -ne 0) {
      throw "No se pudo descargar el repositorio oficial de Supabase."
    }
    if ((Invoke-NativeCommand -FilePath $git -Arguments @("-C", $checkoutDirectory, "sparse-checkout", "init", "--cone") -Quiet) -ne 0) {
      throw "No se pudo iniciar la descarga parcial de Supabase."
    }
    if ((Invoke-NativeCommand -FilePath $git -Arguments @("-C", $checkoutDirectory, "sparse-checkout", "set", "docker") -Quiet) -ne 0) {
      throw "No se pudo seleccionar la configuracion Docker de Supabase."
    }
    if ((Invoke-NativeCommand -FilePath $git -Arguments @("-C", $checkoutDirectory, "fetch", "--depth", "1", "origin", $PinnedSupabaseCommit) -Quiet) -ne 0) {
      throw "No se pudo descargar la version fijada de Supabase."
    }
    if ((Invoke-NativeCommand -FilePath $git -Arguments @("-C", $checkoutDirectory, "checkout", "--detach", $PinnedSupabaseCommit) -Quiet) -ne 0) {
      throw "No se pudo activar la version fijada de Supabase."
    }

    $dockerSource = Join-Path $checkoutDirectory "docker"
    if (-not (Test-Path -LiteralPath (Join-Path $dockerSource "docker-compose.yml"))) {
      throw "El paquete oficial descargado no contiene la configuracion Docker esperada."
    }

    Copy-Item -Path (Join-Path $dockerSource "*") -Destination $serverDirectoryFull -Recurse -Force
  } finally {
    if (
      (Test-Path -LiteralPath $tempDirectory) -and
      $tempDirectory.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
      ([System.IO.Path]::GetFileName($tempDirectory) -like "esmark-supabase-*")
    ) {
      Remove-Item -LiteralPath $tempDirectory -Recurse -Force
    }
  }

  Copy-Item -LiteralPath (Join-Path $serverDirectoryFull ".env.example") -Destination (Join-Path $serverDirectoryFull ".env")

  $bash = Get-GitBashExecutable
  Push-Location $serverDirectoryFull
  try {
    if ((Invoke-NativeCommand -FilePath $bash -Arguments @("utils/generate-keys.sh", "--update-env") -Quiet) -ne 0) {
      throw "No se pudieron generar las claves seguras de Supabase."
    }

    if ((Invoke-NativeCommand -FilePath $bash -Arguments @("utils/add-new-auth-keys.sh", "--update-env") -Quiet) -ne 0) {
      throw "No se pudieron generar las claves modernas de autenticacion."
    }
  } finally {
    Pop-Location
  }
}

$envPath = Join-Path $serverDirectoryFull ".env"
Set-DotEnvValues -Path $envPath -Values @{
  "SUPABASE_PUBLIC_URL"     = $PublicUrl
  "API_EXTERNAL_URL"       = $PublicUrl
  "SITE_URL"               = $PublicUrl
  "POOLER_TENANT_ID"       = "esmark"
  "DISABLE_SIGNUP"         = "true"
  "ENABLE_EMAIL_AUTOCONFIRM" = "true"
  "FUNCTIONS_VERIFY_JWT"   = "true"
}

$composeOverride = @"
services:
  functions:
    env_file:
      - .env.functions
  kong:
    ports: !override
      - "0.0.0.0:8000:8000/tcp"
      - "127.0.0.1:8443:8443/tcp"
  supavisor:
    ports: !override
      - "127.0.0.1:5432:5432"
      - "127.0.0.1:6543:6543"
"@
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText(
  (Join-Path $serverDirectoryFull "docker-compose.esmark.yml"),
  $composeOverride,
  $utf8WithoutBom
)

$functionsEnvPath = Join-Path $serverDirectoryFull ".env.functions"
if (-not (Test-Path -LiteralPath $functionsEnvPath)) {
  [System.IO.File]::WriteAllText(
    $functionsEnvPath,
    "TRELLO_API_KEY=`r`nTRELLO_TOKEN=`r`n",
    $utf8WithoutBom
  )
}

$functionsSource = Join-Path $repoRoot "supabase\functions"
$functionsTarget = Join-Path $serverDirectoryFull "volumes\functions"
New-Item -ItemType Directory -Path $functionsTarget -Force | Out-Null
foreach ($functionDirectory in Get-ChildItem -LiteralPath $functionsSource -Directory) {
  $target = Join-Path $functionsTarget $functionDirectory.Name
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  Copy-Item -Path (Join-Path $functionDirectory.FullName "*") -Destination $target -Recurse -Force
}

$versionNote = @"
ESMARK Control - Supabase self-hosted
Commit oficial fijado: $PinnedSupabaseCommit
URL publica: $PublicUrl
Preparado: $((Get-Date).ToString("o"))

No actualices los archivos Docker directamente desde master. Primero revisa el changelog oficial y realiza un respaldo.
"@
[System.IO.File]::WriteAllText(
  (Join-Path $serverDirectoryFull "ESMARK-SUPABASE-VERSION.txt"),
  $versionNote,
  $utf8WithoutBom
)

if ($env:OS -eq "Windows_NT" -and -not $SkipFirewall) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($isAdmin) {
    $ruleName = "ESMARK Supabase Local - API"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule `
        -DisplayName $ruleName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort 8000 `
        -RemoteAddress LocalSubnet | Out-Null
    }
  } else {
    Write-Warning "Ejecuta una vez este script como administrador para abrir el puerto 8000 solo a la red local."
  }
}

if (-not $SkipStart) {
  $docker = Get-DockerExecutable
  Assert-DockerRunning -Docker $docker
  $composeArguments = Get-ComposeArguments -ServerDirectory $serverDirectoryFull

  Write-Host "Descargando contenedores de Supabase. La primera vez puede tardar varios minutos..."
  if ((Invoke-NativeCommand -FilePath $docker -Arguments ($composeArguments + @("pull"))) -ne 0) {
    throw "Docker no pudo descargar los contenedores de Supabase."
  }

  if ((Invoke-NativeCommand -FilePath $docker -Arguments ($composeArguments + @("up", "-d"))) -ne 0) {
    throw "Docker no pudo iniciar Supabase."
  }

  $anonKey = Get-DotEnvValue -Path $envPath -Key "ANON_KEY"
  Wait-SupabaseHealth -PublicUrl $PublicUrl -AnonKey $anonKey
  Write-Host "Servidor Supabase local listo en $PublicUrl" -ForegroundColor Green
}

Write-Host "Archivos del servidor: $serverDirectoryFull"
Write-Host "Siguiente paso: ejecuta 2-Migrar-Desde-Nube.ps1 durante una ventana sin nuevos registros."
