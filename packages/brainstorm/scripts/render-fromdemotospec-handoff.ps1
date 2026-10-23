[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [string]$SessionRoot = '',
    [string]$GapPath = '',
    [string]$BriefPath = '',
    [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'adapter-common.ps1')

function ConvertTo-MarkdownCell {
    param([string]$Value)
    return $Value.Replace("`r", ' ').Replace("`n", ' ').Replace('|', '\|').Trim()
}

function Format-HandoffField {
    param([string]$Title, [object]$Field)
    $lines = @("### $Title", '')
    foreach ($content in @($Field.mapped_content)) {
        $lines += ('- ' + (ConvertTo-MarkdownCell -Value ([string]$content)) + ' -- Sources: ' + (@($Field.source_ids) -join ', '))
    }

    if ($Field.PSObject.Properties.Name -contains 'next_action') {
        $lines += ('Coverage: ' + [string]$Field.coverage)
        $lines += ('Rationale / gap: ' + (ConvertTo-MarkdownCell -Value ([string]$Field.gap_or_question)))
        $lines += ('Next action: ' + (ConvertTo-MarkdownCell -Value ([string]$Field.next_action)))
    }

    return ($lines -join "`n")
}

$result = Get-FromDemoToSpecGapValidation -SessionPath $SessionPath -SessionRoot $SessionRoot -GapPath $GapPath -BriefPath $BriefPath
Assert-AdapterContract -Condition ([string]$result.gap_status -ceq 'ready') -Message 'FromDemoToSpec handoff rendering requires gap status ready.'
$gap = $result.gap
$context = $result.context
Assert-SessionWritable -SessionPath $SessionPath
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $context.session_directory 'fromdemotospec-handoff.md' }
$OutputPath = Resolve-AdapterSessionPath -SessionDirectory $context.session_directory -ArtifactPath $OutputPath
Assert-AdapterContract -Condition (-not (Test-Path -LiteralPath $OutputPath)) -Message "FromDemoToSpec handoff already exists: $OutputPath"

$sectionV2 = (@($gap.fields | ForEach-Object { Format-HandoffField -Title ([string]$_.field_id) -Field $_ }) -join "`n`n")
$parameterLines = @(
    '| Parameter ID | Name | Default | Range | Source IDs |',
    '|---|---|---|---|---|'
)
foreach ($parameter in @($gap.tunable_parameters)) {
    $parameterLines += ('| ' + (@(
        (ConvertTo-MarkdownCell -Value ([string]$parameter.parameter_id)),
        (ConvertTo-MarkdownCell -Value ([string]$parameter.name)),
        (ConvertTo-MarkdownCell -Value ([string]$parameter.default)),
        (ConvertTo-MarkdownCell -Value ([string]$parameter.range)),
        (@($parameter.source_ids) -join ', ')
    ) -join ' | ') + ' |')
}
$allSources = @(
    @($gap.fields | ForEach-Object { @($_.source_ids) }) +
    @($gap.tunable_parameters | ForEach-Object { @($_.source_ids) })
) | ForEach-Object { $_ } | Sort-Object -Unique

$templateName = 'templates\fromdemotospec-handoff.md'
$templatePath = Join-Path $script:BrainstormAdapterProjectRoot $templateName
$content = [IO.File]::ReadAllText($templatePath, $script:BrainstormAdapterUtf8NoBom)
$content = $content.
    Replace('{{SESSION_ID}}', [string]$context.state.session_id).
    Replace('{{CONTRACT_PATH}}', [string]$gap.external_contract.path).
    Replace('{{CONTRACT_VERSION}}', [string]$gap.external_contract.version).
    Replace('{{CONTRACT_REVISION}}', [string]$gap.external_contract.last_verified_against).
    Replace('{{BRIEF_SHA256}}', [string]$gap.source_snapshot.brief_sha256).
    Replace('{{COMBINATIONS_SHA256}}', [string]$gap.source_snapshot.combinations_sha256).
    Replace('{{DECISIONS_SHA256}}', [string]$gap.source_snapshot.decision_ledger_sha256).
    Replace('{{FIELDS}}', $sectionV2).
    Replace('{{PARAMETERS}}', ($parameterLines -join "`n")).
    Replace('{{REVIEWER}}', [string]$gap.reviewer).
    Replace('{{DECISION_IDS}}', (@($gap.decision_ids) -join ', ')).
    Replace('{{DECISION_LEDGER}}', [string]$context.state.record_path).
    Replace('{{LEDGER_DECISION_IDS}}', (@($context.decision_ids.Keys | Sort-Object) -join ', ')).
    Replace('{{SOURCE_IDS}}', ($allSources -join ', '))
Write-AdapterUtf8TextAtomic -Path $OutputPath -Value $content

if ([string]::IsNullOrWhiteSpace($SessionRoot)) {
    $SessionRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $context.session_directory))
}
try {
    $index = Write-SessionIndex -SessionRoot ([IO.Path]::GetFullPath($SessionRoot))
} catch {
    throw "FromDemoToSpec handoff was preserved at '$OutputPath', but the session index rebuild failed. Do not render or overwrite it again; repair the index with rebuild-index.ps1. $($_.Exception.Message)"
}
[pscustomobject][ordered]@{
    rendered = $true
    adapter_id = 'fromdemotospec-handoff'
    session_id = [string]$context.state.session_id
    handoff_path = $OutputPath
    handoff_status = 'ready'
    external_flow_started = $false
    index_session_count = [int]$index.session_count
    semantic_review = 'passed'
} | ConvertTo-Json -Depth 16
