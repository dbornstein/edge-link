$pidPath = Join-Path (Get-Location) ".dev-server.pid"
if (-not (Test-Path $pidPath)) {
  Write-Host "No dev server PID file found." -ForegroundColor Yellow
  exit 0
}
$devPid = Get-Content $pidPath | Select-Object -First 1
if ($devPid -and ($devPid -as [int])) {
  try {
    Stop-Process -Id ($devPid -as [int]) -ErrorAction Stop
    Write-Host "Stopped dev server process $devPid." -ForegroundColor Green
  } catch {
    Write-Host "Process $devPid was not running." -ForegroundColor Yellow
  }
} else {
  Write-Host "PID file was empty." -ForegroundColor Yellow
}
Remove-Item $pidPath -ErrorAction SilentlyContinue
