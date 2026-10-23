. (Join-Path $PSScriptRoot 'session-common.ps1')
$script:BrainstormPlaybookScriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:BrainstormPlaybookProjectRoot = [IO.Path]::GetFullPath((Join-Path $script:BrainstormPlaybookScriptsRoot '..'))
$script:BrainstormPlaybookUtf8NoBom = New-Object Text.UTF8Encoding($false)

function Stop-PlaybookContract {
    param([string]$Message)
    throw "Brainstorm playbook contract failed: $Message"
}

function Assert-PlaybookContract {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Stop-PlaybookContract -Message $Message }
}

function Read-PlaybookUtf8Json {
    param([string]$Path)
    Assert-PlaybookContract -Condition (Test-Path -LiteralPath $Path -PathType Leaf) -Message "Missing JSON file: $Path"
    try {
        return [IO.File]::ReadAllText($Path, $script:BrainstormPlaybookUtf8NoBom) | ConvertFrom-Json
    } catch {
        Stop-PlaybookContract -Message "Invalid JSON file: $Path"
    }
}

function Resolve-PlaybookProjectPath {
    param([string]$ProjectRoot, [string]$RelativePath)
    Assert-PlaybookContract -Condition (-not [string]::IsNullOrWhiteSpace($RelativePath)) -Message 'Relative path is required.'
    Assert-PlaybookContract -Condition (-not [IO.Path]::IsPathRooted($RelativePath)) -Message "Project path must be relative: $RelativePath"
    Assert-PlaybookContract -Condition (-not ($RelativePath -split '[\\/]' | Where-Object { $_ -ceq '..' })) -Message "Project path traversal is not allowed: $RelativePath"
    $root = [IO.Path]::GetFullPath($ProjectRoot)
    $resolved = [IO.Path]::GetFullPath((Join-Path $root $RelativePath))
    $prefix = $root.TrimEnd([char]92, [char]47) + [IO.Path]::DirectorySeparatorChar
    Assert-PlaybookContract -Condition ($resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) -Message "Project path escaped the root: $RelativePath"
    Assert-SafePhysicalPath -Path $resolved
    return $resolved
}

