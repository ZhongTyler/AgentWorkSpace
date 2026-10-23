[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [string]$CurrentFocus,
    [string]$NextAction,
    [string]$PauseBoundary,
    [string]$DecisionRefs,
    [string]$SessionRoot = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'session-common.ps1')
Assert-SessionWritable -SessionPath $SessionPath
$statePath = Resolve-SessionStatePath -SessionPath $SessionPath
$directory = Split-Path -Parent $statePath
[void](Get-SessionValidation -SessionPath $directory -SessionRoot $SessionRoot)
$state = Read-Utf8Json -Path $statePath
$recordPath = Resolve-SafeRelativePath -BasePath $directory -RelativePath ([string]$state.record_path)
$original = [IO.File]::ReadAllText($recordPath, $script:BrainstormUtf8NoBom)
$record = $original
foreach ($pair in @(@('CurrentFocus','Current focus'), @('NextAction','Next action'), @('PauseBoundary','Pause boundary'), @('DecisionRefs','Decision refs'))) {
    if ($PSBoundParameters.ContainsKey($pair[0])) {
        $record = Set-SessionContinuationField -Content $record -Field $pair[1] -Value ([string]$PSBoundParameters[$pair[0]])
    }
}
$changed = $record -cne $original
if ($changed) {
    $state.updated_at = (Get-Date).ToUniversalTime().ToString('o')
    $commit = Complete-SessionUpdate -SessionPath $directory -State $state -Record $record -SessionRoot $SessionRoot
}
[pscustomobject]@{ changed = $changed; navigation_appended = $false; state_path = $statePath } | ConvertTo-Json -Depth 8
