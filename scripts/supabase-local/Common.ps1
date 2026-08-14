Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Key
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
    if ($line -match "^$([regex]::Escape($Key))=(.*)$") {
      return $Matches[1].Trim()
    }
  }

  return $null
}

function Set-DotEnvValues {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][hashtable]$Values
  )

  $lines = [System.Collections.Generic.List[string]]::new()
  if (Test-Path -LiteralPath $Path) {
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
      $lines.Add($line)
    }
  }

  foreach ($key in $Values.Keys) {
    $replacement = "$key=$($Values[$key])"
    $found = $false

    for ($index = 0; $index -lt $lines.Count; $index += 1) {
      if ($lines[$index] -match "^$([regex]::Escape([string]$key))=") {
        $lines[$index] = $replacement
        $found = $true
        break
      }
    }

    if (-not $found) {
      $lines.Add($replacement)
    }
  }

  $utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllLines($Path, $lines, $utf8WithoutBom)
}

function Get-DockerExecutable {
  $command = Get-Command docker -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $dockerDesktopPath = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
  if (Test-Path -LiteralPath $dockerDesktopPath) {
    return $dockerDesktopPath
  }

  throw @"
Docker Desktop no esta instalado. En la computadora que quedara como servidor ejecuta:
  winget install -e --id Docker.DockerDesktop
Reinicia Windows, abre Docker Desktop y vuelve a ejecutar este script.
"@
}

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [object[]]$Arguments = @(),
    [switch]$Quiet
  )

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    if ($Quiet) {
      & $FilePath @Arguments 2>&1 | Out-Null
    } else {
      & $FilePath @Arguments 2>&1 | ForEach-Object { Write-Host $_ }
    }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  return $exitCode
}

function Assert-DockerRunning {
  param([Parameter(Mandatory = $true)][string]$Docker)

  $exitCode = Invoke-NativeCommand -FilePath $Docker -Arguments @("info") -Quiet
  if ($exitCode -ne 0) {
    throw "Docker Desktop esta instalado, pero no esta iniciado. Abre Docker Desktop y espera que indique Engine running."
  }
}

function Get-GitBashExecutable {
  $candidates = @(
    "C:\Program Files\Git\bin\bash.exe",
    "C:\Program Files\Git\usr\bin\bash.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  $command = Get-Command bash -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  throw "Git Bash no esta instalado. Instala Git para Windows antes de preparar el servidor."
}

function Get-GitExecutable {
  $command = Get-Command git -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidate = "C:\Program Files\Git\cmd\git.exe"
  if (Test-Path -LiteralPath $candidate) {
    return $candidate
  }

  throw "Git para Windows no esta instalado."
}

function Get-ComposeArguments {
  param([Parameter(Mandatory = $true)][string]$ServerDirectory)

  return @(
    "compose",
    "--project-directory", $ServerDirectory,
    "-f", (Join-Path $ServerDirectory "docker-compose.yml"),
    "-f", (Join-Path $ServerDirectory "docker-compose.esmark.yml")
  )
}

function Assert-HttpUrl {
  param([Parameter(Mandatory = $true)][string]$Url)

  $parsed = $null
  if (-not [uri]::TryCreate($Url, [System.UriKind]::Absolute, [ref]$parsed)) {
    throw "La URL '$Url' no es valida. Usa un valor como http://192.168.3.46:8000."
  }

  if ($parsed.Scheme -notin @("http", "https")) {
    throw "La URL del servidor debe comenzar con http:// o https://."
  }

  return $parsed
}

function Wait-SupabaseHealth {
  param(
    [Parameter(Mandatory = $true)][string]$PublicUrl,
    [string]$AnonKey,
    [int]$TimeoutSeconds = 180
  )

  $healthUrl = "$($PublicUrl.TrimEnd('/'))/auth/v1/health"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    try {
      $headers = @{}
      if (-not [string]::IsNullOrWhiteSpace($AnonKey)) {
        $headers["apikey"] = $AnonKey
        $headers["Authorization"] = "Bearer $AnonKey"
      }
      $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -Headers $headers -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        return
      }
    } catch {
      Start-Sleep -Seconds 3
    }
  }

  throw "Supabase no respondio en $healthUrl despues de $TimeoutSeconds segundos. Revisa: docker compose logs."
}