function Write-PlaybookUtf8TextAtomic {
    param([string]$Path, [string]$Value)
    Assert-SafePhysicalPath -Path $Path
    $parent = Split-Path -Parent $Path
    Assert-PlaybookContract -Condition (Test-Path -LiteralPath $parent -PathType Container) -Message "Missing output directory: $parent"
    $temporaryPath = Join-Path $parent ('.' + [IO.Path]::GetFileName($Path) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $normalized = $Value.Replace("`r`n", "`n").Replace("`r", "`n")
        [IO.File]::WriteAllText($temporaryPath, $normalized, $script:BrainstormPlaybookUtf8NoBom)
        Move-Item -LiteralPath $temporaryPath -Destination $Path
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Get-PlaybookCatalogValidation {
    param([string]$ProjectRoot = $script:BrainstormPlaybookProjectRoot)

    $ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
    $catalogPath = Join-Path $ProjectRoot 'playbooks\catalog.json'
    $schemaPath = Join-Path $ProjectRoot 'schemas\playbook-catalog.schema.json'
    $methodCatalogPath = Join-Path $ProjectRoot 'methods\catalog.json'
    $catalog = Read-PlaybookUtf8Json -Path $catalogPath
    $schema = Read-PlaybookUtf8Json -Path $schemaPath
    $methodCatalog = Read-PlaybookUtf8Json -Path $methodCatalogPath

    Assert-PlaybookContract -Condition ([int]$catalog.schema_version -eq 1) -Message 'Playbook catalog schema_version must be 1.'
    Assert-PlaybookContract -Condition ([string]$schema.title -ceq 'Brainstorm playbook catalog v1') -Message 'Playbook catalog schema title is invalid.'

    $readyMethods = @{}
    foreach ($method in @($methodCatalog.methods | Where-Object { [string]$_.status -ceq 'ready' })) {
        $readyMethods[[string]$method.method_id] = $true
    }

    $playbookIds = @{}
    $readyCount = 0
    foreach ($playbook in @($catalog.playbooks)) {
        foreach ($name in @(
            'playbook_id', 'display_name', 'domain', 'status', 'path', 'method_preset_path',
            'convergence_profile_path', 'output_schema_path', 'template_path', 'method_ids',
            'single_user_ai_adaptation', 'downstream_adapters'
        )) {
            Assert-PlaybookContract -Condition ($playbook.PSObject.Properties.Name -contains $name) -Message "Playbook entry is missing property: $name"
        }
        $playbookId = [string]$playbook.playbook_id
        Assert-PlaybookContract -Condition ($playbookId -cmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') -Message "Invalid playbook_id: $playbookId"
        Assert-PlaybookContract -Condition (-not $playbookIds.ContainsKey($playbookId)) -Message "Duplicate playbook_id: $playbookId"
        Assert-PlaybookContract -Condition (@('placeholder', 'ready', 'rejected') -ccontains [string]$playbook.status) -Message "Invalid playbook status: $playbookId"
        $playbookIds[$playbookId] = $true

        foreach ($pathField in @('path', 'method_preset_path', 'convergence_profile_path', 'output_schema_path', 'template_path')) {
            $relativePath = [string]$playbook.$pathField
            $fullPath = Resolve-PlaybookProjectPath -ProjectRoot $ProjectRoot -RelativePath $relativePath
            Assert-PlaybookContract -Condition (Test-Path -LiteralPath $fullPath -PathType Leaf) -Message "Missing playbook file: $relativePath"
        }

        if ([string]$playbook.status -ceq 'ready') {
            $readyCount++
            Assert-PlaybookContract -Condition ([bool]$playbook.single_user_ai_adaptation) -Message "Ready playbook requires single-user AI adaptation: $playbookId"
            Assert-PlaybookContract -Condition (@($playbook.method_ids).Count -ge 1) -Message "Ready playbook requires method references: $playbookId"
            foreach ($methodId in @($playbook.method_ids)) {
                Assert-PlaybookContract -Condition ($readyMethods.ContainsKey([string]$methodId)) -Message "Playbook references a non-ready method: $playbookId->$methodId"
            }
        }

        foreach ($adapter in @($playbook.downstream_adapters)) {
            foreach ($name in @('adapter_id', 'required', 'status', 'implementation_task')) {
                Assert-PlaybookContract -Condition ($adapter.PSObject.Properties.Name -contains $name) -Message "Playbook downstream adapter is missing property: $name"
            }
            Assert-PlaybookContract -Condition ([string]$adapter.adapter_id -cmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') -Message "Invalid downstream adapter ID: $($adapter.adapter_id)"
            Assert-PlaybookContract -Condition (@('unavailable', 'ready') -ccontains [string]$adapter.status) -Message "Invalid downstream adapter status: $($adapter.adapter_id)"
        }
    }

    $gameConcept = @($catalog.playbooks | Where-Object { [string]$_.playbook_id -ceq 'game-concept' })
    Assert-PlaybookContract -Condition ($gameConcept.Count -eq 1) -Message 'Catalog must contain exactly one game-concept playbook.'
    Assert-PlaybookContract -Condition ([string]$gameConcept[0].status -ceq 'ready') -Message 'game-concept must be ready after TB-006.'
    $fromdemotospecAdapters = @($gameConcept[0].downstream_adapters | Where-Object { [string]$_.adapter_id -ceq 'fromdemotospec-handoff' })
    Assert-PlaybookContract -Condition ($fromdemotospecAdapters.Count -eq 1) -Message 'Game Concept must declare exactly one fromdemotospec-handoff boundary.'
    Assert-PlaybookContract -Condition (-not [bool]$fromdemotospecAdapters[0].required) -Message 'FromDemoToSpec must remain optional for Game Concept.'
    Assert-PlaybookContract -Condition ([string]$fromdemotospecAdapters[0].status -ceq 'ready') -Message 'FromDemoToSpec adapter must be ready after TB-007A.'
    Assert-PlaybookContract -Condition ([string]$fromdemotospecAdapters[0].implementation_task -ceq 'TB-007A') -Message 'FromDemoToSpec implementation task must remain TB-007A.'

    $readmePath = Resolve-PlaybookProjectPath -ProjectRoot $ProjectRoot -RelativePath ([string]$gameConcept[0].path)
    $presetPath = Resolve-PlaybookProjectPath -ProjectRoot $ProjectRoot -RelativePath ([string]$gameConcept[0].method_preset_path)
    $profilePath = Resolve-PlaybookProjectPath -ProjectRoot $ProjectRoot -RelativePath ([string]$gameConcept[0].convergence_profile_path)
    $outputPath = Resolve-PlaybookProjectPath -ProjectRoot $ProjectRoot -RelativePath ([string]$gameConcept[0].output_schema_path)
    $templatePath = Resolve-PlaybookProjectPath -ProjectRoot $ProjectRoot -RelativePath ([string]$gameConcept[0].template_path)
    $combinationTemplatePath = Resolve-PlaybookProjectPath -ProjectRoot $ProjectRoot -RelativePath 'templates\game-concept-combinations.md'
    $documents = @{
        readme = [IO.File]::ReadAllText($readmePath, $script:BrainstormPlaybookUtf8NoBom)
        preset = [IO.File]::ReadAllText($presetPath, $script:BrainstormPlaybookUtf8NoBom)
        profile = [IO.File]::ReadAllText($profilePath, $script:BrainstormPlaybookUtf8NoBom)
        output = [IO.File]::ReadAllText($outputPath, $script:BrainstormPlaybookUtf8NoBom)
        template = [IO.File]::ReadAllText($templatePath, $script:BrainstormPlaybookUtf8NoBom)
        combination = [IO.File]::ReadAllText($combinationTemplatePath, $script:BrainstormPlaybookUtf8NoBom)
    }
    foreach ($term in @('METHOD_PRESET.md', 'CONVERGENCE_PROFILE.md', 'OUTPUT_SCHEMA.md')) {
        Assert-PlaybookContract -Condition ($documents.readme.Contains($term)) -Message "Game Concept README is missing route: $term"
    }
    foreach ($methodId in @($gameConcept[0].method_ids)) {
        Assert-PlaybookContract -Condition ($documents.preset.Contains("``$methodId``")) -Message "Method preset is missing method reference: $methodId"
    }
    foreach ($term in @('return-to-brainstorm', 'draft', 'accepted', 'requested')) {
        Assert-PlaybookContract -Condition ($documents.profile.Contains($term) -or $documents.output.Contains($term)) -Message "Playbook contracts are missing controlled term: $term"
    }
    foreach ($heading in @(
        '## Concept Frame', '## Experience Fragment', '## Player Fantasy', '## Core Verbs', '## Core Loop',
        '## Design Pillars', '## Anti-goals', '## Scope',
        '## Validation and Open Questions', '## Decision and Handoff'
    )) {
        Assert-PlaybookContract -Condition ($documents.template.Contains($heading)) -Message "Game Concept template is missing heading: $heading"
    }
    foreach ($heading in @('## Package Options', '## Package Selection')) {
        Assert-PlaybookContract -Condition ($documents.combination.Contains($heading)) -Message "Game Concept combination template is missing heading: $heading"
    }
    foreach ($term in @('Combination schema: `2`', 'Experience fragment', 'Mechanism and coherence', 'Selected package ID')) {
        Assert-PlaybookContract -Condition ($documents.readme.Contains($term) -or $documents.profile.Contains($term) -or $documents.output.Contains($term) -or $documents.combination.Contains($term)) -Message "Game Concept combination gate is missing term: $term"
    }

    $opportunity = @($catalog.playbooks | Where-Object { [string]$_.playbook_id -ceq 'opportunity-thesis' })
    Assert-PlaybookContract -Condition ($opportunity.Count -eq 1) -Message 'Catalog must contain exactly one opportunity-thesis playbook.'
    Assert-PlaybookContract -Condition ([string]$opportunity[0].status -ceq 'ready') -Message 'opportunity-thesis must be ready.'
    Assert-PlaybookContract -Condition (@($opportunity[0].downstream_adapters).Count -eq 0) -Message 'Opportunity Thesis must not declare downstream adapters.'

    $opportunityReadme = [IO.File]::ReadAllText((Resolve-PlaybookProjectPath -ProjectRoot $ProjectRoot -RelativePath ([string]$opportunity[0].path)), $script:BrainstormPlaybookUtf8NoBom)
    $opportunityPreset = [IO.File]::ReadAllText((Resolve-PlaybookProjectPath -ProjectRoot $ProjectRoot -RelativePath ([string]$opportunity[0].method_preset_path)), $script:BrainstormPlaybookUtf8NoBom)
    $opportunityProfile = [IO.File]::ReadAllText((Resolve-PlaybookProjectPath -ProjectRoot $ProjectRoot -RelativePath ([string]$opportunity[0].convergence_profile_path)), $script:BrainstormPlaybookUtf8NoBom)
    $opportunityOutput = [IO.File]::ReadAllText((Resolve-PlaybookProjectPath -ProjectRoot $ProjectRoot -RelativePath ([string]$opportunity[0].output_schema_path)), $script:BrainstormPlaybookUtf8NoBom)
    $opportunityTemplate = [IO.File]::ReadAllText((Resolve-PlaybookProjectPath -ProjectRoot $ProjectRoot -RelativePath ([string]$opportunity[0].template_path)), $script:BrainstormPlaybookUtf8NoBom)
    foreach ($term in @('METHOD_PRESET.md', 'CONVERGENCE_PROFILE.md', 'OUTPUT_SCHEMA.md', 'research-notes')) {
        Assert-PlaybookContract -Condition ($opportunityReadme.Contains($term)) -Message "Opportunity Thesis README is missing contract term: $term"
    }
    foreach ($methodId in @($opportunity[0].method_ids)) {
        Assert-PlaybookContract -Condition ($opportunityPreset.Contains("``$methodId``")) -Message "Opportunity Thesis preset is missing method reference: $methodId"
    }
    foreach ($term in @('D/N/S/C', 'return-to-brainstorm', 'draft', 'accepted', 'Stop')) {
        Assert-PlaybookContract -Condition ($opportunityProfile.Contains($term) -or $opportunityOutput.Contains($term) -or $opportunityTemplate.Contains($term)) -Message "Opportunity Thesis contracts are missing term: $term"
    }
    foreach ($heading in @('## Decision Object', '## Opportunity Claim', '## User Situation', '## D/N/S/C Evidence', '## Strongest Alternative', '## Disconfirmation and Stop', '## Minimum Validation', '## Decision and Handoff')) {
        Assert-PlaybookContract -Condition ($opportunityTemplate.Contains($heading)) -Message "Opportunity Thesis template is missing heading: $heading"
    }

    return [pscustomobject][ordered]@{
        structure_passed = $true
        playbook_count = @($catalog.playbooks).Count
        ready_count = $readyCount
        playbook_ids = @($catalog.playbooks.playbook_id)
        referenced_method_ids = @($gameConcept[0].method_ids)
        opportunity_method_ids = @($opportunity[0].method_ids)
        fromdemotospec_required = [bool]$fromdemotospecAdapters[0].required
        fromdemotospec_adapter_status = [string]$fromdemotospecAdapters[0].status
        semantic_review = 'required'
    }
}


function Get-OpportunityThesisValidation {
    param([string]$SessionPath, [string]$SessionRoot = '', [string]$ArtifactPath)
    $statePath = Resolve-SessionStatePath -SessionPath $SessionPath
    $directory = Split-Path -Parent $statePath
    [void](Get-SessionValidation -SessionPath $directory -SessionRoot $SessionRoot)
    $state = Read-Utf8Json -Path $statePath
    $record = [IO.File]::ReadAllText((Resolve-SafeRelativePath -BasePath $directory -RelativePath ([string]$state.record_path)), $script:BrainstormPlaybookUtf8NoBom)
    $artifactRows = @(Get-MarkdownTableRows -Content $record -Heading 'Artifact Index' -ExpectedHeaders @('Artifact ID', 'Kind', 'Path', 'Source IDs', 'Status', 'Purpose'))
    $path = [IO.Path]::GetFullPath($ArtifactPath)
    $registered = @($artifactRows | Where-Object {
        [string]$_.cells[1] -ceq 'research-notes' -and
        (Resolve-SafeRelativePath -BasePath $directory -RelativePath ([string]$_.cells[2])) -ceq $path
    })
    Assert-PlaybookContract -Condition ($registered.Count -eq 1) -Message 'Opportunity card must be a registered research-notes artifact in this session.'
    $content = [IO.File]::ReadAllText($path, $script:BrainstormPlaybookUtf8NoBom)
    foreach ($marker in @('> Opportunity schema: `2`', '> Playbook ID: `opportunity-thesis`', '> Artifact kind: `research-notes`', '> Semantic review: `required`')) {
        Assert-PlaybookContract -Condition ($content.Contains($marker)) -Message "Missing opportunity identity: $marker"
    }
    Assert-PlaybookContract -Condition ($content.Contains('> Session ID: `' + [string]$state.session_id + '`')) -Message 'Opportunity Session ID mismatch.'
    Assert-PlaybookContract -Condition (-not $content.Contains('{{')) -Message 'Opportunity card contains unresolved template tokens.'
    $statusMatch = [regex]::Match($content, '(?m)^> Status: `(draft|accepted|return-to-brainstorm)`\s*$')
    Assert-PlaybookContract -Condition ($statusMatch.Success) -Message 'Invalid opportunity status.'
    $status = $statusMatch.Groups[1].Value
    Assert-PlaybookContract -Condition ($content.Contains('- Status: `' + $status + '`')) -Message 'Opportunity status and handoff disagree.'
    $sourceIds = @{}
    foreach ($match in [regex]::Matches($record, '(?m)^\|\s*((?:RAW|IDEA|EVID)-[0-9]{3,})\s*\|')) { $sourceIds[$match.Groups[1].Value] = $true }
    $tables = @(
        @{name='Decision Object';headers=@('Candidate','Decision horizon','Default action','Resource ceiling','Decider','Source / status'); source=5},
        @{name='Opportunity Claim';headers=@('Target user and situation','Problem / job','Proposed entry point','Source / status');source=3},
        @{name='User Situation';headers=@('Trigger and current behavior','Friction in a concrete episode','Proposed change and observable result','Source / status');source=3},
        @{name='D/N/S/C Evidence';headers=@('Lens','Supporting evidence','Counterevidence / unknown','Action implication','Source / status');source=4},
        @{name='Strongest Alternative';headers=@('Alternative / platform absorption / capability gap','Why it may win','What would distinguish us','Source / status');source=3},
        @{name='Disconfirmation and Stop';headers=@('Claim at risk','Signal that changes action','Stop condition','Default action if observed','Source / status');source=4},
        @{name='Minimum Validation';headers=@('Validation target','Observation signal','Time / resource ceiling',('Result ' + [char]0x2192 + ' action'),'Owner');source=-1}
    )
    foreach ($table in $tables) {
        Assert-PlaybookContract -Condition ($content.Contains('## ' + $table.name)) -Message "Missing opportunity section: $($table.name)"
        $rows = @(Get-MarkdownTableRows -Content $content -Heading $table.name -ExpectedHeaders $table.headers)
        Assert-PlaybookContract -Condition ($rows.Count -ge 1) -Message "Empty opportunity section: $($table.name)"
        foreach ($row in $rows) {
            foreach ($cell in $row.cells) {
                Assert-PlaybookContract -Condition (-not [string]::IsNullOrWhiteSpace([string]$cell) -and [string]$cell -cne '-') -Message "Empty opportunity field: $($table.name); write unknown or not applicable with reason."
            }
            if ($table.source -ge 0) {
                $source = [string]$row.cells[$table.source]
                $references = @([regex]::Matches($source, '(?:RAW|IDEA|EVID)-[0-9]{3,}'))
                foreach ($reference in $references) {
                    Assert-PlaybookContract -Condition ($sourceIds.ContainsKey($reference.Value)) -Message "Unknown opportunity source: $($reference.Value)"
                }
                Assert-PlaybookContract -Condition ($references.Count -gt 0 -or $source -match '(?i)assumption|unknown|https?://') -Message 'Opportunity source must identify a session source, external URL, assumption or unknown.'
            }
        }
        if ($table.name -ceq 'D/N/S/C Evidence') {
            foreach ($lens in @('D','N','S','C')) {
                Assert-PlaybookContract -Condition (@($rows | Where-Object { [string]$_.cells[0] -cmatch ('^' + $lens + '(?:\s|$)') }).Count -eq 1) -Message "Opportunity lens must occur once; mark inapplicability with reason: $lens"
            }
        }
    }
    $decisionMatch = [regex]::Match($content, '(?m)^- Decision ID:\s*([^\r\n]+)')
    Assert-PlaybookContract -Condition ($decisionMatch.Success) -Message 'Opportunity handoff requires Decision ID or -.'
    $decisionIds = @(Split-ControlReferences -Value $decisionMatch.Groups[1].Value.Trim())
    $decisions = @(Get-MarkdownTableRows -Content $record -Heading 'Decision Record' -ExpectedHeaders @('Decision ID','Candidate IDs','Decision','Criteria','Evidence IDs','Decider'))
    if ($status -ceq 'accepted') { Assert-PlaybookContract -Condition ($decisionIds.Count -gt 0) -Message 'Accepted opportunity needs a user/joint decision.' }
    foreach ($id in $decisionIds) {
        $decision = @($decisions | Where-Object { [string]$_.cells[0] -ceq $id })
        Assert-PlaybookContract -Condition ($decision.Count -eq 1) -Message "Unknown opportunity decision: $id"
        if ($status -ceq 'accepted') {
            Assert-PlaybookContract -Condition (@('user','joint') -ccontains [string]$decision[0].cells[5]) -Message 'Accepted opportunity needs user/joint authority.'
        }
    }
    Assert-PlaybookContract -Condition ($content -match '(?m)^> Current default action:[ \t]*\S[^\r\n]*\r?$') -Message 'Opportunity default action is missing.'
    Assert-PlaybookContract -Condition ($content -match '(?m)^- Next action:[ \t]*\S[^\r\n]*\r?$') -Message 'Opportunity next action is missing.'
    Assert-PlaybookContract -Condition ($content -match '(?m)^- Downstream intent: `(not-requested|requested)`\s*$') -Message 'Invalid opportunity downstream intent.'
    return [pscustomobject][ordered]@{
        structure_passed=$true; playbook_id='opportunity-thesis'; opportunity_schema=2
        session_id=[string]$state.session_id; artifact_id=[string]$registered[0].cells[0]
        status=$status; decision_ids=@($decisionIds); semantic_review='required'
    }
}
