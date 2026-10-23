[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [Parameter(Mandatory = $true)][string]$Reason,
    [string]$SessionRoot = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'adapter-common.ps1')
Assert-SessionWritable -SessionPath $SessionPath
Assert-AdapterContract (-not [string]::IsNullOrWhiteSpace($Reason)) 'Explain why the source or mapping needs review.'
$context = Get-SessionAdapterContext -SessionPath $SessionPath -SessionRoot $SessionRoot
$directory = $context.session_directory
$archiveRef = 'artifacts/handoff-history/' + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$archive = Resolve-SafeRelativePath -BasePath $directory -RelativePath $archiveRef
[void](New-Item -ItemType Directory -Path $archive -Force)
$freshPath = Resolve-SafeRelativePath -BasePath $directory -RelativePath ($archiveRef + '/rebuilt-gap.json')
$arguments = @('-SessionPath', $directory, '-OutputPath', $freshPath)
if ($SessionRoot) { $arguments += @('-SessionRoot', $SessionRoot) }
$output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'new-fromdemotospec-gap.ps1') @arguments)
Assert-AdapterContract ($LASTEXITCODE -eq 0) 'Rebuilding the mapping failed; existing gap and handoff were preserved.'
$fresh = Read-Utf8Json -Path $freshPath
$gapPath = Resolve-SafeRelativePath -BasePath $directory -RelativePath 'fromdemotospec-gap.json'
$handoffPath = Resolve-SafeRelativePath -BasePath $directory -RelativePath 'fromdemotospec-handoff.md'
$oldGap = if (Test-Path -LiteralPath $gapPath) { [IO.File]::ReadAllBytes($gapPath) } else { $null }
$savedHandoff = Resolve-SafeRelativePath -BasePath $directory -RelativePath ($archiveRef + '/previous-handoff.md')
if ($null -ne $oldGap) { [IO.File]::WriteAllBytes((Join-Path $archive 'previous-gap.json'), $oldGap) }
Write-Utf8TextAtomic -Path (Join-Path $archive 'reason.md') -Value $Reason
$moved = $false
try {
    if (Test-Path -LiteralPath $handoffPath) {
        Move-Item -LiteralPath $handoffPath -Destination $savedHandoff
        $moved = $true
    }
    Write-Utf8JsonAtomic -Path $gapPath -Value $fresh
} catch {
    if ($null -ne $oldGap) { [IO.File]::WriteAllBytes($gapPath, $oldGap) }
    if ($moved) { Move-Item -LiteralPath $savedHandoff -Destination $handoffPath }
    throw
}
if (-not $SessionRoot) { $SessionRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $directory)) }
try { [void](Write-SessionIndex -SessionRoot $SessionRoot) }
catch { throw "Mapping reset committed; history is at $archive. Repair the index with build-session-index before continuing. $($_.Exception.Message)" }
[pscustomobject]@{
    reset = $true
    gap_status = 'gap-review'
    semantic_review = 'required'
    archive_path = $archive
    decision_changed = $false
    external_flow_started = $false
    next_action = 'Review current mappings and sources; only mark ready after a new semantic review.'
} | ConvertTo-Json -Depth 8
