[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [Parameter(Mandatory = $true)][string]$PriorIdeaId,
    [Parameter(Mandatory = $true)][string]$NewIdeaId,
    [Parameter(Mandatory = $true)][string]$NewIdea,
    [ValidateSet('user', 'ai-independent', 'project-fact', 'knowledge', 'web')]
    [string]$Source = 'ai-independent',
    [ValidateSet('none', 'shortlist', 'component', 'package', 'prototype', 'later')]
    [string]$Adoption = 'none',
    [string]$ParentIds = '',
    [Parameter(Mandatory = $true)][string]$RevisionReason,
    [string]$SessionRoot = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'session-common.ps1')

Assert-SessionContract -Condition ($PriorIdeaId -cmatch '^IDEA-[0-9]{3,}$') -Message "Invalid PriorIdeaId: $PriorIdeaId"
Assert-SessionContract -Condition ($NewIdeaId -cmatch '^IDEA-[0-9]{3,}$') -Message "Invalid NewIdeaId: $NewIdeaId"
Assert-SessionContract -Condition ($PriorIdeaId -cne $NewIdeaId) -Message 'A revision requires a new Idea ID.'
Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($NewIdea)) -Message 'NewIdea is required.'
Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($RevisionReason) -and $RevisionReason -cne '-') -Message 'RevisionReason is required.'

Assert-SessionWritable -SessionPath $SessionPath
$statePath = Resolve-SessionStatePath -SessionPath $SessionPath
$sessionDirectory = Split-Path -Parent $statePath
$state = Read-Utf8Json -Path $statePath
Assert-SessionContract -Condition ([string]$state.status -cne 'closed') -Message 'Closed sessions are immutable.'
[void](Get-SessionValidation -SessionPath $sessionDirectory -SessionRoot $SessionRoot)
$recordPath = Resolve-SafeRelativePath -BasePath $sessionDirectory -RelativePath ([string]$state.record_path)
$record = [IO.File]::ReadAllText($recordPath, $script:BrainstormUtf8NoBom)
Assert-SessionContract -Condition ((Get-SessionRecordSchemaVersion -Content $record) -eq 2) -Message 'Idea revisions require session record schema 2.'

$headers = @('Idea ID', 'Parent IDs', 'Source', 'Method ID', 'Disposition', 'Adoption', 'Idea', 'Destination', 'Supersedes', 'Decision reason')
$rows = @(Get-MarkdownTableRows -Content $record -Heading 'Idea Ledger' -ExpectedHeaders $headers)
$ideas = @{}
foreach ($row in $rows) { $ideas[[string]$row.cells[0]] = $row }
Assert-SessionContract -Condition ($ideas.ContainsKey($PriorIdeaId)) -Message "Unknown prior Idea ID: $PriorIdeaId"
Assert-SessionContract -Condition (-not $ideas.ContainsKey($NewIdeaId)) -Message "New Idea ID already exists: $NewIdeaId"
$priorCells = @($ideas[$PriorIdeaId].cells)
Assert-SessionContract -Condition (@('active', 'parked') -ccontains [string]$priorCells[4]) -Message "Only active or parked Ideas may be revised: $PriorIdeaId"

if ([string]::IsNullOrWhiteSpace($ParentIds)) { $ParentIds = $PriorIdeaId }
foreach ($parentId in @(Split-ControlReferences -Value $ParentIds)) {
    Assert-SessionContract -Condition ($ideas.ContainsKey($parentId)) -Message "Unknown revision parent: $parentId"
}

$priorCells[4] = 'superseded'
$priorCells[5] = 'none'
$priorCells[7] = $NewIdeaId
$priorCells[9] = $RevisionReason
$updated = Set-MarkdownTableRow -Content $record -Heading 'Idea Ledger' -RowId $PriorIdeaId -Cells $priorCells
$updated = Add-MarkdownTableRow -Content $updated -Heading 'Idea Ledger' -Cells @(
    $NewIdeaId,
    $ParentIds,
    $Source,
    '-',
    'active',
    $Adoption,
    $NewIdea,
    '-',
    $PriorIdeaId,
    '-'
)
$state.updated_at = (Get-Date).ToUniversalTime().ToString('o')
$commit = Complete-SessionUpdate -SessionPath $sessionDirectory -State $state -Record $updated -SessionRoot $SessionRoot
$validation = $commit.validation
$index = $commit.index

[pscustomobject][ordered]@{
    changed = $true
    prior_idea_id = $PriorIdeaId
    new_idea_id = $NewIdeaId
    prior_idea_text_unchanged = $true
    validation = $validation
    index_summary = [pscustomobject][ordered]@{
        session_count = [int]$index.session_count
        total_bytes = [long]$index.total_bytes
        warnings = @($index.warnings)
    }
} | ConvertTo-Json -Depth 16
