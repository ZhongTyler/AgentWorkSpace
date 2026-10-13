param(
    [Parameter(Mandatory=$true)][string]$Executable,
    [string]$Runtime = (Join-Path $env:LOCALAPPDATA 'ResearchMCP/xiaohongshu'),
    [string]$Browser = '',
    [int]$Port = 18062
)
$ErrorActionPreference = 'Stop'
$resolvedExe = (Resolve-Path -LiteralPath $Executable).Path
if (-not (Test-Path -LiteralPath $resolvedExe -PathType Leaf)) { throw 'MCP executable not found' }
New-Item -ItemType Directory -Path $Runtime -Force | Out-Null
$resolvedRuntime = (Resolve-Path -LiteralPath $Runtime).Path
$env:COOKIES_PATH = Join-Path $resolvedRuntime 'cookies.json'
$env:XHS_BROWSER_PROFILE = Join-Path $resolvedRuntime 'browser-profile'
if ($Browser) { $env:XHS_BROWSER_BIN = (Resolve-Path -LiteralPath $Browser).Path }
$process = Start-Process -FilePath $resolvedExe -ArgumentList @('-headless=true', "-port=127.0.0.1:$Port") -WorkingDirectory $resolvedRuntime -WindowStyle Hidden -RedirectStandardOutput (Join-Path $resolvedRuntime 'stdout.log') -RedirectStandardError (Join-Path $resolvedRuntime 'stderr.log') -PassThru
Write-Output "Started research Xiaohongshu MCP PID $($process.Id) on loopback port $Port."
