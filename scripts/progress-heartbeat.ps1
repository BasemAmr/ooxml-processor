$ErrorActionPreference = 'SilentlyContinue'
$repo = Split-Path -Parent $PSScriptRoot
$note = Join-Path $repo 'scratch-progress.txt'
while ($true) {
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
  $commit = (git -C $repo rev-parse --short HEAD 2>$null)
  $dirty = (git -C $repo status --short 2>$null | Measure-Object -Line).Lines
  Add-Content -LiteralPath $note -Value ("Heartbeat: $timestamp | commit=$commit | dirty-files=$dirty")
  Start-Sleep -Seconds 420
}
