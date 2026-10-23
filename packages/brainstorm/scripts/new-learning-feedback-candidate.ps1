[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [Parameter(Mandatory = $true)][string]$ArtifactId,
    [Parameter(Mandatory = $true)][string]$DecisionId,
    [Parameter(Mandatory = $true)][string]$SourceIds,
    [string]$SessionRoot = ''
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDirectory 'session-common.ps1')

Assert-SessionContract -Condition ($DecisionId -cmatch '^DEC-[0-9]{3,}$') -Message "Invalid DecisionId: $DecisionId"
Assert-SessionWritable -SessionPath $SessionPath
$statePath = Resolve-SessionStatePath -SessionPath $SessionPath
$sessionDirectory = Split-Path -Parent $statePath
$state = Read-Utf8Json -Path $statePath
[void](Get-SessionValidation -SessionPath $sessionDirectory -SessionRoot $SessionRoot)
$recordPath = Resolve-SafeRelativePath -BasePath $sessionDirectory -RelativePath ([string]$state.record_path)
$record = [IO.File]::ReadAllText($recordPath, $script:BrainstormUtf8NoBom)
$decisionRows = @(Get-MarkdownTableRows -Content $record -Heading 'Decision Record' -ExpectedHeaders @('Decision ID', 'Candidate IDs', 'Decision', 'Criteria', 'Evidence IDs', 'Decider'))
$decision = @($decisionRows | Where-Object { [string]$_.cells[0] -ceq $DecisionId })
Assert-SessionContract -Condition ($decision.Count -eq 1) -Message "Unknown DecisionId: $DecisionId"
Assert-SessionContract -Condition (@('user', 'joint') -ccontains [string]$decision[0].cells[5]) -Message "Learning candidate requires a user or joint decision: $DecisionId"

$creationArgs = @(
    '-SessionPath', $sessionDirectory,
    '-ArtifactId', $ArtifactId,
    '-Kind', 'learning-feedback',
    '-Title', ("Learning feedback for " + $DecisionId),
    '-SourceIds', $SourceIds,
    '-Purpose', ("Collect reversible prototype evidence for " + $DecisionId)
)
if (-not [string]::IsNullOrWhiteSpace($SessionRoot)) {
    $creationArgs += @('-SessionRoot', $SessionRoot)
}
$creation = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptDirectory 'new-session-artifact.ps1') @creationArgs
if ($LASTEXITCODE -ne 0) { throw 'Learning candidate creation failed.' }
$result = ($creation -join "`n") | ConvertFrom-Json
$templatePath = Join-Path (Get-BrainstormProjectRoot) 'templates\learning-feedback-candidate.md'
$content = [IO.File]::ReadAllText($templatePath, $script:BrainstormUtf8NoBom)
$content = $content.Replace('{{ARTIFACT_ID}}', $ArtifactId).Replace('{{SESSION_ID}}', [string]$state.session_id).Replace('{{DECISION_ID}}', $DecisionId).Replace('{{SOURCE_IDS}}', $SourceIds).Replace('{{CREATED_AT}}', (Get-Date).ToUniversalTime().ToString('o'))
Write-Utf8TextAtomic -Path ([string]$result.artifact_path) -Value $content
$state.updated_at = (Get-Date).ToUniversalTime().ToString('o')
$commit = Complete-SessionUpdate -SessionPath $sessionDirectory -State $state -SessionRoot $SessionRoot

[pscustomobject][ordered]@{
    created = $true
    artifact_id = $ArtifactId
    artifact_path = [string]$result.artifact_path
    decision_id = $DecisionId
    knowledge_write = $false
    review_required = $true
} | ConvertTo-Json -Depth 8
