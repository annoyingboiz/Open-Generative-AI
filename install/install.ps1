# Director — install or update on Windows, one command (PowerShell):
#   irm https://raw.githubusercontent.com/annoyingboiz/Open-Generative-AI/dz/step-2-gateway/install/install.ps1 | iex
# Run it again to update (your data, keys and accounts stay).
# Options (env): DIRECTOR_DIR (default %USERPROFILE%\Director), DIRECTOR_PORT (3300), DIRECTOR_REPO, DIRECTOR_BRANCH.
$ErrorActionPreference = 'Stop'

$Dir    = if ($env:DIRECTOR_DIR) { $env:DIRECTOR_DIR } else { Join-Path $env:USERPROFILE 'Director' }
$Repo   = if ($env:DIRECTOR_REPO) { $env:DIRECTOR_REPO } else { 'https://github.com/annoyingboiz/Open-Generative-AI' }
$Branch = if ($env:DIRECTOR_BRANCH) { $env:DIRECTOR_BRANCH } else { 'dz/step-2-gateway' }
$Port   = if ($env:DIRECTOR_PORT) { [int]$env:DIRECTOR_PORT } else { 3300 }

function Say($t)  { Write-Host $t -ForegroundColor Cyan }
function Fail($t) { Write-Host $t -ForegroundColor Red; exit 1 }

Say "Director - install / update into $Dir"

# 1. Docker Desktop
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host 'Docker Desktop is not installed. Director runs in Docker.' -ForegroundColor Yellow
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $a = Read-Host 'Install Docker Desktop with winget now? [y/N]'
    if ($a -match '^[yY]') {
      winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
      Fail 'Docker Desktop is installed. Restart Windows if it asks, start Docker Desktop, then run this again.'
    }
  }
  Start-Process 'https://www.docker.com/products/docker-desktop/'
  Fail 'Install Docker Desktop, start it, then run this again.'
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Say 'Starting Docker Desktop...'
  $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $dd) { Start-Process $dd }
  for ($i = 0; $i -lt 60; $i++) { docker info *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 3 }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { Fail 'Docker is not running. Start Docker Desktop and run this again.' }
}

# 2. The code: git if installed, otherwise a download (data and settings are kept).
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
if (Test-Path (Join-Path $Dir '.git')) {
  Say 'Updating the code...'
  git -C $Dir fetch --depth 1 origin $Branch; git -C $Dir checkout -q -B $Branch FETCH_HEAD
} else {
  Say 'Downloading the code...'
  $ownerRepo = $Repo -replace '^https://github.com/', ''
  $tmp = Join-Path $env:TEMP ("director-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'src.zip'
  Invoke-WebRequest -UseBasicParsing "https://codeload.github.com/$ownerRepo/zip/refs/heads/$Branch" -OutFile $zip
  Expand-Archive $zip -DestinationPath $tmp
  $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
  # Keep data\ and .env; replace everything else.
  Copy-Item -Path (Join-Path $src.FullName '*') -Destination $Dir -Recurse -Force
  Remove-Item $tmp -Recurse -Force
}
Set-Location $Dir

# 3. Settings: a free port, data next to the code.
$envFile = Join-Path $Dir '.env'
if (-not (Test-Path $envFile)) {
  while (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { $Port++ }
  "# Director on this computer. Keys go into Settings in the app (stored encrypted in data\).`nPORT=$Port`nDATA_DIR=./data`n" | Set-Content -Encoding ascii $envFile
}
$line = Select-String -Path $envFile -Pattern '^PORT=(\d+)' | Select-Object -First 1
if ($line) { $Port = [int]$line.Matches[0].Groups[1].Value }
New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'data') | Out-Null

# 4. Build and start (the first build takes a few minutes).
Say 'Building and starting Director (first time: 5-10 minutes)...'
docker compose -f docker-compose.yml -f deploy/compose.personal.yml up -d --build
if ($LASTEXITCODE -ne 0) { Fail 'Docker could not start Director. See the messages above.' }

$url = "http://localhost:$Port"
Say 'Waiting for Director to start...'
$ok = $false
for ($i = 0; $i -lt 120; $i++) {
  try { Invoke-WebRequest -UseBasicParsing "$url/healthz" -TimeoutSec 3 | Out-Null; $ok = $true; break } catch { Start-Sleep 3 }
}
if (-not $ok) { Fail "Director did not start. See: cd `"$Dir`"; docker compose logs gateway" }

$codeFile = Join-Path $Dir 'data\setup-code'
if (Test-Path $codeFile) {
  $code = (Get-Content $codeFile -Raw).Trim()
  Say 'Ready. First start: create your admin account (the setup code is filled in).'
  Start-Process "$url/setup?code=$code"
  Write-Host "If the browser didn't open: $url/setup   setup code: $code"
} else {
  Say "Ready: $url"
  Start-Process $url
}
Write-Host ""
Write-Host "  Open:    $url"
Write-Host "  Update:  run this installer again"
Write-Host "  Stop:    cd `"$Dir`"; docker compose stop"
Write-Host "  Start:   cd `"$Dir`"; docker compose -f docker-compose.yml -f deploy/compose.personal.yml up -d"
Write-Host "  Logs:    cd `"$Dir`"; docker compose logs -f gateway"
