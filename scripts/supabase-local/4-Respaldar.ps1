param(
  [string]$ServerDirectory = (Join-Path $env:USERPROFILE "ESMARK-Supabase"),
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [ValidateRange(7, 365)][int]$RetentionDays = 30
)

. (Join-Path $PSScriptRoot "Common.ps1")

$serverDirectoryFull = [System.IO.Path]::GetFullPath($ServerDirectory)
$backupDirectoryFull = [System.IO.Path]::GetFullPath($BackupDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $serverDirectoryFull ".env"))) {
  throw "No existe el servidor Supabase local en $serverDirectoryFull."
}

New-Item -ItemType Directory -Path $backupDirectoryFull -Force | Out-Null
$docker = Get-DockerExecutable
Assert-DockerRunning -Docker $docker
$composeArguments = Get-ComposeArguments -ServerDirectory $serverDirectoryFull

$timestamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
$fileName = "esmark-db-$timestamp.dump"
$containerPath = "/tmp/$fileName"
$destinationPath = Join-Path $backupDirectoryFull $fileName

Write-Host "Creando respaldo consistente de PostgreSQL..."
if ((Invoke-NativeCommand -FilePath $docker -Arguments ($composeArguments + @("exec", "-T", "db", "pg_dump", "-U", "postgres", "-d", "postgres", "--format=custom", "--no-owner", "--file=$containerPath"))) -ne 0) {
  throw "Fallo pg_dump dentro del servidor local."
}

if ((Invoke-NativeCommand -FilePath $docker -Arguments ($composeArguments + @("exec", "-T", "db", "pg_restore", "--list", $containerPath)) -Quiet) -ne 0) {
  throw "El archivo generado no paso la verificacion de pg_restore."
}

if ((Invoke-NativeCommand -FilePath $docker -Arguments ($composeArguments + @("cp", "db:$containerPath", $destinationPath))) -ne 0) {
  throw "No se pudo copiar el respaldo a $backupDirectoryFull."
}

[void](Invoke-NativeCommand -FilePath $docker -Arguments ($composeArguments + @("exec", "-T", "db", "rm", "-f", $containerPath)) -Quiet)

$hash = Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256
$hashLine = "$($hash.Hash.ToLowerInvariant())  $fileName`r`n"
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText("$destinationPath.sha256", $hashLine, $utf8WithoutBom)

$cutoff = (Get-Date).AddDays(-$RetentionDays)
foreach ($oldBackup in Get-ChildItem -LiteralPath $backupDirectoryFull -File -Filter "esmark-db-*.dump") {
  if ($oldBackup.LastWriteTime -ge $cutoff) { continue }

  $resolvedOldPath = [System.IO.Path]::GetFullPath($oldBackup.FullName)
  if (-not $resolvedOldPath.StartsWith($backupDirectoryFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Se rechazo eliminar un respaldo fuera del directorio autorizado."
  }

  Remove-Item -LiteralPath $resolvedOldPath -Force
  $oldHashPath = "$resolvedOldPath.sha256"
  if (Test-Path -LiteralPath $oldHashPath) {
    Remove-Item -LiteralPath $oldHashPath -Force
  }
}

Write-Host "Respaldo verificado: $destinationPath" -ForegroundColor Green
