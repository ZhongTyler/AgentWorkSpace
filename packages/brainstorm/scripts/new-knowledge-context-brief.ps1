[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [string]$SessionRoot = '',
    [ValidateSet('query', 'deep-query')][string]$QueryIntent = 'query',
    [ValidateSet('available', 'unavailable')][string]$KnowledgeAvailability = 'available',
    [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'adapter-common.ps1')

$context = Get-SessionAdapterContext -SessionPath $SessionPath -SessionRoot $SessionRoot
Assert-SessionWritable -SessionPath $SessionPath
Assert-AdapterContract -Condition ([string]$context.state.status -cne 'closed') -Message 'A closed session cannot receive a ContextBrief.'
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $context.session_directory 'knowledge-context-brief.md' }
$OutputPath = Resolve-AdapterSessionPath -SessionDirectory $context.session_directory -ArtifactPath $OutputPath
Assert-AdapterContract -Condition (-not (Test-Path -LiteralPath $OutputPath)) -Message "ContextBrief already exists: $OutputPath"

$templatePath = Join-Path $script:BrainstormAdapterProjectRoot 'templates\knowledge-context-brief.md'
$template = [IO.File]::ReadAllText($templatePath, $script:BrainstormAdapterUtf8NoBom)
$goalMatch = [regex]::Match($context.record, '(?m)^- Goal:\s*(.+)$')
$task = if ($goalMatch.Success) { [string]$goalMatch.Groups[1].Value.Trim() } else { '-' }
$queryResult = if ($KnowledgeAvailability -ceq 'unavailable') { 'unavailable' } else { 'pending' }
$notes = if ($KnowledgeAvailability -ceq 'unavailable') { 'Knowledge unavailable; evidence review was not run.' } else { '-' }
$content = $template.
    Replace('{{SESSION_ID}}', [string]$context.state.session_id).
    Replace('{{SESSION_TITLE}}', [string]$context.state.title).
    Replace('{{QUERY_INTENT}}', $QueryIntent).
    Replace('{{TASK}}', $task).
    Replace('{{KNOWLEDGE_AVAILABILITY}}', $KnowledgeAvailability).
    Replace('{{QUERY_RESULT}}', $queryResult).
    Replace('{{RESULT_NOTES}}', $notes)
Write-AdapterUtf8TextAtomic -Path $OutputPath -Value $content

if ([string]::IsNullOrWhiteSpace($SessionRoot)) {
    $SessionRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $context.session_directory))
}
try {
    $index = Write-SessionIndex -SessionRoot ([IO.Path]::GetFullPath($SessionRoot))
} catch {
    throw "ContextBrief was preserved at '$OutputPath', but the session index rebuild failed. Do not recreate or overwrite it; repair the index with build-session-index.ps1. $($_.Exception.Message)"
}
[pscustomobject][ordered]@{
    created = $true
    context_prepared = $true
    query_executed = $false
    adapter_id = 'knowledge-context-brief'
    session_id = [string]$context.state.session_id
    query_intent = $QueryIntent
    knowledge_availability = $KnowledgeAvailability
    output_path = $OutputPath
    index_session_count = [int]$index.session_count
    semantic_review = 'required'
} | ConvertTo-Json -Depth 16
