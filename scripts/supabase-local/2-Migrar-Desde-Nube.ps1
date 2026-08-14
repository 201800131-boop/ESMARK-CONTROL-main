param(
  [string]$ServerDirectory = (Join-Path $env:USERPROFILE "ESMARK-Supabase"),
  [string]$CloudDbUrl = $env:ESMARK_CLOUD_DB_URL,
  [string]$BackupDirectory,
  [switch]$UseLinkedProject
)

. (Join-Path $PSScriptRoot "Common.ps1")

$serverDirectoryFull = [System.IO.Path]::GetFullPath($ServerDirectory)
$serverEnvPath = Join-Path $serverDirectoryFull ".env"
$markerPath = Join-Path $serverDirectoryFull ".esmark-cloud-migration-complete"

if (-not (Test-Path -LiteralPath $serverEnvPath)) {
  throw "No existe el servidor preparado en $serverDirectoryFull. Ejecuta primero 1-Preparar-Servidor.ps1."
}
if (Test-Path -LiteralPath $markerPath) {
  throw "Este servidor ya tiene una migracion marcada como completa. No se repetira para evitar registros duplicados."
}

if (-not $UseLinkedProject -and [string]::IsNullOrWhiteSpace($CloudDbUrl)) {
  $linkedProjectPath = Join-Path ([System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))) "supabase\.temp\project-ref"
  if (Test-Path -LiteralPath $linkedProjectPath) {
    $UseLinkedProject = $true
  }
}

if (-not $UseLinkedProject -and [string]::IsNullOrWhiteSpace($CloudDbUrl)) {
  $secureUrl = Read-Host "Pega la Connection string de Supabase Cloud" -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
  try {
    $CloudDbUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}
if (-not $UseLinkedProject -and [string]::IsNullOrWhiteSpace($CloudDbUrl)) {
  throw "Falta la cadena de conexion de Supabase Cloud."
}

$connectionArguments = if ($UseLinkedProject) {
  @("--linked")
} else {
  @("--db-url", $CloudDbUrl)
}

$supabaseCommand = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $supabaseCommand) {
  throw "No esta instalado Supabase CLI. Instala una version actual antes de migrar."
}
$docker = Get-DockerExecutable
Assert-DockerRunning -Docker $docker
$composeArguments = Get-ComposeArguments -ServerDirectory $serverDirectoryFull

$publicUrl = Get-DotEnvValue -Path $serverEnvPath -Key "SUPABASE_PUBLIC_URL"
$anonKey = Get-DotEnvValue -Path $serverEnvPath -Key "ANON_KEY"
Wait-SupabaseHealth -PublicUrl $publicUrl -AnonKey $anonKey

if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
  $timestamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
  $BackupDirectory = Join-Path $serverDirectoryFull "migracion-cloud-$timestamp"
}
$backupDirectoryFull = [System.IO.Path]::GetFullPath($BackupDirectory)
New-Item -ItemType Directory -Path $backupDirectoryFull -Force | Out-Null

$rolesPath = Join-Path $backupDirectoryFull "roles.sql"
$schemaPath = Join-Path $backupDirectoryFull "schema.sql"
$dataPath = Join-Path $backupDirectoryFull "data.sql"

Write-Host "Exportando roles desde Supabase Cloud..."
if ((Invoke-NativeCommand -FilePath $supabaseCommand.Source -Arguments (@("db", "dump") + $connectionArguments + @("-f", $rolesPath, "--role-only"))) -ne 0) {
  throw "Fallo la exportacion de roles."
}

Write-Host "Exportando estructura, funciones y politicas..."
if ((Invoke-NativeCommand -FilePath $supabaseCommand.Source -Arguments (@("db", "dump") + $connectionArguments + @("-f", $schemaPath))) -ne 0) {
  throw "Fallo la exportacion del esquema."
}

