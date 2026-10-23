[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [string]$SessionRoot = '',
    [string]$BriefPath = '',
    [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'adapter-common.ps1')

function Get-MappedRows {
    param([object[]]$Rows, [int[]]$ContentIndexes, [int]$SourceIndex)
    $content = New-Object System.Collections.Generic.List[string]
    $sources = @{}
    foreach ($row in @($Rows)) {
        $parts = @()
        foreach ($index in $ContentIndexes) {
            $value = [string]$row.cells[$index]
            if (-not [string]::IsNullOrWhiteSpace($value) -and $value -cne '-') { $parts += $value }
        }
        if ($parts.Count -gt 0) { [void]$content.Add(($parts -join ' / ')) }
        foreach ($sourceId in @(Split-ControlReferences -Value ([string]$row.cells[$SourceIndex]))) { $sources[$sourceId] = $true }
    }
    return [pscustomobject][ordered]@{ content = @($content); sources = @($sources.Keys | Sort-Object) }
}

function New-GapField {
    param([string]$FieldId, [string]$Target, [object]$Mapping, [string]$Question)
    $hasContent = @($Mapping.content).Count -gt 0
    return [pscustomobject][ordered]@{
        field_id = $FieldId
        fromdemotospec_target = $Target
        coverage = if ($hasContent) { 'partial' } else { 'missing' }
        mapped_content = @($Mapping.content)
        source_ids = @($Mapping.sources)
        gap_or_question = $Question
    }
}

$context = Get-SessionAdapterContext -SessionPath $SessionPath -SessionRoot $SessionRoot
Assert-SessionWritable -SessionPath $SessionPath
Assert-AdapterContract -Condition ([string]$context.state.status -cne 'closed') -Message 'A closed session cannot receive an FromDemoToSpec gap review.'
if ([string]::IsNullOrWhiteSpace($BriefPath)) { $BriefPath = Join-Path $context.session_directory 'game-concept-brief.md' }
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $context.session_directory 'fromdemotospec-gap.json' }
$BriefPath = Resolve-AdapterSessionPath -SessionDirectory $context.session_directory -ArtifactPath $BriefPath
$OutputPath = Resolve-AdapterSessionPath -SessionDirectory $context.session_directory -ArtifactPath $OutputPath
Assert-AdapterContract -Condition ([IO.Path]::GetFileName($BriefPath) -ceq 'game-concept-brief.md') -Message 'FromDemoToSpec adapter requires the stable game-concept-brief.md source.'
Assert-AdapterContract -Condition (-not (Test-Path -LiteralPath $OutputPath)) -Message "FromDemoToSpec gap already exists: $OutputPath"
$briefValidation = Invoke-GameConceptBriefValidation -SessionPath $context.session_directory -SessionRoot $SessionRoot -BriefPath $BriefPath
Assert-AdapterContract -Condition ([string]$briefValidation.fromdemotospec_intent -ceq 'requested') -Message 'Create the FromDemoToSpec gap only after the brief records fromdemotospec_intent=requested.'
$brief = [IO.File]::ReadAllText($BriefPath, $script:BrainstormAdapterUtf8NoBom)

$validationRows = @(Get-MarkdownTableRows -Content $brief -Heading 'Validation and Open Questions' -ExpectedHeaders @('Item ID', 'Type', 'Statement', 'Source IDs', 'Next action'))
$scopeRows = @(Get-MarkdownTableRows -Content $brief -Heading 'Scope' -ExpectedHeaders @('Bucket', 'Included / excluded', 'Rationale', 'Source IDs'))
$verbRows = @(Get-MarkdownTableRows -Content $brief -Heading 'Core Verbs' -ExpectedHeaders @('Verb', 'Player intent', 'Feedback / consequence', 'Source IDs'))
$loopRows = @(Get-MarkdownTableRows -Content $brief -Heading 'Core Loop' -ExpectedHeaders @('Step ID', 'Player action', 'System response', 'Return / progression', 'Source IDs'))
$pillarRows = @(Get-MarkdownTableRows -Content $brief -Heading 'Design Pillars' -ExpectedHeaders @('Pillar ID', 'Commitment', 'In-scope signal', 'Exclusion signal', 'Source IDs'))
$antiRows = @(Get-MarkdownTableRows -Content $brief -Heading 'Anti-goals' -ExpectedHeaders @('Anti-goal ID', 'Avoid', 'Why', 'Source IDs'))

$hypothesis = Get-MappedRows -Rows @($validationRows | Where-Object { [string]$_.cells[1] -ceq 'hypothesis' }) -ContentIndexes @(2) -SourceIndex 3
$success = Get-MappedRows -Rows @($validationRows | Where-Object { [string]$_.cells[1] -ceq 'test' }) -ContentIndexes @(2, 4) -SourceIndex 3
$excluded = Get-MappedRows -Rows @($scopeRows | Where-Object { [string]$_.cells[0] -ceq 'excluded' }) -ContentIndexes @(1, 2) -SourceIndex 3
$operations = Get-MappedRows -Rows $verbRows -ContentIndexes @(0, 1) -SourceIndex 3
$responses = Get-MappedRows -Rows $loopRows -ContentIndexes @(2) -SourceIndex 4
$loop = Get-MappedRows -Rows $loopRows -ContentIndexes @(1, 2, 3) -SourceIndex 4
$rulesA = Get-MappedRows -Rows $pillarRows -ContentIndexes @(1, 2, 3) -SourceIndex 4
$rulesB = Get-MappedRows -Rows $antiRows -ContentIndexes @(1, 2) -SourceIndex 3
$rules = [pscustomobject][ordered]@{
    content = @($rulesA.content) + @($rulesB.content)
    sources = @(@($rulesA.sources) + @($rulesB.sources) | Sort-Object -Unique)
}
$empty = [pscustomobject][ordered]@{ content = @(); sources = @() }


