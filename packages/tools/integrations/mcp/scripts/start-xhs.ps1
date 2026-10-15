param(
    [string]$Executable = '',
    [string]$Runtime = (Join-Path $env:LOCALAPPDATA 'ResearchMCP/xiaohongshu'),
    [string]$Browser = '',
    [ValidateRange(1,65535)][int]$Port = 18062,
    [switch]$BoundedReader
)
$ErrorActionPreference = 'Stop'
if ($BoundedReader) {
    if ($Executable) { throw 'Choose either -Executable or -BoundedReader' }
    $readerLock = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../xhs-compat-lock.json') -Raw | ConvertFrom-Json
    $Executable = Join-Path $Runtime $readerLock.bounded_note_reader.runtime_filename
    if ((Get-FileHash -LiteralPath $Executable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $readerLock.bounded_note_reader.binary_sha256) { throw 'Bounded reader fingerprint differs; do not start an unknown build' }
}
if (-not $Executable) { throw 'Specify -Executable or the installed pinned -BoundedReader' }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw 'Port already has a listener; inspect ownership before starting another service' }
$resolvedExe = (Resolve-Path -LiteralPath $Executable).Path
if (-not (Test-Path -LiteralPath $resolvedExe -PathType Leaf)) { throw 'MCP executable not found' }
New-Item -ItemType Directory -Path $Runtime -Force | Out-Null
$resolvedRuntime = (Resolve-Path -LiteralPath $Runtime).Path
$env:COOKIES_PATH = Join-Path $resolvedRuntime 'cookies.json'
$env:XHS_BROWSER_PROFILE = Join-Path $resolvedRuntime 'browser-profile'
if ($Browser) { $env:XHS_BROWSER_BIN = (Resolve-Path -LiteralPath $Browser).Path }
$process = Start-Process -FilePath $resolvedExe -ArgumentList @('-headless=true', "-port=127.0.0.1:$Port") -WorkingDirectory $resolvedRuntime -WindowStyle Hidden -RedirectStandardOutput (Join-Path $resolvedRuntime 'stdout.log') -RedirectStandardError (Join-Path $resolvedRuntime 'stderr.log') -PassThru
Write-Output "Started research Xiaohongshu MCP PID $($process.Id) on loopback port $Port."
