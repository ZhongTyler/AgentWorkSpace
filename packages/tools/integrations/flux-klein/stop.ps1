$ErrorActionPreference = 'Stop'
$fluxRuntime = Join-Path $PSScriptRoot 'runtime'
$fluxSource = (Get-Content -LiteralPath (Join-Path $fluxRuntime 'source-path.txt') -Raw).Trim()
$fluxLock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source-lock.json') -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath($fluxSource) -ne [IO.Path]::GetFullPath((Join-Path $fluxRuntime ('ComfyUI-' + $fluxLock.source.commit)))) { throw 'Refusing to stop a source outside this pinned installation' }
$fluxMain = Join-Path $fluxSource 'main.py'
$fluxProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -and $_.CommandLine.Contains($fluxMain) })
foreach ($fluxProcess in $fluxProcesses) { Stop-Process -Id $fluxProcess.ProcessId -ErrorAction Stop }
Write-Output "Stopped $($fluxProcesses.Count) processes belonging to this exact ComfyUI source."