Write-Host "Exportando datos y usuarios..."
$dataDumpArguments = @(
  "db", "dump"
) + $connectionArguments + @(
  "-f", $dataPath,
  "--use-copy",
  "--data-only",
  "-x", "storage.buckets_vectors",
  "-x", "storage.vector_indexes"
)
if ((Invoke-NativeCommand -FilePath $supabaseCommand.Source -Arguments $dataDumpArguments) -ne 0) {
  throw "Fallo la exportacion de datos."
}

foreach ($item in @(
  @{ Local = $rolesPath; Remote = "/tmp/esmark_roles.sql" },
  @{ Local = $schemaPath; Remote = "/tmp/esmark_schema.sql" },
  @{ Local = $dataPath; Remote = "/tmp/esmark_data.sql" }
)) {
  if ((Invoke-NativeCommand -FilePath $docker -Arguments ($composeArguments + @("cp", $item.Local, "db:$($item.Remote)"))) -ne 0) {
    throw "No se pudo copiar $($item.Local) al contenedor local."
  }
}

$restoreWrapperPath = Join-Path $backupDirectoryFull "restore_data.sql"
$restoreWrapper = @"
\set ON_ERROR_STOP on
begin;
set session_replication_role = replica;
\i /tmp/esmark_data.sql
set session_replication_role = origin;
commit;
"@
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($restoreWrapperPath, $restoreWrapper, $utf8WithoutBom)
if ((Invoke-NativeCommand -FilePath $docker -Arguments ($composeArguments + @("cp", $restoreWrapperPath, "db:/tmp/esmark_restore_data.sql"))) -ne 0) {
  throw "No se pudo preparar la restauracion de datos."
}

Write-Host "Restaurando roles..."
if ((Invoke-NativeCommand -FilePath $docker -Arguments ($composeArguments + @("exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "/tmp/esmark_roles.sql"))) -ne 0) {
  throw "Fallo la restauracion de roles. No cambies todavia la aplicacion."
}

Write-Host "Restaurando estructura..."
if ((Invoke-NativeCommand -FilePath $docker -Arguments ($composeArguments + @("exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "/tmp/esmark_schema.sql"))) -ne 0) {
  throw "Fallo la restauracion del esquema. No cambies todavia la aplicacion."
}

Write-Host "Restaurando datos y usuarios..."
if ((Invoke-NativeCommand -FilePath $docker -Arguments ($composeArguments + @("exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "/tmp/esmark_restore_data.sql"))) -ne 0) {
  throw "Fallo la restauracion de datos. No cambies todavia la aplicacion."
}

if ((Invoke-NativeCommand -FilePath $docker -Arguments ($composeArguments + @("restart", "auth", "rest", "realtime", "functions")) -Quiet) -ne 0) {
  throw "Los datos se restauraron, pero no se pudieron reiniciar todos los servicios."
}
Wait-SupabaseHealth -PublicUrl $publicUrl -AnonKey $anonKey

Write-Host "Verificando usuarios y registros locales..."
$verificationSql = @"
select 'auth.users' as tabla, count(*) as registros from auth.users
union all
select 'public.pedidos_danados', count(*) from public.pedidos_danados
union all
select 'public.reportes_generados', count(*) from public.reportes_generados
order by tabla;
"@
if ((Invoke-NativeCommand -FilePath $docker -Arguments ($composeArguments + @("exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", $verificationSql))) -ne 0) {
  throw "La restauracion termino, pero fallo la verificacion de tablas principales."
}

$migrationNote = @"
Migracion desde Supabase Cloud completada: $((Get-Date).ToString("o"))
Respaldo de migracion: $backupDirectoryFull
Los datos de Supabase Cloud NO fueron eliminados.
"@
[System.IO.File]::WriteAllText($markerPath, $migrationNote, $utf8WithoutBom)

Write-Host "Migracion local completada y verificada." -ForegroundColor Green
Write-Host "Siguiente paso: ejecuta 3-Configurar-App.ps1 y prueba el inicio de sesion antes de instalar en las demas computadoras."
