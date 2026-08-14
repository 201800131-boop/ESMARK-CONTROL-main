param(
  [string]$ServerDirectory = (Join-Path $env:USERPROFILE "ESMARK-Supabase"),
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [ValidateRange(0, 23)][int]$Hour = 23
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "Este instalador de tarea programada esta preparado para Windows."
}

$backupScript = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "4-Respaldar.ps1"))
$serverDirectoryFull = [System.IO.Path]::GetFullPath($ServerDirectory)
$backupDirectoryFull = [System.IO.Path]::GetFullPath($BackupDirectory)
$arguments = @(
  "-NoProfile",
  "-ExecutionPolicy Bypass",
  "-File `"$backupScript`"",
  "-ServerDirectory `"$serverDirectoryFull`"",
  "-BackupDirectory `"$backupDirectoryFull`""
) -join " "

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours($Hour))
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
$userId = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest

Register-ScheduledTask `
  -TaskName "ESMARK - Respaldo diario Supabase local" `
  -Description "Respaldo diario verificado de la base local de ESMARK Control" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

Write-Host "Respaldo diario programado a las $($Hour.ToString('00')):00." -ForegroundColor Green
Write-Host "Docker Desktop y la sesion del usuario servidor deben permanecer iniciados."
