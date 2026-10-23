[CmdletBinding()]
param([switch]$CandidateContract, [string]$EvidenceOutputDirectory = '', [switch]$Portable)

$ErrorActionPreference = 'Stop'
$testRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [IO.Path]::GetFullPath((Join-Path $testRoot '..'))
$scriptsRoot = Join-Path $projectRoot 'scripts'
$newSession = Join-Path $scriptsRoot 'new-session.ps1'
$validateAdapters = Join-Path $scriptsRoot 'validate-adapters.ps1'
$newContextBrief = Join-Path $scriptsRoot 'new-knowledge-context-brief.ps1'
$validateContextBrief = Join-Path $scriptsRoot 'validate-knowledge-context-brief.ps1'
$newGap = Join-Path $scriptsRoot 'new-fromdemotospec-gap.ps1'
$validateGap = Join-Path $scriptsRoot 'validate-fromdemotospec-gap.ps1'
$renderHandoff = Join-Path $scriptsRoot 'render-fromdemotospec-handoff.ps1'
$validateHandoff = Join-Path $scriptsRoot 'validate-fromdemotospec-handoff.ps1'
$utf8NoBom = New-Object Text.UTF8Encoding($false)

function Get-TestSha256 {
    param([string]$Path)
    $stream=[IO.File]::OpenRead($Path);$sha=[Security.Cryptography.SHA256]::Create()
    try{return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose();$stream.Dispose()}
}


function Stop-Test {
    param([string]$Message)
    throw "Brainstorm adapter system contract failed: $Message"
}

function Assert-Test {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Stop-Test -Message $Message }
}

function Invoke-SuccessJson {
    param([string]$ScriptPath, [string[]]$Arguments)
    $output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments)
    if ($LASTEXITCODE -ne 0) { Stop-Test -Message "Command failed: $ScriptPath" }
    try {
        return ($output -join "`n") | ConvertFrom-Json
    } catch {
        Stop-Test -Message "Command did not return JSON: $ScriptPath"
    }
}

function Invoke-ExpectedFailure {
    param([string]$ScriptPath, [string[]]$Arguments)
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments 2>&1)
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    Assert-Test -Condition ($LASTEXITCODE -ne 0) -Message "Command should have failed: $ScriptPath"
    Assert-Test -Condition (($output -join "`n").Contains('Brainstorm adapter contract failed:')) -Message ("Expected failure did not use the adapter contract prefix: " + ($output -join " "))
}

if (-not $CandidateContract) {
$catalog = Invoke-SuccessJson -ScriptPath $validateAdapters -Arguments @()
Assert-Test -Condition ([bool]$catalog.structure_passed) -Message 'Adapter catalog validation did not pass.'
Assert-Test -Condition ([int]$catalog.adapter_count -eq 3) -Message 'TB-012 must expose exactly three adapters.'
Assert-Test -Condition ([int]$catalog.ready_count -eq 3) -Message 'All three adapters must be ready.'
}

Assert-Test -Condition (-not [bool]$catalog.launches_external_flow) -Message 'Adapters must not launch an external flow.'

$systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$sandbox = Join-Path $systemTemp ('brainstorm-adapter-contract-' + [guid]::NewGuid().ToString('N'))
$sessionsRoot = Join-Path $sandbox 'sessions'
$sessionId = 'bs-20260729-130000-a1b2c3'
try {
    [void](New-Item -ItemType Directory -Path $sessionsRoot -Force)
    $createdSession = Invoke-SuccessJson -ScriptPath $newSession -Arguments @(
        '-Title', 'Adapter fixture',
        '-Goal', 'Prepare traceable downstream context',
        '-Mode', 'standard',
        '-OutputRoot', $sessionsRoot,
        '-SessionId', $sessionId
    )
    $sessionPath = [string]$createdSession.session_path
    $recordPath = Join-Path $sessionPath 'session.md'
    $record = [IO.File]::ReadAllText($recordPath, $utf8NoBom)
    $record = $record.Replace(
        "| Raw ID | Source | Original input | Interpretation status |`n|---|---|---|---|",
        "| Raw ID | Source | Original input | Interpretation status |`n|---|---|---|---|`n| RAW-001 | user | Protect a moving settlement | clear |"
    )
    $record = $record.Replace(
        "| Idea ID | Parent IDs | Source | Method ID | Disposition | Adoption | Idea | Destination | Supersedes | Decision reason |`n|---|---|---|---|---|---|---|---|---|---|",
        "| Idea ID | Parent IDs | Source | Method ID | Disposition | Adoption | Idea | Destination | Supersedes | Decision reason |`n|---|---|---|---|---|---|---|---|---|---|`n| IDEA-001 | - | ai-independent | - | active | prototype | Redirect the settlement route | - | - | - |"
    )
    $record = $record.Replace(
        "| Evidence ID | Source type | Supports / challenges | Finding | Limits |`n|---|---|---|---|---|",
        "| Evidence ID | Source type | Supports / challenges | Finding | Limits |`n|---|---|---|---|---|`n| EVID-001 | knowledge | IDEA-001 | Route choice benefits from legible consequences | Context dependent |"
    )
    $record = $record.Replace(
        "| Decision ID | Candidate IDs | Decision | Criteria | Evidence IDs | Decider |`n|---|---|---|---|---|---|",
        "| Decision ID | Candidate IDs | Decision | Criteria | Evidence IDs | Decider |`n|---|---|---|---|---|---|`n| DEC-001 | IDEA-001 | Accept concept direction | Supports player agency | EVID-001 | user |`n| DEC-002 | IDEA-001 | Recover health between battles later | Deferred beyond first prototype | EVID-001 | user |"
    )
    [IO.File]::WriteAllText($recordPath, $record, $utf8NoBom)

    $createdContext = Invoke-SuccessJson -ScriptPath $newContextBrief -Arguments @(
        '-SessionPath', $sessionPath,
        '-SessionRoot', $sessionsRoot,
        '-QueryIntent', 'query'
    )
    $contextPath = [string]$createdContext.output_path
    Invoke-ExpectedFailure -ScriptPath $newContextBrief -Arguments @(
        '-SessionPath', $sessionPath,
        '-SessionRoot', $sessionsRoot
    )
    $context = [IO.File]::ReadAllText($contextPath, $utf8NoBom)
    $context = $context.Replace(
        '| task | Prepare traceable downstream context | - |',
        '| task | Prepare traceable downstream context | RAW-001 |'
    )
    $context = $context.Replace(
        '| available | pending | - | - |',
        '| available | completed | EVID-001 | Knowledge evidence was reviewed. |'
    )
    [IO.File]::WriteAllText($contextPath, $context, $utf8NoBom)
    $contextValidation = Invoke-SuccessJson -ScriptPath $validateContextBrief -Arguments @(
        '-SessionPath', $sessionPath,
        '-SessionRoot', $sessionsRoot
    )
    Assert-Test -Condition ([string]$contextValidation.query_result -ceq 'completed') -Message 'Completed Knowledge result was not retained.'
    Assert-Test -Condition ([int]$contextValidation.evidence_count -eq 1) -Message 'Knowledge Evidence ID was not retained.'
    Assert-Test -Condition (-not [bool]$contextValidation.launches_external_flow) -Message 'ContextBrief must not launch Knowledge.'

    $invalidUnavailable = $context.Replace(
        '| available | completed | EVID-001 | Knowledge evidence was reviewed. |',
        '| unavailable | unavailable | EVID-001 | Knowledge was unavailable. |'
    )
    [IO.File]::WriteAllText($contextPath, $invalidUnavailable, $utf8NoBom)
    Invoke-ExpectedFailure -ScriptPath $validateContextBrief -Arguments @(
        '-SessionPath', $sessionPath,
        '-SessionRoot', $sessionsRoot
    )
    $validUnavailable = $context.Replace(
        '| available | completed | EVID-001 | Knowledge evidence was reviewed. |',
        '| unavailable | unavailable | - | Knowledge was unavailable; continue without evidence review. |'
    )
    [IO.File]::WriteAllText($contextPath, $validUnavailable, $utf8NoBom)
    $unavailableValidation = Invoke-SuccessJson -ScriptPath $validateContextBrief -Arguments @(
        '-SessionPath', $sessionPath,
        '-SessionRoot', $sessionsRoot
    )
    Assert-Test -Condition ([string]$unavailableValidation.knowledge_availability -ceq 'unavailable') -Message 'Knowledge degradation state was not retained.'
    Assert-Test -Condition ([int]$unavailableValidation.evidence_count -eq 0) -Message 'Unavailable Knowledge must not claim evidence.'

    $combinationPath = Join-Path $sessionPath 'game-concept-combinations.md'
    $combination = [IO.File]::ReadAllText((Join-Path $projectRoot 'templates\game-concept-combinations.md'), $utf8NoBom).Replace('{{SESSION_ID}}', $sessionId).Replace('{{SESSION_TITLE}}', 'Adapter fixture').Replace('{{CREATED_AT}}', '2026-09-08T00:00:00Z')
    $combination = $combination.Replace('## Package Selection', '| PKG-001 | Route convoy | Bridge is blocked; redirect up a slope, spend fuel, escape pursuit | Route choices exchange supplies and future safety | IDEA-001 | - | Less fuel in exchange for avoiding the blockade |' + [Environment]::NewLine + [Environment]::NewLine + '## Package Selection')
    $combination = $combination.Replace('| open | - | - | No direction selected; continue from the current question. | - |', '| selected | PKG-001 | DEC-001 | User selected route agency; later base-building excluded. | - |')
    [IO.File]::WriteAllText($combinationPath, $combination, $utf8NoBom)

    $briefPath = Join-Path $sessionPath 'game-concept-brief.md'
    $brief = @'
# Game Concept Brief

> Brief schema: `3`
> Selected package ID: `PKG-001`
> Playbook ID: `game-concept`
> Session ID: `bs-20260729-130000-a1b2c3`
> Session title: Adapter fixture
> Created: 2026-07-29T13:00:00Z
> Semantic review: `required`

## Concept Frame

| Concept | Target player / context | Emotional promise | Source IDs |
|---|---|---|---|
| Route a moving settlement through danger | Strategy players | Protective improvisation | RAW-001 |

## Experience Fragment

| Situation | Player action / choice | Visible consequence | Source IDs |
|---|---|---|---|
| A blocked bridge lies ahead | Redirect the convoy to a steep path | Avoid blockade, consume fuel, then choose the next crossing | RAW-001, IDEA-001 |

## Player Fantasy

| Fantasy | Player identity | Desired feeling | Source IDs |
|---|---|---|---|
| Guide a vulnerable moving home | Route keeper | Responsible mastery | RAW-001 |

## Core Verbs

| Verb | Player intent | Feedback / consequence | Source IDs |
|---|---|---|---|
| redirect | Avoid threats | Route and resource state change | IDEA-001 |

## Core Loop

| Step ID | Player action | System response | Return / progression | Source IDs |
|---|---|---|---|---|
| LOOP-001 | Read and redirect the route | Reveal pressure and apply a consequence | Choose the next redirect | RAW-001, IDEA-001 |

## Design Pillars

| Pillar ID | Commitment | In-scope signal | Exclusion signal | Source IDs |
|---|---|---|---|---|
| PILLAR-001 | Meaningful route choice | Alternatives change risk | Cosmetic branches | IDEA-001 |

## Anti-goals

| Anti-goal ID | Avoid | Why | Source IDs |
|---|---|---|---|
| ANTI-001 | Static base management | It removes movement pressure | RAW-001 |

## Scope

| Bucket | Included / excluded | Rationale | Source IDs |
|---|---|---|---|
| prototype | One route and one threat | Test the redirect decision | IDEA-001 |
| excluded | Persistent city building | Preserve the moving fantasy | RAW-001 |

## Validation and Open Questions

| Item ID | Type | Statement | Source IDs | Next action |
|---|---|---|---|---|
| CHECK-001 | hypothesis | Legible route consequences create agency | IDEA-001 | Compare two route outcomes |
| CHECK-002 | test | Players can explain why they redirected | IDEA-001 | Observe three test turns |

## Decision and Handoff

| Brief status | Selected package ID | Decision IDs | FromDemoToSpec intent | Missing |
|---|---|---|---|---|
| accepted | PKG-001 | DEC-001 | requested | - |
'@
    [IO.File]::WriteAllText($briefPath, ($brief.Replace("`r`n", "`n") + "`n"), $utf8NoBom)

    $createdGap = Invoke-SuccessJson -ScriptPath $newGap -Arguments @(
        '-SessionPath', $sessionPath,
        '-SessionRoot', $sessionsRoot
    )
    $gapPath = [string]$createdGap.gap_path
    $gapReview = Invoke-SuccessJson -ScriptPath $validateGap -Arguments @(
        '-SessionPath', $sessionPath,
        '-SessionRoot', $sessionsRoot
    )
    Assert-Test -Condition ([string]$gapReview.gap_status -ceq 'gap-review') -Message 'Initial FromDemoToSpec gap must remain in gap-review.'
    Assert-Test -Condition ([int]$gapReview.gap_count -gt 0) -Message 'Initial FromDemoToSpec gap must expose missing or partial fields.'
    Assert-Test -Condition (-not [bool]$gapReview.external_flow_started) -Message 'Gap review must not launch FromDemoToSpec.'
    Invoke-ExpectedFailure -ScriptPath $newGap -Arguments @(
        '-SessionPath', $sessionPath,
        '-SessionRoot', $sessionsRoot
    )

    $gap = [IO.File]::ReadAllText($gapPath, $utf8NoBom) | ConvertFrom-Json
    foreach ($field in @($gap.fields)) {
        $field.coverage = 'satisfied'
        $field.blocking = $false
        if (@($field.mapped_content).Count -eq 0) { $field.mapped_content = @("Reviewed content for $($field.field_id)") }
        if (@($field.source_ids).Count -eq 0) { $field.source_ids = @('IDEA-001') }
        $field.gap_or_question = ''
    }
    $gap.tunable_parameters = @(
        [pscustomobject][ordered]@{ parameter_id = 'FromDemoToSpec-PARAM-001'; name = 'Threat pressure'; default = '2'; range = '1-5'; source_ids = @('IDEA-001') },
        [pscustomobject][ordered]@{ parameter_id = 'FromDemoToSpec-PARAM-002'; name = 'Route choices'; default = '3'; range = '2-4'; source_ids = @('IDEA-001') },
        [pscustomobject][ordered]@{ parameter_id = 'FromDemoToSpec-PARAM-003'; name = 'Recovery per turn'; default = '1'; range = '0-2'; source_ids = @('IDEA-001') }
    )
    $gap.status = 'ready'
    $gap.semantic_review = 'passed'
    $gap.reviewer = 'agent'
    $gap.decision_ids = @('DEC-001')
    [IO.File]::WriteAllText($gapPath, (($gap | ConvertTo-Json -Depth 32) + "`n"), $utf8NoBom)

    $readyValidation = Invoke-SuccessJson -ScriptPath $validateGap -Arguments @(
        '-SessionPath', $sessionPath,
        '-SessionRoot', $sessionsRoot
    )
    Assert-Test -Condition ([string]$readyValidation.gap_status -ceq 'ready') -Message 'Reviewed FromDemoToSpec gap did not become ready.'
    Assert-Test -Condition ([int]$readyValidation.gap_count -eq 0) -Message 'Ready FromDemoToSpec gap must have zero gaps.'
    Assert-Test -Condition ([int]$readyValidation.tunable_parameter_count -eq 3) -Message 'Ready FromDemoToSpec gap must retain three parameters.'

    $rendered = Invoke-SuccessJson -ScriptPath $renderHandoff -Arguments @(
        '-SessionPath', $sessionPath,
        '-SessionRoot', $sessionsRoot
    )
    $handoffPath = [string]$rendered.handoff_path
    Assert-Test -Condition (Test-Path -LiteralPath $handoffPath -PathType Leaf) -Message 'FromDemoToSpec handoff was not rendered.'
    Assert-Test -Condition (-not [bool]$rendered.external_flow_started) -Message 'Rendering must not launch FromDemoToSpec.'
    $handoffValidation = Invoke-SuccessJson -ScriptPath $validateHandoff -Arguments @(
        '-SessionPath', $sessionPath,
        '-SessionRoot', $sessionsRoot
    )
    Assert-Test -Condition ([string]$handoffValidation.handoff_status -ceq 'ready') -Message 'Rendered FromDemoToSpec handoff did not validate.'
    Assert-Test ([bool]$handoffValidation.reception_inventory_checked) 'New handoff inventory was not checked.'
    Assert-Test -Condition ([int]$handoffValidation.tunable_parameter_count -eq 3) -Message 'Rendered handoff lost parameters.'
    Invoke-ExpectedFailure -ScriptPath $renderHandoff -Arguments @(
        '-SessionPath', $sessionPath,
        '-SessionRoot', $sessionsRoot
    )


    if (-not [string]::IsNullOrWhiteSpace($EvidenceOutputDirectory)) {
        $evidenceDirectory = [IO.Path]::GetFullPath($EvidenceOutputDirectory)
        [void](New-Item -ItemType Directory -Path $evidenceDirectory -Force)
        foreach ($entry in @(
            @{source=$recordPath;target='synthetic-host-record.md'},
            @{source=$briefPath;target='synthetic-brief.md'},
            @{source=$gapPath;target='synthetic-fromdemotospec-gap.json'},
            @{source=$handoffPath;target='synthetic-fromdemotospec-handoff.md'}
        )) {
            $destination = Join-Path $evidenceDirectory $entry.target
            Assert-Test (-not (Test-Path -LiteralPath $destination)) 'Integration evidence already exists; do not overwrite.'
            Copy-Item -LiteralPath $entry.source -Destination $destination
        }
    }

    $validHandoffText = [IO.File]::ReadAllText($handoffPath, $utf8NoBom)
    Assert-Test ($validHandoffText.Contains('> Ledger decision IDs: `DEC-001, DEC-002`')) 'Renderer lost a deferred decision outside brief selection IDs.'
    Assert-Test ($validHandoffText.Contains('> Decision ledger: `session.md`')) 'Renderer lost the original decision ledger route.'
    [IO.File]::WriteAllText($handoffPath, $validHandoffText.Replace('> Ledger decision IDs: `DEC-001, DEC-002`', '> Ledger decision IDs: `DEC-001`'), $utf8NoBom)
    Invoke-ExpectedFailure -ScriptPath $validateHandoff -Arguments @('-SessionPath', $sessionPath, '-SessionRoot', $sessionsRoot)
    [IO.File]::WriteAllText($handoffPath, $validHandoffText, $utf8NoBom)
    [IO.File]::WriteAllText($handoffPath, $validHandoffText.Replace('Coverage: satisfied', 'Coverage: assumed'), $utf8NoBom)
    Invoke-ExpectedFailure -ScriptPath $validateHandoff -Arguments @('-SessionPath', $sessionPath, '-SessionRoot', $sessionsRoot)
    [IO.File]::WriteAllText($handoffPath, $validHandoffText.Replace('| agent | DEC-001 |', '| agent | - |'), $utf8NoBom)
    Invoke-ExpectedFailure -ScriptPath $validateHandoff -Arguments @('-SessionPath', $sessionPath, '-SessionRoot', $sessionsRoot)
    [IO.File]::WriteAllText($handoffPath, $validHandoffText.Replace('| Threat pressure | 2 |', '| Threat pressure | 99 |'), $utf8NoBom)
    Invoke-ExpectedFailure -ScriptPath $validateHandoff -Arguments @('-SessionPath', $sessionPath, '-SessionRoot', $sessionsRoot)
    [IO.File]::WriteAllText($handoffPath, $validHandoffText, $utf8NoBom)

    $readyJson = $gap | ConvertTo-Json -Depth 32
    $gap.tunable_parameters = @()
    $owned = @($gap.fields | Where-Object field_id -eq 'lifecycle-environment')[0]
    $owned.coverage = 'missing'
    $owned.mapped_content = @()
    $owned.source_ids = @()
    $owned.gap_or_question = 'Formal environment belongs to FromDemoToSpec preparation, before implementation.'
    $owned.next_action = 'FromDemoToSpec selects lifecycle and resolves formal environment.'
    [IO.File]::WriteAllText($gapPath, (($gap | ConvertTo-Json -Depth 32) + "`n"), $utf8NoBom)
    $pendingEnvironment = Invoke-SuccessJson -ScriptPath $validateGap -Arguments @('-SessionPath', $sessionPath, '-SessionRoot', $sessionsRoot)
    Assert-Test ([int]$pendingEnvironment.tunable_parameter_count -eq 0 -and [int]$pendingEnvironment.gap_count -eq 1) 'V2 must allow no invented parameters and explicit FromDemoToSpec-owned work.'
    $owned.blocking = $true
    [IO.File]::WriteAllText($gapPath, (($gap | ConvertTo-Json -Depth 32) + "`n"), $utf8NoBom)
    Invoke-ExpectedFailure -ScriptPath $validateGap -Arguments @('-SessionPath', $sessionPath, '-SessionRoot', $sessionsRoot)
    $gap = $readyJson | ConvertFrom-Json
    $gap.fields[0].coverage = 'assumed'
    $gap.fields[0].gap_or_question = 'Assumed experience goal is not accepted input.'
    [IO.File]::WriteAllText($gapPath, (($gap | ConvertTo-Json -Depth 32) + "`n"), $utf8NoBom)
    Invoke-ExpectedFailure -ScriptPath $validateGap -Arguments @('-SessionPath', $sessionPath, '-SessionRoot', $sessionsRoot)
    $gap = $readyJson | ConvertFrom-Json
    $gap.decision_ids = @()
    [IO.File]::WriteAllText($gapPath, (($gap | ConvertTo-Json -Depth 32) + "`n"), $utf8NoBom)
    Invoke-ExpectedFailure -ScriptPath $validateGap -Arguments @('-SessionPath', $sessionPath, '-SessionRoot', $sessionsRoot)
    $gap = $readyJson | ConvertFrom-Json
    [IO.File]::WriteAllText($gapPath, (($gap | ConvertTo-Json -Depth 32) + "`n"), $utf8NoBom)


    $legacyGap = $readyJson | ConvertFrom-Json
    $legacyGap.schema_version = 1
    [IO.File]::WriteAllText($gapPath, ($legacyGap | ConvertTo-Json -Depth 32), $utf8NoBom)
    Invoke-ExpectedFailure -ScriptPath $validateGap -Arguments @('-SessionPath', $sessionPath, '-SessionRoot', $sessionsRoot)
    $gap = $readyJson | ConvertFrom-Json
    [IO.File]::WriteAllText($gapPath, ($gap | ConvertTo-Json -Depth 32), $utf8NoBom)

    $gap.external_flow_started = $true
    [IO.File]::WriteAllText($gapPath, (($gap | ConvertTo-Json -Depth 32) + "`n"), $utf8NoBom)
    Invoke-ExpectedFailure -ScriptPath $validateGap -Arguments @(
        '-SessionPath', $sessionPath,
        '-SessionRoot', $sessionsRoot
    )


    # Active handoffs cannot use the historical missing-inventory exception.
    [IO.File]::WriteAllText($gapPath, $readyJson, $utf8NoBom)
    $withoutInventory = [regex]::Replace($validHandoffText, '(?m)^> (Reception inventory|Decision ledger|Ledger decision IDs):[^\r\n]*\r?\n', '')
    [IO.File]::WriteAllText($handoffPath, $withoutInventory, $utf8NoBom)
    Invoke-ExpectedFailure -ScriptPath $validateHandoff -Arguments @('-SessionPath',$sessionPath,'-SessionRoot',$sessionsRoot)
    [IO.File]::WriteAllText($handoffPath, $validHandoffText, $utf8NoBom)
    $currentBrief = [IO.File]::ReadAllText($briefPath,$utf8NoBom)
    [IO.File]::WriteAllText($briefPath, $currentBrief.Replace('Route a moving settlement through danger','Defend a stationary settlement'), $utf8NoBom)
    Invoke-ExpectedFailure -ScriptPath $validateHandoff -Arguments @('-SessionPath',$sessionPath,'-SessionRoot',$sessionsRoot)
    $summary = Invoke-SuccessJson -ScriptPath (Join-Path $scriptsRoot 'get-close-summary.ps1') -Arguments @('-SessionPath',$sessionPath)
    Assert-Test ($summary.fromdemotospec.gap_status -ceq 'review-required') 'Summary echoed stale ready.'
    $oldGapHash = Get-TestSha256 -Path $gapPath
    $oldHandoffHash = Get-TestSha256 -Path $handoffPath
    $reset = Invoke-SuccessJson -ScriptPath (Join-Path $scriptsRoot 'reset-fromdemotospec-handoff.ps1') -Arguments @('-SessionPath',$sessionPath,'-Reason','Synthetic source changed; rebuild before a new mapping review')
    Assert-Test ($reset.gap_status -ceq 'gap-review' -and -not $reset.decision_changed -and -not $reset.external_flow_started) 'Mapping reset widened authority.'
    Assert-Test ((Get-TestSha256 -Path (Join-Path $reset.archive_path 'previous-gap.json')) -ceq $oldGapHash) 'Reset lost previous gap bytes.'
    Assert-Test ((Get-TestSha256 -Path (Join-Path $reset.archive_path 'previous-handoff.md')) -ceq $oldHandoffHash) 'Reset lost previous handoff bytes.'
    Assert-Test (-not (Test-Path -LiteralPath $handoffPath)) 'Reset left a stale active handoff.'
    $fresh = [IO.File]::ReadAllText($gapPath,$utf8NoBom) | ConvertFrom-Json
    foreach ($field in $fresh.fields) {
        $field.coverage = 'satisfied'; $field.blocking = $false; $field.gap_or_question = ''
        if (@($field.mapped_content).Count -eq 0) { $field.mapped_content = @('Synthetic newly reviewed mapping') }
        if (@($field.source_ids).Count -eq 0) { $field.source_ids = @('IDEA-001') }
    }
    $fresh.status='ready'; $fresh.semantic_review='passed'; $fresh.reviewer='agent'; $fresh.decision_ids=@('DEC-001')
    [IO.File]::WriteAllText($gapPath, ($fresh | ConvertTo-Json -Depth 32), $utf8NoBom)
    [void](Invoke-SuccessJson -ScriptPath $renderHandoff -Arguments @('-SessionPath',$sessionPath))
    $reviewRoot = Join-Path $sandbox 'reviews'
    if (-not $Portable) {
    [void](Invoke-SuccessJson -ScriptPath (Join-Path $scriptsRoot 'record-completion-learning-review.ps1') -Arguments @('-SessionPath',$sessionPath,'-Outcome','no_increment','-Summary','Synthetic closure boundary','-SourceIds','RAW-001','-DiscussionPurposeVisible','unknown','-SerialQaWithoutProgress','unknown','-PrematureConvergenceOrOverdetail','unknown','-SupportConsumptionCausedRework','unknown','-CompletionLearningRoot',$reviewRoot))
    }
    $closeArgs = @('-SessionPath',$sessionPath,'-ToState','closed')
    if (-not $Portable) { $closeArgs += @('-CompletionLearningRoot',$reviewRoot) }
    [void](Invoke-SuccessJson -ScriptPath (Join-Path $scriptsRoot 'set-session-state.ps1') -Arguments $closeArgs)
    $previousPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $rejected = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $renderHandoff -SessionPath $sessionPath -OutputPath (Join-Path $sessionPath 'after-close.md') 2>&1); $rejectedCode = $LASTEXITCODE } finally { $ErrorActionPreference = $previousPreference }
    Assert-Test ($rejectedCode -ne 0 -and ($rejected -join ' ').Contains('Closed sessions') -and -not (Test-Path -LiteralPath (Join-Path $sessionPath 'after-close.md'))) 'Renderer wrote after closure.'

    if ($CandidateContract) { Write-Output 'Brainstorm candidate mapping behavior: PASS; catalog readiness not checked' } else { Write-Output 'Brainstorm adapter system contract: PASS' }
}
finally {
    if (Test-Path -LiteralPath $sandbox -PathType Container) {
        $cleanupTarget = [IO.Path]::GetFullPath($sandbox)
        Assert-Test -Condition ($cleanupTarget.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase)) -Message "Unsafe cleanup target: $cleanupTarget"
        Remove-Item -LiteralPath $cleanupTarget -Recurse -Force
    }
}
