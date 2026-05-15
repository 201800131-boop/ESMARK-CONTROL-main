$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Set-Location $repoRoot

$dirty = git status --porcelain
if (-not [string]::IsNullOrWhiteSpace($dirty)) {
  Write-Error 'Hay cambios sin commit. Limpia o guarda esos cambios antes de ejecutar release:auto.'
}

$packagePath = Join-Path $repoRoot 'apps\windows\package.json'
$raw = Get-Content $packagePath -Raw

$versionMatch = [regex]::Match($raw, '"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"')
if (-not $versionMatch.Success) {
  Write-Error 'No se pudo leer version semver desde apps/windows/package.json.'
}

$major = [int]$versionMatch.Groups[1].Value
$minor = [int]$versionMatch.Groups[2].Value
$patch = [int]$versionMatch.Groups[3].Value

$newVersion = "$major.$minor.$($patch + 1)"
$newTag = "v$newVersion"

Write-Host "Incrementando version a $newVersion ..." -ForegroundColor Cyan

$updated = [regex]::Replace(
  $raw,
  '"version"\s*:\s*"\d+\.\d+\.\d+"',
  "`"version`": `"$newVersion`"",
  1
)

[System.IO.File]::WriteAllText(
  $packagePath,
  $updated,
  [System.Text.UTF8Encoding]::new($false)
)

git add apps/windows/package.json
git commit -m "chore(release): bump windows app to $newTag"
git tag $newTag

Write-Host 'Publicando commit y tag...' -ForegroundColor Cyan
git push origin main
git push origin $newTag

Write-Host "Release preparado. Se disparo el workflow con tag $newTag." -ForegroundColor Green
