$script:BrainstormAdapterScriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:BrainstormAdapterProjectRoot = [IO.Path]::GetFullPath((Join-Path $script:BrainstormAdapterScriptsRoot '..'))
$script:BrainstormAdapterUtf8NoBom = New-Object Text.UTF8Encoding($false)

. (Join-Path $script:BrainstormAdapterScriptsRoot 'session-common.ps1')
. (Join-Path $script:BrainstormAdapterScriptsRoot 'fromdemotospec-v2-common.ps1')

function Stop-AdapterContract {
    param([string]$Message)
    throw "Brainstorm adapter contract failed: $Message"
}

function Assert-AdapterContract {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Stop-AdapterContract -Message $Message }
}

function Resolve-AdapterSessionPath {
    param([string]$SessionDirectory, [string]$ArtifactPath)
    $sessionFull = [IO.Path]::GetFullPath($SessionDirectory)
    $artifactFull = [IO.Path]::GetFullPath($ArtifactPath)
    $prefix = $sessionFull.TrimEnd([char]92, [char]47) + [IO.Path]::DirectorySeparatorChar
    Assert-AdapterContract -Condition ($artifactFull.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) -Message "Adapter artifact must stay inside the session: $artifactFull"
    Assert-SafePhysicalPath -Path $artifactFull
    return $artifactFull
}

