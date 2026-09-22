# Launches index.html in the user's default browser (resolved from registry).
# MAPHTML env var must point to index.html (set by 启动地图.bat).
$ErrorActionPreference = 'Stop'
$f = $env:MAPHTML
if (-not $f -or -not (Test-Path $f)) { exit 1 }
$url = 'file:///' + $f.Replace('\', '/')
try {
  $p = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice').ProgId
  $c = Get-ItemPropertyValue ('Registry::HKEY_CLASSES_ROOT\' + $p + '\shell\open\command') -Name '(default)'
  $exe = [regex]::Match($c, '"?([^"]+\.exe)').Groups[1].Value
  if (-not $exe -or -not (Test-Path $exe)) { throw 'no exe' }
  Start-Process $exe $url
  exit 0
} catch {
  # Fallback: well-known browser install paths
  $cands = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($e in $cands) {
    if (Test-Path $e) { Start-Process $e $url; exit 0 }
  }
  exit 1
}
