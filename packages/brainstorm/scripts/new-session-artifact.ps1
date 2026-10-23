[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [Parameter(Mandatory = $true)][string]$ArtifactId,
    [Parameter(Mandatory = $true)]
    [ValidateSet('divergence-batch', 'comparison', 'scoring', 'draft-analysis', 'research-notes', 'perspective-review', 'learning-feedback')]
    [string]$Kind,
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$SourceIds,
    [Parameter(Mandatory = $true)][string]$Purpose,
    [string]$SessionRoot = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'session-common.ps1')

Assert-SessionContract -Condition ($ArtifactId -cmatch '^ART-[0-9]{3,}$') -Message "Invalid ArtifactId: $ArtifactId"
Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($Title)) -Message 'Title is required.'
Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($Purpose) -and $Purpose -cne '-') -Message 'Purpose is required.'

Assert-SessionWritable -SessionPath $SessionPath
$statePath = Resolve-SessionStatePath -SessionPath $SessionPath
$sessionDirectory = Split-Path -Parent $statePath
$state = Read-Utf8Json -Path $statePath
Assert-SessionContract -Condition ([string]$state.status -cne 'closed') -Message 'Closed sessions are immutable.'
[void](Get-SessionValidation -SessionPath $sessionDirectory -SessionRoot $SessionRoot)
$recordPath = Resolve-SafeRelativePath -BasePath $sessionDirectory -RelativePath ([string]$state.record_path)
$record = [IO.File]::ReadAllText($recordPath, $script:BrainstormUtf8NoBom)
Assert-SessionContract -Condition ((Get-SessionRecordSchemaVersion -Content $record) -eq 2) -Message 'Session artifacts require session record schema 2.'

$rawRows = @(Get-MarkdownTableRows -Content $record -Heading 'Raw Capture' -ExpectedHeaders @('Raw ID', 'Source', 'Original input', 'Interpretation status'))
$ideaRows = @(Get-MarkdownTableRows -Content $record -Heading 'Idea Ledger' -ExpectedHeaders @('Idea ID', 'Parent IDs', 'Source', 'Method ID', 'Disposition', 'Adoption', 'Idea', 'Destination', 'Supersedes', 'Decision reason'))
$availableSourceIds = @{}
foreach ($row in @($rawRows) + @($ideaRows)) { $availableSourceIds[[string]$row.cells[0]] = $true }
$references = @(Split-ControlReferences -Value $SourceIds)
Assert-SessionContract -Condition ($references.Count -ge 1) -Message 'SourceIds requires at least one Raw or Idea ID.'
foreach ($sourceId in $references) {
    Assert-SessionContract -Condition ($availableSourceIds.ContainsKey($sourceId)) -Message "Unknown Artifact source: $sourceId"
}

$artifactRows = @(Get-MarkdownTableRows -Content $record -Heading 'Artifact Index' -ExpectedHeaders @('Artifact ID', 'Kind', 'Path', 'Source IDs', 'Status', 'Purpose'))
Assert-SessionContract -Condition (-not (@($artifactRows | Where-Object { [string]$_.cells[0] -ceq $ArtifactId }).Count -gt 0)) -Message "Artifact ID already exists: $ArtifactId"
$artifactRelativePath = ('artifacts/' + $ArtifactId.ToLowerInvariant() + '-' + $Kind + '.md')
$artifactPath = [IO.Path]::GetFullPath((Join-Path $sessionDirectory $artifactRelativePath))
$sessionPrefix = [IO.Path]::GetFullPath($sessionDirectory).TrimEnd([char]92, [char]47) + [IO.Path]::DirectorySeparatorChar
Assert-SessionContract -Condition ($artifactPath.StartsWith($sessionPrefix, [StringComparison]::OrdinalIgnoreCase)) -Message 'Artifact path escaped the session directory.'
Assert-SessionContract -Condition (-not (Test-Path -LiteralPath $artifactPath)) -Message "Artifact file already exists: $artifactPath"

$templateName = if ($Kind -ceq 'perspective-review') { 'templates\perspective-review.md' } else { 'templates\session-artifact.md' }
$templatePath = Join-Path (Get-BrainstormProjectRoot) $templateName
Assert-SessionContract -Condition (Test-Path -LiteralPath $templatePath -PathType Leaf) -Message "Missing Artifact template: $templatePath"
$content = [IO.File]::ReadAllText($templatePath, $script:BrainstormUtf8NoBom)
$content = $content.Replace('{{ARTIFACT_ID}}', $ArtifactId)
$content = $content.Replace('{{TITLE}}', $Title)
$content = $content.Replace('{{SESSION_ID}}', [string]$state.session_id)
$content = $content.Replace('{{KIND}}', $Kind)
$content = $content.Replace('{{SOURCE_IDS}}', ($references -join ', '))
$content = $content.Replace('{{CREATED_AT}}', (Get-Date).ToUniversalTime().ToString('o'))
$content = $content.Replace('{{PURPOSE}}', $Purpose)

$artifactDirectory = Split-Path -Parent $artifactPath
if (-not (Test-Path -LiteralPath $artifactDirectory -PathType Container)) {
    [void](New-Item -ItemType Directory -Path $artifactDirectory -Force)
}
$artifactCreated = $false
$recordUpdated = $false
try {
    Write-Utf8TextAtomic -Path $artifactPath -Value $content
    $artifactCreated = $true
    $updatedRecord = Add-MarkdownTableRow -Content $record -Heading 'Artifact Index' -Cells @(
        $ArtifactId,
        $Kind,
        $artifactRelativePath,
        ($references -join ', '),
        'active',
        $Purpose
    )
    $state.updated_at = (Get-Date).ToUniversalTime().ToString('o')
    $commit = Complete-SessionUpdate -SessionPath $sessionDirectory -State $state -Record $updatedRecord -SessionRoot $SessionRoot
    $recordUpdated = $true
    $validation = $commit.validation
    $index = $commit.index
} catch {
    $recordUpdated = [IO.File]::ReadAllText($recordPath, $script:BrainstormUtf8NoBom).Contains('| ' + $ArtifactId + ' |')
    if ($artifactCreated -and -not $recordUpdated -and (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
        Remove-Item -LiteralPath $artifactPath -Force
    }
    throw
}

[pscustomobject][ordered]@{
    created = $true
    artifact_id = $ArtifactId
    kind = $Kind
    artifact_path = $artifactPath
    validation = $validation
    index_summary = [pscustomobject][ordered]@{
        session_count = [int]$index.session_count
        total_bytes = [long]$index.total_bytes
        warnings = @($index.warnings)
    }
} | ConvertTo-Json -Depth 16
