[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [Parameter(Mandatory = $true)]
    [ValidateSet('capture', 'framing', 'divergence', 'clustering', 'combination', 'convergence', 'recording', 'handoff', 'paused', 'closed')]
    [string]$Phase,
    [string]$MethodId = '-',
    [Parameter(Mandatory = $true)][string]$AiResponsibility,
    [Parameter(Mandatory = $true)][string]$UserAction,
    [Parameter(Mandatory = $true)][string]$NextStep,
    [string]$CurrentFocus = '',
    [string]$PauseBoundary = '',
    [string]$DecisionRefs = '',
    [string]$SessionRoot = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'session-common.ps1')

foreach ($value in @($AiResponsibility, $UserAction, $NextStep)) {
    Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($value) -and $value -cne '-') -Message 'Navigator guidance fields must be non-empty.'
}

Assert-SessionWritable -SessionPath $SessionPath
$statePath = Resolve-SessionStatePath -SessionPath $SessionPath
$sessionDirectory = Split-Path -Parent $statePath
$state = Read-Utf8Json -Path $statePath
Assert-SessionContract -Condition ([string]$state.status -cne 'closed') -Message 'Closed sessions are immutable.'
[void](Get-SessionValidation -SessionPath $sessionDirectory -SessionRoot $SessionRoot)

$catalog = Read-Utf8Json -Path (Join-Path (Get-BrainstormProjectRoot) 'methods\catalog.json')
$readyMethodIds = @($catalog.methods | Where-Object { [string]$_.status -ceq 'ready' } | ForEach-Object { [string]$_.method_id })
Assert-SessionContract -Condition ($MethodId -ceq '-' -or $readyMethodIds -ccontains $MethodId) -Message "MethodId must be '-' or a ready Method ID: $MethodId"

$recordPath = Resolve-SafeRelativePath -BasePath $sessionDirectory -RelativePath ([string]$state.record_path)
$record = [IO.File]::ReadAllText($recordPath, $script:BrainstormUtf8NoBom)
Assert-SessionContract -Condition ((Get-SessionRecordSchemaVersion -Content $record) -eq 2) -Message 'Phase navigation requires session record schema 2.'
$rows = @(Get-MarkdownTableRows -Content $record -Heading 'Phase Navigator' -ExpectedHeaders @('Navigation ID', 'Phase', 'Method ID', 'AI responsibility', 'User action', 'Next step'))
$maxSequence = 0
foreach ($row in $rows) {
    $id = [string]$row.cells[0]
    if ($id -cmatch '^NAV-([0-9]{3,})$') {
        $maxSequence = [Math]::Max($maxSequence, [int]$Matches[1])
    }
}
$navigationId = 'NAV-' + ($maxSequence + 1).ToString('000')
$updatedRecord = Add-MarkdownTableRow -Content $record -Heading 'Phase Navigator' -Cells @(
    $navigationId,
    $Phase,
    $MethodId,
    $AiResponsibility,
    $UserAction,
    $NextStep
)
$updatedRecord = Set-SessionContinuationField -Content $updatedRecord -Field 'Next action' -Value $NextStep
if (-not [string]::IsNullOrWhiteSpace($CurrentFocus)) {
    $updatedRecord = Set-SessionContinuationField -Content $updatedRecord -Field 'Current focus' -Value $CurrentFocus
}
if (-not [string]::IsNullOrWhiteSpace($PauseBoundary)) {
    $updatedRecord = Set-SessionContinuationField -Content $updatedRecord -Field 'Pause boundary' -Value $PauseBoundary
}
if (-not [string]::IsNullOrWhiteSpace($DecisionRefs)) {
    $decisionRows = @(Get-MarkdownTableRows -Content $record -Heading 'Decision Record' -ExpectedHeaders @('Decision ID', 'Candidate IDs', 'Decision', 'Criteria', 'Evidence IDs', 'Decider'))
    $available = @($decisionRows | ForEach-Object { [string]$_.cells[0] })
    foreach ($id in @(Split-ControlReferences -Value $DecisionRefs)) {
        Assert-SessionContract -Condition ($available -ccontains $id) -Message "Unknown continuation Decision ref: $id"
    }
    $updatedRecord = Set-SessionContinuationField -Content $updatedRecord -Field 'Decision refs' -Value $DecisionRefs
}
$state.updated_at = (Get-Date).ToUniversalTime().ToString('o')
$commit = Complete-SessionUpdate -SessionPath $sessionDirectory -State $state -Record $updatedRecord -SessionRoot $SessionRoot
$validation = $commit.validation
$index = $commit.index

[pscustomobject][ordered]@{
    changed = $true
    navigation_id = $navigationId
    phase = $Phase
    method_id = $MethodId
    validation = $validation
    index_summary = [pscustomobject][ordered]@{
        session_count = [int]$index.session_count
        total_bytes = [long]$index.total_bytes
        warnings = @($index.warnings)
    }
} | ConvertTo-Json -Depth 16