$experienceRows = @(Get-MarkdownTableRows -Content $brief -Heading 'Experience Fragment' -ExpectedHeaders @('Situation', 'Player action / choice', 'Visible consequence', 'Source IDs'))
$conceptRows = @(Get-MarkdownTableRows -Content $brief -Heading 'Concept Frame' -ExpectedHeaders @('Concept', 'Target player / context', 'Emotional promise', 'Source IDs'))
$goalMapping = Get-MappedRows -Rows $conceptRows -ContentIndexes @(0, 1, 2) -SourceIndex 3
$scopeMapping = Get-MappedRows -Rows $scopeRows -ContentIndexes @(0, 1, 2) -SourceIndex 3
$feedbackMapping = Get-MappedRows -Rows $experienceRows -ContentIndexes @(0, 1, 2) -SourceIndex 3
$riskMapping = Get-MappedRows -Rows $validationRows -ContentIndexes @(1, 2, 4) -SourceIndex 3
$maps = @{
    'experience-goal' = $goalMapping; 'core-loop' = $loop; 'scope' = $scopeMapping
    'validation-depth' = $success; 'presentation-feedback' = $feedbackMapping
    'lifecycle-environment' = $empty; 'rules-state' = $rules
    'risks-decisions' = $riskMapping; 'budget-authority' = $empty
}
$actions = @{
    'experience-goal' = 'Review the intended player experience against accepted concept sources.'
    'core-loop' = 'Review choices, costs, consequences and the next cycle across necessary systems.'
    'scope' = 'Review included content and exclusions without removing core feedback or depth.'
    'validation-depth' = 'FromDemoToSpec: define observable scenarios and the depth needed to experience consequences.'
    'presentation-feedback' = 'FromDemoToSpec: autonomously implement necessary understanding, feeling and coherence in the playable slice.'
    'lifecycle-environment' = 'FromDemoToSpec: choose lifecycle; settle formal engine and environment before maintained implementation.'
    'rules-state' = 'FromDemoToSpec: develop executable rules, state and edge cases in the connected design baseline.'
    'risks-decisions' = 'FromDemoToSpec: preserve user decisions, separate assumptions and investigate actual risks.'
    'budget-authority' = 'FromDemoToSpec: reuse authorized budget; propose a bounded first batch and escalate only material tradeoffs.'
}
$fieldList = @(
    foreach ($definition in @(Get-FromDemoToSpecV2Fields)) {
        $id = [string]$definition.field_id
        $field = New-GapField -FieldId $id -Target ([string]$definition.fromdemotospec_target) -Mapping $maps[$id] -Question $actions[$id]
        $field | Add-Member -NotePropertyName blocking -NotePropertyValue ([bool]$definition.required_at_handoff)
        $field | Add-Member -NotePropertyName next_action -NotePropertyValue $actions[$id]
        $field
    }
)

$fromdemotospec = Get-AdapterDefinition -AdapterId 'fromdemotospec-handoff'
$gap = [pscustomobject][ordered]@{
    schema_version = 2
    adapter_id = 'fromdemotospec-handoff'
    session_id = [string]$context.state.session_id
    source_brief = 'game-concept-brief.md'
    source_snapshot = Get-HandoffSourceSnapshot -SessionDirectory $context.session_directory
    external_contract = [pscustomobject][ordered]@{
        path = [string]$fromdemotospec.external_contract.path
        version = [string]$fromdemotospec.external_contract.version
        last_verified_against = [string]$fromdemotospec.external_contract.last_verified_against
    }
    status = 'gap-review'
    structural_review = 'passed'
    semantic_review = 'required'
    reviewer = $null
    decision_ids = @()
    external_flow_started = $false
    fields = $fieldList
    tunable_parameters = @()
}
Write-AdapterUtf8JsonAtomic -Path $OutputPath -Value $gap

if ([string]::IsNullOrWhiteSpace($SessionRoot)) {
    $SessionRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $context.session_directory))
}
try {
    $index = Write-SessionIndex -SessionRoot ([IO.Path]::GetFullPath($SessionRoot))
} catch {
    throw "FromDemoToSpec gap review was preserved at '$OutputPath', but the session index rebuild failed. Do not recreate or overwrite it; repair the index with build-session-index.ps1. $($_.Exception.Message)"
}
[pscustomobject][ordered]@{
    created = $true
    adapter_id = 'fromdemotospec-handoff'
    session_id = [string]$context.state.session_id
    gap_path = $OutputPath
    gap_status = 'gap-review'
    gap_count = $fieldList.Count
    external_flow_started = $false
    index_session_count = [int]$index.session_count
    semantic_review = 'required'
} | ConvertTo-Json -Depth 16
