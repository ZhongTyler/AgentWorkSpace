$ErrorActionPreference = 'Stop'
$fluxRoot = $PSScriptRoot
$fluxToolsHome = Split-Path (Split-Path $fluxRoot -Parent) -Parent
if ((Test-Path -LiteralPath (Join-Path $fluxToolsHome 'portable-profile.json')) -and -not (Test-Path -LiteralPath (Join-Path $fluxToolsHome '.tools-home.json'))) { throw 'Prepare an external Tools home before starting; managed modules are read-only' }
$fluxRuntime = Join-Path $fluxRoot 'runtime'
$fluxPython = Join-Path $fluxRuntime 'venv\Scripts\python.exe'
$fluxSource = (Get-Content -LiteralPath (Join-Path $fluxRuntime 'source-path.txt') -Raw).Trim()
if (-not ([IO.Path]::GetFullPath($fluxSource)).StartsWith(([IO.Path]::GetFullPath($fluxRuntime) + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Source path escapes tool runtime' }
$fluxLock = Get-Content -LiteralPath (Join-Path $fluxRoot 'source-lock.json') -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath($fluxSource) -ne [IO.Path]::GetFullPath((Join-Path $fluxRuntime ('ComfyUI-' + $fluxLock.source.commit)))) { throw 'Source does not match pinned version' }
if (Get-NetTCPConnection -LocalPort 8199 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8199 is already in use; verify the existing owner before starting another server' }
$fluxStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$fluxStdout = Join-Path $fluxRuntime "server-$fluxStamp.out.log"
$fluxStderr = Join-Path $fluxRuntime "server-$fluxStamp.err.log"
$fluxArgs = @('-X','utf8','-B', (Join-Path $fluxSource 'main.py'), '--listen','127.0.0.1','--port','8199','--disable-auto-launch','--disable-all-custom-nodes','--offline','--reserve-vram','2','--disable-pinned-memory','--disable-async-offload','--output-directory',(Join-Path $fluxRuntime 'outputs'))
$fluxQuotedArgs = @($fluxArgs | ForEach-Object { '"' + $_.Replace('"','\"') + '"' })
$fluxProcess = Start-Process -FilePath $fluxPython -ArgumentList $fluxQuotedArgs -WorkingDirectory $fluxSource -WindowStyle Hidden -RedirectStandardOutput $fluxStdout -RedirectStandardError $fluxStderr -PassThru
@{ pid=$fluxProcess.Id; source=$fluxSource; port=8199; arguments=$fluxArgs; started_at=(Get-Date).ToString('o'); stdout=$fluxStdout; stderr=$fluxStderr } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fluxRuntime 'server-state.json') -Encoding utf8
Write-Output "Started local-only ComfyUI (launcher PID $($fluxProcess.Id)); inspect logs and http://127.0.0.1:8199/system_stats before generating."