function Write-AdapterUtf8TextAtomic {
    param([string]$Path, [string]$Value)
    Assert-SafePhysicalPath -Path $Path
    $parent = Split-Path -Parent $Path
    Assert-AdapterContract -Condition (Test-Path -LiteralPath $parent -PathType Container) -Message "Missing artifact directory: $parent"
    $temporaryPath = Join-Path $parent ('.' + [IO.Path]::GetFileName($Path) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $normalized = $Value.Replace("`r`n", "`n").Replace("`r", "`n")
        [IO.File]::WriteAllText($temporaryPath, $normalized, $script:BrainstormAdapterUtf8NoBom)
        Move-Item -LiteralPath $temporaryPath -Destination $Path
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Write-AdapterUtf8JsonAtomic {
    param([string]$Path, [object]$Value)
    $json = ($Value | ConvertTo-Json -Depth 32).Replace("`r`n", "`n").Replace("`r", "`n") + "`n"
    Write-AdapterUtf8TextAtomic -Path $Path -Value $json
}

function Get-MarkdownMetadata {
    param([string]$Content, [string]$Label)
    $pattern = '(?m)^> ' + [regex]::Escape($Label) + ': `?([^`\r\n]+)`?\s*$'
    $match = [regex]::Match($Content, $pattern)
    Assert-AdapterContract -Condition $match.Success -Message "Missing metadata: $Label"
    return [string]$match.Groups[1].Value
}

function Get-AdapterCatalog {
    return Read-Utf8Json -Path (Join-Path $script:BrainstormAdapterProjectRoot 'adapters\catalog.json')
}

function Get-AdapterDefinition {
    param([string]$AdapterId)
    $catalog = Get-AdapterCatalog
    $matches = @($catalog.adapters | Where-Object { [string]$_.adapter_id -ceq $AdapterId })
    Assert-AdapterContract -Condition ($matches.Count -eq 1) -Message "Adapter catalog entry is missing or duplicated: $AdapterId"
    return $matches[0]
}

function Get-AdapterCatalogValidation {
    $catalogPath = Join-Path $script:BrainstormAdapterProjectRoot 'adapters\catalog.json'
    $schemaPath = Join-Path $script:BrainstormAdapterProjectRoot 'schemas\adapter-catalog.schema.json'
    $fromdemotospecSchemaPath = Join-Path $script:BrainstormAdapterProjectRoot 'schemas\fromdemotospec-gap.schema.json'
    $catalog = Read-Utf8Json -Path $catalogPath
    $schema = Read-Utf8Json -Path $schemaPath
    $fromdemotospecSchema = Read-Utf8Json -Path $fromdemotospecSchemaPath
    Assert-AdapterContract -Condition ([int]$catalog.schema_version -eq 1) -Message 'Adapter catalog schema_version must be 1.'
    Assert-AdapterContract -Condition ([string]$schema.title -ceq 'Brainstorm adapter catalog v1') -Message 'Adapter catalog schema title is invalid.'
    Assert-AdapterContract -Condition ([string]$fromdemotospecSchema.title -ceq 'Brainstorm FromDemoToSpec gap v2') -Message 'FromDemoToSpec gap schema title is invalid.'

    $ids = @{}
    foreach ($adapter in @($catalog.adapters)) {
        foreach ($name in @(
            'adapter_id', 'display_name', 'status', 'direction', 'target_system', 'input_kind',
            'output_path', 'contract_path', 'external_contract', 'launches_external_flow', 'degradation_supported'
        )) {
            Assert-AdapterContract -Condition ($adapter.PSObject.Properties.Name -contains $name) -Message "Adapter entry is missing property: $name"
        }
        $id = [string]$adapter.adapter_id
        Assert-AdapterContract -Condition ($id -cmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') -Message "Invalid adapter ID: $id"
        Assert-AdapterContract -Condition (-not $ids.ContainsKey($id)) -Message "Duplicate adapter ID: $id"
        Assert-AdapterContract -Condition (@('unavailable', 'ready', 'retired') -ccontains [string]$adapter.status) -Message "Invalid adapter status: $id"
        Assert-AdapterContract -Condition ([string]$adapter.direction -ceq 'outbound') -Message "Adapter direction must be outbound: $id"
        Assert-AdapterContract -Condition (-not [bool]$adapter.launches_external_flow) -Message "Adapter must not launch external flow: $id"
        Assert-AdapterContract -Condition ([string]$adapter.output_path -cmatch '^[^/\\]+\.(?:md|json)$') -Message "Adapter output must be a session-local filename: $id"
        Assert-AdapterContract -Condition ([string]$adapter.external_contract.last_verified_against -cmatch '^[0-9a-f]{40}$') -Message "Adapter requires a 40-character verification revision: $id"
        $contractPath = Resolve-SafeRelativePath -BasePath $script:BrainstormAdapterProjectRoot -RelativePath ([string]$adapter.contract_path)
        Assert-AdapterContract -Condition (Test-Path -LiteralPath $contractPath -PathType Leaf) -Message "Missing adapter contract document: $id"
        $ids[$id] = $true
    }

    Assert-AdapterContract -Condition ($ids.Count -eq 3) -Message 'Brainstorm must expose exactly three adapters after TB-012.'
    $knowledge = Get-AdapterDefinition -AdapterId 'knowledge-context-brief'
    $fromdemotospec = Get-AdapterDefinition -AdapterId 'fromdemotospec-handoff'
    $analysis = Get-AdapterDefinition -AdapterId 'game-analysis-decision'
    Assert-AdapterContract -Condition ([string]$knowledge.status -ceq 'ready' -and [bool]$knowledge.degradation_supported) -Message 'Knowledge ContextBrief adapter must be ready with degradation support.'
    Assert-AdapterContract -Condition ([string]$knowledge.external_contract.path -ceq 'Knowledge/system/integrations/GAME_ANALYSIS_DECISION.md') -Message 'Knowledge adapter external contract path drifted.'
    Assert-AdapterContract -Condition ([string]$knowledge.external_contract.version -ceq 'context-brief-game-analysis-decision-handoff-v1') -Message 'Knowledge adapter contract version drifted.'
    Assert-AdapterContract -Condition ([string]$fromdemotospec.status -ceq 'ready') -Message 'FromDemoToSpec adapter must be ready after TB-007A.'
    Assert-AdapterContract -Condition ([string]$fromdemotospec.external_contract.path -ceq 'FromDemoToSpec/templates/design-baseline.md') -Message 'FromDemoToSpec external contract path drifted.'
    Assert-AdapterContract -Condition ([string]$fromdemotospec.external_contract.version -ceq 'fromdemotospec-design-baseline-v2') -Message 'FromDemoToSpec external contract version drifted.'
    Assert-AdapterContract -Condition ([string]$analysis.status -ceq 'ready') -Message 'GameAnalysisDecision adapter must be ready after TB-012.'
    Assert-AdapterContract -Condition ([string]$analysis.external_contract.path -ceq 'GameAnalysisDecision/adapters/v2/contract.schema.json') -Message 'GameAnalysisDecision external contract path drifted.'
    Assert-AdapterContract -Condition ([string]$analysis.external_contract.version -ceq 'game-analysis-decision-adapter-v2') -Message 'GameAnalysisDecision contract version drifted.'
    Assert-AdapterContract -Condition ([string]$analysis.external_contract.last_verified_against -ceq '5d713ffa89d89f97af23d4df5ba9f83b17ef6546') -Message 'GameAnalysisDecision verification revision drifted.'

    foreach ($path in @(
        'templates\knowledge-context-brief.md',
        'templates\fromdemotospec-handoff.md',
        'adapters\fromdemotospec-handoff\COMPATIBILITY.md',
        'adapters\game-analysis-decision\brainstorm-analysis-request.schema.json',
        'adapters\game-analysis-decision\brainstorm-producer-decision.schema.json'
    )) {
        Assert-AdapterContract -Condition (Test-Path -LiteralPath (Join-Path $script:BrainstormAdapterProjectRoot $path) -PathType Leaf) -Message "Missing adapter asset: $path"
    }

    return [pscustomobject][ordered]@{
        structure_passed = $true
        adapter_count = @($catalog.adapters).Count
        ready_count = @($catalog.adapters | Where-Object { [string]$_.status -ceq 'ready' }).Count
        adapter_ids = @($catalog.adapters.adapter_id)
        launches_external_flow = $false
        semantic_review = 'required'
    }
}

function Get-SessionAdapterContext {
    param([string]$SessionPath, [string]$SessionRoot = '')
    $statePath = Resolve-SessionStatePath -SessionPath $SessionPath
    $sessionDirectory = Split-Path -Parent $statePath
    $validation = Get-SessionValidation -SessionPath $sessionDirectory -SessionRoot $SessionRoot
    $state = Read-Utf8Json -Path $statePath
    $recordPath = Resolve-SafeRelativePath -BasePath $sessionDirectory -RelativePath ([string]$state.record_path)
    $record = [IO.File]::ReadAllText($recordPath, $script:BrainstormAdapterUtf8NoBom)

    $rawIds = @{}
    foreach ($row in @(Get-MarkdownTableRows -Content $record -Heading 'Raw Capture' -ExpectedHeaders @('Raw ID', 'Source', 'Original input', 'Interpretation status'))) {
        $rawIds[[string]$row.cells[0]] = $row
    }
    $ideaIds = @{}
    $ideaHeaders = @('Idea ID', 'Parent IDs', 'Source', 'Method ID', 'Disposition', 'Adoption', 'Idea', 'Destination', 'Supersedes', 'Decision reason')
    foreach ($row in @(Get-MarkdownTableRows -Content $record -Heading 'Idea Ledger' -ExpectedHeaders $ideaHeaders)) {
        $ideaIds[[string]$row.cells[0]] = $row
    }
    $evidenceIds = @{}
    foreach ($row in @(Get-MarkdownTableRows -Content $record -Heading 'Evidence Annex' -ExpectedHeaders @('Evidence ID', 'Source type', 'Supports / challenges', 'Finding', 'Limits'))) {
        $evidenceIds[[string]$row.cells[0]] = $row
    }
    $decisionIds = @{}
    foreach ($row in @(Get-MarkdownTableRows -Content $record -Heading 'Decision Record' -ExpectedHeaders @('Decision ID', 'Candidate IDs', 'Decision', 'Criteria', 'Evidence IDs', 'Decider'))) {
        $decisionIds[[string]$row.cells[0]] = $row
    }
    $allIds = @{}
    foreach ($id in @($rawIds.Keys) + @($ideaIds.Keys) + @($evidenceIds.Keys) + @($decisionIds.Keys)) { $allIds[$id] = $true }

    return [pscustomobject][ordered]@{
        session_directory = $sessionDirectory
        state = $state
        validation = $validation
        record = $record
        raw_ids = $rawIds
        idea_ids = $ideaIds
        evidence_ids = $evidenceIds
        decision_ids = $decisionIds
        all_ids = $allIds
    }
}

function Assert-AdapterSourceIds {
    param([string[]]$SourceIds, [hashtable]$AllIds, [string]$Label)
    foreach ($sourceId in @($SourceIds)) {
        Assert-AdapterContract -Condition ($AllIds.ContainsKey([string]$sourceId)) -Message "Unknown source reference: $Label->$sourceId"
    }
}

function Invoke-GameConceptBriefValidation {
    param([string]$SessionPath, [string]$SessionRoot, [string]$BriefPath)
    $validator = Join-Path $script:BrainstormAdapterScriptsRoot 'validate-game-concept-brief.ps1'
    $arguments = @('-SessionPath', $SessionPath, '-BriefPath', $BriefPath)
    if (-not [string]::IsNullOrWhiteSpace($SessionRoot)) { $arguments += @('-SessionRoot', $SessionRoot) }
    $output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $validator @arguments 2>&1)
    Assert-AdapterContract -Condition ($LASTEXITCODE -eq 0) -Message "Game Concept brief validation failed: $($output -join ' ')"
    try {
        return ($output -join "`n") | ConvertFrom-Json
    } catch {
        Stop-AdapterContract -Message 'Game Concept brief validator did not return JSON.'
    }
}

function Get-FromDemoToSpecGapValidation {
    param(
        [string]$SessionPath,
        [string]$SessionRoot = '',
        [string]$GapPath = '',
        [string]$BriefPath = ''
    )
    $context = Get-SessionAdapterContext -SessionPath $SessionPath -SessionRoot $SessionRoot
    if ([string]::IsNullOrWhiteSpace($GapPath)) { $GapPath = Join-Path $context.session_directory 'fromdemotospec-gap.json' }
    if ([string]::IsNullOrWhiteSpace($BriefPath)) { $BriefPath = Join-Path $context.session_directory 'game-concept-brief.md' }
    $GapPath = Resolve-AdapterSessionPath -SessionDirectory $context.session_directory -ArtifactPath $GapPath
    $BriefPath = Resolve-AdapterSessionPath -SessionDirectory $context.session_directory -ArtifactPath $BriefPath
    Assert-AdapterContract -Condition ([IO.Path]::GetFileName($BriefPath) -ceq 'game-concept-brief.md') -Message 'FromDemoToSpec adapter requires the stable game-concept-brief.md source.'
    Assert-AdapterContract -Condition (Test-Path -LiteralPath $GapPath -PathType Leaf) -Message "Missing FromDemoToSpec gap file: $GapPath"
    $briefValidation = Invoke-GameConceptBriefValidation -SessionPath $context.session_directory -SessionRoot $SessionRoot -BriefPath $BriefPath
    $gap = Read-Utf8Json -Path $GapPath
    Assert-AdapterContract -Condition ([int]$gap.schema_version -eq 2) -Message 'Active FromDemoToSpec gaps require schema 2; historical documents are archives only.'
    return Get-FromDemoToSpecGapV2Validation -Gap $gap -Context $context -BriefValidation $briefValidation -GapPath $GapPath
}
