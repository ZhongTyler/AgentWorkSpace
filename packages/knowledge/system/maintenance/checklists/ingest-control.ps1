[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('advance', 'start', 'status', 'merge-pending', 'plan-backtests', 'verify-backtest-set', 'record-package', 'record-artifact', 'reserve-agent-session', 'bind-agent-session', 'close-agent-session', 'sync-agent-sessions', 'prepare-raw-review', 'preflight-raw-review', 'apply-review-repairs', 'complete-raw-review', 'invalidate-raw-review', 'discard-raw-review', 'recover-reviewer-drift', 'prepare-core-review', 'preflight-core-review', 'complete-core-review', 'record-content-audit', 'record-writer-stage', 'correct-stage1-duplicate', 'render-stage1-audit-summary', 'record-backtest', 'approve-gate', 'prepare-semantic-review', 'record-semantic-review', 'check-semantic-review', 'check-stage1', 'check-stage2', 'check-backtests', 'check-stage3', 'render-final-review', 'verify-final-review', 'find-review', 'fuse', 'abandon-fused', 'record-depth-remediation', 'recover-fused', 'rebase-stage1-baseline', 'finish', 'prepare-managed-close', 'initialize-package-data', 'seal-package-section', 'render-package', 'prepare-context', 'reopen-package-section')]
    [string]$Action,
    [string]$RunPath = '',
    [string]$BatchId = '',
    [string]$Items = '',
    [string]$ItemsPath = '',
    [string]$BatchLabels = '',
    [int]$BeforeCount = -1,
    [int]$AfterCount = -1,
    [ValidateSet('', 'scoring', 'stage1', 'stage2', 'stage3', 'gate_audit', 'maintenance')]
    [string]$Package = '',
    [string]$PackagePath = '',
    [int]$Anchor = -1,
    [string]$EvidencePath = '',
    [string]$Stage1Revision = '',
    [string]$BaselineRevision = '',
    [string]$Stage3Revision = '',
    [string]$OutputPath = '',
    [string]$Reason = '',
    [string]$ApprovedHash = '',
    [switch]$ViaFinalizer,
    [ValidateSet('interactive', 'deferred')]
    [string]$ReviewPolicy = 'interactive',
    [ValidateSet('core', 'legacy')]
    [string]$ReviewChannel = 'core',
    [ValidateSet('auto', 'existing', 'consolidated-v1')]
    [string]$ExecutionProfile = 'auto',
    [switch]$PostIngestReread,
    [ValidateSet('', 'scoring', 'stage1', 'stage2', 'stage3')]
    [string]$Gate = '',
    [string]$ArtifactPath = '',
    [string]$AuditReceiptPath = '',
    [string]$AgentId = '',
    [string]$AgentIds = '',
    [switch]$PrimaryWriter,
    [string]$SessionKey = '',
    [ValidateSet('', 'content_writer', 'raw_writer', 'wiki_writer', 'raw_reviewer', 'core_reviewer', 'report_repair', 'other')]
    [string]$AgentRole = '',
    [ValidateSet('', 'reserved', 'active', 'completed', 'failed', 'aborted', 'replaced')]
    [string]$SessionStatus = '',
    [ValidateSet('unknown', 'succeeded', 'permission_failed', 'failed')]
    [string]$WorkOutcome = 'unknown',
    [string]$Model = '',
    [string]$ReasoningEffort = '',
    [string]$Purpose = '',
    [string]$StartedAt = '',
    [string]$EndedAt = '',
    [long]$InputTokens = -1,
    [long]$CachedInputTokens = -1,
    [long]$OutputTokens = -1,
    [string]$HostSessionRoot = '',
    [ValidateSet('', 'input', 'raw')]
    [string]$ArtifactKind = '',
    [ValidateSet('', 'ingested', 'skipped')]
    [string]$Disposition = '',
    [string]$InputItem = '',
    [ValidateRange(-1, 2147483647)]
    [int]$InputItemIndex = -1,
    [string]$ManagedTaskId = '',
    [string]$WorkspaceRoot = '',
    [ValidateSet('', 'scoring', 'stage1', 'stage2', 'stage3')]
    [string]$SemanticReviewStage = '',
    [string]$SemanticReviewReceiptPath = '',
    [string]$SemanticReviewCandidatesPath = '',
    [string]$ProducerContextId = '',
    [ValidateSet('', 'disabled', 'precision', 'shadow', 'enforced')]
    [string]$SemanticReviewMode = '',
    [string]$PackageDataPath = '',
    [string]$SemanticDataPath = '',
    [ValidateSet('summary', 'full')]
    [string]$OutputMode = 'summary',
    [switch]$UseDeterministicPackages,
    [switch]$UseLegacyPackages,
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:utf8NoBom = New-Object Text.UTF8Encoding($false)
$script:projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$script:backtestAnchorInterval = 30
$script:backtestSampleSize = 6
$script:statePath = Join-Path $script:projectRoot 'system/registry/ingest-auto-review-state.json'
$script:indexPath = Join-Path $script:projectRoot 'system/maintenance/ingest-runs/index.json'
$script:semanticReviewPolicyPath = Join-Path $script:projectRoot 'system/registry/ingest-semantic-review-policy.json'
$script:gitReviewExcludedPathspecs = @(
    ':(exclude).obsidian/workspace.json',
    ':(exclude)system/maintenance/ingest-runs/**/semantic-reviews/**/actual.diff'
)
$script:hostExecutable = (Get-Process -Id $PID).Path
$script:packageRendererPath = Join-Path $PSScriptRoot 'render-ingest-package.ps1'
$script:contextPreparerPath = Join-Path $PSScriptRoot 'prepare-ingest-context.ps1'
$script:rawReviewControllerPath = Join-Path $PSScriptRoot 'raw-review-control.mjs'
$script:coreReviewControllerPath = Join-Path $PSScriptRoot 'core-review-control.mjs'
. (Join-Path $PSScriptRoot 'clippings-path-resolver.ps1')

function Write-Utf8File {
    param([string]$Path, [string]$Text)
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    [IO.File]::WriteAllText($Path, $Text, $script:utf8NoBom)
}

function Convert-HostUtc([object]$Value) {
    if ($Value -is [DateTimeOffset]) { return $Value.UtcDateTime }
    if ($Value -is [DateTime]) { return $Value.ToUniversalTime() }
    if ([string]$Value -notmatch '(Z|[+-]\d{2}:\d{2})$') { throw 'Host timestamp requires an explicit timezone.' }
    return [DateTimeOffset]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime
}

function Write-JsonFile {
    param([string]$Path, [object]$Value)
    $json = @(($Value | ConvertTo-Json -Depth 30) -split '\r?\n' | ForEach-Object { $_.TrimEnd() }) -join "`n"
    Write-Utf8File -Path $Path -Text ($json + "`n")
}

function Get-FullPathInsideProject {
    param([string]$Path, [switch]$MustExist)
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Path is required.' }
    $full = if ([IO.Path]::IsPathRooted($Path)) { [IO.Path]::GetFullPath($Path) } else { [IO.Path]::GetFullPath((Join-Path $script:projectRoot $Path)) }
    $prefix = $script:projectRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Path must stay inside Knowledge: $full" }
    $probe = $full
    while ($probe -and $probe -ne $script:projectRoot) {
        if (Test-Path -LiteralPath $probe) {
            $info = Get-Item -LiteralPath $probe -Force
            if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked paths are not valid controller targets: $Path" }
        }
        $probe = Split-Path -Parent $probe
    }
    if ($MustExist -and -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $full = Resolve-ClippingPathMigration -ProjectRoot $script:projectRoot -RequestedFullPath $full
    }
    if ($MustExist -and -not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "File does not exist: $full" }
    return $full
}

function Get-RelativeProjectPath {
    param([string]$FullPath)
    return $FullPath.Substring($script:projectRoot.TrimEnd('\', '/').Length + 1).Replace('\', '/')
}

function Get-Sha256 {
    param([string]$Path)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [IO.File]::ReadAllBytes($Path)
        return (([BitConverter]::ToString($hasher.ComputeHash($bytes))) -replace '-', '').ToLowerInvariant()
    }
    finally {
        $hasher.Dispose()
    }
}

function Write-RunOutcome {
    param(
        [object]$Run,
        [string]$RunManifestPath,
        [string]$NextAction
    )
    if ($OutputMode -eq 'full') {
        Write-Output ($Run | ConvertTo-Json -Depth 30)
        return
    }
    Write-Output ([pscustomobject][ordered]@{
        status = [string]$Run.status
        path = Get-RelativeProjectPath -FullPath $RunManifestPath
        sha256 = Get-Sha256 -Path $RunManifestPath
        next_action = $NextAction
    } | ConvertTo-Json -Depth 10)
}

function Get-FrontmatterFieldValues {
    param([string]$Body, [string]$Field)
    $lines = @($Body -split '\r?\n')
    $fieldPattern = [regex]::Escape($Field)
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -notmatch "^${fieldPattern}:\s*(?<value>.*)$") { continue }
        $inlineValue = $Matches['value'].Trim().Trim('"', "'")
        if (-not [string]::IsNullOrWhiteSpace($inlineValue)) { return @($inlineValue) }

        $values = @()
        for ($itemIndex = $index + 1; $itemIndex -lt $lines.Count; $itemIndex++) {
            if ($lines[$itemIndex] -match '^\s+-\s*(?<value>.+?)\s*$') {
                $values += $Matches['value'].Trim().Trim('"', "'")
                continue
            }
            if ([string]::IsNullOrWhiteSpace($lines[$itemIndex])) { continue }
            break
        }
        return @($values)
    }
    return @()
}

function Get-RawSourceIdentity {
    param([string]$Path)
    $head = @(Get-Content -Encoding UTF8 -LiteralPath $Path -TotalCount 80) -join "`n"
    $frontmatter = [regex]::Match($head, '(?ms)\A---\s*\r?\n(?<body>.*?)\r?\n---')
    if (-not $frontmatter.Success) { return @() }
    $urls = @(Get-FrontmatterFieldValues -Body $frontmatter.Groups['body'].Value -Field 'source_url')
    $clippings = @(Get-FrontmatterFieldValues -Body $frontmatter.Groups['body'].Value -Field 'source_clipping')
    if ($urls.Count -eq 0 -or $urls.Count -ne $clippings.Count) { return @() }

    $identities = @()
    for ($index = 0; $index -lt $urls.Count; $index++) {
        if ($urls[$index] -notmatch '^https?://' -or [string]::IsNullOrWhiteSpace($clippings[$index])) { continue }
        $identities += [pscustomobject][ordered]@{ source_url = $urls[$index]; source_clipping = $clippings[$index] }
    }
    return @($identities)
}

function Assert-CanonicalClippingItems {
    param([string[]]$Values, [string]$Context)
    foreach ($value in @($Values)) {
        $normalized = ([string]$value).Replace('\', '/')
        if (-not $normalized.StartsWith('Clippings/', [StringComparison]::OrdinalIgnoreCase)) { continue }
        if (-not (Test-CanonicalClippingPath -Path $normalized)) {
            throw "$Context clipping path must use Clippings/YYYYMMDD-*.md before the run starts: $normalized"
        }
        $full = Get-FullPathInsideProject -Path $normalized -MustExist
        $file = Get-Item -LiteralPath $full
        if ($file.Length -eq 0) { throw "$Context clipping file is empty: $normalized" }
        $head = @(Get-Content -Encoding UTF8 -LiteralPath $full -TotalCount 20) -join "`n"
        if ($head -match '(?m)^capture_status:\s*missing\s*$') { throw "$Context clipping source needs recovery: $normalized" }
    }
}

function Assert-RawArtifactClippings {
    param([string]$Path)
    $head = @(Get-Content -Encoding UTF8 -LiteralPath $Path -TotalCount 80) -join "`n"
    $frontmatter = [regex]::Match($head, '(?ms)\A---\s*\r?\n(?<body>.*?)\r?\n---')
    if (-not $frontmatter.Success) { return }
    $values = @(Get-FrontmatterFieldValues -Body $frontmatter.Groups['body'].Value -Field 'source_clipping')
    foreach ($value in $values) {
        $relative = ConvertTo-ClippingPath -Reference ([string]$value)
        if (-not (Test-CanonicalClippingPath -Path $relative)) {
            throw "Raw source_clipping must use Clippings/YYYYMMDD-*.md: $(Get-RelativeProjectPath -FullPath $Path) -> $relative"
        }
        [void](Get-FullPathInsideProject -Path $relative -MustExist)
    }
}

function Assert-NoRawSourceIdentityCollision {
    param([string]$CandidatePath)
    $candidates = @(Get-RawSourceIdentity -Path $CandidatePath)
    if ($candidates.Count -eq 0) { return }
    $candidateFull = [IO.Path]::GetFullPath($CandidatePath)
    foreach ($existingFile in @(Get-ChildItem -LiteralPath (Join-Path $script:projectRoot 'raw-sources') -Filter '*.md' -File)) {
        if ([IO.Path]::GetFullPath($existingFile.FullName).Equals($candidateFull, [StringComparison]::OrdinalIgnoreCase)) { continue }
        $existingIdentities = @(Get-RawSourceIdentity -Path $existingFile.FullName)
        foreach ($candidate in $candidates) {
            foreach ($existing in $existingIdentities) {
                if ([string]$existing.source_url -eq [string]$candidate.source_url -and
                    [string]$existing.source_clipping -eq [string]$candidate.source_clipping) {
                    $existingRelative = Get-RelativeProjectPath -FullPath $existingFile.FullName
                    $candidateRelative = Get-RelativeProjectPath -FullPath $candidateFull
                    throw "Raw source identity collision: $candidateRelative matches $existingRelative by source_url and source_clipping."
                }
            }
        }
    }
}

function Assert-RawArtifactDomains {
    param([string[]]$Paths)
    $validDomains = @{}
    foreach ($domainFile in @(Get-ChildItem -LiteralPath (Join-Path $script:projectRoot 'domains') -Filter '*.md' -File)) {
        if ($domainFile.Name -in @('README.md', 'domain-principles.template.md')) { continue }
        $validDomains[$domainFile.BaseName] = $true
    }
    foreach ($path in @($Paths)) {
        $head = @(Get-Content -Encoding UTF8 -LiteralPath $path -TotalCount 80) -join "`n"
        $frontmatter = [regex]::Match($head, '(?ms)\A---\s*\r?\n(?<body>.*?)\r?\n---')
        if (-not $frontmatter.Success) { throw "Raw artifact frontmatter is missing: $(Get-RelativeProjectPath -FullPath $path)" }
        $body = $frontmatter.Groups['body'].Value
        $inline = [regex]::Match($body, '(?m)^domains:\s*\[(?<values>[^\]]*)\]\s*$')
        $domains = @(if ($inline.Success) {
            $inline.Groups['values'].Value.Split(',') | ForEach-Object { $_.Trim().Trim('"', "'") } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        } else {
            Get-FrontmatterFieldValues -Body $body -Field 'domains'
        })
        if ($domains.Count -eq 0) { throw "Raw artifact domains are missing: $(Get-RelativeProjectPath -FullPath $path)" }
        foreach ($domain in $domains) {
            if (-not $validDomains.ContainsKey([string]$domain)) {
                throw "Raw artifact has unknown domain '$domain': $(Get-RelativeProjectPath -FullPath $path)"
            }
        }
    }
}

function Read-JsonFile {
    param([string]$Path)
    # Preserve ISO timestamps as strings so deterministic package hashes keep
    # their original seven-digit fractional-second precision.
    $json = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
    # DateKind is available in PowerShell 7.2+; the .cmd entrypoint still
    # needs to run under Windows PowerShell 5.1.
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        return ($json | ConvertFrom-Json -DateKind String)
    }
    return ($json | ConvertFrom-Json)
}

function Test-ObjectProperty {
    param([object]$Value, [string]$Name)
    return $null -ne $Value -and $null -ne $Value.PSObject.Properties[$Name]
}

function Convert-UnicodeLiteral {
    param([string]$Value)
    return [regex]::Replace($Value, '\\u([0-9a-fA-F]{4})', {
        param($match)
        return [char][Convert]::ToInt32($match.Groups[1].Value, 16)
    })
}

function Split-ControlList {
    param([string]$Value)
    $normalized = $Value.Replace([char]0xFF5C, '|')
    return @($normalized -split '\|' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
}

function Read-ControlItems {
    if (-not [string]::IsNullOrWhiteSpace($Items) -and -not [string]::IsNullOrWhiteSpace($ItemsPath)) {
        throw 'Items and ItemsPath are mutually exclusive.'
    }
    if (-not [string]::IsNullOrWhiteSpace($ItemsPath)) {
        $full = Get-FullPathInsideProject -Path $ItemsPath -MustExist
        $value = Read-JsonFile -Path $full
        if ($value -is [string] -or $value -isnot [System.Collections.IEnumerable]) {
            throw 'ItemsPath must contain a JSON array of strings.'
        }
        $list = @($value | ForEach-Object { [string]$_ })
        if (@($list | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
            throw 'ItemsPath cannot contain blank items.'
        }
        return @($list)
    }
    return @(Split-ControlList -Value $Items)
}

function Read-Run {
    $full = Get-FullPathInsideProject -Path $RunPath -MustExist
    $run = Read-JsonFile -Path $full
    if ((Test-ObjectProperty -Value $run -Name 'execution_control') -and (Test-ObjectProperty -Value $run.execution_control -Name 'execution_profile') -and @('existing', 'consolidated-v1') -notcontains [string]$run.execution_control.execution_profile) { throw 'Unsupported execution profile; do not reinterpret this run through another route.' }
    foreach ($field in @('schema_version', 'batch_id', 'status', 'items', 'base_revision', 'counts', 'packages', 'commits', 'backtests', 'final_review')) {
        if (-not (Test-ObjectProperty -Value $run -Name $field)) { throw "Run manifest missing field: $field" }
    }
    if (@(1, 2, 3, 4, 5, 6, 7, 8) -notcontains [int]$run.schema_version) { throw 'Unsupported run manifest schema_version.' }
    if ([int]$run.schema_version -ge 8 -and (-not (Test-ObjectProperty -Value $run -Name 'raw_standard') -or $run.raw_standard -ne 'RAW_STANDARD_V2')) { throw 'Schema 8 requires RAW_STANDARD_V2.' }
    if ([int]$run.schema_version -ge 3 -and -not (Test-ObjectProperty -Value $run -Name 'content_audits')) {
        throw 'Run manifest missing field: content_audits'
    }
    if ([int]$run.schema_version -ge 4 -and -not (Test-ObjectProperty -Value $run -Name 'managed_task')) {
        throw 'Run manifest missing field: managed_task'
    }
    if ([int]$run.schema_version -ge 5) {
        foreach ($field in @('producer_context_id', 'semantic_review_mode', 'semantic_reviews')) {
            if (-not (Test-ObjectProperty -Value $run -Name $field)) { throw "Run manifest missing field: $field" }
        }
        foreach ($stage in @('scoring', 'stage1', 'stage2', 'stage3')) {
            $slot = $run.semantic_reviews.$stage
            if ($null -eq $slot) { throw "Run manifest semantic review slot is missing: $stage" }
            foreach ($field in @('pending', 'active', 'history')) {
                if (-not (Test-ObjectProperty -Value $slot -Name $field)) { throw "Run manifest semantic review slot $stage missing field: $field" }
            }
        }
    }
    if ([int]$run.schema_version -ge 6) {
        if (-not (Test-ObjectProperty -Value $run -Name 'package_data')) { throw 'Run manifest missing field: package_data' }
        foreach ($field in @('path', 'schema_version', 'renderer_version')) {
            if (-not (Test-ObjectProperty -Value $run.package_data -Name $field)) { throw "Run manifest package_data missing field: $field" }
        }
    }
    if (Test-ObjectProperty -Value $run -Name 'execution_control') {
        if ((Test-ObjectProperty $run.execution_control 'workflow_revision') -and $run.execution_control.workflow_revision -notin @(1,2)) { throw 'Unsupported workflow_revision; preserve the original run contract.' }
        if ((Test-ObjectProperty $run.execution_control 'mechanical_contract_version') -and $run.execution_control.mechanical_contract_version -ne 1) { throw 'Unsupported mechanical_contract_version.' }
        if ((Test-ObjectProperty $run.execution_control 'reviewer_route_version') -and $run.execution_control.reviewer_route_version -notin @(1,2,3)) { throw 'Unsupported reviewer_route_version.' }
        foreach ($field in @('schema_version', 'child_session_cap', 'raw_review_attempts', 'writer_stages', 'writer_stage_history')) {
            if (-not (Test-ObjectProperty -Value $run.execution_control -Name $field)) { throw "Run manifest execution_control missing field: $field" }
        }
        if ((Test-ObjectProperty -Value $run.execution_control -Name 'raw_review_history') -and $run.execution_control.raw_review_history -isnot [array]) {
            throw 'Run manifest execution_control.raw_review_history must be an array.'
        }
        if ([int]$run.execution_control.schema_version -notin @(1, 2) -or [int]$run.execution_control.child_session_cap -lt 1) {
            throw 'Run manifest execution_control version or child session cap is invalid.'
        }
        if ([int]$run.execution_control.schema_version -ge 2) {
            foreach ($field in @('agent_sessions', 'quality_events', 'reviewer_policy')) {
                if (-not (Test-ObjectProperty -Value $run.execution_control -Name $field)) { throw "Run manifest execution_control missing field: $field" }
            }
            if ($run.execution_control.agent_sessions -isnot [array] -or $run.execution_control.quality_events -isnot [array]) {
                throw 'Run manifest execution_control v2 ledgers must be arrays.'
            }
        }
        foreach ($stage in @('stage1', 'stage3')) {
            if (-not (Test-ObjectProperty -Value $run.execution_control.writer_stages -Name $stage)) {
                throw "Run manifest writer stage is missing: $stage"
            }
        }
        if ((Test-ObjectProperty $run.execution_control 'runtime_contract_version') -and [int]$run.execution_control.runtime_contract_version -ge 3) {
            if (-not (Test-ObjectProperty $run.execution_control 'wiki_consumption_contract_version') -or $run.execution_control.wiki_consumption_contract_version -ne 1) { throw 'Runtime v3 requires wiki_consumption_contract_version=1.' }
        }
    }
    return [pscustomobject]@{ Path = $full; Value = $run }
}

function Get-ReviewPolicy {
    param([object]$Run)
    if (Test-ObjectProperty -Value $Run -Name 'review_policy') { return [string]$Run.review_policy }
    return 'deferred'
}

function Resolve-WorkspaceRoot {
    if (-not [string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
        $candidate = [IO.Path]::GetFullPath($WorkspaceRoot)
        if (-not (Test-Path -LiteralPath (Join-Path $candidate 'WorkspaceOrchestration/scripts/task-tool.ps1') -PathType Leaf)) {
            throw "WorkspaceRoot has no orchestration task tool: $candidate"
        }
        return $candidate
    }
    $candidate = $script:projectRoot
    for ($depth = 0; $depth -lt 7; $depth++) {
        if (Test-Path -LiteralPath (Join-Path $candidate 'WorkspaceOrchestration/scripts/task-tool.ps1') -PathType Leaf) { return $candidate }
        $parent = Split-Path -Parent $candidate
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $candidate) { break }
        $candidate = $parent
    }
    throw 'Workspace root could not be discovered; pass -WorkspaceRoot explicitly.'
}

function Get-ManagedTaskContext {
    param([string]$TaskId, [switch]$RequireBaseHead)
    if ($TaskId -notmatch '^[a-z0-9][a-z0-9._-]{0,63}$') { throw 'ManagedTaskId must be a safe task identifier.' }
    $root = Resolve-WorkspaceRoot
    $taskTool = Join-Path $root 'WorkspaceOrchestration/scripts/task-tool.ps1'
    $statusText = @(& $script:hostExecutable -NoProfile -ExecutionPolicy Bypass -File $taskTool status -WorkspaceRoot $root -TaskId $TaskId) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Unable to read managed task status: $TaskId" }
    $status = $statusText | ConvertFrom-Json
    $tasks = @($status.data.tasks)
    $worktrees = @($status.data.managed_worktrees)
    if ($tasks.Count -ne 1 -or $worktrees.Count -ne 1) { throw 'Managed auto-ingest requires one active task and one owned worktree record.' }
    $task = $tasks[0]
    $worktree = $worktrees[0]
    if ($task.repository_id -ne 'knowledge' -or $task.status -ne 'active' -or $task.mode -ne 'isolated') {
        throw 'Managed auto-ingest requires an active isolated Knowledge task.'
    }
    if ($worktree.status -ne 'active' -or [string]$worktree.task_id -ne $TaskId) {
        throw 'Managed auto-ingest worktree ownership is not active.'
    }
    if ([IO.Path]::GetFullPath([string]$task.execution_path).TrimEnd('\', '/') -ne $script:projectRoot.TrimEnd('\', '/')) {
        throw 'Managed task execution_path does not match this Knowledge worktree.'
    }
    $head = (& git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -C $script:projectRoot rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Unable to read managed Knowledge HEAD.' }
    if ($RequireBaseHead -and $head -ne [string]$task.base_revision) {
        throw 'Managed auto-ingest must start at the task base revision.'
    }
    return [pscustomobject][ordered]@{
        task_id = $TaskId
        base_revision = [string]$task.base_revision
        execution_path = [string]$task.execution_path
        workspace_root = $root
        head = $head
    }
}

function Assert-ManagedRunContext {
    param([object]$Run)
    if ([int]$Run.schema_version -lt 4 -or $null -eq $Run.managed_task) { return $null }
    $context = Get-ManagedTaskContext -TaskId ([string]$Run.managed_task.task_id)
    if ($context.base_revision -ne [string]$Run.managed_task.base_revision -or $context.base_revision -ne [string]$Run.base_revision) {
        throw 'Managed run identity differs from its orchestration task base.'
    }
    return $context
}

function Get-GitTree {
    param([string]$Revision)
    $tree = (& git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -C $script:projectRoot show -s --format=%T $Revision).Trim()
    if ($LASTEXITCODE -ne 0 -or $tree -notmatch '^[0-9a-f]{40,64}$') { throw "Unable to read Git tree: $Revision" }
    return $tree
}

function Get-GitPatch {
    param([string]$From, [string]$To)
    $lines = @(& git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -c core.quotepath=false -C $script:projectRoot diff --binary $From $To -- $script:gitReviewExcludedPathspecs)
    if ($LASTEXITCODE -ne 0) { throw "Unable to export checkpoint patch: $From..$To" }
    if ($lines.Count -eq 0) { return '' }
    return (($lines -join "`n") + "`n")
}

function Assert-RunLocalPath {
    param([string]$RunManifestPath, [string]$CandidatePath)
    $runDirectory = (Split-Path -Parent $RunManifestPath).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $CandidatePath.StartsWith($runDirectory, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Run evidence must stay beside its manifest: $CandidatePath"
    }
}

function Save-Run {
    param([string]$Path, [object]$Run)
    $Run.updated_at = [DateTime]::UtcNow.ToString('o')
    Write-JsonFile -Path $Path -Value $Run
}

function Get-ExecutionAgentIds {
    param([object]$Run)
    if (-not (Test-ObjectProperty -Value $Run -Name 'execution_control')) { return @() }
    $ids = @()
    if ([int]$Run.execution_control.schema_version -ge 2) {
        return @($Run.execution_control.agent_sessions | ForEach-Object { [string]$_.agent_id } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
    }
    foreach ($attempt in @($Run.execution_control.raw_review_attempts)) {
        if ((Test-ObjectProperty -Value $attempt -Name 'agent_id') -and -not [string]::IsNullOrWhiteSpace([string]$attempt.agent_id)) { $ids += [string]$attempt.agent_id }
    }
    if (Test-ObjectProperty -Value $Run.execution_control -Name 'raw_review_history') {
        foreach ($attempt in @($Run.execution_control.raw_review_history)) {
            if ((Test-ObjectProperty -Value $attempt -Name 'agent_id') -and -not [string]::IsNullOrWhiteSpace([string]$attempt.agent_id)) { $ids += [string]$attempt.agent_id }
        }
    }
    foreach ($stage in @('stage1', 'stage3')) {
        $record = $Run.execution_control.writer_stages.$stage
        if ($null -ne $record) { $ids += @($record.agent_ids | ForEach-Object { [string]$_ }) }
    }
    foreach ($record in @($Run.execution_control.writer_stage_history)) {
        $ids += @($record.agent_ids | ForEach-Object { [string]$_ })
    }
    return @($ids | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
}

function Assert-ExecutionAgentBudget {
    param([object]$Run, [string[]]$AdditionalAgentIds = @())
    if (-not (Test-ObjectProperty -Value $Run -Name 'execution_control')) { return 0 }
    $cap = [int]$Run.execution_control.child_session_cap
    if ([int]$Run.execution_control.schema_version -ge 2) {
        $count = @($Run.execution_control.agent_sessions).Count
        if ($count -gt $cap) { throw "Child session cap exceeded: $count > $cap" }
        foreach ($id in @($AdditionalAgentIds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)) {
            if (@($Run.execution_control.agent_sessions | Where-Object { [string]$_.agent_id -eq $id }).Count -eq 0) {
                throw "AgentId is not bound to a reserved child session: $id"
            }
        }
        return $count
    }
    $ids = @((Get-ExecutionAgentIds -Run $Run) + @($AdditionalAgentIds) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
    if ($ids.Count -gt $cap) { throw "Child session cap exceeded: $($ids.Count) > $cap" }
    return $ids.Count
}

function Move-WriterStageToHistory {
    param([object]$Run, [string]$Stage, [string]$Reason)
    if (-not (Test-ObjectProperty -Value $Run -Name 'execution_control')) { return }
    $record = $Run.execution_control.writer_stages.$Stage
    if ($null -eq $record) { return }
    $archived = $record | Select-Object *
    $archived | Add-Member -NotePropertyName invalidated_reason -NotePropertyValue $Reason -Force
    $archived | Add-Member -NotePropertyName invalidated_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    $Run.execution_control.writer_stage_history = @($Run.execution_control.writer_stage_history) + @($archived)
    $Run.execution_control.writer_stages.$Stage = $null
}

function Move-RawReviewsToHistory {
    param([object]$Run, [string]$Reason)
    if (-not (Test-ObjectProperty -Value $Run -Name 'execution_control')) { return }
    if (-not (Test-ObjectProperty -Value $Run.execution_control -Name 'raw_review_history')) {
        $Run.execution_control | Add-Member -NotePropertyName raw_review_history -NotePropertyValue @()
    }
    $archived = @()
    foreach ($attempt in @($Run.execution_control.raw_review_attempts)) {
        $record = $attempt | Select-Object *
        $record | Add-Member -NotePropertyName invalidated_reason -NotePropertyValue $Reason -Force
        $record | Add-Member -NotePropertyName invalidated_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
        $archived += $record
    }
    $Run.execution_control.raw_review_history = @($Run.execution_control.raw_review_history) + @($archived)
    $Run.execution_control.raw_review_attempts = @()
}

function Assert-WriterStageCompletion {
    param([object]$Run, [string]$Stage, [string]$SemanticDataPath = '')
    if (-not (Test-ObjectProperty -Value $Run -Name 'execution_control')) { return }
    if ($Stage -notin @('stage1', 'stage3')) { return }
    $record = $Run.execution_control.writer_stages.$Stage
    if ($null -eq $record -or [string]$record.status -ne 'completed') {
        throw "$Stage package cannot seal before record-writer-stage confirms all writer agents joined and outputs are final."
    }
    foreach ($output in @($record.outputs)) {
        $full = Get-FullPathInsideProject -Path ([string]$output.path) -MustExist
        if ((Get-Sha256 -Path $full) -ne [string]$output.sha256) { throw "$Stage writer output changed after completion: $($output.path)" }
    }
    if ($Stage -eq 'stage3') {
        $semanticPath = [string]$record.semantic_path
        if (-not [string]::IsNullOrWhiteSpace($SemanticDataPath)) {
            $actualSemanticFull = Get-FullPathInsideProject -Path $SemanticDataPath -MustExist
            $actualSemanticPath = Get-RelativeProjectPath -FullPath $actualSemanticFull
            if ($actualSemanticPath -ne $semanticPath) { throw 'Stage3 writer completion is bound to a different semantic plan.' }
        }
        $semanticFull = Get-FullPathInsideProject -Path $semanticPath -MustExist
        if ((Get-Sha256 -Path $semanticFull) -ne [string]$record.semantic_sha256) { throw 'Stage3 semantic plan changed after writer completion.' }
    }
    [void](Assert-ExecutionAgentBudget -Run $Run)
}

function Get-PackageDataPathForRun {
    param([object]$Run, [string]$RunManifestPath)
    if ([int]$Run.schema_version -lt 6 -or $null -eq $Run.PSObject.Properties['package_data']) { throw 'Deterministic package actions require run schema_version 6.' }
    $path = [string]$Run.package_data.path
    if ([string]::IsNullOrWhiteSpace($path)) { throw 'Run has no package_data path.' }
    return Get-FullPathInsideProject -Path $path -MustExist
}

function New-EmptyPackageSemantic {
    return [pscustomobject][ordered]@{
        summary = ''
        rows = @()
        semantic_exceptions = @()
        unresolved_risks = @()
        structure_change_requests = @()
        micro_failures = @()
    }
}

function Get-CleanJsonText {
    param([object]$Value, [int]$Depth = 30)
    return (@(($Value | ConvertTo-Json -Depth $Depth) -split '\r?\n' | ForEach-Object { $_.TrimEnd() }) -join "`n") + "`n"
}

function Get-ObjectSha256 {
    param([object]$Value)
    $bytes = [Text.Encoding]::UTF8.GetBytes((Get-CleanJsonText -Value $Value))
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}

function Assert-PackageSemanticShape {
    param([object]$Semantic)
    if ($null -eq $Semantic) { throw 'Semantic package data is required.' }
    foreach ($field in @('summary', 'rows', 'semantic_exceptions', 'unresolved_risks', 'structure_change_requests', 'micro_failures')) {
        if (-not (Test-ObjectProperty -Value $Semantic -Name $field)) { throw "Semantic package data is missing field: $field" }
    }
    if ($Semantic.summary -isnot [string]) { throw 'semantic.summary must be a string.' }
    foreach ($field in @('rows', 'semantic_exceptions', 'unresolved_risks', 'structure_change_requests', 'micro_failures')) {
        if ($null -eq $Semantic.$field -or $Semantic.$field -is [string] -or $Semantic.$field -isnot [System.Collections.IEnumerable]) { throw "semantic.$field must be an array." }
    }
}

function Assert-GateAuditSemanticBoundary {
    param([object]$Semantic)
    $text = $Semantic | ConvertTo-Json -Compress -Depth 30
    if ($text -match '(?i)(?<![a-f0-9])[a-f0-9]{64}(?![a-f0-9])') {
        throw 'gate_audit semantic data must not hand-copy SHA-256 values; renderer and final review own runtime hashes.'
    }
}

function Invoke-DeterministicRenderer {
    param([string]$Kind, [string]$RunManifestPath, [string]$PackageDataFull, [string]$TargetFull)
    $text = @(& $script:hostExecutable -NoProfile -ExecutionPolicy Bypass -File $script:packageRendererPath -Package $Kind -RunPath (Get-RelativeProjectPath -FullPath $RunManifestPath) -PackageDataPath (Get-RelativeProjectPath -FullPath $PackageDataFull) -OutputPath (Get-RelativeProjectPath -FullPath $TargetFull) -OutputMode summary) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Deterministic package renderer failed: $text" }
    return ($text | ConvertFrom-Json)
}

function Invoke-ContentReview {
    param([string]$Operation, [string]$Manifest, [string]$Stage = '', [string]$Semantic = '', [string]$Target = '', [string]$Revision = '', [switch]$AfterWriting)
    $arguments = @((Join-Path $PSScriptRoot 'ingest-review.mjs'), $Operation, '--root', $script:projectRoot, '--run', $Manifest)
    if ($Stage) { $arguments += @('--stage', $Stage) }
    if ($Semantic) { $arguments += @('--semantic', $Semantic) }
    if ($Target) { $arguments += @('--output', $Target) }
    if ($Revision) { $arguments += @('--revision', $Revision) }
    if ($AfterWriting) { $arguments += @('--after-writing', 'true') }
    $text = @(& node @arguments) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Content review $Operation failed: $text" }
    return ($text | ConvertFrom-Json)
}

function Get-SemanticReviewMode {
    if (-not (Test-Path -LiteralPath $script:semanticReviewPolicyPath -PathType Leaf)) { return 'disabled' }
    $policy = Read-JsonFile -Path $script:semanticReviewPolicyPath
    $policyDefault = if (Test-ObjectProperty -Value $policy -Name 'default_mode') { [string]$policy.default_mode } else { [string]$policy.mode }
    if (@(1, 2) -notcontains [int]$policy.schema_version -or @('disabled', 'shadow', 'enforced') -notcontains $policyDefault) {
        throw 'Invalid ingest semantic-review policy.'
    }
    if ((Test-ObjectProperty -Value $policy -Name 'mode') -and @('disabled', 'shadow', 'enforced') -notcontains [string]$policy.mode) {
        throw 'Invalid ingest semantic-review policy mode.'
    }
    if ((Test-ObjectProperty -Value $policy -Name 'precision_mode') -and @('shadow', 'enforced') -notcontains [string]$policy.precision_mode) {
        throw 'Invalid ingest semantic-review precision_mode.'
    }
    return $policyDefault
}

function Resolve-SemanticReviewMode {
    param([string]$RequestedMode)
    if ([string]::IsNullOrWhiteSpace($RequestedMode)) { return Get-SemanticReviewMode }
    switch ($RequestedMode) {
        'precision' { return 'enforced' }
        'disabled' { return 'disabled' }
        'shadow' { return 'shadow' }
        'enforced' { return 'enforced' }
        default { throw "Unsupported semantic review mode: $RequestedMode" }
    }
}

function Test-SemanticReviewRun {
    param([object]$Run)
    return ([int]$Run.schema_version -ge 7 -or ([int]$Run.schema_version -ge 5 -and (Get-ReviewPolicy -Run $Run) -eq 'deferred'))
}

function Get-SemanticReviewRunMode {
    param([object]$Run)
    if (-not (Test-SemanticReviewRun -Run $Run)) { return 'disabled' }
    if (-not (Test-ObjectProperty -Value $Run -Name 'semantic_review_mode')) { return 'enforced' }
    return [string]$Run.semantic_review_mode
}

function Test-SemanticReviewGateEnabled {
    param([object]$Run)
    return (Test-SemanticReviewRun -Run $Run) -and (Get-SemanticReviewRunMode -Run $Run) -eq 'enforced'
}

function Assert-SemanticReviewStage {
    param([string]$Stage)
    if (@('scoring', 'stage1', 'stage2', 'stage3') -notcontains $Stage) { throw "Unsupported semantic review stage: $Stage" }
}

function Get-SemanticReviewSlot {
    param([object]$Run, [string]$Stage)
    Assert-SemanticReviewStage -Stage $Stage
    if (-not (Test-SemanticReviewRun -Run $Run)) { throw 'Semantic review is only available for deferred schema v5 runs.' }
    $slot = $Run.semantic_reviews.$Stage
    if ($null -eq $slot) { throw "Run semantic review slot is missing: $Stage" }
    return $slot
}

function New-SemanticEvidenceRecord {
    param([string]$FullPath, [string]$Role)
    $full = Get-FullPathInsideProject -Path $FullPath -MustExist
    return [pscustomobject][ordered]@{ path = Get-RelativeProjectPath -FullPath $full; sha256 = Get-Sha256 -Path $full; role = $Role }
}

function Add-SemanticEvidence {
    param([System.Collections.Generic.List[object]]$Records, [string]$FullPath, [string]$Role)
    $record = New-SemanticEvidenceRecord -FullPath $FullPath -Role $Role
    if (@($Records | Where-Object { $_.path -eq $record.path -and $_.role -eq $record.role }).Count -eq 0) { [void]$Records.Add($record) }
}

function Get-SemanticReviewEvidence {
    param([object]$Run, [string]$RunManifestPath, [string]$Stage, [string]$Stage3Revision = '', [string]$CandidatesPath = '', [string]$RunSnapshotPath = '')
    Assert-SemanticReviewStage -Stage $Stage
    $records = New-Object System.Collections.Generic.List[object]
    $packageKinds = switch ($Stage) {
        'scoring' { @('scoring') }
        'stage1' { @('scoring', 'stage1') }
        'stage2' { @('stage1', 'stage2') }
        'stage3' { @('stage2', 'stage3', 'gate_audit', 'maintenance') }
    }
    foreach ($kind in $packageKinds) { Add-SemanticEvidence -Records $records -FullPath (Assert-RecordedPackage -Run $Run -Kind $kind) -Role ("package_$kind") }
    if ([int]$Run.schema_version -ge 7) {
        $data = Read-JsonFile -Path (Get-PackageDataPathForRun -Run $Run -RunManifestPath $RunManifestPath)
        foreach ($kind in @($packageKinds | Where-Object { $_ -ne 'maintenance' })) {
            foreach ($dependency in @($data.sections.$kind.derived.dependencies)) {
                if ($dependency.exists) { Add-SemanticEvidence -Records $records -FullPath ([string]$dependency.path) -Role ('bound_' + $kind) }
            }
        }
        foreach ($rule in @('system/maintenance/checklists/ingest-semantic-review.md','system/maintenance/schemas/ingest-semantic-review-v1.schema.json')) {
            Add-SemanticEvidence -Records $records -FullPath $rule -Role 'semantic_review_contract'
        }
        if ($Stage -eq 'scoring' -and $RunSnapshotPath) { Add-SemanticEvidence -Records $records -FullPath $RunSnapshotPath -Role 'scoring_run_snapshot' }
        if ($Stage -eq 'scoring') {
            foreach ($reference in @(
                @{ path = 'system/registry/quick-reference.md'; role = 'scoring_knowledge_index' },
                @{ path = 'system/registry/raw-list.md'; role = 'scoring_history_raw_list' },
                @{ path = 'system/registry/skipped-sources.md'; role = 'scoring_history_skipped' },
                @{ path = 'Clippings/temp-review-2026-07-13.md'; role = 'scoring_pending_queue' }
            )) {
                Add-SemanticEvidence -Records $records -FullPath (Join-Path $script:projectRoot $reference.path) -Role $reference.role
            }
            $baselineWikiManifestPath = Join-Path (Split-Path -Parent $RunManifestPath) 'semantic-reviews/scoring/baseline-wiki-manifest.json'
            if (-not (Test-Path -LiteralPath $baselineWikiManifestPath -PathType Leaf)) {
                throw 'Schema 7+ scoring semantic review requires a run-local baseline Wiki manifest.'
            }
            Add-SemanticEvidence -Records $records -FullPath $baselineWikiManifestPath -Role 'scoring_related_wiki_baseline_manifest'
            $baselineWikiManifest = Read-JsonFile -Path $baselineWikiManifestPath
            if ([string]$baselineWikiManifest.kind -ne 'scoring_baseline_wiki_manifest' -or
                [string]$baselineWikiManifest.batch_id -ne [string]$Run.batch_id -or
                [string]$baselineWikiManifest.baseline_revision -ne [string]$Run.base_revision) {
                throw 'Scoring baseline Wiki manifest does not bind the run baseline revision.'
            }
            $baselineWikiEntries = @($baselineWikiManifest.paths)
            $baselineWikiPaths = @($baselineWikiEntries | ForEach-Object { [string]$_.baseline_path })
            if ($baselineWikiEntries.Count -ne 12 -or (@($baselineWikiPaths | Sort-Object -Unique).Count -ne 12)) {
                throw 'Scoring baseline Wiki manifest must contain 12 unique pages.'
            }
            foreach ($entry in $baselineWikiEntries) {
                if ([string]$entry.baseline_path -notmatch '^wiki/.+\.md$' -or [string]::IsNullOrWhiteSpace([string]$entry.snapshot_path)) {
                    throw 'Scoring baseline Wiki manifest contains an invalid page path.'
                }
                Add-SemanticEvidence -Records $records -FullPath (Get-FullPathInsideProject -Path ([string]$entry.snapshot_path) -MustExist) -Role 'scoring_related_wiki_baseline'
            }
        }
        if ($Stage -eq 'stage2') {
            if ([string]::IsNullOrWhiteSpace($CandidatesPath)) { throw 'Stage2 semantic review requires explicit candidate scope, including an empty justified set when appropriate.' }
            $candidateFull = Get-FullPathInsideProject -Path $CandidatesPath -MustExist
            Assert-RunLocalPath -RunManifestPath $RunManifestPath -CandidatePath $candidateFull
            $candidates = Read-JsonFile -Path $candidateFull
            if (-not (Test-ObjectProperty $candidates 'candidate_paths') -or ($candidates.candidate_paths.Count -eq 0 -and (-not (Test-ObjectProperty $candidates 'reason') -or [string]::IsNullOrWhiteSpace($candidates.reason)))) { throw 'Candidate scope needs candidate_paths and a reason when empty.' }
            Add-SemanticEvidence -Records $records -FullPath $candidateFull -Role 'wiki_candidates_manifest'
            foreach ($candidate in @($candidates.candidate_paths)) {
                if ([string]$candidate -notmatch '^(wiki|domains)/.+[.]md$') { throw 'Semantic candidate outside Wiki/domain scope.' }
                Add-SemanticEvidence -Records $records -FullPath ([string]$candidate) -Role 'wiki_candidate'
            }
        }
        if ($Stage -eq 'stage3') {
            Assert-GitRevision -Revision $Stage3Revision
            if (-not $Run.commits.stage1) { throw 'Stage3 semantic review requires Stage1 checkpoint.' }
            $diffPath = Join-Path (Split-Path -Parent $RunManifestPath) 'semantic-reviews/stage3/actual.diff'
            Write-Utf8File -Path $diffPath -Text (Get-GitPatch -From ([string]$Run.commits.stage1) -To $Stage3Revision)
            Add-SemanticEvidence -Records $records -FullPath $diffPath -Role 'stage3_diff'
        }
        return @($records.ToArray())
    }
    if ($Stage -eq 'scoring') {
        Add-SemanticEvidence -Records $records -FullPath (Join-Path $script:projectRoot 'system/protocols/SCORING_SYSTEM.md') -Role 'scoring_ssot'
        # Scoring reviewers must independently verify history and B1 claims.
        # Keep this evidence set explicit and bounded.
        foreach ($reference in @(
            @{ path = 'system/registry/quick-reference.md'; role = 'scoring_knowledge_index' },
            @{ path = 'system/registry/raw-list.md'; role = 'scoring_history_raw_list' },
            @{ path = 'system/registry/skipped-sources.md'; role = 'scoring_history_skipped' },
            @{ path = 'Clippings/temp-review-2026-07-13.md'; role = 'scoring_pending_queue' }
        )) {
            Add-SemanticEvidence -Records $records -FullPath (Join-Path $script:projectRoot $reference.path) -Role $reference.role
        }
        # B1 must be evaluated against the Stage 1 pre-write Wiki tree. A run-local
        # manifest may freeze those pages as exact Git-tree snapshots; current Wiki
        # files are deliberately excluded from scoring evidence in that case.
        $baselineWikiManifestPath = Join-Path (Split-Path -Parent $RunManifestPath) 'semantic-reviews/scoring/baseline-wiki-manifest.json'
        if (Test-Path -LiteralPath $baselineWikiManifestPath -PathType Leaf) {
            Add-SemanticEvidence -Records $records -FullPath $baselineWikiManifestPath -Role 'scoring_related_wiki_baseline_manifest'
            $baselineWikiManifest = Read-JsonFile -Path $baselineWikiManifestPath
            if ([string]$baselineWikiManifest.kind -ne 'scoring_baseline_wiki_manifest' -or
                [string]$baselineWikiManifest.batch_id -ne [string]$Run.batch_id -or
                [string]$baselineWikiManifest.baseline_revision -ne [string]$Run.base_revision) {
                throw 'Scoring baseline Wiki manifest does not bind the run baseline revision.'
            }
            $baselineWikiEntries = @($baselineWikiManifest.paths)
            $baselineWikiPaths = @($baselineWikiEntries | ForEach-Object { [string]$_.baseline_path })
            if ($baselineWikiEntries.Count -ne 12 -or (@($baselineWikiPaths | Sort-Object -Unique).Count -ne 12)) {
                throw 'Scoring baseline Wiki manifest must contain 12 unique pages.'
            }
            foreach ($entry in $baselineWikiEntries) {
                $baselinePath = [string]$entry.baseline_path
                $snapshotPath = [string]$entry.snapshot_path
                if ($baselinePath -notmatch '^wiki/.+\.md$' -or [string]::IsNullOrWhiteSpace($snapshotPath)) {
                    throw 'Scoring baseline Wiki manifest contains an invalid page path.'
                }
                Add-SemanticEvidence -Records $records -FullPath (Get-FullPathInsideProject -Path $snapshotPath -MustExist) -Role 'scoring_related_wiki_baseline'
            }
        } else {
            foreach ($reference in @(
                @{ path = (Convert-UnicodeLiteral 'wiki/\u6838\u5fc3\u4f53\u9a8c\u4e0e\u73a9\u6cd5\u7ec4\u5408\u8bbe\u8ba1.md'); role = 'scoring_related_wiki' },
                @{ path = (Convert-UnicodeLiteral 'wiki/\u4f53\u9a8c\u8c03\u8282\u4e0e\u53cd\u9988\u8bbe\u8ba1\u8303\u5f0f.md'); role = 'scoring_related_wiki' },
                @{ path = (Convert-UnicodeLiteral 'wiki/\u5546\u4e1a\u5316\u8bbe\u8ba1\uff1a\u4ef7\u503c\u3001\u5206\u5c42\u4e0e\u8d2d\u4e70\u51b3\u7b56.md'); role = 'scoring_related_wiki' },
                @{ path = (Convert-UnicodeLiteral 'wiki/\u4e92\u52a8\u53d9\u4e8b\u7ed3\u6784\u65b9\u6cd5\u8bba.md'); role = 'scoring_related_wiki' },
                @{ path = (Convert-UnicodeLiteral 'wiki/Roguelike \u4f53\u9a8c\u4e0e\u968f\u673a\u7cfb\u7edf\u8bbe\u8ba1.md'); role = 'scoring_related_wiki' },
                @{ path = (Convert-UnicodeLiteral 'wiki/\u6e38\u620f\u8bbe\u8ba1\u65b9\u6cd5\u8bba\uff1a\u53d9\u4e8b\u4e0e\u4e16\u754c.md'); role = 'scoring_related_wiki' },
                @{ path = (Convert-UnicodeLiteral 'wiki/\u73a9\u5bb6\u4ef7\u503c\u4e0e\u4e50\u8da3\u8bbe\u8ba1.md'); role = 'scoring_related_wiki' },
                @{ path = (Convert-UnicodeLiteral 'wiki/\u6e38\u620f\u957f\u7ebf\u8fd0\u8425\u4e0e\u793e\u533a\u7ecf\u8425.md'); role = 'scoring_related_wiki' },
                @{ path = (Convert-UnicodeLiteral 'wiki/\u7ecf\u8425\u4e0e\u6210\u957f\u7cfb\u7edf\u8bbe\u8ba1.md'); role = 'scoring_related_wiki' },
                @{ path = (Convert-UnicodeLiteral 'wiki/\u6e38\u620f\u793e\u4ea4\u5de5\u5177\u4e0e\u6c9f\u901a\u8bbe\u8ba1.md'); role = 'scoring_related_wiki' },
                @{ path = (Convert-UnicodeLiteral 'wiki/\u53d9\u4e8b\u8bbe\u8ba1\uff1a\u7406\u8bba\u4e0e\u6846\u67b6.md'); role = 'scoring_related_wiki' },
                @{ path = (Convert-UnicodeLiteral 'wiki/\u968f\u673a\u6027\u4e0e\u4e0d\u786e\u5b9a\u6027\u6279\u5224.md'); role = 'scoring_related_wiki' }
            )) {
                Add-SemanticEvidence -Records $records -FullPath (Join-Path $script:projectRoot $reference.path) -Role $reference.role
            }
        }
        $historyAuditPath = Join-Path (Split-Path -Parent $RunManifestPath) 'scoring-history-audit.json'
        if (Test-Path -LiteralPath $historyAuditPath -PathType Leaf) {
            Add-SemanticEvidence -Records $records -FullPath $historyAuditPath -Role 'scoring_history_audit_manifest'
        }
        foreach ($item in @($Run.items)) { Add-SemanticEvidence -Records $records -FullPath $item -Role 'input_clipping' }
        # When a deferred run already has content audits, scoring must expose the
        # complete input -> raw -> manifest/review/decision chain instead of only
        # the six Clippings. Keep the lightweight fixture path compatible by
        # adding this closure only when the run actually carries audits.
        if (@($Run.content_audits).Count -gt 0) {
            if ([string]::IsNullOrWhiteSpace($RunSnapshotPath)) { throw 'Scoring evidence closure requires an immutable run snapshot.' }
            Add-SemanticEvidence -Records $records -FullPath $RunSnapshotPath -Role 'scoring_run_snapshot'
            foreach ($audit in @($Run.content_audits)) {
                Add-SemanticEvidence -Records $records -FullPath ([string]$audit.raw_path) -Role 'raw'
                Add-SemanticEvidence -Records $records -FullPath ([string]$audit.path) -Role 'content_audit_receipt'
                $receiptFull = Get-FullPathInsideProject -Path ([string]$audit.path) -MustExist
                $receipt = Read-JsonFile -Path $receiptFull
                $auditBindings = @(
                    @{ property = 'manifest_path'; role = 'content_audit_manifest' },
                    @{ property = 'decision_path'; role = 'content_audit_decision' }
                )
                if (-not ((Test-ObjectProperty -Value $receipt -Name 'review_persistence') -and [string]$receipt.review_persistence -eq 'compiled_in_memory')) {
                    $auditBindings = @(
                        @{ property = 'manifest_path'; role = 'content_audit_manifest' },
                        @{ property = 'review_path'; role = 'content_audit_review' },
                        @{ property = 'decision_path'; role = 'content_audit_decision' }
                    )
                }
                foreach ($binding in $auditBindings) {
                    if (-not (Test-ObjectProperty -Value $receipt -Name $binding.property) -or [string]::IsNullOrWhiteSpace([string]$receipt.($binding.property))) {
                        throw "Scoring evidence closure is missing $($binding.property): $($audit.path)"
                    }
                    Add-SemanticEvidence -Records $records -FullPath ([string]$receipt.($binding.property)) -Role $binding.role
                }
            }
        }
    }
    if (@('stage1', 'stage2') -contains $Stage) {
        foreach ($artifact in @($Run.artifacts | Where-Object { [string]$_.kind -eq 'raw' -and [string]$_.disposition -eq 'ingested' })) {
            Add-SemanticEvidence -Records $records -FullPath ([string]$artifact.path) -Role 'raw'
        }
    }
    if ($Stage -eq 'stage1') {
        # Stage 1 reviewers must be able to independently traverse clipping -> manifest -> review/decision -> raw.
        # The receipt only binds these paths by hash; the request must include the files themselves.
        foreach ($item in @($Run.items)) { Add-SemanticEvidence -Records $records -FullPath $item -Role 'input_clipping' }
        foreach ($audit in @($Run.content_audits)) { Add-SemanticEvidence -Records $records -FullPath ([string]$audit.path) -Role 'content_audit_receipt' }
        foreach ($audit in @($Run.content_audits)) {
            $receiptFull = Get-FullPathInsideProject -Path ([string]$audit.path) -MustExist
            $receipt = Read-JsonFile -Path $receiptFull
            $auditBindings = @(
                @{ property = 'manifest_path'; role = 'content_audit_manifest' },
                @{ property = 'decision_path'; role = 'content_audit_decision' }
            )
            if (-not ((Test-ObjectProperty -Value $receipt -Name 'review_persistence') -and [string]$receipt.review_persistence -eq 'compiled_in_memory')) {
                $auditBindings = @(
                    @{ property = 'manifest_path'; role = 'content_audit_manifest' },
                    @{ property = 'review_path'; role = 'content_audit_review' },
                    @{ property = 'decision_path'; role = 'content_audit_decision' }
                )
            }
            foreach ($binding in $auditBindings) {
                if (-not (Test-ObjectProperty -Value $receipt -Name $binding.property) -or [string]::IsNullOrWhiteSpace([string]$receipt.($binding.property))) {
                    throw "Stage 1 content audit receipt is missing $($binding.property): $($audit.path)"
                }
                Add-SemanticEvidence -Records $records -FullPath ([string]$receipt.($binding.property)) -Role $binding.role
            }
        }
        Add-SemanticEvidence -Records $records -FullPath (Join-Path $script:projectRoot 'system/maintenance/checklists/ingest-semantic-review.md') -Role 'semantic_review_rubric'
        Add-SemanticEvidence -Records $records -FullPath (Join-Path $script:projectRoot 'system/maintenance/schemas/ingest-semantic-review-v1.schema.json') -Role 'semantic_review_schema'
        Add-SemanticEvidence -Records $records -FullPath (Join-Path $script:projectRoot 'raw-sources/README.md') -Role 'raw_writing_rules'
        if ([int]$Run.schema_version -ge 8) {
            foreach ($rule in @('raw-standard-v2.md','raw-writing-v2.md','raw-review-contract-notes.md')) {
                Add-SemanticEvidence -Records $records -FullPath (Join-Path $script:projectRoot ('system/maintenance/checklists/' + $rule)) -Role 'raw_v2_rules'
            }
        }
        foreach ($samplePath in @('system/maintenance/checklists/raw-writing-v2.md')) {
            Add-SemanticEvidence -Records $records -FullPath (Join-Path $script:projectRoot $samplePath) -Role 'style_boundary_sample'
        }
    }
    if ($Stage -eq 'stage2') {
        Add-SemanticEvidence -Records $records -FullPath (Join-Path $script:projectRoot 'system/registry/index.md') -Role 'wiki_index'
        Add-SemanticEvidence -Records $records -FullPath (Join-Path $script:projectRoot 'domains/README.md') -Role 'domain_navigation'
        Add-SemanticEvidence -Records $records -FullPath (Join-Path $script:projectRoot 'system/registry/KNOWLEDGE_STATUS.md') -Role 'capacity_snapshot'
        if ([string]::IsNullOrWhiteSpace($CandidatesPath)) { throw 'Stage 2 semantic review requires SemanticReviewCandidatesPath.' }
        $candidatesFull = Get-FullPathInsideProject -Path $CandidatesPath -MustExist
        Assert-RunLocalPath -RunManifestPath $RunManifestPath -CandidatePath $candidatesFull
        $candidateManifest = Read-JsonFile -Path $candidatesFull
        if (-not (Test-ObjectProperty -Value $candidateManifest -Name 'candidate_paths') -or @($candidateManifest.candidate_paths).Count -lt 1) {
            throw 'Stage 2 semantic candidates manifest requires a non-empty candidate_paths array.'
        }
        Add-SemanticEvidence -Records $records -FullPath $candidatesFull -Role 'wiki_candidates_manifest'
        foreach ($candidatePath in @($candidateManifest.candidate_paths)) {
            $candidateRelative = [string]$candidatePath
            if ($candidateRelative -notmatch '^(wiki|domains)/.+\.md$') { throw "Stage 2 candidate path is outside wiki/domain scope: $candidateRelative" }
            Add-SemanticEvidence -Records $records -FullPath $candidateRelative -Role 'wiki_candidate'
        }
    }
    if ($Stage -eq 'stage3') {
        Assert-GitRevision -Revision $Stage3Revision
        if ([string]::IsNullOrWhiteSpace([string]$Run.commits.stage1)) { throw 'Stage 3 semantic review requires a Stage 1 checkpoint.' }
        $runDirectory = Split-Path -Parent $RunManifestPath
        $diffPath = Join-Path $runDirectory 'semantic-reviews/stage3/actual.diff'
        Write-Utf8File -Path $diffPath -Text (Get-GitPatch -From ([string]$Run.commits.stage1) -To $Stage3Revision)
        Add-SemanticEvidence -Records $records -FullPath $diffPath -Role 'stage3_diff'
    }
    if ($records.Count -eq 0) { throw "Semantic review has no evidence: $Stage" }
    return @($records.ToArray())
}

function Move-SemanticReviewActiveToHistory {
    param([object]$Slot, [string]$Reason)
    if ($null -eq $Slot.active) { return }
    $entry = [pscustomobject][ordered]@{ record = $Slot.active; invalidated_at = [DateTime]::UtcNow.ToString('o'); invalidated_reason = $Reason }
    $Slot.history = @($Slot.history + $entry)
    $Slot.active = $null
}

function Assert-SemanticReviewReceipt {
    param([object]$Run, [string]$RunManifestPath, [string]$Stage, [object]$Receipt, [object]$Pending)
    foreach ($field in @('schema_version', 'kind', 'batch_id', 'stage', 'cycle', 'request_path', 'request_sha256', 'reviewer_context_id', 'reviewer_model', 'fresh_context', 'verdict', 'findings', 'independent_conclusion', 'comparison', 'reviewed_at')) {
        if (-not (Test-ObjectProperty -Value $Receipt -Name $field)) { throw "Semantic review receipt missing field: $field" }
    }
    if ([int]$Receipt.schema_version -ne 1 -or [string]$Receipt.kind -ne 'semantic_review_receipt') { throw 'Unsupported semantic review receipt schema.' }
    if ([string]$Receipt.batch_id -ne [string]$Run.batch_id -or [string]$Receipt.stage -ne $Stage -or [int]$Receipt.cycle -ne [int]$Pending.cycle) { throw 'Semantic review receipt identity mismatch.' }
    if ([string]$Receipt.request_path -ne [string]$Pending.path -or [string]$Receipt.request_sha256 -ne [string]$Pending.sha256) { throw 'Semantic review receipt request mismatch.' }
    if (-not [bool]$Receipt.fresh_context -or [string]::IsNullOrWhiteSpace([string]$Receipt.reviewer_context_id) -or [string]::IsNullOrWhiteSpace([string]$Receipt.reviewer_model)) { throw 'Semantic review receipt lacks fresh reviewer evidence.' }
    if ([string]$Receipt.reviewer_context_id -eq [string]$Run.producer_context_id) { throw 'Semantic reviewer context must differ from producer context.' }
    $priorRecords = @()
    foreach ($existing in @($Run.semantic_reviews.scoring, $Run.semantic_reviews.stage1, $Run.semantic_reviews.stage2, $Run.semantic_reviews.stage3)) {
        $priorRecords += @($existing.history | ForEach-Object { $_.record })
        if ($null -ne $existing.active) { $priorRecords += $existing.active }
    }
    foreach ($record in $priorRecords) {
        if ($null -ne $record -and [string]$record.reviewer_context_id -eq [string]$Receipt.reviewer_context_id) { throw 'Semantic reviewer context cannot be reused within one batch.' }
    }
    if (@('pass', 'revise', 'escalate') -notcontains [string]$Receipt.verdict) { throw 'Semantic review receipt has an invalid verdict.' }
    foreach ($finding in @($Receipt.findings)) {
        foreach ($field in @('severity', 'category', 'claim', 'evidence_paths', 'required_action')) {
            if (-not (Test-ObjectProperty -Value $finding -Name $field)) { throw "Semantic review finding missing field: $field" }
        }
        if (@('blocking', 'material', 'advisory') -notcontains [string]$finding.severity -or @($finding.evidence_paths).Count -lt 1) { throw 'Semantic review finding is invalid.' }
    }
    if ([string]$Receipt.verdict -eq 'pass' -and @($Receipt.findings | Where-Object { @('blocking', 'material') -contains [string]$_.severity }).Count -gt 0) { throw 'Semantic review pass cannot retain blocking or material findings.' }
}

function Get-SemanticReviewStatus {
    param([object]$Run, [string]$RunManifestPath, [string]$Stage)
    if (-not (Test-SemanticReviewRun -Run $Run)) { return 'not_applicable' }
    $slot = Get-SemanticReviewSlot -Run $Run -Stage $Stage
    if ($null -eq $slot.active) { return 'missing' }
    $record = $slot.active
    try {
        $receiptFull = Get-FullPathInsideProject -Path ([string]$record.receipt_path) -MustExist
        if ((Get-Sha256 -Path $receiptFull) -ne [string]$record.receipt_sha256) { return 'stale' }
        $requestFull = Get-FullPathInsideProject -Path ([string]$record.request_path) -MustExist
        if ((Get-Sha256 -Path $requestFull) -ne [string]$record.request_sha256) { return 'stale' }
        $request = Read-JsonFile -Path $requestFull
        foreach ($evidence in @($request.evidence)) {
            $full = Get-FullPathInsideProject -Path ([string]$evidence.path) -MustExist
            if ((Get-Sha256 -Path $full) -ne [string]$evidence.sha256) { return 'stale' }
        }
    } catch { return 'stale' }
    if ([string]$record.verdict -eq 'pass') { return 'valid_pass' }
    return [string]$record.verdict
}

function Assert-SemanticReviewPass {
    param([object]$Run, [string]$RunManifestPath, [string]$Stage)
    if (-not (Test-SemanticReviewGateEnabled -Run $Run)) { return }
    $status = Get-SemanticReviewStatus -Run $Run -RunManifestPath $RunManifestPath -Stage $Stage
    if ($status -ne 'valid_pass') { throw "Semantic review is not a valid pass for ${Stage}: $status" }
}

function Assert-GitRevision {
    param([string]$Revision)
    if ($Revision -notmatch '^[0-9a-fA-F]{40,64}$') { throw "Invalid full Git revision: $Revision" }
    & git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -C $script:projectRoot cat-file -e ($Revision + '^{commit}') 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Git revision does not exist: $Revision" }
}

function Get-ChangedPaths {
    param([string]$From, [string]$To)
    $paths = @(& git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -c core.quotepath=false -C $script:projectRoot diff --name-only $From $To -- $script:gitReviewExcludedPathspecs)
    if ($LASTEXITCODE -ne 0) { throw "Unable to read Git diff: $From..$To" }
    return @($paths | ForEach-Object { $_.Trim().Replace('\', '/') } | Where-Object { $_ -ne '' })
}

function Get-RawCountAtRevision {
    param([string]$Revision)
    Assert-GitRevision -Revision $Revision
    $paths = @(& git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -C $script:projectRoot ls-tree -r --name-only $Revision -- raw-sources/)
    if ($LASTEXITCODE -ne 0) { throw "Unable to count raw files at revision: $Revision" }
    return @($paths | ForEach-Object { $_.Trim('"') } | Where-Object { $_.EndsWith('.md') -and -not $_.EndsWith('/README.md') -and -not $_.EndsWith('.template.md') }).Count
}

function Get-CurrentRawCount {
    return @(Get-ChildItem -LiteralPath (Join-Path $script:projectRoot 'raw-sources') -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' }).Count
}

function Get-Stage1DiffBaseline {
    param([object]$Run, [string]$ManifestPath)
    if (-not (Test-ObjectProperty -Value $Run -Name 'raw_v2_migration')) { return [string]$Run.base_revision }
    $output = @(& node (Join-Path $PSScriptRoot 'migrate-raw-v2.mjs') checkpoint-base --root $script:projectRoot --run $ManifestPath) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $output.Trim() -notmatch '^[a-f0-9]{40}$') { throw "Invalid Raw v2 migration baseline: $output" }
    return $output.Trim()
}

function Assert-PackageMarkers {
    param([string]$Kind, [string]$Text)
    $markers = switch ($Kind) {
        'scoring' { @((Convert-UnicodeLiteral '## \u8bc4\u5206\u5305'), (Convert-UnicodeLiteral '\u8bc4\u5206\u7ed3\u8bba'), (Convert-UnicodeLiteral '\u8bc1\u636e\u7d22\u5f15'), (Convert-UnicodeLiteral '\u6a21\u578b\u5efa\u8bae\uff1a')) }
        'stage1' { @((Convert-UnicodeLiteral '## \u9636\u6bb5\u4e00\u5ba1\u6838\u5305'), (Convert-UnicodeLiteral 'raw \u6e05\u5355'), (Convert-UnicodeLiteral '\u9a8c\u8bc1\u6458\u8981'), (Convert-UnicodeLiteral '\u5185\u5bb9\u5ba1\u6838\u6536\u636e\u6458\u8981'), (Convert-UnicodeLiteral '\u538b\u7f29\u6bd4\u9010\u7bc7\u56de\u8bfb'), (Convert-UnicodeLiteral '\u5199\u4f5c\u9aa8\u67b6\u9010\u7bc7\u8bc1\u636e'), (Convert-UnicodeLiteral '\u98ce\u683c\u4e0e\u6765\u6e90\u8fb9\u754c\u62bd\u68c0'), (Convert-UnicodeLiteral '\u6279\u6ce8\u6458\u8981'), (Convert-UnicodeLiteral '\u6a21\u578b\u5efa\u8bae\uff1a')) }
        'stage2' { @((Convert-UnicodeLiteral '## \u9636\u6bb5\u4e8c\u5f52\u5c5e\u5305'), (Convert-UnicodeLiteral '\u5199\u5165\u89c4\u5212'), (Convert-UnicodeLiteral '\u6279\u6ce8\u6d88\u8d39\u7ed3\u8bba'), (Convert-UnicodeLiteral '\u672a\u6d88\u8d39\u98ce\u9669'), (Convert-UnicodeLiteral '\u6a21\u578b\u5efa\u8bae\uff1a')) }
        'stage3' { @((Convert-UnicodeLiteral '## \u9636\u6bb5\u4e09\u95ed\u5408\u5305'), (Convert-UnicodeLiteral '\u7ef4\u62a4\u540c\u6b65\u786e\u8ba4'), (Convert-UnicodeLiteral '\u9a8c\u8bc1\uff1a'), (Convert-UnicodeLiteral '\u6a21\u578b\u5efa\u8bae\uff1a\u65e0\u9700\u5207\u6362\u5efa\u8bae')) }
        'gate_audit' { @((Convert-UnicodeLiteral '\u81ea\u52a8\u95e8\u7981\u4e0e\u56de\u6eda\u5ba1\u8ba1'), (Convert-UnicodeLiteral '\u7194\u65ad\u68c0\u67e5'), (Convert-UnicodeLiteral '\u56de\u6eda\u70b9')) }
        'maintenance' { @() }
        default { throw "Unsupported package kind: $Kind" }
    }
    foreach ($marker in $markers) {
        if (-not $Text.Contains($marker)) { throw "$Kind package missing marker: $marker" }
    }
    if ($Kind -eq 'stage1') {
        $rawCount = ([regex]::Matches([string]$Text, '(?m)^-\s+\[[^\]]+\]\([^\)]+\)')).Count
        $rereadPattern = Convert-UnicodeLiteral '\u6b63\u6587\s+\d+\s+\u884c\s*\u2192\s*\u6b63\u6587\s+\d+\s+\u884c'
        $rereadCount = ([regex]::Matches([string]$Text, $rereadPattern)).Count
        if ($rawCount -lt 1) { throw 'stage1 package must list at least one raw artifact.' }
        if ($rereadCount -lt $rawCount) { throw "stage1 package compression reread evidence is incomplete: $rereadCount rows for $rawCount raw artifacts." }
        $auditHeading = Convert-UnicodeLiteral '### \u5185\u5bb9\u5ba1\u6838\u6536\u636e\u6458\u8981'
        $auditSection = [regex]::Match([string]$Text, '(?ms)^' + [regex]::Escape($auditHeading) + '\s*\r?\n(?<body>.*?)(?=^###\s|\z)')
        if (-not $auditSection.Success -or -not $auditSection.Groups['body'].Value.Contains('CONTENT_AUDIT_SUMMARY_V1')) {
            throw 'stage1 package is missing the controller-generated content-audit summary.'
        }
        $auditRows = @($auditSection.Groups['body'].Value -split '\r?\n' | Where-Object {
            $_.TrimStart().StartsWith('|') -and $_ -notmatch '^\s*\|\s*:?-{3,}' -and $_ -notmatch '^\s*\|\s*raw\s*\|'
        })
        if ($auditRows.Count -ne $rawCount) { throw "stage1 content-audit summary row count differs from the raw list: $($auditRows.Count) != $rawCount." }
        $skeletonHeading = Convert-UnicodeLiteral '### \u5199\u4f5c\u9aa8\u67b6\u9010\u7bc7\u8bc1\u636e'
        $skeletonSection = [regex]::Match([string]$Text, '(?ms)^' + [regex]::Escape($skeletonHeading) + '\s*\r?\n(?<body>.*?)(?=^###\s|\z)')
        if (-not $skeletonSection.Success -or -not $skeletonSection.Groups['body'].Value.Contains('WRITING_SKELETON_V1')) {
            throw 'stage1 package is missing per-raw writing-skeleton evidence.'
        }
        $skeletonRows = @($skeletonSection.Groups['body'].Value -split '\r?\n' | Where-Object {
            $_.TrimStart().StartsWith('|') -and $_ -notmatch '^\s*\|\s*:?-{3,}' -and $_ -notmatch '^\s*\|\s*raw\s*\|'
        })
        if ($skeletonRows.Count -ne $rawCount) { throw "stage1 writing-skeleton row count differs from the raw list: $($skeletonRows.Count) != $rawCount." }
        if (@($skeletonRows | Where-Object { $_ -match '(?i)TODO' }).Count -gt 0) { throw 'stage1 writing-skeleton evidence contains an unfinished row.' }
        $sampleHeading = Convert-UnicodeLiteral '### \u98ce\u683c\u4e0e\u6765\u6e90\u8fb9\u754c\u62bd\u68c0'
        $sampleSection = [regex]::Match([string]$Text, '(?ms)^' + [regex]::Escape($sampleHeading) + '\s*\r?\n(?<body>.*?)(?=^###\s|\z)')
        if (-not $sampleSection.Success) { throw ('stage1 package missing ' + (Convert-UnicodeLiteral '\u98ce\u683c\u4e0e\u6765\u6e90\u8fb9\u754c\u62bd\u68c0') + ' evidence.') }
        foreach ($sample in @(
            (Convert-UnicodeLiteral 'raw-sources/\u4ece0\u52301\u521b\u9020\u5f00\u653e\u4e16\u754c\u8bbe\u8ba1\u6d41\u7a0b-\u5929\u7f8e\u6c5f\u5cb8\u6816-20260705.md'),
            (Convert-UnicodeLiteral 'raw-sources/Game Master-\u5a01\u5c14\u83b1\u7279\u6e38\u620f\u5927\u5e08-indienova-\u843d\u65e5\u95f4-20061106.md'),
            (Convert-UnicodeLiteral 'raw-sources/\u6e38\u620f\u5206\u6790(\u56db\u4e94)-\u6697\u9ed1\u7cfb\u5217\u4e3a\u4ec0\u4e48\u597d\u73a9-\u6e38\u620f\u8bbe\u8ba1\u7406\u8bba-20230701.md')
        )) {
            if (-not $sampleSection.Groups['body'].Value.Contains($sample)) { throw "stage1 sample-read evidence is missing structure/style sample: $sample" }
        }
        if (-not $sampleSection.Groups['body'].Value.Contains('STYLE_BOUNDARY_SPOTCHECK_V1')) { throw 'stage1 style/source-boundary spot-check marker is missing.' }
        $sampleRows = @($sampleSection.Groups['body'].Value -split '\r?\n' | Where-Object {
            $_.TrimStart().StartsWith('|') -and $_ -notmatch '^\s*\|\s*:?-{3,}' -and $_ -notmatch '^\s*\|\s*raw\s*\|'
        })
        $minimumSampleRows = [Math]::Min(2, $rawCount)
        if ($sampleRows.Count -lt $minimumSampleRows) { throw "stage1 style/source-boundary spot-check is incomplete: $($sampleRows.Count) rows, expected at least $minimumSampleRows." }
        if (@($sampleRows | Where-Object { $_ -match '(?i)TODO' }).Count -gt 0) { throw 'stage1 style/source-boundary spot-check contains an unfinished row.' }
    }
}

function Assert-DeterministicPackage {
    param([string]$Kind, [string]$Text)
    $labels = @{
        scoring = 'Scoring Package'
        stage1 = 'Stage 1 Package'
        stage2 = 'Stage 2 Package'
        stage3 = 'Stage 3 Package'
        gate_audit = 'Gate Audit Package'
    }
    if (-not $labels.ContainsKey($Kind)) { throw "Unsupported deterministic package kind: $Kind" }
    if (-not $Text.Contains("## $($labels[$Kind]) - ")) { throw "Deterministic package has an invalid heading: $Kind" }
    if ($Text -notmatch ("<!-- ingest-package-renderer:v[12] package:" + [regex]::Escape($Kind) + " section:")) { throw "Deterministic package renderer marker is missing: $Kind" }
    foreach ($heading in @('### Runtime facts', '### Semantic judgment', '### Fixed judgment table', '### semantic_exceptions', '### unresolved_risks', '### structure_change_requests', '### micro_failures', '### Script-derived facts')) {
        if (-not $Text.Contains($heading)) { throw "Deterministic package missing fixed section ${heading}: $Kind" }
    }
}

function Assert-RecordedPackage {
    param([object]$Run, [string]$Kind)
    if ([int]$Run.schema_version -ge 7 -and $Kind -ne 'maintenance') {
        [void](Invoke-ContentReview -Operation verify-section -Manifest $RunPath -Stage $Kind -AfterWriting:($Run.status -in @('stage2_approved','stage2_planned','stage3_completed','awaiting_final_review','completed')))
    }
    $record = $Run.packages.$Kind
    if ($null -eq $record) { throw "Package has not been recorded: $Kind" }
    $full = Get-FullPathInsideProject -Path ([string]$record.path) -MustExist
    $actualHash = Get-Sha256 -Path $full
    if ($actualHash -ne [string]$record.sha256) { throw "Package hash drifted: $Kind" }
    if ($Kind -eq 'maintenance') {
        $receipt = Read-JsonFile -Path $full
        if ($receipt.status -ne 'passed') { throw 'Maintenance receipt is not passed.' }
        foreach ($check in @($receipt.checks)) {
            if (-not [bool]$check.passed) { throw "Maintenance check failed: $($check.id)" }
        }
    } else {
        $packageText = Get-Content -Raw -Encoding UTF8 -LiteralPath $full
        if ([int]$Run.schema_version -ge 6) {
            Assert-DeterministicPackage -Kind $Kind -Text $packageText
        } else {
            Assert-PackageMarkers -Kind $Kind -Text $packageText
        }
    }
    return $full
}

function Get-DepthRemediationResult {
    param([object]$Run, [string]$RunManifestPath, [string]$Path)
    $full = Get-FullPathInsideProject -Path $Path -MustExist
    if ([int]$Run.schema_version -ge 2) { Assert-RunLocalPath -RunManifestPath $RunManifestPath -CandidatePath $full }
    $rawPaths = @($Run.artifacts | Where-Object { [string]$_.kind -eq 'raw' -and [string]$_.disposition -eq 'ingested' } | ForEach-Object { [string]$_.path })
    if ($rawPaths.Count -eq 0) { throw 'Depth remediation requires at least one ingested raw artifact.' }
    $checker = Join-Path $PSScriptRoot 'check-depth-remediation.ps1'
    if (-not (Test-Path -LiteralPath $checker -PathType Leaf)) { throw 'Depth-remediation checker is missing.' }
    $output = @(& $script:hostExecutable -NoProfile -ExecutionPolicy Bypass -File $checker -Path $full -RawPath ($rawPaths -join ',') -AsJson) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Depth-remediation checker failed: $output" }
    $result = $output | ConvertFrom-Json
    if ($result.status -ne 'passed') { throw 'Depth-remediation checker did not pass.' }
    return [pscustomobject][ordered]@{ path = Get-RelativeProjectPath -FullPath $full; sha256 = Get-Sha256 -Path $full; requires_rewrite = [bool]$result.requires_rewrite; raw_count = [int]$result.raw_count }
}

function Get-RequiredAnchors {
    param([int]$Before, [int]$After)
    if ($Before -lt 0 -or $After -lt $Before) { throw "Invalid before/after count: $Before -> $After" }
    $anchors = New-Object System.Collections.Generic.List[int]
    $next = ([Math]::Floor($Before / $script:backtestAnchorInterval) + 1) * $script:backtestAnchorInterval
    while ($next -le $After) { [void]$anchors.Add([int]$next); $next += $script:backtestAnchorInterval }
    return @($anchors)
}

function Assert-ContentBacktest {
    param([object]$Backtest, [int]$Anchor, [int]$RunSchemaVersion = 7)
    if (-not (Test-ObjectProperty -Value $Backtest -Name 'content_review')) { throw "Backtest $Anchor missing field: content_review" }
    $record = $Backtest.content_review
    foreach ($field in @('path', 'sha256', 'status')) {
        if (-not (Test-ObjectProperty -Value $record -Name $field)) { throw "Backtest $Anchor content_review missing field: $field" }
    }
    if ([string]$record.status -ne 'passed') { throw "Backtest $Anchor content review is not passed." }
    $full = Get-FullPathInsideProject -Path ([string]$record.path) -MustExist
    if ((Get-Sha256 -Path $full) -ne [string]$record.sha256) { throw "Backtest $Anchor content review hash drifted." }
    $receipt = Read-JsonFile -Path $full
    foreach ($field in @('schema_version', 'status', 'run_id', 'report_path', 'report_sha256', 'sample_count', 'anomaly_count')) {
        if (-not (Test-ObjectProperty -Value $receipt -Name $field)) { throw "Backtest $Anchor content receipt missing field: $field" }
    }
    if ([string]$receipt.status -ne 'passed' -or [int]$receipt.sample_count -lt 1) { throw "Backtest $Anchor content receipt is incomplete." }
    if ([int]$receipt.schema_version -lt 2) { throw "Backtest $Anchor content receipt predates full-source audit schema." }
    if ($RunSchemaVersion -ge 8 -and (-not (Test-ObjectProperty -Value $receipt -Name 'raw_standard') -or $receipt.raw_standard -ne 'RAW_STANDARD_V2')) { throw 'Schema 8 backtests require RAW_STANDARD_V2.' }
    foreach ($field in @('source_content_audit_count', 'source_content_audits')) {
        if (-not (Test-ObjectProperty -Value $receipt -Name $field)) { throw "Backtest $Anchor content receipt missing field: $field" }
    }
    if ([int]$receipt.source_content_audit_count -ne [int]$receipt.sample_count -or @($receipt.source_content_audits).Count -ne [int]$receipt.sample_count) {
        throw "Backtest $Anchor full-source audit coverage is incomplete."
    }
    foreach ($auditRecord in @($receipt.source_content_audits)) {
        $auditFull = Get-FullPathInsideProject -Path ([string]$auditRecord.path) -MustExist
        if ((Get-Sha256 -Path $auditFull) -ne [string]$auditRecord.sha256) { throw "Backtest $Anchor source-content audit receipt hash drifted." }
        $audit = Read-JsonFile -Path $auditFull
        if ($RunSchemaVersion -ge 8) {
            if ([int]$audit.schema_version -ne 6 -or $audit.standard -ne 'RAW_STANDARD_V2' -or $audit.evidence_class -notin @('host_observed','reviewer_attested')) { throw 'Legacy or fixture backtest cannot satisfy schema 8.' }
            $auditVerifier = 'backtest-quality.mjs'
            $verifiedAudit = @(& node (Join-Path $script:projectRoot "system/maintenance/checklists/$auditVerifier") verify --root $script:projectRoot --receipt $auditFull) -join "`n"
            if ($LASTEXITCODE -ne 0) { throw "Backtest unified core verification failed: $verifiedAudit" }
        }
        if ([int]$audit.schema_version -lt 4 -or
            -not (Test-ObjectProperty -Value $audit -Name 'coverage_counts') -or
            -not (Test-ObjectProperty -Value $audit -Name 'retention_policy_counts') -or
            [string]$audit.status -ne 'passed' -or
            [string]$audit.mode -ne 'backtest' -or
            [int]$audit.failed_unit_count -ne 0) {
            throw "Backtest $Anchor source-content audit is not passed."
        }
        if ([string]$audit.raw_path -ne [string]$auditRecord.raw_path -or [int]$audit.unit_count -ne [int]$auditRecord.unit_count) {
            throw "Backtest $Anchor source-content audit identity mismatch."
        }
        $rawFull = Get-FullPathInsideProject -Path ([string]$audit.raw_path) -MustExist
        if ((Get-Sha256 -Path $rawFull) -ne [string]$audit.raw_sha256) { throw "Backtest $Anchor source-content audit raw hash drifted." }
        foreach ($source in @($audit.sources)) {
            $sourceFull = Get-FullPathInsideProject -Path ([string]$source.source_path) -MustExist
            if ((Get-Sha256 -Path $sourceFull) -ne [string]$source.source_sha256) { throw "Backtest $Anchor source-content audit source hash drifted." }
        }
        foreach ($pair in @(
            @([string]$audit.manifest_path, [string]$audit.manifest_sha256, 'manifest'),
            @($(if ($audit.PSObject.Properties.Name -contains 'decision_path') { [string]$audit.decision_path } else { [string]$audit.review_path }), $(if ($audit.PSObject.Properties.Name -contains 'decision_sha256') { [string]$audit.decision_sha256 } else { [string]$audit.review_sha256 }), 'review')
        )) {
            $evidenceFull = Get-FullPathInsideProject -Path $pair[0] -MustExist
            if ((Get-Sha256 -Path $evidenceFull) -ne $pair[1]) { throw "Backtest $Anchor source-content audit $($pair[2]) hash drifted." }
        }
        if ((Test-ObjectProperty -Value $audit -Name 'decision_path') -and -not [string]::IsNullOrWhiteSpace([string]$audit.decision_path)) {
            $decisionFull = Get-FullPathInsideProject -Path ([string]$audit.decision_path) -MustExist
            if ((Get-Sha256 -Path $decisionFull) -ne [string]$audit.decision_sha256) { throw "Backtest $Anchor source-content audit decision hash drifted." }
        }
    }
    $reportFull = Get-FullPathInsideProject -Path ([string]$receipt.report_path) -MustExist
    if ((Get-Sha256 -Path $reportFull) -ne [string]$receipt.report_sha256) { throw "Backtest $Anchor content report hash drifted." }
    return $receipt
}

function Assert-Backtests {
    param([object]$Run, [int[]]$Required)
    # Stateless historical receipt-set inspection has no run schema; active runs always do.
    $hasRunSchema = Test-ObjectProperty -Value $Run -Name 'schema_version'
    $backtestRunSchema = if ($hasRunSchema) { [int]$Run.schema_version } else { 7 }
    $validationRunSchema = $backtestRunSchema
    $defaultSampleCount = if ($hasRunSchema -and $backtestRunSchema -lt 8) { 5 } else { $script:backtestSampleSize }
    foreach ($anchorValue in $Required) {
        $matches = @($Run.backtests | Where-Object { [int]$_.anchor -eq $anchorValue })
        if ($matches.Count -ne 1) { throw "Required backtest receipt missing or duplicated: $anchorValue" }
        $record = $matches[0]
        $full = Get-FullPathInsideProject -Path ([string]$record.path) -MustExist
        if ((Get-Sha256 -Path $full) -ne [string]$record.sha256) { throw "Backtest receipt hash drifted: $anchorValue" }
        $receipt = Read-JsonFile -Path $full
        if ([int]$receipt.anchor -ne $anchorValue) { throw "Backtest receipt anchor mismatch: $anchorValue" }
        $expectedSampleCount = if ($hasRunSchema) {
            $defaultSampleCount
        } elseif ((Test-ObjectProperty -Value $receipt -Name 'raw_standard') -and [string]$receipt.raw_standard -eq 'RAW_STANDARD_V2') {
            $script:backtestSampleSize
        } else {
            5
        }
        $schemaVersion = if (Test-ObjectProperty -Value $receipt -Name 'schema_version') { [int]$receipt.schema_version } else { 1 }
        if ($schemaVersion -ge 4) {
            foreach ($field in @('schema_version', 'anchor', 'samples', 'content_review')) {
                if (-not (Test-ObjectProperty -Value $receipt -Name $field)) { throw "Backtest $anchorValue missing field: $field" }
            }
            $samples = @($receipt.samples)
            if ($samples.Count -ne $expectedSampleCount) { throw "Backtest $anchorValue must contain exactly $expectedSampleCount unified content/scoring samples." }
            $samplePaths = @($samples | ForEach-Object { [string]$_.source })
            if (@($samplePaths | Select-Object -Unique).Count -ne $expectedSampleCount) { throw "Backtest $anchorValue contains duplicate scoring samples." }
            foreach ($sample in $samples) {
                foreach ($field in @('source', 'old_a', 'a1', 'a2', 'a3', 'new_a', 'deviation', 'disposition', 'evidence')) {
                    if (-not (Test-ObjectProperty -Value $sample -Name $field)) { throw "Backtest $anchorValue sample missing field: $field" }
                }
            }
            $contentReceipt = Assert-ContentBacktest -Backtest $receipt -Anchor $anchorValue -RunSchemaVersion $validationRunSchema
            if ([int]$contentReceipt.schema_version -lt 4 -or
                [int]$contentReceipt.sample_count -ne $expectedSampleCount -or
                -not (Test-ObjectProperty -Value $contentReceipt -Name 'scoring_result_count') -or
                -not (Test-ObjectProperty -Value $contentReceipt -Name 'scoring_results') -or
                [int]$contentReceipt.scoring_result_count -ne $expectedSampleCount -or
                @($contentReceipt.scoring_results).Count -ne $expectedSampleCount) {
                throw "Backtest $anchorValue content receipt does not contain exactly $expectedSampleCount unified content/scoring results."
            }
            foreach ($sample in $samples) {
                $matches = @($contentReceipt.scoring_results | Where-Object {
                    [string]$_.raw_path -eq [string]$sample.source -and
                    [Math]::Abs([double]$_.old_a - [double]$sample.old_a) -lt 0.001 -and
                    [Math]::Abs([double]$_.new_a - [double]$sample.new_a) -lt 0.001 -and
                    [Math]::Abs([double]$_.deviation - [double]$sample.deviation) -lt 0.001
                })
                if ($matches.Count -ne 1) { throw "Backtest $anchorValue scoring/content identity mismatch: $($sample.source)" }
            }
        } else {
            foreach ($field in @('anchor', 'source', 'old_a', 'new_a', 'deviation', 'disposition')) {
                if (-not (Test-ObjectProperty -Value $receipt -Name $field)) { throw "Backtest $anchorValue missing field: $field" }
            }
            [void](Assert-ContentBacktest -Backtest $receipt -Anchor $anchorValue -RunSchemaVersion $backtestRunSchema)
        }
    }
}

function Update-ReviewIndex {
    param([string]$RunManifestPath, [object]$Run)
    if (-not (Test-ObjectProperty -Value $Run -Name 'artifacts')) { return }
    $index = if (Test-Path -LiteralPath $script:indexPath -PathType Leaf) {
        Read-JsonFile -Path $script:indexPath
    } else {
        [pscustomobject][ordered]@{ schema_version = 1; updated_at = $null; runs = @(); entries = @() }
    }
    if ([int]$index.schema_version -ne 1) { throw 'Unsupported review index schema_version.' }
    if (-not (Test-ObjectProperty -Value $index -Name 'runs')) { $index | Add-Member -NotePropertyName runs -NotePropertyValue @() }
    $packages = New-Object System.Collections.Generic.List[object]
    foreach ($kind in @('scoring', 'stage1', 'stage2', 'stage3', 'gate_audit', 'maintenance')) {
        $record = $Run.packages.$kind
        if ($null -ne $record) {
            [void]$packages.Add([pscustomobject][ordered]@{ kind = $kind; path = [string]$record.path; sha256 = [string]$record.sha256 })
        }
    }
    $reviewPath = if ($null -ne $Run.final_review.path) { [string]$Run.final_review.path } else { $null }
    $reviewHash = if ($null -ne $Run.final_review.approved_sha256) { [string]$Run.final_review.approved_sha256 } else { $null }
    $semanticReviews = @()
    if (Test-SemanticReviewRun -Run $Run) {
        foreach ($stage in @('scoring', 'stage1', 'stage2', 'stage3')) {
            $record = $Run.semantic_reviews.$stage.active
            if ($null -ne $record) {
                $semanticReviews += [pscustomobject][ordered]@{
                    stage = $stage
                    verdict = [string]$record.verdict
                    cycle = [int]$record.cycle
                    receipt_path = [string]$record.receipt_path
                    receipt_sha256 = [string]$record.receipt_sha256
                }
            }
        }
    }
    $relatedPaths = @($Run.artifacts | ForEach-Object { [string]$_.path })
    $remainingRuns = @($index.runs | Where-Object { [string]$_.batch_id -ne [string]$Run.batch_id })
    $runRecord = [pscustomobject][ordered]@{
        batch_id = [string]$Run.batch_id
        review_policy = Get-ReviewPolicy -Run $Run
        run_path = Get-RelativeProjectPath -FullPath $RunManifestPath
        packages = @($packages.ToArray())
        final_review = $reviewPath
        approved_sha256 = $reviewHash
        stage1_revision = $Run.commits.stage1
        stage3_revision = $Run.commits.stage3
        semantic_reviews = @($semanticReviews)
        completed_at = [string]$Run.updated_at
    }
    # Preserve historical sequence; sorting the full index rewrites thousands of
    # unrelated rows on every batch close.
    $index.runs = @($remainingRuns + $runRecord)
    $remaining = @($index.entries | Where-Object { [string]$_.batch_id -ne [string]$Run.batch_id })
    $newEntries = New-Object System.Collections.Generic.List[object]
    foreach ($artifact in @($Run.artifacts)) {
        [void]$newEntries.Add([pscustomobject][ordered]@{
            path = [string]$artifact.path
            kind = [string]$artifact.kind
            disposition = [string]$artifact.disposition
            batch_id = [string]$Run.batch_id
            related_paths = @($relatedPaths | Where-Object { $_ -ne [string]$artifact.path })
        })
    }
    $index.entries = @($remaining + $newEntries.ToArray())
    $index.updated_at = [DateTime]::UtcNow.ToString('o')
    Write-JsonFile -Path $script:indexPath -Value $index
}

function Complete-InteractiveRun {
    param([string]$RunManifestPath, [object]$Run, [string]$Hash)
    if (-not (Test-ObjectProperty -Value $Run -Name 'approvals')) { throw 'Interactive run is missing approval records.' }
    Assert-ArtifactCoverage -Run $Run
    $Run.approvals.stage3 = [pscustomobject][ordered]@{ sha256 = $Hash; approved_at = [DateTime]::UtcNow.ToString('o') }
    $Run.status = 'completed'
    Save-Run -Path $RunManifestPath -Run $Run
    Update-ReviewIndex -RunManifestPath $RunManifestPath -Run $Run
}

function Assert-ArtifactCoverage {
    param([object]$Run)
    if ([int]$Run.schema_version -lt 2) { return }
    $inputArtifacts = @($Run.artifacts | Where-Object { [string]$_.kind -eq 'input' })
    foreach ($item in @($Run.items)) {
        $matches = @($inputArtifacts | Where-Object {
            (Test-ObjectProperty -Value $_ -Name 'input_item') -and [string]$_.input_item -eq [string]$item
        })
        if ($matches.Count -ne 1) {
            throw "Artifact coverage is incomplete: expected one input artifact for '$item', found $($matches.Count)."
        }
    }
    $ingestedInputs = @($inputArtifacts | Where-Object { [string]$_.disposition -eq 'ingested' })
    $rawArtifacts = @($Run.artifacts | Where-Object {
        [string]$_.kind -eq 'raw' -and [string]$_.disposition -eq 'ingested'
    })
    if ($ingestedInputs.Count -gt 0 -and $rawArtifacts.Count -eq 0) {
        throw 'Artifact coverage is incomplete: ingested input requires at least one raw artifact.'
    }
}

function Get-ContentAuditRecord {
    param([object]$Run, [string]$RunManifestPath, [string]$Path)
    $full = Get-FullPathInsideProject -Path $Path -MustExist
    Assert-RunLocalPath -RunManifestPath $RunManifestPath -CandidatePath $full
    $receipt = Read-JsonFile -Path $full
    if ([int]$Run.schema_version -ge 8) {
        $isCoreClaimReceipt = (Test-ObjectProperty -Value $receipt -Name 'audit_scope') -and [string]$receipt.audit_scope -eq 'core_claim_bidirectional'
        if ($isCoreClaimReceipt) {
            if ([int]$receipt.schema_version -ne 7 -or $receipt.standard -ne 'RAW_STANDARD_V2') { throw 'Core-claim audit receipt has an unsupported schema.' }
            $verifiedText = @(& node $script:coreReviewControllerPath verify --root $script:projectRoot --receipt $Path) -join "`n"
            if ($LASTEXITCODE -ne 0) { throw "Core-claim independent audit did not pass: $verifiedText" }
            $coreRequest = Read-JsonFile -Path (Get-FullPathInsideProject -Path ([string]$receipt.request_path) -MustExist)
            if ((Test-ObjectProperty $Run.execution_control 'reviewer_route_version') -and $Run.execution_control.reviewer_route_version -eq 3) {
                $author = $Run.execution_control.artifact_authors.PSObject.Properties[[string]$receipt.raw_path]
                if ($null -eq $author -or [string]$coreRequest.producer_context_id -ne [string]$author.Value.agent_id) { throw 'Core review producer does not match the actual Raw writer.' }
            } elseif ([string]$coreRequest.producer_context_id -ne [string]$Run.producer_context_id) { throw 'Core review producer does not match the run producer.' }
        } else {
        if ([int]$receipt.schema_version -ne 6 -or $receipt.standard -ne 'RAW_STANDARD_V2') { throw 'New runs cannot use legacy Raw audit receipts.' }
        if (-not (Test-ObjectProperty -Value $Run -Name 'producer_context_id') -or [string]::IsNullOrWhiteSpace([string]$Run.producer_context_id)) { throw 'Schema 8 ingested Raw requires start -ProducerContextId.' }
        $rawRequest = Read-JsonFile -Path (Get-FullPathInsideProject -Path ([string]$receipt.request_path) -MustExist)
        if ([string]$rawRequest.producer_context_id -ne [string]$Run.producer_context_id) { throw 'Raw review producer does not match the run producer.' }
        $verifiedText = @(& node (Join-Path $script:projectRoot 'system/maintenance/checklists/raw-quality.mjs') verify --root $script:projectRoot --receipt $Path) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "Raw v2 independent audit did not pass: $verifiedText" }
        if ($receipt.evidence_class -ne 'host_observed') { throw 'Contract fixtures are not real independent review evidence.' }
        foreach ($key in @('request_path','host_path')) {
            $boundFull = Get-FullPathInsideProject -Path ([string]$receipt.$key) -MustExist
            Assert-RunLocalPath -RunManifestPath $RunManifestPath -CandidatePath $boundFull
        }
        }
    }
    $compactReceipt = (Test-ObjectProperty -Value $receipt -Name 'review_persistence') -and [string]$receipt.review_persistence -eq 'compiled_in_memory'
    $requiredFields = @('schema_version', 'status', 'mode', 'raw_path', 'raw_sha256', 'sources', 'manifest_path', 'manifest_sha256', 'unit_count', 'coverage_counts', 'retention_policy_counts', 'failed_unit_count')
    if (-not $compactReceipt) { $requiredFields += @('review_path', 'review_sha256') }
    if ($compactReceipt) { $requiredFields += @('decision_path', 'decision_sha256') }
    foreach ($field in $requiredFields) {
        if (-not (Test-ObjectProperty -Value $receipt -Name $field)) { throw "Content-audit receipt missing field: $field" }
    }
    if ([int]$receipt.schema_version -lt 4) { throw 'Stage 1 content-audit receipt predates media-marker audit schema.' }
    if ($compactReceipt -and [int]$receipt.schema_version -lt 5) { throw 'Compact content-audit receipt must use schema_version 5.' }
    if ([string]$receipt.status -ne 'passed' -or [string]$receipt.mode -ne 'stage1') { throw 'Stage 1 content-audit receipt must be passed in stage1 mode.' }
    if ([int]$receipt.unit_count -lt 1 -or [int]$receipt.failed_unit_count -ne 0) { throw 'Stage 1 content-audit receipt contains unresolved source units.' }
    $rawRelative = [string]$receipt.raw_path
    $rawMatches = @($Run.artifacts | Where-Object {
        [string]$_.kind -eq 'raw' -and [string]$_.disposition -eq 'ingested' -and [string]$_.path -eq $rawRelative
    })
    if ($rawMatches.Count -ne 1) { throw "Content-audit receipt does not match one ingested raw artifact: $rawRelative" }
    $rawFull = Get-FullPathInsideProject -Path $rawRelative -MustExist
    if ((Get-Sha256 -Path $rawFull) -ne [string]$receipt.raw_sha256) { throw "Content-audit raw hash drifted: $rawRelative" }
    foreach ($source in @($receipt.sources)) {
        $sourceRelative = [string]$source.source_path
        $inputMatches = @($Run.artifacts | Where-Object {
            [string]$_.kind -eq 'input' -and [string]$_.disposition -eq 'ingested' -and [string]$_.path -eq $sourceRelative
        })
        if ($inputMatches.Count -ne 1) { throw "Content-audit source is not one ingested input artifact: $sourceRelative" }
        $sourceFull = Get-FullPathInsideProject -Path $sourceRelative -MustExist
        if ((Get-Sha256 -Path $sourceFull) -ne [string]$source.source_sha256) { throw "Content-audit source hash drifted: $sourceRelative" }
    }
    $evidencePairs = @(
        [pscustomobject][ordered]@{ path = [string]$receipt.manifest_path; sha256 = [string]$receipt.manifest_sha256; label = 'manifest' }
    )
    if (-not $compactReceipt) {
        $evidencePairs += [pscustomobject][ordered]@{ path = [string]$receipt.review_path; sha256 = [string]$receipt.review_sha256; label = 'review' }
    }
    foreach ($pair in $evidencePairs) {
        $evidenceFull = Get-FullPathInsideProject -Path $pair.path -MustExist
        Assert-RunLocalPath -RunManifestPath $RunManifestPath -CandidatePath $evidenceFull
        if ((Get-Sha256 -Path $evidenceFull) -ne $pair.sha256) { throw "Content-audit $($pair.label) hash drifted." }
    }
    if ((Test-ObjectProperty -Value $receipt -Name 'decision_path') -and -not [string]::IsNullOrWhiteSpace([string]$receipt.decision_path)) {
        $decisionFull = Get-FullPathInsideProject -Path ([string]$receipt.decision_path) -MustExist
        Assert-RunLocalPath -RunManifestPath $RunManifestPath -CandidatePath $decisionFull
        if ((Get-Sha256 -Path $decisionFull) -ne [string]$receipt.decision_sha256) { throw 'Content-audit decision hash drifted.' }
    }
    return [pscustomobject][ordered]@{
        raw_path = $rawRelative
        path = Get-RelativeProjectPath -FullPath $full
        sha256 = Get-Sha256 -Path $full
    }
}

function Assert-ContentAuditCoverage {
    param([object]$Run, [string]$RunManifestPath)
    if ([int]$Run.schema_version -lt 3) { return }
    $rawArtifacts = @($Run.artifacts | Where-Object { [string]$_.kind -eq 'raw' -and [string]$_.disposition -eq 'ingested' })
    foreach ($raw in $rawArtifacts) {
        $matches = @($Run.content_audits | Where-Object { [string]$_.raw_path -eq [string]$raw.path })
        if ($matches.Count -ne 1) { throw "Content-audit coverage is incomplete for raw: $($raw.path)" }
        $record = Get-ContentAuditRecord -Run $Run -RunManifestPath $RunManifestPath -Path ([string]$matches[0].path)
        if ([string]$record.sha256 -ne [string]$matches[0].sha256) { throw "Content-audit receipt hash drifted for raw: $($raw.path)" }
    }
    foreach ($audit in @($Run.content_audits)) {
        if (@($rawArtifacts | Where-Object { [string]$_.path -eq [string]$audit.raw_path }).Count -ne 1) {
            throw "Content audit has no matching ingested raw artifact: $($audit.raw_path)"
        }
    }
}

function Assert-Stage1WritingSkeleton {
    param([object]$Run, [string]$Text)
    $heading = Convert-UnicodeLiteral '### \u5199\u4f5c\u9aa8\u67b6\u9010\u7bc7\u8bc1\u636e'
    $section = [regex]::Match([string]$Text, '(?ms)^' + [regex]::Escape($heading) + '\s*\r?\n(?<body>.*?)(?=^###\s|\z)')
    if (-not $section.Success) { throw 'Stage 1 writing-skeleton section is missing.' }
    $rows = @($section.Groups['body'].Value -split '\r?\n' | Where-Object {
        $_.TrimStart().StartsWith('|') -and $_ -notmatch '^\s*\|\s*:?-{3,}' -and $_ -notmatch '^\s*\|\s*raw\s*\|'
    })
    $rawArtifacts = @($Run.artifacts | Where-Object { [string]$_.kind -eq 'raw' -and [string]$_.disposition -eq 'ingested' })
    foreach ($raw in $rawArtifacts) {
        $path = [string]$raw.path
        if (@($rows | Where-Object { $_.Contains($path) }).Count -ne 1) {
            throw "Stage 1 writing-skeleton evidence does not identify exactly one row for raw: $path"
        }
    }
}

function Assert-DeterministicStage1Package {
    param([object]$Run, [string]$RunManifestPath, [string]$PackagePath)
    if ([int]$Run.schema_version -lt 6) { throw 'Deterministic Stage 1 validation requires schema_version 6.' }
    $dataFull = Get-PackageDataPathForRun -Run $Run -RunManifestPath $RunManifestPath
    $data = Read-JsonFile -Path $dataFull
    $rows = @($data.sections.stage1.semantic.rows)
    $rawArtifacts = @($Run.artifacts | Where-Object { [string]$_.kind -eq 'raw' -and [string]$_.disposition -eq 'ingested' })
    if ($rows.Count -ne $rawArtifacts.Count) { throw "Deterministic Stage 1 row count differs from ingested raw count: $($rows.Count) != $($rawArtifacts.Count)." }
    foreach ($raw in $rawArtifacts) {
        $matches = @($rows | Where-Object { [string]$_.raw -eq [string]$raw.path })
        if ($matches.Count -ne 1) { throw "Deterministic Stage 1 must identify exactly one row for raw: $($raw.path)" }
        $row = $matches[0]
        foreach ($field in @('writing_skeleton', 'coverage', 'boundary', 'disposition')) {
            if (-not (Test-ObjectProperty -Value $row -Name $field) -or [string]::IsNullOrWhiteSpace([string]$row.$field) -or [string]$row.$field -eq '-') {
                throw "Deterministic Stage 1 row is missing ${field}: $($raw.path)"
            }
        }
    }
}

function Get-Stage1AuditSummary {
    param([object]$Run, [string]$RunManifestPath)
    $null = Assert-ContentAuditCoverage -Run $Run -RunManifestPath $RunManifestPath
    $rawArtifacts = @($Run.artifacts | Where-Object { [string]$_.kind -eq 'raw' -and [string]$_.disposition -eq 'ingested' })
    if ($rawArtifacts.Count -lt 1) { throw 'Stage 1 audit summary requires at least one ingested raw artifact.' }
    $lines = New-Object System.Collections.Generic.List[string]
    [void]$lines.Add((Convert-UnicodeLiteral '### \u5185\u5bb9\u5ba1\u6838\u6536\u636e\u6458\u8981'))
    [void]$lines.Add((Convert-UnicodeLiteral '| raw | receipt | \u5355\u5143\u6570 | \u5b8c\u6574 | \u90e8\u5206/\u7f3a\u5931 | \u56fe\u7247\u7559\u6807 | \u5931\u8d25/\u5f02\u5e38 | \u7ed3\u8bba |'))
    [void]$lines.Add('|---|---|---:|---:|---:|---:|---:|---|')
    foreach ($raw in $rawArtifacts) {
        $matches = @($Run.content_audits | Where-Object { [string]$_.raw_path -eq [string]$raw.path })
        $receiptFull = Get-FullPathInsideProject -Path ([string]$matches[0].path) -MustExist
        $receipt = Read-JsonFile -Path $receiptFull
        $partialMissing = ([string][int]$receipt.coverage_counts.partial) + ' / ' + ([string][int]$receipt.coverage_counts.missing)
        $failedAnomaly = ([string][int]$receipt.failed_unit_count) + ' / ' + ([string][int]$receipt.anomaly_count)
        $conclusion = Convert-UnicodeLiteral '\u901a\u8fc7'
        [void]$lines.Add("| $([string]$raw.path) | $([string]$matches[0].path) | $([int]$receipt.unit_count) | $([int]$receipt.coverage_counts.complete) | $partialMissing | $([int]$receipt.coverage_counts.marker_only) | $failedAnomaly | $conclusion |")
    }
    [void]$lines.Add('CONTENT_AUDIT_SUMMARY_V1')
    return ($lines -join "`n")
}

function Assert-Stage1AuditSummary {
    param([object]$Run, [string]$RunManifestPath, [string]$Text)
    $heading = Convert-UnicodeLiteral '### \u5185\u5bb9\u5ba1\u6838\u6536\u636e\u6458\u8981'
    $section = [regex]::Match($Text, '(?ms)^' + [regex]::Escape($heading) + '\s*\r?\n(?<body>.*?)(?=^###\s|\z)')
    if (-not $section.Success) { throw 'Stage 1 package has no content-audit summary section.' }
    $actual = (($heading + "`n" + $section.Groups['body'].Value.Trim()).Trim() -replace "`r`n?", "`n")
    $expected = ((Get-Stage1AuditSummary -Run $Run -RunManifestPath $RunManifestPath).Trim() -replace "`r`n?", "`n")
    if ($actual -cne $expected) { throw 'Stage 1 content-audit summary differs from controller-generated receipts.' }
}

try {
    if ($Action -eq 'advance') {
        $advanceArgs = @('--root',$script:projectRoot,'--run',$RunPath,'--shell',$script:hostExecutable)
        if ($ApprovedHash) { $advanceArgs += @('--approved',$ApprovedHash) }
        if ($HostSessionRoot) { $advanceArgs += @('--sessions',$HostSessionRoot) }
        if ($Reason) { $advanceArgs += @('--retry',$Reason) }
        & node (Join-Path $PSScriptRoot 'ingest-advance.mjs') @advanceArgs
        exit $LASTEXITCODE
    }
    if ($Action -eq 'find-review') {
        $artifactFull = Get-FullPathInsideProject -Path $ArtifactPath
        $artifactRelative = Get-RelativeProjectPath -FullPath $artifactFull
        if (-not (Test-Path -LiteralPath $script:indexPath -PathType Leaf)) { throw 'Review index does not exist.' }
        $index = Read-JsonFile -Path $script:indexPath
        $artifacts = @($index.entries | Where-Object { [string]$_.path -eq $artifactRelative })
        if ($artifacts.Count -eq 0) { throw "No review package is indexed for: $artifactRelative" }
        $matches = New-Object System.Collections.Generic.List[object]
        foreach ($artifact in $artifacts) {
            $review = @($index.runs | Where-Object { [string]$_.batch_id -eq [string]$artifact.batch_id })
            if ($review.Count -ne 1) { throw "Review index has no unique run for batch: $($artifact.batch_id)" }
            [void]$matches.Add([pscustomobject][ordered]@{ artifact = $artifact; review = $review[0] })
        }
        Write-Output ([pscustomobject][ordered]@{ path = $artifactRelative; matches = @($matches.ToArray()) } | ConvertTo-Json -Depth 30)
        exit 0
    }

    if ($Action -eq 'plan-backtests') {
        $required = @(Get-RequiredAnchors -Before $BeforeCount -After $AfterCount)
        Write-Output ([pscustomobject][ordered]@{ before = $BeforeCount; after = $AfterCount; required_backtest_anchors = @($required) } | ConvertTo-Json -Depth 10)
        exit 0
    }

    if ($Action -eq 'verify-backtest-set') {
        $required = @(Get-RequiredAnchors -Before $BeforeCount -After $AfterCount)
        $directory = Get-FullPathInsideProject -Path $EvidencePath
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) { throw "Backtest evidence directory does not exist: $directory" }
        $records = New-Object System.Collections.Generic.List[object]
        foreach ($anchorValue in $required) {
            $receiptPath = Join-Path $directory ("backtest-$anchorValue.json")
            if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) { throw "Backtest receipt is missing: $receiptPath" }
            [void]$records.Add([pscustomobject][ordered]@{
                anchor = $anchorValue
                path = Get-RelativeProjectPath -FullPath $receiptPath
                sha256 = Get-Sha256 -Path $receiptPath
            })
        }
        Assert-Backtests -Run ([pscustomobject][ordered]@{ backtests = @($records.ToArray()) }) -Required $required
        Write-Output ([pscustomobject][ordered]@{ status = 'backtest_set_verified'; required_backtest_anchors = @($required); evidence_path = Get-RelativeProjectPath -FullPath $directory } | ConvertTo-Json -Depth 10)
        exit 0
    }

    if ($Action -eq 'start') {
        $resolvedSemanticReviewMode = Resolve-SemanticReviewMode -RequestedMode $SemanticReviewMode
        if ($ExecutionProfile -eq 'auto') {
            $ExecutionProfile = if ($ReviewPolicy -eq 'deferred' -and $ReviewChannel -eq 'core' -and [string]::IsNullOrWhiteSpace($ManagedTaskId) -and $resolvedSemanticReviewMode -eq 'disabled') { 'consolidated-v1' } else { 'existing' }
        }
        if ($ExecutionProfile -eq 'consolidated-v1' -and ($ReviewChannel -ne 'core' -or $ReviewPolicy -ne 'deferred')) { throw 'consolidated-v1 requires core deferred; historical and interactive routes remain explicit.' }
        if ($ExecutionProfile -eq 'consolidated-v1' -and (-not [string]::IsNullOrWhiteSpace($ManagedTaskId) -or $resolvedSemanticReviewMode -ne 'disabled')) { throw 'consolidated-v1 does not yet support managed or precision routes. Use the existing profile before creating this run; no policy is silently disabled.' }
        if ($ReviewChannel -eq 'legacy' -and [string]::IsNullOrWhiteSpace($Reason)) { throw 'Legacy review for a new run requires a concrete unsupported-input reason; core is the default.' }
        if ($BatchId -notmatch '^[a-z0-9][a-z0-9-]{2,79}$') { throw 'BatchId must be a safe lowercase identifier.' }
        $itemList = @(Read-ControlItems)
        if ($itemList.Count -lt 1) { throw 'At least one item is required.' }
        if ($itemList.Count -eq 1 -and -not [string]::IsNullOrWhiteSpace($Items) -and $itemList[0] -match ',\s*(Clippings|raw-sources)/') {
            throw 'Items appears to contain comma-joined paths. Use ItemsPath with a JSON string array, or separate simple items with fullwidth vertical bars when calling ingest-control.cmd.'
        }
        Assert-CanonicalClippingItems -Values $itemList -Context 'Start item'
        if ($BeforeCount -lt 0 -and $ExecutionProfile -ne 'consolidated-v1') { throw 'BeforeCount must be zero or greater.' }
        $runFull = Get-FullPathInsideProject -Path $RunPath
        if (Test-Path -LiteralPath $runFull) { throw "Run manifest already exists: $runFull" }
        $expectedRun = Get-FullPathInsideProject -Path ("system/maintenance/ingest-runs/$BatchId/run.json")
        if (-not $runFull.Equals($expectedRun, [StringComparison]::OrdinalIgnoreCase)) { throw "RunPath must be system/maintenance/ingest-runs/$BatchId/run.json" }
        $orchestration = 'standalone_direct'
        $managedContext = $null
        $resolvedWorkspaceRoot = if ([string]::IsNullOrWhiteSpace($ManagedTaskId)) { Split-Path -Parent $script:projectRoot } else { Resolve-WorkspaceRoot }
        $orchestrationRoot = Join-Path $resolvedWorkspaceRoot 'WorkspaceOrchestration'
        $modePath = Join-Path (Join-Path $orchestrationRoot 'config') 'mode.json'
        $taskTool = Join-Path (Join-Path $orchestrationRoot 'scripts') 'task-tool.ps1'
        if ((Test-Path -LiteralPath $modePath -PathType Leaf) -or (Test-Path -LiteralPath $taskTool -PathType Leaf)) {
            if (-not ((Test-Path -LiteralPath $modePath -PathType Leaf) -and (Test-Path -LiteralPath $taskTool -PathType Leaf))) { throw 'Workspace orchestration evidence is incomplete.' }
            $mode = Read-JsonFile -Path $modePath
            if (@('direct', 'managed') -notcontains [string]$mode.mode) { throw "Unsupported WorkspaceOrchestration mode: $($mode.mode)" }
            if ($ReviewPolicy -eq 'deferred' -and [string]::IsNullOrWhiteSpace($ManagedTaskId)) {
                if ($mode.mode -ne 'direct') { throw "Deferred review requires direct mode, found: $($mode.mode)" }
            }
            $orchestration = "workspace_$($mode.mode)"
        }
        if (-not [string]::IsNullOrWhiteSpace($ManagedTaskId)) {
            if ($ReviewPolicy -ne 'deferred') { throw 'ManagedTaskId is only valid for automatic review_policy=deferred.' }
            $managedContext = Get-ManagedTaskContext -TaskId $ManagedTaskId -RequireBaseHead
            $orchestration = "workspace_managed_isolated:$ManagedTaskId"
        }
        $state = $null
        if ($ReviewPolicy -eq 'deferred') {
            $state = Read-JsonFile -Path $script:statePath
            if ($state.status -ne 'inactive') { throw "Automatic-review state is not inactive: $($state.status)" }
            $stateRelative = Get-RelativeProjectPath -FullPath $script:statePath
            $stateDrift = @(& git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -C $script:projectRoot status --porcelain -- $stateRelative)
            if ($LASTEXITCODE -ne 0 -or $stateDrift.Count -gt 0) { throw 'Automatic-review state file has uncommitted drift.' }
        }
        $base = (& git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -C $script:projectRoot rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Unable to read Knowledge HEAD.' }
        if ($null -ne $managedContext -and $base -ne $managedContext.base_revision) { throw 'Managed run base differs from its orchestration task.' }
        $physicalBefore = Get-RawCountAtRevision -Revision $base
        if ($BeforeCount -lt 0 -and $ExecutionProfile -eq 'consolidated-v1') { $BeforeCount = $physicalBefore }
        if ($BeforeCount -ne $physicalBefore) { throw "BeforeCount does not match physical raw baseline: supplied=$BeforeCount, physical=$physicalBefore" }
        $now = [DateTime]::UtcNow.ToString('o')
        $semanticReviewMode = $resolvedSemanticReviewMode
        $semanticReviewEnabled = ($semanticReviewMode -ne 'disabled')
        if ($semanticReviewEnabled -and [string]::IsNullOrWhiteSpace($ProducerContextId)) {
            throw 'ProducerContextId is required while semantic review policy is shadow or enforced.'
        }
        if ($UseLegacyPackages) { throw 'New runs use schema 8 and deterministic packages. Legacy versions are historical records only.' }
        $deterministicPackagesRequested = $true
        $deterministicPackageFallback = $false
        $runSchemaVersion = 8
        $agentRoutingText = & node (Join-Path $PSScriptRoot 'ingest-agent-routing.mjs') policy --root $script:projectRoot
        if ($LASTEXITCODE -ne 0) { throw 'Ingest agent routing could not be loaded.' }
        $agentRouting = ($agentRoutingText -join "`n") | ConvertFrom-Json
        if ($PostIngestReread -and $ReviewChannel -ne 'core') { throw 'PostIngestReread requires the current core route; historical runs keep their own contract.' }
        $selectedPostReread = if ($PSBoundParameters.ContainsKey('PostIngestReread')) { [bool]$PostIngestReread } else { [bool]$agentRouting.post_ingest_reread.enabled }
        $run = [pscustomobject][ordered]@{
            raw_standard = 'RAW_STANDARD_V2'
            schema_version = $runSchemaVersion; batch_id = $BatchId; review_policy = $ReviewPolicy; status = 'running_scoring'; items = @($itemList)
            orchestration_evidence = $orchestration; base_revision = $base
            managed_task = if ($null -eq $managedContext) { $null } else { [pscustomobject][ordered]@{ task_id = $ManagedTaskId; base_revision = [string]$managedContext.base_revision } }
            counts = [pscustomobject][ordered]@{ before = $BeforeCount; after = $null; required_backtest_anchors = @() }
            packages = [pscustomobject][ordered]@{ scoring = $null; stage1 = $null; stage2 = $null; stage3 = $null; gate_audit = $null; maintenance = $null }
            commits = [pscustomobject][ordered]@{ stage1 = $null; stage3 = $null }
            backtests = @(); final_review = [pscustomobject][ordered]@{ path = $null; sha256 = $null; approved_sha256 = $null }
            approvals = [pscustomobject][ordered]@{ scoring = $null; stage1 = $null; stage2 = $null; stage3 = $null }
            artifacts = @()
            content_audits = @()
            started_at = $now; updated_at = $now
        }
        if ($runSchemaVersion -ge 8) {
            $run | Add-Member -NotePropertyName execution_control -NotePropertyValue ([pscustomobject][ordered]@{
                schema_version = 2
                execution_profile = $ExecutionProfile
                workflow_revision = if ($ExecutionProfile -eq 'consolidated-v1') { 2 } else { 1 }
                writer_config = if ($ReviewChannel -eq 'core') { $agentRouting.writer_config } else { $null }
                task_session_bindings = if ($ReviewChannel -eq 'core') { $agentRouting.task_session_bindings } else { $null }
                post_ingest_reread = [pscustomobject][ordered]@{ enabled = ($ReviewChannel -eq 'core' -and $selectedPostReread); model = [string]$agentRouting.post_ingest_reread.model; reasoning_effort = [string]$agentRouting.post_ingest_reread.reasoning_effort }
                runtime_contract_version = 3
                mechanical_contract_version = 1
                reviewer_route_version = if ($ReviewChannel -eq 'legacy') { 2 } else { 3 }
                page_review_contract_version = if ($ReviewChannel -eq 'legacy') { 1 } else { 3 }
                page_review_queue_version = if ($ReviewChannel -eq 'legacy') { 0 } else { 1 }
                wiki_consumption_contract_version = 1
                preferred_review_channel = $ReviewChannel
                review_channel_reason = $(if ($ReviewChannel -eq 'legacy') { $Reason } else { $null })
                child_session_cap = 12
                fresh_parent_context_recommended = $true
                agent_sessions = @()
                quality_events = @()
                reviewer_policy = [pscustomobject][ordered]@{ mode = 'single_primary'; primary_agent_id = $null; primary_context_id = $null }
                raw_review_attempts = @()
                raw_review_history = @()
                writer_stages = [pscustomobject][ordered]@{ stage1 = $null; stage3 = $null }
                writer_stage_history = @()
                page_reviews = @()
            })
        }
        if ($semanticReviewEnabled -or $deterministicPackagesRequested) {
            $resolvedProducerContextId = $ProducerContextId
            $run | Add-Member -NotePropertyName producer_context_id -NotePropertyValue $resolvedProducerContextId
            $run | Add-Member -NotePropertyName semantic_review_mode -NotePropertyValue $semanticReviewMode
            $run | Add-Member -NotePropertyName semantic_reviews -NotePropertyValue ([pscustomobject][ordered]@{
                scoring = [pscustomobject][ordered]@{ pending = $null; active = $null; history = @() }
                stage1 = [pscustomobject][ordered]@{ pending = $null; active = $null; history = @() }
                stage2 = [pscustomobject][ordered]@{ pending = $null; active = $null; history = @() }
                stage3 = [pscustomobject][ordered]@{ pending = $null; active = $null; history = @() }
            })
        }
        if ($deterministicPackageFallback) {
            $run | Add-Member -NotePropertyName deterministic_package_fallback -NotePropertyValue 'semantic_review_uses_schema5_until_combined_v6_contract_is_available'
        }
        if ($deterministicPackagesRequested) {
            $packageDataFull = if ([string]::IsNullOrWhiteSpace($PackageDataPath)) {
                Get-FullPathInsideProject -Path ("system/maintenance/ingest-runs/$BatchId/package-data.json")
            } else {
                Get-FullPathInsideProject -Path $PackageDataPath
            }
            Assert-RunLocalPath -RunManifestPath $runFull -CandidatePath $packageDataFull
            if (Test-Path -LiteralPath $packageDataFull) { throw "Package data already exists: $packageDataFull" }
            $emptySections = [ordered]@{}
            foreach ($kind in @('scoring','stage1','stage2','stage3','gate_audit')) {
                $emptySections[$kind] = [pscustomobject][ordered]@{ status = 'open'; semantic = New-EmptyPackageSemantic; derived = [pscustomobject][ordered]@{}; section_sha256 = $null }
            }
            $packageData = [pscustomobject][ordered]@{ schema_version = 2; batch_id = $BatchId; renderer_version = 'ingest-package-renderer-v2'; sections = [pscustomobject]$emptySections }
            Write-JsonFile -Path $packageDataFull -Value $packageData
            $run | Add-Member -NotePropertyName package_data -NotePropertyValue ([pscustomobject][ordered]@{ path = Get-RelativeProjectPath -FullPath $packageDataFull; schema_version = 2; renderer_version = 'ingest-package-renderer-v2' })
        }
        Write-JsonFile -Path $runFull -Value $run
        if ($ReviewPolicy -eq 'deferred') {
            $state.status = 'running'; $state.stage = 'scoring'; $state.batch_id = $BatchId; $state.items = @($itemList); $state.started_at = $now
            if (Test-ObjectProperty -Value $state -Name 'batch_labels') {
                $state.PSObject.Properties.Remove('batch_labels')
            }
            Write-JsonFile -Path $script:statePath -Value $state
        }
        if ($OutputMode -eq 'full') {
            Write-Output ($run | ConvertTo-Json -Depth 30)
        } else {
            Write-Output ([pscustomobject][ordered]@{ status = [string]$run.status; path = Get-RelativeProjectPath -FullPath $runFull; sha256 = Get-Sha256 -Path $runFull; next_action = 'prepare-context, then seal and render scoring package' } | ConvertTo-Json -Depth 10)
        }
        exit 0
    }

    $loaded = Read-Run
    $run = $loaded.Value
    if ($Action -eq 'status') {
        if ($OutputMode -eq 'full') { Write-Output ($run | ConvertTo-Json -Depth 30) }
        else {
            $summaryText = & node (Join-Path $PSScriptRoot 'ingest-runtime-contract.mjs') summary --run $loaded.Path
            if ($LASTEXITCODE -ne 0) { throw 'Run summary failed.' }
            $summary = $summaryText | ConvertFrom-Json
            $summary | Add-Member -NotePropertyName path -NotePropertyValue (Get-RelativeProjectPath -FullPath $loaded.Path)
            $summary | Add-Member -NotePropertyName sha256 -NotePropertyValue (Get-Sha256 -Path $loaded.Path)
            Write-Output ($summary | ConvertTo-Json -Depth 10)
        }
        exit 0
    }
    if ([int]$run.schema_version -ge 7 -and $run.status -in @('completed','abandoned') -and -not ($run.status -eq 'completed' -and $Action -eq 'prepare-managed-close')) { throw 'Terminal run is read-only; do not rewrite approved or abandoned history.' }
    if ($Action -eq 'reserve-agent-session') {
        if ([int]$run.execution_control.schema_version -lt 2) { throw 'Agent session reservation requires execution_control v2.' }
        if ([string]::IsNullOrWhiteSpace($AgentRole) -or [string]::IsNullOrWhiteSpace($Model) -or [string]::IsNullOrWhiteSpace($ReasoningEffort) -or [string]::IsNullOrWhiteSpace($Purpose)) {
            throw 'reserve-agent-session requires AgentRole, Model, ReasoningEffort, and Purpose.'
        }
        $key = if ([string]::IsNullOrWhiteSpace($SessionKey)) { 'session-' + [guid]::NewGuid().ToString('N') } else { $SessionKey.Trim() }
        if ($key -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$') { throw 'SessionKey must be a safe identifier.' }
        if (@($run.execution_control.agent_sessions | Where-Object { [string]$_.session_key -eq $key }).Count -gt 0) { throw "Agent session already exists: $key" }
        $nextCount = @($run.execution_control.agent_sessions).Count + 1
        if ($nextCount -gt [int]$run.execution_control.child_session_cap) { throw "Child session cap exceeded: $nextCount > $($run.execution_control.child_session_cap)" }
        $record = [pscustomobject][ordered]@{
            session_key = $key; role = $AgentRole; model = $Model; reasoning_effort = $ReasoningEffort
            purpose = $Purpose.Trim(); status = 'reserved'; agent_id = $null
            reserved_at = [DateTime]::UtcNow.ToString('o'); started_at = $null; ended_at = $null
            duration_seconds = $null; usage = $null; close_reason = $null
            work_outcome = 'unknown'
        }
        $run.execution_control.agent_sessions = @($run.execution_control.agent_sessions) + @($record)
        Save-Run -Path $loaded.Path -Run $run
        Write-Output ([pscustomobject][ordered]@{ status='reserved'; session_key=$key; actual_child_session_count=$nextCount; child_session_cap=[int]$run.execution_control.child_session_cap; next_action='launch exactly one child agent, then bind-agent-session even if later work fails' } | ConvertTo-Json -Depth 10)
        exit 0
    }
    if ($Action -eq 'bind-agent-session') {
        if ([int]$run.execution_control.schema_version -lt 2) { throw 'Agent session binding requires execution_control v2.' }
        if ([string]::IsNullOrWhiteSpace($SessionKey) -or [string]::IsNullOrWhiteSpace($AgentId)) { throw 'bind-agent-session requires SessionKey and AgentId.' }
        $matches = @($run.execution_control.agent_sessions | Where-Object { [string]$_.session_key -eq $SessionKey })
        if ($matches.Count -ne 1) { throw "Expected exactly one reserved agent session: $SessionKey" }
        $record = $matches[0]
        if ([string]$record.status -ne 'reserved') { throw "Only a reserved agent session can be bound: $SessionKey" }
        $record.agent_id = $AgentId.Trim(); $record.status = 'active'
        $record.started_at = if ([string]::IsNullOrWhiteSpace($StartedAt)) { [DateTime]::UtcNow.ToString('o') } else { (Convert-HostUtc $StartedAt).ToString('o') }
        Save-Run -Path $loaded.Path -Run $run
        Write-Output ($record | ConvertTo-Json -Depth 10)
        exit 0
    }
    if ($Action -eq 'close-agent-session') {
        if ([int]$run.execution_control.schema_version -lt 2) { throw 'Agent session closure requires execution_control v2.' }
        if ([string]::IsNullOrWhiteSpace($SessionKey) -or $SessionStatus -notin @('completed','failed','aborted','replaced')) { throw 'close-agent-session requires SessionKey and a terminal SessionStatus.' }
        $matches = @($run.execution_control.agent_sessions | Where-Object { [string]$_.session_key -eq $SessionKey })
        if ($matches.Count -ne 1) { throw "Expected exactly one agent session: $SessionKey" }
        $record = $matches[0]
        if ([string]$record.status -notin @('reserved','active')) { throw "Agent session is already terminal: $SessionKey" }
        $end = if ([string]::IsNullOrWhiteSpace($EndedAt)) { [DateTime]::UtcNow } else { Convert-HostUtc $EndedAt }
        if ($record.started_at -and $end -lt (Convert-HostUtc $record.started_at)) { throw 'Session end must not precede start.' }
        if ($CachedInputTokens -ge 0 -and $InputTokens -ge 0 -and $CachedInputTokens -gt $InputTokens) { throw 'Cached input is a subset of input tokens.' }
        $record.status = $SessionStatus; $record.ended_at = $end.ToString('o'); $record.close_reason = if ([string]::IsNullOrWhiteSpace($Reason)) { $null } else { $Reason.Trim() }
        $record | Add-Member -NotePropertyName work_outcome -NotePropertyValue $WorkOutcome -Force
        if ($record.started_at) { $record.duration_seconds = [Math]::Round(($end - (Convert-HostUtc $record.started_at)).TotalSeconds, 3) }
        if ($InputTokens -ge 0 -or $CachedInputTokens -ge 0 -or $OutputTokens -ge 0) {
            $record.usage = [pscustomobject][ordered]@{ input_tokens=$(if($InputTokens -ge 0){$InputTokens}else{$null}); cached_input_tokens=$(if($CachedInputTokens -ge 0){$CachedInputTokens}else{$null}); output_tokens=$(if($OutputTokens -ge 0){$OutputTokens}else{$null}); source='host_supplied' }
        }
        Save-Run -Path $loaded.Path -Run $run
        Write-Output ($record | ConvertTo-Json -Depth 10)
        exit 0
    }
    if ($Action -eq 'sync-agent-sessions') {
        if ([int]$run.execution_control.schema_version -lt 2) { throw 'Agent session sync requires execution_control v2.' }
        $sessionRoot = if (-not [string]::IsNullOrWhiteSpace($HostSessionRoot)) {
            [IO.Path]::GetFullPath($HostSessionRoot)
        } elseif (-not [string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
            [IO.Path]::GetFullPath((Join-Path $env:CODEX_HOME 'sessions'))
        } elseif (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
            [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.codex/sessions'))
        } else {
            throw 'Host session root is unavailable; pass -HostSessionRoot.'
        }
        if (-not (Test-Path -LiteralPath $sessionRoot -PathType Container)) { throw "Host session root does not exist: $sessionRoot" }
        $pending = @($run.execution_control.agent_sessions | Where-Object { [string]$_.status -in @('reserved','active') })
        $unresolved = New-Object System.Collections.Generic.List[string]
        $updates = New-Object System.Collections.Generic.List[object]
        foreach ($record in $pending) {
            $agentId = [string]$record.agent_id
            if ([string]$record.status -eq 'reserved' -or [string]::IsNullOrWhiteSpace($agentId)) {
                [void]$unresolved.Add("$($record.session_key):unbound")
                continue
            }
            if ($agentId -notmatch '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$') {
                [void]$unresolved.Add("$($record.session_key):invalid-agent-id")
                continue
            }
            $matches = @(Get-ChildItem -LiteralPath $sessionRoot -Recurse -File -Filter "*$agentId*.jsonl" -ErrorAction SilentlyContinue)
            $completedLog = $null
            $completedEvents = $null
            foreach ($candidate in $matches) {
                $events = New-Object System.Collections.Generic.List[object]
                foreach ($line in Get-Content -Encoding UTF8 -LiteralPath $candidate.FullName) {
                    if ([string]::IsNullOrWhiteSpace($line)) { continue }
                    try { [void]$events.Add(($line | ConvertFrom-Json)) } catch { }
                }
                $meta = @($events | Where-Object { [string]$_.type -eq 'session_meta' -and [string]$_.payload.id -eq $agentId })
                $complete = @($events | Where-Object { [string]$_.type -eq 'event_msg' -and [string]$_.payload.type -eq 'task_complete' })
                if ($meta.Count -eq 1 -and $complete.Count -gt 0) {
                    $completedLog = $candidate
                    $completedEvents = @($events | ForEach-Object { $_ })
                    break
                }
            }
            if ($null -eq $completedLog) {
                [void]$unresolved.Add("$($record.session_key):host-log-incomplete")
                continue
            }
            $tokenEvents = @($completedEvents | Where-Object { [string]$_.type -eq 'event_msg' -and [string]$_.payload.type -eq 'token_count' -and $null -ne $_.payload.info.total_token_usage })
            $usage = $null
            if ($tokenEvents.Count -gt 0) {
                $total = $tokenEvents[-1].payload.info.total_token_usage
                $usage = [pscustomobject][ordered]@{
                    input_tokens = $(if ($null -ne $total.PSObject.Properties['input_tokens']) { [int64]$total.input_tokens } else { $null })
                    cached_input_tokens = $(if ($null -ne $total.PSObject.Properties['cached_input_tokens']) { [int64]$total.cached_input_tokens } else { $null })
                    output_tokens = $(if ($null -ne $total.PSObject.Properties['output_tokens']) { [int64]$total.output_tokens } else { $null })
                    source = 'host_session_log'
                }
            }
            $completeEvent = @($completedEvents | Where-Object { [string]$_.type -eq 'event_msg' -and [string]$_.payload.type -eq 'task_complete' })[-1]
            $end = if ($null -ne $completeEvent.PSObject.Properties['timestamp'] -and -not [string]::IsNullOrWhiteSpace([string]$completeEvent.timestamp)) {
                Convert-HostUtc $completeEvent.timestamp
            } else { $completedLog.LastWriteTimeUtc }
            if ($record.started_at -and $end -lt (Convert-HostUtc $record.started_at)) {
                [void]$unresolved.Add("$($record.session_key):host-log-clock-before-start")
                continue
            }
            [void]$updates.Add([pscustomobject]@{ record=$record; ended_at=$end; usage=$usage; log=$completedLog.FullName })
        }
        if ($unresolved.Count -gt 0) { throw ('Agent sessions are not host-complete: ' + ($unresolved -join ', ')) }
        foreach ($update in $updates) {
            $record = $update.record
            $record.status = 'completed'
            $record.ended_at = $update.ended_at.ToString('o')
            $record.close_reason = 'synced from completed host session log'
            if ($record.started_at) { $record.duration_seconds = [Math]::Round(($update.ended_at - (Convert-HostUtc $record.started_at)).TotalSeconds, 3) }
            if ($null -ne $update.usage) { $record.usage = $update.usage }
        }
        if ($updates.Count -gt 0) { Save-Run -Path $loaded.Path -Run $run }
        Write-Output ([pscustomobject][ordered]@{ status='synced'; completed_session_count=$updates.Count; terminal_session_count=@($run.execution_control.agent_sessions | Where-Object { [string]$_.status -in @('completed','failed','aborted','replaced') }).Count; total_session_count=@($run.execution_control.agent_sessions).Count; next_action='run maintenance only after all agent sessions are terminal' } | ConvertTo-Json -Depth 10)
        exit 0
    }
    if ($Action -eq 'invalidate-raw-review') {
        if (-not (Test-ObjectProperty -Value $run -Name 'execution_control')) { throw 'invalidate-raw-review requires a new schema8 run with execution_control.' }
        if ([string]::IsNullOrWhiteSpace($Reason)) { throw 'invalidate-raw-review requires a concrete Reason.' }
        $rawFull = Get-FullPathInsideProject -Path $ArtifactPath -MustExist
        $arguments = @(
            $script:rawReviewControllerPath, 'invalidate',
            '--root', $script:projectRoot,
            '--run', (Get-RelativeProjectPath -FullPath $loaded.Path),
            '--raw', (Get-RelativeProjectPath -FullPath $rawFull),
            '--reason', $Reason
        )
        $text = @(& node @arguments 2>&1) -join [Environment]::NewLine
        if ($LASTEXITCODE -ne 0) { throw "Raw review invalidation failed: $text" }
        Write-Output $text
        exit 0
    }
    if ($Action -eq 'recover-reviewer-drift') {
        if (-not (Test-ObjectProperty -Value $run -Name 'execution_control')) { throw 'recover-reviewer-drift requires a new schema8 run with execution_control.' }
        if ([string]::IsNullOrWhiteSpace($Reason)) { throw 'recover-reviewer-drift requires a concrete Reason.' }
        if ([string]::IsNullOrWhiteSpace($EvidencePath)) { throw 'recover-reviewer-drift requires EvidencePath.' }
        $evidenceFull = Get-FullPathInsideProject -Path $EvidencePath -MustExist
        Assert-RunLocalPath -RunManifestPath $loaded.Path -CandidatePath $evidenceFull
        $arguments = @(
            $script:rawReviewControllerPath, 'recover-drift',
            '--root', $script:projectRoot,
            '--run', (Get-RelativeProjectPath -FullPath $loaded.Path),
            '--evidence', (Get-RelativeProjectPath -FullPath $evidenceFull),
            '--reason', $Reason
        )
        $text = @(& node @arguments 2>&1) -join [Environment]::NewLine
        if ($LASTEXITCODE -ne 0) { throw "Reviewer-drift recovery failed: $text" }
        Write-Output $text
        exit 0
    }
    if ($Action -eq 'discard-raw-review') {
        if (-not (Test-ObjectProperty -Value $run -Name 'execution_control')) { throw 'discard-raw-review requires a new schema8 run with execution_control.' }
        if ([string]::IsNullOrWhiteSpace($Reason)) { throw 'discard-raw-review requires a concrete Reason.' }
        $rawFull = Get-FullPathInsideProject -Path $ArtifactPath -MustExist
        $arguments = @($script:rawReviewControllerPath, 'discard', '--root', $script:projectRoot, '--run', (Get-RelativeProjectPath -FullPath $loaded.Path), '--raw', (Get-RelativeProjectPath -FullPath $rawFull), '--reason', $Reason)
        $text = @(& node @arguments 2>&1) -join [Environment]::NewLine
        if ($LASTEXITCODE -ne 0) { throw "Raw review discard failed: $text" }
        Write-Output $text
        exit 0
    }
    if ($Action -eq 'prepare-core-review') {
        if (-not (Test-ObjectProperty -Value $run -Name 'execution_control')) { throw 'prepare-core-review requires a new schema8 run with execution_control.' }
        $rawFull = Get-FullPathInsideProject -Path $ArtifactPath -MustExist
        $ledgerFull = Get-FullPathInsideProject -Path $EvidencePath -MustExist
        Assert-RunLocalPath -RunManifestPath $loaded.Path -CandidatePath $ledgerFull
        $arguments = @($script:coreReviewControllerPath, 'prepare', '--root', $script:projectRoot, '--run', (Get-RelativeProjectPath -FullPath $loaded.Path), '--raw', (Get-RelativeProjectPath -FullPath $rawFull), '--ledger', (Get-RelativeProjectPath -FullPath $ledgerFull))
        $text = @(& node @arguments 2>&1) -join [Environment]::NewLine
        if ($LASTEXITCODE -ne 0) { throw "Core review preparation failed: $text" }
        Write-Output $text
        exit 0
    }
    if ($Action -eq 'preflight-core-review') {
        if (-not (Test-ObjectProperty -Value $run -Name 'execution_control')) { throw 'preflight-core-review requires a new schema8 run with execution_control.' }
        $rawFull = Get-FullPathInsideProject -Path $ArtifactPath -MustExist
        $arguments = @($script:coreReviewControllerPath, 'preflight', '--root', $script:projectRoot, '--run', (Get-RelativeProjectPath -FullPath $loaded.Path), '--raw', (Get-RelativeProjectPath -FullPath $rawFull))
        $text = @(& node @arguments 2>&1) -join [Environment]::NewLine
        if ($LASTEXITCODE -ne 0) { throw "Core review preflight failed: $text" }
        Write-Output $text
        exit 0
    }
    if ($Action -eq 'complete-core-review') {
        if (-not (Test-ObjectProperty -Value $run -Name 'execution_control')) { throw 'complete-core-review requires a new schema8 run with execution_control.' }
        if ([string]::IsNullOrWhiteSpace($AgentId)) { throw 'complete-core-review requires the actual reviewer AgentId.' }
        $rawFull = Get-FullPathInsideProject -Path $ArtifactPath -MustExist
        $arguments = @($script:coreReviewControllerPath, 'complete', '--root', $script:projectRoot, '--run', (Get-RelativeProjectPath -FullPath $loaded.Path), '--raw', (Get-RelativeProjectPath -FullPath $rawFull), '--agent', $AgentId)
        if ($HostSessionRoot) { $arguments += @('--sessions', $HostSessionRoot) }
        $text = @(& node @arguments 2>&1) -join [Environment]::NewLine
        $code = $LASTEXITCODE
        if ($code -notin @(0, 2)) { throw "Core review completion failed: $text" }
        Write-Output $text
        exit $code
    }
    if ($Action -eq 'prepare-raw-review') {
        if ($run.execution_control.PSObject.Properties['preferred_review_channel'] -and $run.execution_control.preferred_review_channel -eq 'core') { throw 'New batches use prepare-core-review with a complete claim ledger and full section coverage. Legacy raw review is only for runs already using that channel.' }
        if (-not (Test-ObjectProperty -Value $run -Name 'execution_control')) { throw 'prepare-raw-review requires a new schema8 run with execution_control.' }
        $rawFull = Get-FullPathInsideProject -Path $ArtifactPath -MustExist
        $manifestFull = Get-FullPathInsideProject -Path $EvidencePath -MustExist
        Assert-RunLocalPath -RunManifestPath $loaded.Path -CandidatePath $manifestFull
        $arguments = @(
            $script:rawReviewControllerPath, 'prepare',
            '--root', $script:projectRoot,
            '--run', (Get-RelativeProjectPath -FullPath $loaded.Path),
            '--raw', (Get-RelativeProjectPath -FullPath $rawFull),
            '--manifest', (Get-RelativeProjectPath -FullPath $manifestFull)
        )
        if (-not [string]::IsNullOrWhiteSpace($Reason)) { $arguments += @('--reason', $Reason) }
        $text = @(& node @arguments 2>&1) -join [Environment]::NewLine
        if ($LASTEXITCODE -ne 0) { throw "Raw review preparation failed: $text" }
        Write-Output $text
        exit 0
    }
    if ($Action -eq 'complete-raw-review') {
        if (-not (Test-ObjectProperty -Value $run -Name 'execution_control')) { throw 'complete-raw-review requires a new schema8 run with execution_control.' }
        if ([string]::IsNullOrWhiteSpace($AgentId)) { throw 'complete-raw-review requires the actual reviewer AgentId.' }
        $rawFull = Get-FullPathInsideProject -Path $ArtifactPath -MustExist
        $arguments = @(
            $script:rawReviewControllerPath, 'complete',
            '--root', $script:projectRoot,
            '--run', (Get-RelativeProjectPath -FullPath $loaded.Path),
            '--raw', (Get-RelativeProjectPath -FullPath $rawFull),
            '--agent', $AgentId
        )
        if ($HostSessionRoot) { $arguments += @('--sessions', $HostSessionRoot) }
        $text = @(& node @arguments 2>&1) -join [Environment]::NewLine
        $code = $LASTEXITCODE
        if ($code -notin @(0, 2)) { throw "Raw review completion failed: $text" }
        Write-Output $text
        exit $code
    }
    if ($Action -eq 'preflight-raw-review') {
        if (-not (Test-ObjectProperty -Value $run -Name 'execution_control')) { throw 'preflight-raw-review requires a schema8 run with execution_control.' }
        $rawFull = Get-FullPathInsideProject -Path $ArtifactPath -MustExist
        $arguments = @($script:rawReviewControllerPath, 'preflight', '--root', $script:projectRoot, '--run', (Get-RelativeProjectPath -FullPath $loaded.Path), '--raw', (Get-RelativeProjectPath -FullPath $rawFull))
        $text = @(& node @arguments 2>&1) -join [Environment]::NewLine
        if ($LASTEXITCODE -ne 0) { throw "Raw review preflight failed: $text" }
        Write-Output $text
        exit 0
    }
    if ($Action -eq 'apply-review-repairs') {
        if ([int]$run.execution_control.schema_version -lt 2) { throw 'apply-review-repairs requires execution_control v2.' }
        $rawFull = Get-FullPathInsideProject -Path $ArtifactPath -MustExist
        $arguments = @($script:rawReviewControllerPath, 'apply', '--root', $script:projectRoot, '--run', (Get-RelativeProjectPath -FullPath $loaded.Path), '--raw', (Get-RelativeProjectPath -FullPath $rawFull))
        $text = @(& node @arguments 2>&1) -join [Environment]::NewLine
        if ($LASTEXITCODE -ne 0) { throw "Raw review deterministic repair failed: $text" }
        Write-Output $text
        exit 0
    }
    if ($Action -eq 'reopen-package-section') {
        if ([int]$run.schema_version -lt 7) { throw 'Section rework requires schema7 or newer.' }
        if ([string]::IsNullOrWhiteSpace($Reason)) { throw 'Rework requires a concrete Reason.' }
        if ($Package -notin @('scoring','stage1','stage2','stage3','gate_audit')) { throw 'Rework requires a semantic Package.' }
        $order = @('scoring','stage1','stage2','stage3','gate_audit')
        $startIndex = [Array]::IndexOf($order, $Package)
        $affected = @($order[$startIndex..($order.Count-1)])
        $dataFull = Get-PackageDataPathForRun -Run $run -RunManifestPath $loaded.Path
        $data = Read-JsonFile -Path $dataFull
        # Preserve the exact previous run, sealed data and rendered reports before clearing approvals.
        $historyDirectory = Join-Path (Split-Path -Parent $loaded.Path) ('revisions/' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $historyDirectory -Force | Out-Null
        Copy-Item -LiteralPath $loaded.Path -Destination (Join-Path $historyDirectory 'run.json')
        Copy-Item -LiteralPath $dataFull -Destination (Join-Path $historyDirectory 'package-data.json')
        $savedFiles = New-Object 'System.Collections.Generic.List[object]'
        $records = @($run.packages.PSObject.Properties | Where-Object { $null -ne $_.Value } | ForEach-Object { $_.Value })
        if ($run.final_review.path) { $records += $run.final_review }
        if ($run.final_review.PSObject.Properties['content_manifest'] -and $run.final_review.content_manifest) { $records += [pscustomobject]@{path=$run.final_review.content_manifest} }
        foreach ($record in $records) {
            $full = Get-FullPathInsideProject -Path ([string]$record.path) -MustExist
            $target = Join-Path $historyDirectory ((Get-Sha256 -Path $full).Substring(0,16) + '-' + [IO.Path]::GetFileName($full))
            Copy-Item -LiteralPath $full -Destination $target
            [void]$savedFiles.Add([pscustomobject]@{original_path=[string]$record.path; archived_path=Get-RelativeProjectPath $target; sha256=Get-Sha256 $target})
        }
        Write-JsonFile -Path (Join-Path $historyDirectory 'rework.json') -Value ([pscustomobject]@{reason=$Reason; affected_sections=$affected; saved_files=@($savedFiles.ToArray()); source_and_wiki_restored=$false})
        foreach ($kind in $affected) {
            $data.sections.$kind = [pscustomobject][ordered]@{ status='open'; semantic=New-EmptyPackageSemantic; derived=[pscustomobject]@{}; section_sha256=$null }
            $run.packages.$kind = $null
            if ($run.approvals.PSObject.Properties[$kind]) { $run.approvals.$kind = $null }
            if ($run.semantic_reviews.PSObject.Properties[$kind]) { Move-SemanticReviewActiveToHistory -Slot $run.semantic_reviews.$kind -Reason $Reason; $run.semantic_reviews.$kind.pending = $null }
        }
        if (Test-ObjectProperty -Value $run -Name 'execution_control') {
            if ($Package -in @('scoring', 'stage1')) { Move-WriterStageToHistory -Run $run -Stage 'stage1' -Reason $Reason }
            if ($Package -in @('scoring', 'stage1', 'stage2', 'stage3')) { Move-WriterStageToHistory -Run $run -Stage 'stage3' -Reason $Reason }
        }
        $run.packages.maintenance = $null
        $run.final_review = [pscustomobject][ordered]@{path=$null;sha256=$null;approved_sha256=$null;content_manifest=$null;content_manifest_sha256=$null}
        $run.commits.stage3 = $null
        if ($Package -in @('scoring','stage1')) { $run.commits.stage1 = $null }
        $run.counts.after = $null; $run.counts.required_backtest_anchors = @(); $run.backtests = @()
        $standard = (Get-ReviewPolicy -Run $run) -eq 'interactive'
        $run.status = switch ($Package) {
            'scoring' { 'running_scoring' }
            'stage1' { if ($standard) { 'scoring_approved' } else { 'running_scoring' } }
            'stage2' { if ($standard) { 'stage1_approved' } else { 'stage1_committed' } }
            default { 'stage2_planned' }
        }
        Write-JsonFile -Path $dataFull -Value $data
        Save-Run -Path $loaded.Path -Run $run
        if (-not $standard) { $state=Read-JsonFile -Path $script:statePath; $state.status='running';$state.stage=$run.status;Write-JsonFile -Path $script:statePath -Value $state }
        Write-Output ([pscustomobject]@{status='reopened';affected_sections=$affected;history=Get-RelativeProjectPath $historyDirectory;next_action='Repair only authorized content, then re-evaluate and reseal affected sections; this operation does not restore source or Wiki bytes.'} | ConvertTo-Json -Depth 10)
        exit 0
    }
    $managedRunContext = Assert-ManagedRunContext -Run $run
    if ($Action -eq 'record-writer-stage') {
        if (-not (Test-ObjectProperty -Value $run -Name 'execution_control')) { throw 'record-writer-stage requires a new schema8 run with execution_control.' }
        if ($Package -notin @('stage1', 'stage3')) { throw 'record-writer-stage supports only stage1 or stage3.' }
        $agentList = @(Split-ControlList -Value $AgentIds)
        if ($PrimaryWriter -and $agentList.Count -gt 0) { throw 'PrimaryWriter and AgentIds are mutually exclusive.' }
        if ($PrimaryWriter -and $Package -ne 'stage3') { throw 'PrimaryWriter is supported only for Stage3.' }
        if ($PrimaryWriter -and (Test-ObjectProperty $run.execution_control 'reviewer_route_version') -and $run.execution_control.reviewer_route_version -eq 3) { throw 'Parent-review route requires a separate content writer; PrimaryWriter is not supported.' }
        if (@($agentList | Sort-Object -Unique).Count -ne $agentList.Count) { throw 'AgentIds must not contain duplicates.' }
        $outputs = New-Object 'System.Collections.Generic.List[object]'
        $semanticRelative = $null
        $semanticSha = $null
        if ($Package -eq 'stage1') {
            foreach ($artifact in @($run.artifacts | Where-Object { [string]$_.kind -eq 'raw' -and [string]$_.disposition -eq 'ingested' })) {
                $full = Get-FullPathInsideProject -Path ([string]$artifact.path) -MustExist
                [void]$outputs.Add([pscustomobject][ordered]@{ path = [string]$artifact.path; sha256 = Get-Sha256 -Path $full })
            }
        } else {
            if ($run.status -ne 'stage2_planned') { throw "Stage3 writers may complete only after Stage2 is planned, found $($run.status)" }
            if ([string]::IsNullOrWhiteSpace($SemanticDataPath)) { throw 'Stage3 writer completion requires SemanticDataPath.' }
            if ([string]::IsNullOrWhiteSpace([string]$run.commits.stage1)) { throw 'Stage3 writer completion requires a Stage1 checkpoint.' }
            $semanticFull = Get-FullPathInsideProject -Path $SemanticDataPath -MustExist
            Assert-RunLocalPath -RunManifestPath $loaded.Path -CandidatePath $semanticFull
            $semantic = Read-JsonFile -Path $semanticFull
            Assert-PackageSemanticShape -Semantic $semantic
            $contractResult = & node (Join-Path $PSScriptRoot 'ingest-runtime-contract.mjs') stage3 --semantic $semanticFull
            if ($LASTEXITCODE -ne 0) { throw 'Stage3 row contract failed before writer completion.' }
            $semanticRelative = Get-RelativeProjectPath -FullPath $semanticFull
            $semanticSha = Get-Sha256 -Path $semanticFull
            $artifactPaths = @($semantic.rows | ForEach-Object { [string]$_.artifact } | Sort-Object -Unique)
            $trackedChanges = @(& git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -c core.quotepath=false -C $script:projectRoot diff --name-only ([string]$run.commits.stage1) -- 'wiki/' 'domains/')
            if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect Stage3 writer outputs against the Stage1 checkpoint.' }
            $untrackedChanges = @(& git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -c core.quotepath=false -C $script:projectRoot ls-files --others --exclude-standard -- 'wiki/' 'domains/')
            if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect untracked Stage3 writer outputs.' }
            $changedPaths = @(($trackedChanges + $untrackedChanges) | ForEach-Object { $_.Trim().Replace('\', '/') } | Where-Object { $_ -ne '' } | Sort-Object -Unique)
            foreach ($artifactPath in $artifactPaths) {
                if ($artifactPath -notmatch '^(wiki|domains)/.+\.md$') { throw "Stage3 writer output is outside Wiki/domain scope: $artifactPath" }
                if ($changedPaths -notcontains $artifactPath) { throw "Stage3 semantic row is not an actual post-Stage1 change: $artifactPath" }
                $full = Get-FullPathInsideProject -Path $artifactPath -MustExist
                [void]$outputs.Add([pscustomobject][ordered]@{ path = $artifactPath; sha256 = Get-Sha256 -Path $full })
            }
        }
        if ($outputs.Count -gt 0 -and $agentList.Count -eq 0 -and -not $PrimaryWriter) { throw "$Package writer outputs require at least one actual AgentId or PrimaryWriter." }
        if ((Test-ObjectProperty $run.execution_control 'reviewer_route_version') -and $run.execution_control.reviewer_route_version -eq 3) {
            foreach ($output in $outputs) {
                $author = $run.execution_control.artifact_authors.PSObject.Properties[[string]$output.path]
                if ($null -eq $author -or $agentList -notcontains [string]$author.Value.agent_id) { throw "Missing actual writer assignment for $($output.path)." }
            }
        }
        [void](Assert-ExecutionAgentBudget -Run $run -AdditionalAgentIds $agentList)
        if ($null -ne $run.execution_control.writer_stages.$Package) {
            $existing = $run.execution_control.writer_stages.$Package
            $sameAgents = (@($existing.agent_ids | Sort-Object) -join '|') -ceq (@($agentList | Sort-Object) -join '|')
            $sameOutputs = (@($existing.outputs | Sort-Object path | ForEach-Object { $_.path + '|' + $_.sha256 }) -join "`n") -ceq (@($outputs.ToArray() | Sort-Object path | ForEach-Object { $_.path + '|' + $_.sha256 }) -join "`n")
            if ($existing.status -eq 'completed' -and $sameAgents -and $sameOutputs -and $existing.semantic_path -eq $semanticRelative -and $existing.semantic_sha256 -eq $semanticSha) {
                $existing | Add-Member -NotePropertyName reused -NotePropertyValue $true -Force
                Write-Output ($existing | ConvertTo-Json -Depth 20)
                exit 0
            }
            Move-WriterStageToHistory -Run $run -Stage $Package -Reason 'writer completion replaced before package seal'
        }
        $record = [pscustomobject][ordered]@{
            stage = $Package
            status = 'completed'
            model = if ($PrimaryWriter) { 'primary_session' } elseif ($run.execution_control.PSObject.Properties['writer_config'] -and $run.execution_control.writer_config) { [string]$run.execution_control.writer_config.model } else { 'gpt-5.6-luna' }
            reasoning_effort = if ($PrimaryWriter) { 'context_owned' } elseif ($run.execution_control.PSObject.Properties['writer_config'] -and $run.execution_control.writer_config) { [string]$run.execution_control.writer_config.reasoning_effort } else { 'max' }
            agent_ids = @($agentList)
            writer_mode = if ($PrimaryWriter) { 'primary_session' } else { 'child_agent' }
            output_count = $outputs.Count
            outputs = @($outputs.ToArray())
            semantic_path = $semanticRelative
            semantic_sha256 = $semanticSha
            completed_at = [DateTime]::UtcNow.ToString('o')
        }
        $run.execution_control.writer_stages.$Package = $record
        Save-Run -Path $loaded.Path -Run $run
        Write-Output ($record | ConvertTo-Json -Depth 20)
        exit 0
    }
    if ($Action -eq 'initialize-package-data') {
        $dataFull = Get-PackageDataPathForRun -Run $run -RunManifestPath $loaded.Path
        $result = [pscustomobject][ordered]@{ status = 'initialized'; path = Get-RelativeProjectPath -FullPath $dataFull; sha256 = Get-Sha256 -Path $dataFull; next_action = 'prepare-context' }
        if ($OutputMode -eq 'full') { $result | Add-Member -NotePropertyName package_data -NotePropertyValue (Read-JsonFile -Path $dataFull) }
        Write-Output ($result | ConvertTo-Json -Depth 30)
        exit 0
    }
    if ($Action -eq 'prepare-context') {
        if ([string]::IsNullOrWhiteSpace($Package)) { throw 'Package is required for prepare-context.' }
        if ($Package -notin @('scoring','stage1','stage2','stage3')) { throw 'prepare-context only supports scoring, stage1, stage2, or stage3.' }
        $outputFull = Get-FullPathInsideProject -Path $OutputPath
        Assert-RunLocalPath -RunManifestPath $loaded.Path -CandidatePath $outputFull
        $text = @(& $script:hostExecutable -NoProfile -ExecutionPolicy Bypass -File $script:contextPreparerPath -Stage $Package -RunPath (Get-RelativeProjectPath -FullPath $loaded.Path) -OutputPath (Get-RelativeProjectPath -FullPath $outputFull) -OutputMode $OutputMode) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "Context preparation failed: $text" }
        Write-Output $text
        exit 0
    }
    if ($Action -eq 'seal-package-section') {
        if ([string]::IsNullOrWhiteSpace($Package) -or $Package -notin @('scoring','stage1','stage2','stage3','gate_audit')) { throw 'A supported package is required for seal-package-section.' }
        if ([string]::IsNullOrWhiteSpace($SemanticDataPath)) { throw 'SemanticDataPath is required for seal-package-section.' }
        $dataFull = Get-PackageDataPathForRun -Run $run -RunManifestPath $loaded.Path
        $semanticFull = Get-FullPathInsideProject -Path $SemanticDataPath -MustExist
        $data = Read-JsonFile -Path $dataFull
        $section = $data.sections.$Package
        if ([string]$section.status -eq 'sealed') { throw "Package section is already sealed: $Package" }
        $semantic = Read-JsonFile -Path $semanticFull
        Assert-PackageSemanticShape -Semantic $semantic
        if ($Package -eq 'scoring' -and (Test-ObjectProperty $run 'execution_control') -and (Test-ObjectProperty $run.execution_control 'mechanical_contract_version')) {
            & node (Join-Path $PSScriptRoot 'ingest-score-check.mjs') --root $script:projectRoot --semantic $semanticFull | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Deterministic scoring arithmetic failed.' }
        }
        if ($Package -in @('stage2','stage3')) {
            & node (Join-Path $PSScriptRoot 'wiki-consumption.mjs') check --root $script:projectRoot --run $loaded.Path --semantic $semanticFull --stage $Package | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Wiki consumption traceability failed before sealing.' }
        }
        if ($Package -eq 'stage3') {
            $contractResult = & node (Join-Path $PSScriptRoot 'ingest-runtime-contract.mjs') stage3 --semantic $semanticFull
            if ($LASTEXITCODE -ne 0) { throw 'Stage3 row contract failed before sealing.' }
        }
        if ($Package -in @('stage1', 'stage3')) { Assert-WriterStageCompletion -Run $run -Stage $Package -SemanticDataPath $SemanticDataPath }
        if ($Package -eq 'gate_audit') { Assert-GateAuditSemanticBoundary -Semantic $semantic }
        $derived = [pscustomobject][ordered]@{
            batch_id = [string]$run.batch_id
            run_status = [string]$run.status
            item_count = @($run.items).Count
            artifact_count = @($run.artifacts).Count
            content_audit_count = @($run.content_audits).Count
            required_backtest_anchors = @($run.counts.required_backtest_anchors)
            generated_at = [DateTime]::UtcNow.ToString('o')
        }
        if ([int]$run.schema_version -ge 7) {
            if ($Package -eq 'scoring') {
                if (@($semantic.rows).Count -ne @($run.items).Count) { throw 'Scoring must present every input exactly once, including skipped items.' }
                foreach ($item in @($run.items)) { if (@($semantic.rows | Where-Object { [string]$_.source -eq [string]$item }).Count -ne 1) { throw 'Scoring rows do not match exact run inputs.' } }
            }
            if ($Package -eq 'stage1') { foreach ($row in @($semantic.rows)) { if (-not (Test-ObjectProperty $row 'content_summary') -or [string]::IsNullOrWhiteSpace([string]$row.content_summary)) { throw 'Stage1 rows require content_summary for actual raw review.' } } }
            if ($Package -eq 'stage3' -and (-not (Test-ObjectProperty $semantic 'splits') -or $semantic.splits -isnot [System.Collections.IEnumerable] -or $semantic.splits -is [string])) { throw 'Stage3 requires explicit splits array (empty when no split).' }
            $dependencies = @(Invoke-ContentReview -Operation snapshot -Manifest $loaded.Path -Stage $Package -Semantic $semanticFull)
            $derived | Add-Member -NotePropertyName dependencies -NotePropertyValue $dependencies
        }
        $payload = [pscustomobject][ordered]@{ semantic = $semantic; derived = $derived }
        $section.semantic = $semantic
        $section.derived = $derived
        $section.section_sha256 = Get-ObjectSha256 -Value $payload
        $section.status = 'sealed'
        Write-JsonFile -Path $dataFull -Value $data
        $result = [pscustomobject][ordered]@{ status = 'sealed'; path = Get-RelativeProjectPath -FullPath $dataFull; sha256 = Get-Sha256 -Path $dataFull; section_sha256 = [string]$section.section_sha256; next_action = 'render-package' }
        Write-Output ($result | ConvertTo-Json -Depth 20)
        exit 0
    }
    if ($Action -eq 'render-package') {
        if ([string]::IsNullOrWhiteSpace($Package) -or $Package -notin @('scoring','stage1','stage2','stage3','gate_audit')) { throw 'A supported package is required for render-package.' }
        $dataFull = Get-PackageDataPathForRun -Run $run -RunManifestPath $loaded.Path
        $outputFull = Get-FullPathInsideProject -Path $OutputPath
        Assert-RunLocalPath -RunManifestPath $loaded.Path -CandidatePath $outputFull
        $rendered = Invoke-DeterministicRenderer -Kind $Package -RunManifestPath $loaded.Path -PackageDataFull $dataFull -TargetFull $outputFull
        Write-Output ($rendered | ConvertTo-Json -Depth 20)
        exit 0
    }
    if ($Action -eq 'render-stage1-audit-summary') {
        Write-Output (Get-Stage1AuditSummary -Run $run -RunManifestPath $loaded.Path)
        exit 0
    }

    if ($Action -eq 'prepare-semantic-review') {
        if (-not (Test-SemanticReviewRun -Run $run)) { throw 'prepare-semantic-review requires a schema v5 automatic run.' }
        if ((Get-SemanticReviewRunMode -Run $run) -eq 'disabled') { throw 'Optional semantic review is disabled; do not dispatch a reviewer.' }
        Assert-SemanticReviewStage -Stage $SemanticReviewStage
        $slot = Get-SemanticReviewSlot -Run $run -Stage $SemanticReviewStage
        if ($null -ne $slot.pending) { throw "Semantic review already awaits a receipt: $SemanticReviewStage" }
        switch ($SemanticReviewStage) {
            'scoring' {
                # Shadow reviews are advisory and may need a late refresh after a
                # downstream evidence repair (for example raw-list/Wiki drift
                # discovered while closing Stage 3). Keep enforced runs on the
                # normal running_scoring gate; a stale shadow slot may refresh
                # without reopening the primary stage state.
                $scoringStaleRefresh = $false
                $scoringRevisionRefresh = $false
                if ((Get-SemanticReviewRunMode -Run $run) -eq 'shadow' -and @('stage1_committed', 'stage2_planned', 'stage3_completed', 'awaiting_final_review') -contains $run.status) {
                    if ($null -ne $slot.active) {
                        $scoringStatus = Get-SemanticReviewStatus -Run $run -RunManifestPath $loaded.Path -Stage 'scoring'
                        $scoringStaleRefresh = $scoringStatus -eq 'stale'
                        $scoringRevisionRefresh = $scoringStatus -eq 'revise'
                    } else {
                        $lastScoring = @($slot.history | ForEach-Object { $_.record }) | Select-Object -Last 1
                        $scoringRevisionRefresh = $null -ne $lastScoring -and [string]$lastScoring.verdict -eq 'revise'
                    }
                }
                if ($run.status -ne 'running_scoring' -and -not $scoringStaleRefresh -and -not $scoringRevisionRefresh) { throw "Scoring semantic review requires running_scoring, found $($run.status)" }
                [void](Assert-RecordedPackage -Run $run -Kind 'scoring')
            }
            'stage1' {
                # Shadow reviews are advisory and may be refreshed after a later-stage
                # package caused evidence drift. Keep enforced runs on the normal
                # running_scoring gate so a post-check rewrite still requires recovery.
                $stage1StaleRefresh = $false
                $stage1RevisionRefresh = $false
                if (@('stage2_planned', 'stage3_completed', 'awaiting_final_review') -contains $run.status -and (Get-SemanticReviewRunMode -Run $run) -eq 'shadow' -and $null -ne $slot.active) {
                    $stage1Status = Get-SemanticReviewStatus -Run $run -RunManifestPath $loaded.Path -Stage 'stage1'
                    $stage1StaleRefresh = $stage1Status -eq 'stale'
                    $stage1RevisionRefresh = $stage1Status -eq 'revise'
                }
                if ($run.status -ne $(if ([int]$run.schema_version -ge 7 -and (Get-ReviewPolicy -Run $run) -eq 'interactive') { 'scoring_approved' } else { 'running_scoring' }) -and -not $stage1StaleRefresh -and -not $stage1RevisionRefresh) { throw "Stage 1 semantic review requires running_scoring, found $($run.status)" }
                [void](Assert-RecordedPackage -Run $run -Kind 'stage1')
                Assert-ArtifactCoverage -Run $run
                Assert-ContentAuditCoverage -Run $run -RunManifestPath $loaded.Path
            }
            'stage2' {
                # A shadow Stage 2 receipt can likewise become stale when raw
                # evidence or Wiki navigation is repaired after planning. Allow
                # only an active=stale refresh; enforced runs still require the
                # original stage1_committed gate and formal recovery.
                $stage2StaleRefresh = $false
                $stage2RevisionRefresh = $false
                if ((Get-SemanticReviewRunMode -Run $run) -eq 'shadow' -and $null -ne $slot.active -and @('stage2_planned', 'stage3_completed', 'awaiting_final_review') -contains $run.status) {
                    $stage2Status = Get-SemanticReviewStatus -Run $run -RunManifestPath $loaded.Path -Stage 'stage2'
                    $stage2StaleRefresh = $stage2Status -eq 'stale'
                    $stage2RevisionRefresh = $stage2Status -eq 'revise'
                }
                if ($run.status -ne $(if ([int]$run.schema_version -ge 7 -and (Get-ReviewPolicy -Run $run) -eq 'interactive') { 'stage1_approved' } else { 'stage1_committed' }) -and -not $stage2StaleRefresh -and -not $stage2RevisionRefresh) { throw "Stage 2 semantic review requires stage1_committed, found $($run.status)" }
                [void](Assert-RecordedPackage -Run $run -Kind 'stage2')
            }
            'stage3' {
                $stage3StaleRefresh = $false
                $stage3RevisionRefresh = $false
                if ((Get-SemanticReviewRunMode -Run $run) -eq 'shadow' -and $null -ne $slot.active -and @('stage3_completed', 'awaiting_final_review') -contains $run.status) {
                    $stage3Status = Get-SemanticReviewStatus -Run $run -RunManifestPath $loaded.Path -Stage 'stage3'
                    $stage3StaleRefresh = $stage3Status -eq 'stale'
                    $stage3RevisionRefresh = $stage3Status -eq 'revise'
                }
                if ($run.status -ne 'stage2_planned' -and -not $stage3StaleRefresh -and -not $stage3RevisionRefresh) { throw "Stage 3 semantic review requires stage2_planned, found $($run.status)" }
                foreach ($kind in @('stage2', 'stage3', 'gate_audit', 'maintenance')) { [void](Assert-RecordedPackage -Run $run -Kind $kind) }
                Assert-GitRevision -Revision $Stage3Revision
            }
        }
        $priorStatusForRefresh = ''
        $oldFingerprint = ''
        if ($null -ne $slot.active) {
            $priorStatus = Get-SemanticReviewStatus -Run $run -RunManifestPath $loaded.Path -Stage $SemanticReviewStage
            $priorStatusForRefresh = $priorStatus
            # In enforced mode an escalate receipt fuses the run before this path is reachable.
            # In shadow mode it is advisory, so permit a new request only after evidence drift;
            # otherwise a stale escalation would permanently block the non-enforcing run.
            if ($priorStatus -eq 'valid_pass') { throw "Semantic review cannot be replaced while it is ${priorStatus}: $SemanticReviewStage" }
            $priorRequest = Read-JsonFile -Path (Get-FullPathInsideProject -Path ([string]$slot.active.request_path) -MustExist)
            $oldFingerprint = @($priorRequest.evidence | ForEach-Object { "$( [string]$_.path )|$( [string]$_.sha256 )" } | Sort-Object) -join "`n"
            $historyReason = if ($priorStatus -eq 'stale') { 'evidence_drift' } else { 'revision_cycle' }
            Move-SemanticReviewActiveToHistory -Slot $slot -Reason $historyReason
        }
        $cycle = @($slot.history).Count + 1
        $runDirectory = Split-Path -Parent $loaded.Path
        $runSnapshotFull = ''
        if ($SemanticReviewStage -eq 'scoring' -and @($run.content_audits).Count -gt 0) {
            $runSnapshotFull = Join-Path $runDirectory ("semantic-reviews/scoring/run-snapshot-$cycle.json")
            $runSnapshot = [pscustomobject][ordered]@{
                schema_version = [int]$run.schema_version
                batch_id = [string]$run.batch_id
                review_policy = [string]$run.review_policy
                semantic_review_mode = [string]$run.semantic_review_mode
                producer_context_id = [string]$run.producer_context_id
                base_revision = [string]$run.base_revision
                items = @($run.items)
                counts = $run.counts
                packages = $run.packages
                commits = $run.commits
                artifacts = @($run.artifacts)
                content_audits = @($run.content_audits)
            }
            Write-JsonFile -Path $runSnapshotFull -Value $runSnapshot
        }
        $evidence = @(Get-SemanticReviewEvidence -Run $run -RunManifestPath $loaded.Path -Stage $SemanticReviewStage -Stage3Revision $Stage3Revision -CandidatesPath $SemanticReviewCandidatesPath -RunSnapshotPath $runSnapshotFull)
        if (-not [string]::IsNullOrWhiteSpace($priorStatusForRefresh)) {
            $newFingerprint = @($evidence | ForEach-Object { "$( [string]$_.path )|$( [string]$_.sha256 )" } | Sort-Object) -join "`n"
            if (@('revise', 'escalate') -contains $priorStatusForRefresh -and $oldFingerprint -eq $newFingerprint) { throw "Semantic $priorStatusForRefresh requires changed evidence before a new request: $SemanticReviewStage" }
        }
        $requestFull = Join-Path $runDirectory ("semantic-reviews/$SemanticReviewStage/request-$cycle.json")
        $request = [pscustomobject][ordered]@{
            schema_version = 1
            kind = 'semantic_review_request'
            batch_id = [string]$run.batch_id
            stage = $SemanticReviewStage
            cycle = $cycle
            producer_context_id = [string]$run.producer_context_id
            rubric_version = 'INGEST_SEMANTIC_REVIEW_V1'
            evidence = @($evidence)
        }
        Write-JsonFile -Path $requestFull -Value $request
        $slot.pending = [pscustomobject][ordered]@{ path = Get-RelativeProjectPath -FullPath $requestFull; sha256 = Get-Sha256 -Path $requestFull; cycle = $cycle }
        Save-Run -Path $loaded.Path -Run $run
        Write-Output ($request | ConvertTo-Json -Depth 30)
        exit 0
    }

    if ($Action -eq 'record-semantic-review') {
        if (-not (Test-SemanticReviewRun -Run $run)) { throw 'record-semantic-review requires a schema v5 automatic run.' }
        Assert-SemanticReviewStage -Stage $SemanticReviewStage
        $slot = Get-SemanticReviewSlot -Run $run -Stage $SemanticReviewStage
        if ($null -eq $slot.pending) { throw "No semantic review request awaits a receipt: $SemanticReviewStage" }
        if ([string]::IsNullOrWhiteSpace($SemanticReviewReceiptPath)) { throw 'SemanticReviewReceiptPath is required.' }
        $receiptFull = Get-FullPathInsideProject -Path $SemanticReviewReceiptPath -MustExist
        Assert-RunLocalPath -RunManifestPath $loaded.Path -CandidatePath $receiptFull
        $receipt = Read-JsonFile -Path $receiptFull
        Assert-SemanticReviewReceipt -Run $run -RunManifestPath $loaded.Path -Stage $SemanticReviewStage -Receipt $receipt -Pending $slot.pending
        $record = [pscustomobject][ordered]@{
            request_path = [string]$slot.pending.path
            request_sha256 = [string]$slot.pending.sha256
            receipt_path = Get-RelativeProjectPath -FullPath $receiptFull
            receipt_sha256 = Get-Sha256 -Path $receiptFull
            cycle = [int]$slot.pending.cycle
            verdict = [string]$receipt.verdict
            reviewer_context_id = [string]$receipt.reviewer_context_id
            reviewer_model = [string]$receipt.reviewer_model
            fresh_context = [bool]$receipt.fresh_context
            reviewed_at = [string]$receipt.reviewed_at
        }
        $slot.pending = $null
        $slot.active = $record
        $priorReviseCount = @($slot.history | Where-Object { [string]$_.record.verdict -eq 'revise' }).Count
        $mustFuse = (Test-SemanticReviewGateEnabled -Run $run) -and ([string]$record.verdict -eq 'escalate' -or ([string]$record.verdict -eq 'revise' -and $priorReviseCount -ge 1))
        if ($mustFuse) {
            $run.status = 'fused'
            $reason = if ([string]$record.verdict -eq 'escalate') { "semantic review escalated: $SemanticReviewStage" } else { "semantic review exceeded one automatic revision: $SemanticReviewStage" }
            $run | Add-Member -NotePropertyName fused_reason -NotePropertyValue $reason -Force
            $run.final_review.path = $null; $run.final_review.sha256 = $null; $run.final_review.approved_sha256 = $null
            $state = Read-JsonFile -Path $script:statePath
            $state.status = 'fused'; $state.stage = 'fused'
            Write-JsonFile -Path $script:statePath -Value $state
        }
        Save-Run -Path $loaded.Path -Run $run
        Write-Output ($record | ConvertTo-Json -Depth 20)
        exit 0
    }

    if ($Action -eq 'check-semantic-review') {
        if (-not (Test-SemanticReviewRun -Run $run)) { throw 'check-semantic-review requires a schema v5 automatic run.' }
        Assert-SemanticReviewStage -Stage $SemanticReviewStage
        Write-Output ([pscustomobject][ordered]@{ stage = $SemanticReviewStage; status = Get-SemanticReviewStatus -Run $run -RunManifestPath $loaded.Path -Stage $SemanticReviewStage } | ConvertTo-Json)
        exit 0
    }

    if ($Action -eq 'merge-pending') {
        if ((Get-ReviewPolicy -Run $run) -ne 'deferred') { throw 'merge-pending is only valid for review_policy=deferred.' }
        if ($run.status -ne 'running_scoring') { throw "merge-pending requires running_scoring before Stage 1, found $($run.status)" }
        $additional = @(Split-ControlList -Value $Items)
        if ($additional.Count -lt 1) { throw 'merge-pending requires at least one additional item.' }
        Assert-CanonicalClippingItems -Values $additional -Context 'Merged item'
        $combined = @($run.items + $additional)
        if (@($combined | Select-Object -Unique).Count -ne $combined.Count) { throw 'merge-pending items must be unique across the combined batch.' }
        if ($combined.Count -gt 6) { throw "merge-pending exceeds the automatic merged-batch cap: $($combined.Count) > 6" }
        if (@($run.artifacts).Count -gt 0 -or @($run.content_audits).Count -gt 0 -or @($run.backtests).Count -gt 0 -or $null -ne $run.packages.scoring -or $null -ne $run.packages.stage1 -or $null -ne $run.packages.stage2 -or $null -ne $run.packages.stage3 -or $null -ne $run.packages.gate_audit -or $null -ne $run.packages.maintenance -or $null -ne $run.commits.stage1 -or $null -ne $run.commits.stage3) {
            throw 'merge-pending is only valid before evidence recording or a rollback checkpoint.'
        }
        $state = Read-JsonFile -Path $script:statePath
        if ($state.status -ne 'running' -or $state.stage -ne 'scoring' -or [string]$state.batch_id -ne [string]$run.batch_id) { throw 'Automatic-review state does not match a pending scoring run.' }
        $labels = @(Split-ControlList -Value $BatchLabels)
        if ($labels.Count -eq 0) { throw 'merge-pending requires the merged batch labels.' }
        $run.items = @($combined)
        $run | Add-Member -NotePropertyName batch_labels -NotePropertyValue @($labels | Select-Object -Unique) -Force
        $run | Add-Member -NotePropertyName merged_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
        Save-Run -Path $loaded.Path -Run $run
        $state.items = @($combined)
        $state | Add-Member -NotePropertyName batch_labels -NotePropertyValue @($labels | Select-Object -Unique) -Force
        Write-JsonFile -Path $script:statePath -Value $state
        Write-RunOutcome -Run $run -RunManifestPath $loaded.Path -NextAction 'seal scoring package for the expanded batch'
        exit 0
    }

    if ($Action -eq 'fuse') {
        if ($run.status -eq 'completed') { throw 'A completed run cannot be fused.' }
        if ([string]::IsNullOrWhiteSpace($Reason)) { throw 'Reason is required when fusing a run.' }
        $run.status = 'fused'
        $run | Add-Member -NotePropertyName fused_reason -NotePropertyValue $Reason -Force
        if ($null -ne $run.final_review) {
            $run.final_review.path = $null
            $run.final_review.sha256 = $null
            $run.final_review.approved_sha256 = $null
        }
        Save-Run -Path $loaded.Path -Run $run
        if ((Get-ReviewPolicy -Run $run) -eq 'deferred') {
            $state = Read-JsonFile -Path $script:statePath
            $state.status = 'fused'; $state.stage = 'fused'
            Write-JsonFile -Path $script:statePath -Value $state
        }
        Write-RunOutcome -Run $run -RunManifestPath $loaded.Path -NextAction 'repair the fused condition or abandon the run from its checkpoint'
        exit 0
    }

    if ($Action -eq 'abandon-fused') {
        if ($run.status -ne 'fused') { throw "abandon-fused requires fused, found $($run.status)" }
        if ((Get-ReviewPolicy -Run $run) -ne 'deferred') { throw 'abandon-fused is only valid for review_policy=deferred.' }
        if ([string]::IsNullOrWhiteSpace($Reason)) { throw 'Reason is required when abandoning a fused run.' }
        $hasEvidence = @($run.artifacts).Count -gt 0 -or @($run.content_audits).Count -gt 0 -or @($run.backtests).Count -gt 0 -or
            $null -ne $run.packages.scoring -or $null -ne $run.packages.stage1 -or $null -ne $run.packages.stage2 -or
            $null -ne $run.packages.stage3 -or $null -ne $run.packages.gate_audit -or $null -ne $run.packages.maintenance -or
            $null -ne $run.commits.stage1 -or $null -ne $run.commits.stage3
        if ($hasEvidence) { throw 'abandon-fused only permits a zero-evidence run; recover the run instead.' }
        $state = Read-JsonFile -Path $script:statePath
        if ($state.status -ne 'fused' -or [string]$state.batch_id -ne [string]$run.batch_id) { throw 'Automatic-review state does not match fused run.' }
        $now = [DateTime]::UtcNow.ToString('o')
        $run.status = 'abandoned'
        $run | Add-Member -NotePropertyName abandoned_reason -NotePropertyValue $Reason -Force
        $run | Add-Member -NotePropertyName abandoned_at -NotePropertyValue $now -Force
        Save-Run -Path $loaded.Path -Run $run
        $state.status = 'inactive'; $state.stage = 'none'; $state.batch_id = $null; $state.items = @(); $state.started_at = $null
        Write-JsonFile -Path $script:statePath -Value $state
        Write-Output ($run | ConvertTo-Json -Depth 30)
        exit 0
    }

    if ($Action -eq 'record-depth-remediation') {
        if ((Get-ReviewPolicy -Run $run) -ne 'deferred') { throw 'record-depth-remediation is only valid for review_policy=deferred.' }
        if (@('fused', 'running_scoring') -notcontains $run.status) { throw "record-depth-remediation requires fused or running_scoring, found $($run.status)" }
        if ([string]::IsNullOrWhiteSpace($EvidencePath)) { throw 'EvidencePath is required for depth remediation.' }
        $run | Add-Member -NotePropertyName depth_remediation -NotePropertyValue (Get-DepthRemediationResult -Run $run -RunManifestPath $loaded.Path -Path $EvidencePath) -Force
        Save-Run -Path $loaded.Path -Run $run
        Write-Output ($run.depth_remediation | ConvertTo-Json -Depth 10)
        exit 0
    }

    if ($Action -eq 'recover-fused') {
        if ($run.status -ne 'fused') { throw "recover-fused requires fused, found $($run.status)" }
        if ($BeforeCount -lt 0 -or $AfterCount -lt $BeforeCount) { throw "Invalid recovery count range: $BeforeCount -> $AfterCount" }
        $physicalBefore = Get-RawCountAtRevision -Revision ([string]$run.base_revision)
        $physicalAfter = Get-CurrentRawCount
        if ($BeforeCount -ne $physicalBefore -or $AfterCount -ne $physicalAfter) {
            throw "Recovery counts do not match physical evidence: supplied=$BeforeCount->$AfterCount, physical=$physicalBefore->$physicalAfter"
        }
        $run.counts.before = $BeforeCount; $run.counts.after = $null; $run.counts.required_backtest_anchors = @()
        $hasStage1Checkpoint = ($null -ne $run.packages.stage1 -and $null -ne $run.commits.stage1)
        $restartStage1 = $false
        if ((Test-ObjectProperty -Value $run -Name 'depth_remediation') -and $null -ne $run.depth_remediation) {
            $record = Get-DepthRemediationResult -Run $run -RunManifestPath $loaded.Path -Path ([string]$run.depth_remediation.path)
            if ([string]$record.sha256 -ne [string]$run.depth_remediation.sha256) { throw 'Depth-remediation evidence hash drifted.' }
            $restartStage1 = [bool]$record.requires_rewrite
        }
        if ($restartStage1) {
            if (Test-ObjectProperty -Value $run -Name 'execution_control') {
                Move-RawReviewsToHistory -Run $run -Reason 'fused recovery restarted Stage1'
                Move-WriterStageToHistory -Run $run -Stage 'stage1' -Reason 'fused recovery restarted Stage1'
                Move-WriterStageToHistory -Run $run -Stage 'stage3' -Reason 'fused recovery restarted Stage1'
            }
            foreach ($kind in @('stage1', 'stage2', 'stage3', 'gate_audit', 'maintenance')) { $run.packages.$kind = $null }
            $run.commits.stage1 = $null; $run.commits.stage3 = $null; $run.backtests = @()
            $run.status = 'running_scoring'
        } else {
            $run.status = if ($hasStage1Checkpoint) { 'stage2_planned' } else { 'running_scoring' }
        }
        if (Test-ObjectProperty -Value $run -Name 'fused_reason') { $run.PSObject.Properties.Remove('fused_reason') }
        Save-Run -Path $loaded.Path -Run $run
        $state = Read-JsonFile -Path $script:statePath
        if ($state.status -ne 'fused' -or [string]$state.batch_id -ne [string]$run.batch_id) { throw 'Automatic-review state does not match fused run.' }
        $state.status = 'running'; $state.stage = if ($restartStage1 -or -not $hasStage1Checkpoint) { 'scoring' } else { 'stage2_planned' }
        Write-JsonFile -Path $script:statePath -Value $state
        Write-Output ($run | ConvertTo-Json -Depth 30)
        exit 0
    }

    if ($Action -eq 'rebase-stage1-baseline') {
        if ((Get-ReviewPolicy -Run $run) -ne 'deferred') { throw 'rebase-stage1-baseline is only valid for review_policy=deferred.' }
        if ($run.status -ne 'running_scoring') { throw "rebase-stage1-baseline requires running_scoring, found $($run.status)" }
        if ([string]::IsNullOrWhiteSpace($BaselineRevision)) { throw 'BaselineRevision is required for Stage 1 baseline rebase.' }
        Assert-GitRevision -Revision $BaselineRevision
        if ($null -ne $run.commits.stage1 -or $null -ne $run.commits.stage3) { throw 'Stage 1 baseline may not be rebased after a checkpoint commit.' }
        foreach ($kind in @('stage2', 'stage3', 'gate_audit', 'maintenance')) {
            if ($null -ne $run.packages.$kind) { throw "Stage 1 baseline may not be rebased after recording $kind evidence." }
        }
        $concurrentHeadDrift = ([string]$Reason -eq 'concurrent_head_drift')
        if (-not $concurrentHeadDrift) {
            if (-not (Test-ObjectProperty -Value $run -Name 'depth_remediation') -or $null -eq $run.depth_remediation) { throw 'Stage 1 baseline rebase requires recorded depth-remediation evidence.' }
            $record = Get-DepthRemediationResult -Run $run -RunManifestPath $loaded.Path -Path ([string]$run.depth_remediation.path)
            if ([string]$record.sha256 -ne [string]$run.depth_remediation.sha256) { throw 'Depth-remediation evidence hash drifted.' }
            if ([bool]$record.requires_rewrite) { throw 'Stage 1 baseline may only be rebased after all depth rewrites pass.' }
        }
        $baselineCount = Get-RawCountAtRevision -Revision $BaselineRevision
        $currentCount = Get-CurrentRawCount
        $concurrentPaths = @()
        if ($concurrentHeadDrift) {
            if ($baselineCount -ne [int]$run.counts.before) { throw "Concurrent baseline raw count must match the run baseline: expected=$($run.counts.before), actual=$baselineCount" }
            $ingestedRawCount = @($run.artifacts | Where-Object { [string]$_.kind -eq 'raw' -and [string]$_.disposition -eq 'ingested' }).Count
            if ($currentCount -ne ($baselineCount + $ingestedRawCount)) { throw "Concurrent baseline raw count does not reconcile with ingested artifacts: baseline=$baselineCount, ingested=$ingestedRawCount, current=$currentCount" }
            $concurrentPaths = @(Get-ChangedPaths -From ([string]$run.base_revision) -To $BaselineRevision)
            if ($concurrentPaths.Count -eq 0) { throw 'Concurrent baseline rebase requires observable head-drift paths.' }
        } elseif ($baselineCount -ne $currentCount) {
            throw "Rebased baseline raw count must match current raw count: baseline=$baselineCount, current=$currentCount"
        }
        $previousBase = [string]$run.base_revision
        $run.base_revision = $BaselineRevision.ToLowerInvariant()
        $run.counts.before = $baselineCount; $run.counts.after = $null; $run.counts.required_backtest_anchors = @()
        $run.packages.stage1 = $null
        $run.commits.stage1 = $null; $run.commits.stage3 = $null; $run.backtests = @()
        $run | Add-Member -NotePropertyName stage1_baseline_recovery -NotePropertyValue ([pscustomobject][ordered]@{
            previous_base_revision = $previousBase
            rebased_base_revision = $run.base_revision
            raw_count = $baselineCount
            reason = if ($concurrentHeadDrift) { 'concurrent_head_drift' } else { 'depth_remediation' }
            concurrent_paths = @($concurrentPaths)
            rebased_at = [DateTime]::UtcNow.ToString('o')
        }) -Force
        Save-Run -Path $loaded.Path -Run $run
        $state = Read-JsonFile -Path $script:statePath
        if ($state.status -ne 'running' -or [string]$state.batch_id -ne [string]$run.batch_id) { throw 'Automatic-review state does not match running remediation run.' }
        $state.stage = 'scoring'
        Write-JsonFile -Path $script:statePath -Value $state
        Write-Output ($run | ConvertTo-Json -Depth 30)
        exit 0
    }

    if ($Action -eq 'record-package') {
        if ([string]::IsNullOrWhiteSpace($Package)) { throw 'Package is required.' }
        if ([int]$run.schema_version -ge 7 -and $Package -ne 'maintenance') {
            [void](Invoke-ContentReview -Operation verify-section -Manifest $loaded.Path -Stage $Package -AfterWriting:($run.status -in @('stage2_planned','stage3_completed','awaiting_final_review','completed')))
        }
        $full = Get-FullPathInsideProject -Path $PackagePath -MustExist
        if ([int]$run.schema_version -ge 2) { Assert-RunLocalPath -RunManifestPath $loaded.Path -CandidatePath $full }
        if ((Get-ReviewPolicy -Run $run) -eq 'interactive') {
            $requiredStatus = switch ($Package) {
                'scoring' { 'running_scoring' }
                'stage1' { 'scoring_approved' }
                'stage2' { 'stage1_approved' }
                default { 'stage2_planned' }
            }
            if ($run.status -ne $requiredStatus) { throw "$Package package requires $requiredStatus, found $($run.status)" }
        }
        if ($Package -eq 'maintenance') {
            $receipt = Read-JsonFile -Path $full
            if ($receipt.status -ne 'passed') { throw 'Maintenance receipt must be passed before recording.' }
        } else {
            if ([int]$run.schema_version -ge 6 -and $Package -in @('scoring','stage1','stage2','stage3','gate_audit')) {
                $dataFull = Get-PackageDataPathForRun -Run $run -RunManifestPath $loaded.Path
                $renderFull = Join-Path (Split-Path -Parent $full) ('.render-verify-' + [guid]::NewGuid().ToString('N') + '.md')
                try {
                    [void](Invoke-DeterministicRenderer -Kind $Package -RunManifestPath $loaded.Path -PackageDataFull $dataFull -TargetFull $renderFull)
                    $actualBytes = [IO.File]::ReadAllBytes($full)
                    $expectedBytes = [IO.File]::ReadAllBytes($renderFull)
                    if ($actualBytes.Length -ne $expectedBytes.Length -or [Convert]::ToBase64String($actualBytes) -ne [Convert]::ToBase64String($expectedBytes)) {
                        throw "Deterministic package differs from renderer output: $Package (actual=$(Get-Sha256 -Path $full), expected=$(Get-Sha256 -Path $renderFull))"
                    }
                } finally {
                    if (Test-Path -LiteralPath $renderFull) { Remove-Item -LiteralPath $renderFull -Force }
                }
            }
            $packageText = Get-Content -Raw -Encoding UTF8 -LiteralPath $full
            if ([int]$run.schema_version -ge 6 -and $Package -in @('scoring','stage1','stage2','stage3','gate_audit')) {
                if ($packageText -notmatch '<!-- ingest-package-renderer:v[12] package:') { throw "Deterministic package marker is missing: $Package" }
            } else {
                Assert-PackageMarkers -Kind $Package -Text $packageText
                if ($Package -eq 'stage1') {
                    Assert-Stage1AuditSummary -Run $run -RunManifestPath $loaded.Path -Text $packageText
                }
            }
        }
        $run.packages.$Package = [pscustomobject][ordered]@{ path = Get-RelativeProjectPath -FullPath $full; sha256 = Get-Sha256 -Path $full }
        Save-Run -Path $loaded.Path -Run $run
        Write-Output ($run.packages.$Package | ConvertTo-Json -Depth 10)
        exit 0
    }

    if ($Action -eq 'record-artifact') {
        if ([int]$run.schema_version -lt 2) { throw 'Artifact recording requires run schema_version 2.' }
        if ([string]::IsNullOrWhiteSpace($ArtifactKind) -or [string]::IsNullOrWhiteSpace($Disposition)) { throw 'ArtifactKind and Disposition are required.' }
        if ($ArtifactKind -eq 'raw' -and $Disposition -ne 'ingested') { throw 'A raw artifact must have disposition=ingested.' }
        $resolvedInputItem = $InputItem
        if ($ArtifactKind -eq 'input') {
            if ($InputItemIndex -ge 0) {
                if (-not [string]::IsNullOrWhiteSpace($InputItem)) { throw 'InputItem and InputItemIndex are mutually exclusive.' }
                if ($InputItemIndex -ge @($run.items).Count) { throw "InputItemIndex is outside the run item range: $InputItemIndex" }
                $resolvedInputItem = [string]$run.items[$InputItemIndex]
            }
            if ([string]::IsNullOrWhiteSpace($resolvedInputItem)) { throw 'InputItem or InputItemIndex is required for an input artifact.' }
            if (@($run.items | Where-Object { [string]$_ -eq $resolvedInputItem }).Count -ne 1) { throw "Input item does not uniquely match a run item: $resolvedInputItem" }
            if ([string]::IsNullOrWhiteSpace($ArtifactPath)) { $ArtifactPath = $resolvedInputItem }
        } elseif (-not [string]::IsNullOrWhiteSpace($InputItem) -or $InputItemIndex -ge 0) {
            throw 'InputItem and InputItemIndex are only valid for an input artifact.'
        }
        $full = Get-FullPathInsideProject -Path $ArtifactPath -MustExist
        $relative = Get-RelativeProjectPath -FullPath $full
        if ($ArtifactKind -eq 'input' -and $relative.StartsWith('Clippings/', [StringComparison]::OrdinalIgnoreCase) -and -not (Test-CanonicalClippingPath -Path $relative)) {
            throw "Input artifact clipping path must use Clippings/YYYYMMDD-*.md: $relative"
        }
        if ($ArtifactKind -eq 'raw') {
            Assert-RawArtifactClippings -Path $full
            Assert-NoRawSourceIdentityCollision -CandidatePath $full
        }
        $remaining = @($run.artifacts | Where-Object {
            $samePath = [string]$_.path -eq $relative
            $sameInput = $ArtifactKind -eq 'input' -and (Test-ObjectProperty -Value $_ -Name 'input_item') -and [string]$_.input_item -eq $resolvedInputItem
            -not ($samePath -or $sameInput)
        })
        $run.artifacts = @($remaining + [pscustomobject][ordered]@{ path = $relative; kind = $ArtifactKind; disposition = $Disposition; input_item = $(if ($ArtifactKind -eq 'input') { $resolvedInputItem } else { $null }) })
        Save-Run -Path $loaded.Path -Run $run
        Write-Output (($run.artifacts | Where-Object { [string]$_.path -eq $relative }) | ConvertTo-Json -Depth 10)
        exit 0
    }

    if ($Action -eq 'record-content-audit') {
        if ([int]$run.schema_version -lt 3) { throw 'Content-audit recording requires run schema_version 3.' }
        $lateContentAuditRefresh = $false
        if (@('stage3_completed', 'awaiting_final_review') -contains [string]$run.status -and (Get-SemanticReviewStatus -Run $run -RunManifestPath $loaded.Path -Stage 'stage1') -ne 'valid_pass') {
            $lateContentAuditRefresh = $true
        }
        if (-not $lateContentAuditRefresh -and @('running_scoring', 'scoring_approved', 'stage2_planned') -notcontains [string]$run.status) { throw "Content-audit recording is only valid before Stage 1 closes, while Stage 2 is planned, or during a late Stage 1 repair, found $($run.status)" }
        $record = Get-ContentAuditRecord -Run $run -RunManifestPath $loaded.Path -Path $AuditReceiptPath
        if (Test-ObjectProperty -Value $run -Name 'execution_control') {
            $legacyAttemptMatches = @($run.execution_control.raw_review_attempts | Where-Object {
                [string]$_.raw_path -eq [string]$record.raw_path -and
                [string]$_.status -eq 'passed' -and
                [string]$_.receipt_path -eq [string]$record.path -and
                [string]$_.receipt_sha256 -eq [string]$record.sha256
            })
            $coreAttemptMatches = if (Test-ObjectProperty -Value $run.execution_control -Name 'core_review_attempts') { @($run.execution_control.core_review_attempts | Where-Object {
                [string]$_.raw_path -eq [string]$record.raw_path -and
                [string]$_.status -eq 'passed' -and
                [string]$_.receipt_path -eq [string]$record.path -and
                [string]$_.receipt_sha256 -eq [string]$record.sha256
            }) } else { @() }
            if ((@($legacyAttemptMatches).Count + @($coreAttemptMatches).Count) -ne 1) {
                throw 'Schema8 content audit must come from exactly one passed prepare-raw-review/complete-raw-review attempt or complete-core-review attempt.'
            }
        }
        $remaining = @($run.content_audits | Where-Object {
            [string]$_.raw_path -ne [string]$record.raw_path -and [string]$_.path -ne [string]$record.path
        })
        $run.content_audits = @($remaining + $record)
        Save-Run -Path $loaded.Path -Run $run
        Write-Output ($record | ConvertTo-Json -Depth 10)
        exit 0
    }

    if ($Action -eq 'correct-stage1-duplicate') {
        if ((Get-ReviewPolicy -Run $run) -ne 'deferred') { throw 'correct-stage1-duplicate is only valid for review_policy=deferred.' }
        if ($run.status -ne 'stage1_committed') { throw "correct-stage1-duplicate requires stage1_committed, found $($run.status)" }
        if ([string]::IsNullOrWhiteSpace($InputItem) -or [string]::IsNullOrWhiteSpace($ArtifactPath) -or [string]::IsNullOrWhiteSpace($Reason)) {
            throw 'correct-stage1-duplicate requires InputItem, ArtifactPath and Reason.'
        }
        $rawFull = Get-FullPathInsideProject -Path $ArtifactPath -MustExist
        $rawRelative = Get-RelativeProjectPath -FullPath $rawFull
        $inputMatches = @($run.artifacts | Where-Object {
            [string]$_.kind -eq 'input' -and [string]$_.input_item -eq $InputItem -and [string]$_.disposition -eq 'ingested'
        })
        if ($inputMatches.Count -ne 1) { throw "Duplicate correction requires one ingested input artifact: $InputItem" }
        $rawMatches = @($run.artifacts | Where-Object {
            [string]$_.kind -eq 'raw' -and [string]$_.path -eq $rawRelative -and [string]$_.disposition -eq 'ingested'
        })
        if ($rawMatches.Count -ne 1) { throw "Duplicate correction requires one ingested raw artifact: $rawRelative" }
        $auditMatches = @($run.content_audits | Where-Object { [string]$_.raw_path -eq $rawRelative })
        if ($auditMatches.Count -ne 1) { throw "Duplicate correction requires one content audit: $rawRelative" }
        $auditReceipt = Read-JsonFile -Path (Get-FullPathInsideProject -Path ([string]$auditMatches[0].path) -MustExist)
        $inputPath = [string]$inputMatches[0].path
        $auditSources = @($auditReceipt.sources | ForEach-Object { [string]$_.source_path })
        if ($auditSources.Count -ne 1 -or $auditSources[0] -ne $inputPath) {
            throw 'Duplicate correction is only safe when the raw audit maps exactly one input artifact.'
        }
        $inputMatches[0].disposition = 'skipped'
        $run.artifacts = @($run.artifacts | Where-Object {
            -not ([string]$_.kind -eq 'raw' -and [string]$_.path -eq $rawRelative)
        })
        $run.content_audits = @($run.content_audits | Where-Object { [string]$_.raw_path -ne $rawRelative })
        if (Test-ObjectProperty -Value $run -Name 'execution_control') {
            Move-WriterStageToHistory -Run $run -Stage 'stage1' -Reason $Reason
            Move-WriterStageToHistory -Run $run -Stage 'stage3' -Reason $Reason
        }
        foreach ($kind in @('stage1', 'stage2', 'stage3', 'gate_audit', 'maintenance')) { $run.packages.$kind = $null }
        $run.commits.stage1 = $null
        $run.commits.stage3 = $null
        $run.backtests = @()
        $run.counts.after = $null
        $run.counts.required_backtest_anchors = @()
        $corrections = @()
        if (Test-ObjectProperty -Value $run -Name 'stage1_corrections') { $corrections = @($run.stage1_corrections) }
        $corrections += [pscustomobject][ordered]@{
            kind = 'late_duplicate'
            input_item = $InputItem
            input_path = $inputPath
            raw_path = $rawRelative
            reason = $Reason
            corrected_at = [DateTime]::UtcNow.ToString('o')
        }
        $run | Add-Member -NotePropertyName stage1_corrections -NotePropertyValue @($corrections) -Force
        $run.status = 'running_scoring'
        Save-Run -Path $loaded.Path -Run $run
        $state = Read-JsonFile -Path $script:statePath
        if ($state.status -ne 'running' -or [string]$state.batch_id -ne [string]$run.batch_id) {
            throw 'Automatic-review state does not match the Stage 1 duplicate correction.'
        }
        $state.stage = 'scoring'
        Write-JsonFile -Path $script:statePath -Value $state
        Write-Output ($run.stage1_corrections[-1] | ConvertTo-Json -Depth 10)
        exit 0
    }

    if ($Action -eq 'approve-gate') {
        if ((Get-ReviewPolicy -Run $run) -ne 'interactive') { throw 'approve-gate is only valid for review_policy=interactive.' }
        if ([string]::IsNullOrWhiteSpace($Gate)) { throw 'Gate is required.' }
        if ([int]$run.schema_version -ge 7 -and $Gate -eq 'stage3') { throw 'Schema 7 closes with check-stage3, render-final-review, verify-final-review and finish after final approval.' }
        $expectedStatus = switch ($Gate) {
            'scoring' { 'running_scoring' }
            'stage1' { 'scoring_approved' }
            'stage2' { 'stage1_approved' }
            'stage3' { 'stage2_planned' }
        }
        if ($run.status -ne $expectedStatus) { throw "$Gate approval requires $expectedStatus, found $($run.status)" }
        if ([int]$run.schema_version -ge 7 -and $Gate -eq 'stage2' -and $null -eq $run.commits.stage1) { throw 'Stage2 approval requires a verified Stage1 checkpoint.' }
        Assert-SemanticReviewPass -Run $run -RunManifestPath $loaded.Path -Stage $Gate
        $packageFull = Assert-RecordedPackage -Run $run -Kind $Gate
        $actual = Get-Sha256 -Path $packageFull
        if ([string]::IsNullOrWhiteSpace($ApprovedHash) -or $ApprovedHash.ToLowerInvariant() -ne $actual) { throw 'ApprovedHash must exactly match the gate package SHA-256.' }
        if ($Gate -eq 'stage3') {
            [void](Assert-RecordedPackage -Run $run -Kind 'maintenance')
            if ($null -eq $run.counts.after) { throw 'Backtests must be verified before Stage 3 approval.' }
            Complete-InteractiveRun -RunManifestPath $loaded.Path -Run $run -Hash $actual
        } else {
            if ($Gate -eq 'stage1') {
                Assert-ArtifactCoverage -Run $run
                Assert-ContentAuditCoverage -Run $run -RunManifestPath $loaded.Path
                if ([int]$run.schema_version -ge 6) { Assert-DeterministicStage1Package -Run $run -RunManifestPath $loaded.Path -PackagePath $packageFull } else { Assert-Stage1AuditSummary -Run $run -RunManifestPath $loaded.Path -Text (Get-Content -Raw -Encoding UTF8 -LiteralPath $packageFull) }
            }
            $run.approvals.$Gate = [pscustomobject][ordered]@{ sha256 = $actual; approved_at = [DateTime]::UtcNow.ToString('o') }
            $run.status = switch ($Gate) {
                'scoring' { 'scoring_approved' }
                'stage1' { 'stage1_approved' }
                'stage2' { 'stage2_planned' }
            }
            Save-Run -Path $loaded.Path -Run $run
        }
        Write-Output ($run | ConvertTo-Json -Depth 30)
        exit 0
    }

    if ($Action -eq 'record-backtest') {
        if ($Anchor -le 0 -or ($Anchor % $script:backtestAnchorInterval) -ne 0) { throw "Anchor must be a positive multiple of $($script:backtestAnchorInterval)." }
        $full = Get-FullPathInsideProject -Path $EvidencePath -MustExist
        if ([int]$run.schema_version -ge 2) { Assert-RunLocalPath -RunManifestPath $loaded.Path -CandidatePath $full }
        $receipt = Read-JsonFile -Path $full
        if ([int]$receipt.anchor -ne $Anchor) { throw 'Backtest receipt anchor does not match -Anchor.' }
        $candidateRecord = [pscustomobject][ordered]@{ anchor = $Anchor; path = Get-RelativeProjectPath -FullPath $full; sha256 = Get-Sha256 -Path $full }
        Assert-Backtests -Run ([pscustomobject][ordered]@{ schema_version = [int]$run.schema_version; backtests = @($candidateRecord) }) -Required @($Anchor)
        $remaining = @($run.backtests | Where-Object { [int]$_.anchor -ne $Anchor })
        $run.backtests = @($remaining + $candidateRecord)
        Save-Run -Path $loaded.Path -Run $run
        Write-Output (($run.backtests | Where-Object { [int]$_.anchor -eq $Anchor }) | ConvertTo-Json -Depth 10)
        exit 0
    }

    if ($Action -eq 'check-stage1') {
        $standardV7 = [int]$run.schema_version -ge 7 -and (Get-ReviewPolicy -Run $run) -eq 'interactive'
        if (-not $standardV7 -and (Get-ReviewPolicy -Run $run) -ne 'deferred') { throw 'check-stage1 is only valid for automatic or schema7 standard runs.' }
        $stage1Expected = if ($standardV7) { 'stage1_approved' } else { 'running_scoring' }
        if ($run.status -ne $stage1Expected) { throw "check-stage1 requires $stage1Expected, found $($run.status)" }
        Assert-WriterStageCompletion -Run $run -Stage 'stage1'
        [void](Assert-RecordedPackage -Run $run -Kind 'scoring')
        $stage1Package = Assert-RecordedPackage -Run $run -Kind 'stage1'
        Assert-ArtifactCoverage -Run $run
        $rawArtifacts = @($run.artifacts | Where-Object { [string]$_.kind -eq 'raw' -and [string]$_.disposition -eq 'ingested' })
        $rawPaths = @($rawArtifacts | ForEach-Object { Get-FullPathInsideProject -Path ([string]$_.path) -MustExist })
        Assert-RawArtifactDomains -Paths $rawPaths
        $styleChecker = Join-Path $PSScriptRoot 'check-raw-style.ps1'
        if (-not (Test-Path -LiteralPath $styleChecker -PathType Leaf)) { throw 'Raw-style checker is missing.' }
        if ($rawPaths.Count -gt 0) {
        $styleOutput = @(& $script:hostExecutable -NoProfile -ExecutionPolicy Bypass -File $styleChecker -Standard $(if ([int]$run.schema_version -ge 8) { 'v2' } else { 'v1' }) -Path ($rawPaths -join ',') ) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "Raw-style checker failed for Stage 1: $styleOutput" }
        }
        Assert-ContentAuditCoverage -Run $run -RunManifestPath $loaded.Path
        $stage1Text = Get-Content -Raw -Encoding UTF8 -LiteralPath $stage1Package
        if ([int]$run.schema_version -ge 6) {
            Assert-DeterministicStage1Package -Run $run -RunManifestPath $loaded.Path -PackagePath $stage1Package
        } else {
            Assert-Stage1AuditSummary -Run $run -RunManifestPath $loaded.Path -Text $stage1Text
            Assert-Stage1WritingSkeleton -Run $run -Text $stage1Text
        }
        Assert-SemanticReviewPass -Run $run -RunManifestPath $loaded.Path -Stage 'scoring'
        Assert-SemanticReviewPass -Run $run -RunManifestPath $loaded.Path -Stage 'stage1'
        Assert-GitRevision -Revision $Stage1Revision
        $allowed = @('raw-sources/', 'Clippings/', 'system/registry/skipped-sources.md', 'system/registry/clipping-path-migrations.json', 'system/registry/ingest-auto-review-state.json', 'system/maintenance/ingest-runs/', 'system/maintenance/checklists/ingest-control.ps1', 'system/maintenance/checklists/render-ingest-package.ps1')
        $stage1DiffBase = Get-Stage1DiffBaseline -Run $run -ManifestPath $loaded.Path
        foreach ($path in @(Get-ChangedPaths -From $stage1DiffBase -To $Stage1Revision)) {
            if (@($allowed | Where-Object { $path -eq $_.TrimEnd('/') -or $path.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }).Count -eq 0) {
                throw "Stage 1 checkpoint contains an out-of-scope path: $path"
            }
        }
        & git -C $script:projectRoot merge-base --is-ancestor $stage1DiffBase $Stage1Revision
        if ($LASTEXITCODE -ne 0) { throw 'Stage1 checkpoint is not descended from the run baseline.' }
        if ([int]$run.schema_version -ge 7) { [void](Invoke-ContentReview -Operation verify-checkpoint -Manifest $loaded.Path -Stage stage1 -Revision $Stage1Revision) }
        $run.commits.stage1 = $Stage1Revision.ToLowerInvariant(); $run.status = if ($standardV7) { 'stage1_approved' } else { 'stage1_committed' }
        Save-Run -Path $loaded.Path -Run $run
        $state = Read-JsonFile -Path $script:statePath
        if ((Get-ReviewPolicy -Run $run) -eq 'deferred') { $state.stage = 'stage1_committed'; Write-JsonFile -Path $script:statePath -Value $state }
        Write-RunOutcome -Run $run -RunManifestPath $loaded.Path -NextAction 'prepare stage2 context and seal stage2 package'
        exit 0
    }

    if ($Action -eq 'check-stage2') {
        if ((Get-ReviewPolicy -Run $run) -ne 'deferred') { throw 'check-stage2 is only valid for review_policy=deferred.' }
        if ($run.status -ne 'stage1_committed') { throw "check-stage2 requires stage1_committed, found $($run.status)" }
        [void](Assert-RecordedPackage -Run $run -Kind 'stage2')
        Assert-SemanticReviewPass -Run $run -RunManifestPath $loaded.Path -Stage 'stage2'
        $run.status = 'stage2_planned'
        Save-Run -Path $loaded.Path -Run $run
        $state = Read-JsonFile -Path $script:statePath
        $state.stage = 'stage2_planned'
        Write-JsonFile -Path $script:statePath -Value $state
        Write-RunOutcome -Run $run -RunManifestPath $loaded.Path -NextAction 'verify backtests, then prepare stage3 context'
        exit 0
    }

    if ($Action -eq 'check-backtests') {
        if ($run.status -ne 'stage2_planned') { throw "check-backtests requires stage2_planned, found $($run.status)" }
        $required = @(Get-RequiredAnchors -Before ([int]$run.counts.before) -After $AfterCount)
        Assert-Backtests -Run $run -Required $required
        $run.counts.after = $AfterCount; $run.counts.required_backtest_anchors = @($required)
        Save-Run -Path $loaded.Path -Run $run
        Write-Output ([pscustomobject][ordered]@{ status = 'backtests_verified'; required_backtest_anchors = @($required) } | ConvertTo-Json -Depth 10)
        exit 0
    }

    if ($Action -eq 'check-stage3') {
        if ([int]$run.schema_version -lt 7 -and (Get-ReviewPolicy -Run $run) -ne 'deferred') { throw 'check-stage3 is only valid for review_policy=deferred on historical runs.' }
        if ($run.status -ne 'stage2_planned') { throw "check-stage3 requires stage2_planned, found $($run.status)" }
        Assert-WriterStageCompletion -Run $run -Stage 'stage3'
        foreach ($kind in @('stage3', 'gate_audit', 'maintenance')) { [void](Assert-RecordedPackage -Run $run -Kind $kind) }
        Assert-GitRevision -Revision $Stage3Revision
        if ((Test-ObjectProperty $run 'execution_control') -and (Test-ObjectProperty $run.execution_control 'mechanical_contract_version')) {
            & node (Join-Path $PSScriptRoot 'ingest-maintenance-scope.mjs') --root $script:projectRoot --receipt ([string]$run.packages.maintenance.path) --revision $Stage3Revision | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Final commit does not match maintenance coverage.' }
        }
        if ([int]$run.schema_version -ge 7) {
            foreach ($priorKind in @('scoring','stage1','stage2')) { [void](Assert-RecordedPackage -Run $run -Kind $priorKind) }
            & git -C $script:projectRoot merge-base --is-ancestor ([string]$run.commits.stage1) $Stage3Revision
            if ($LASTEXITCODE -ne 0) { throw 'Stage3 checkpoint is not descended from Stage1.' }
        }
        Assert-SemanticReviewPass -Run $run -RunManifestPath $loaded.Path -Stage 'stage3'
        if ($null -ne $run.counts.after -and [int]$run.counts.after -ne $AfterCount) { throw 'AfterCount differs from the pre-commit backtest check.' }
        $required = @(Get-RequiredAnchors -Before ([int]$run.counts.before) -After $AfterCount)
        Assert-Backtests -Run $run -Required $required
        $run.counts.after = $AfterCount; $run.counts.required_backtest_anchors = @($required)
        if ([int]$run.schema_version -ge 7) { [void](Invoke-ContentReview -Operation verify-checkpoint -Manifest $loaded.Path -Stage stage3 -Revision $Stage3Revision) }
        $run.commits.stage3 = $Stage3Revision.ToLowerInvariant(); $run.status = 'stage3_completed'
        Save-Run -Path $loaded.Path -Run $run
        $state = Read-JsonFile -Path $script:statePath
        if ((Get-ReviewPolicy -Run $run) -eq 'deferred') { $state.stage = 'stage3_completed'; Write-JsonFile -Path $script:statePath -Value $state }
        Write-RunOutcome -Run $run -RunManifestPath $loaded.Path -NextAction 'render and verify final review'
        exit 0
    }

    if ([int]$run.schema_version -ge 7 -and $Action -eq 'render-final-review') {
        foreach ($kind in @('scoring','stage1','stage2','stage3','gate_audit','maintenance')) { [void](Assert-RecordedPackage -Run $run -Kind $kind) }
        foreach ($stage in @('scoring','stage1','stage2','stage3')) { Assert-SemanticReviewPass -Run $run -RunManifestPath $loaded.Path -Stage $stage }
        $review = Invoke-ContentReview -Operation render -Manifest $loaded.Path -Target $OutputPath
        $run.final_review = [pscustomobject][ordered]@{ path=$review.path; sha256=$review.sha256; approved_sha256=$null; content_manifest=$review.content_manifest; content_manifest_sha256=$review.content_manifest_sha256 }
        $run.status = 'awaiting_final_review'
        Save-Run -Path $loaded.Path -Run $run
        if ((Get-ReviewPolicy -Run $run) -eq 'deferred') { $state=Read-JsonFile -Path $script:statePath; $state.status='awaiting_final_review'; $state.stage='stage3_completed'; Write-JsonFile -Path $script:statePath -Value $state }
        Write-Output ($run.final_review | ConvertTo-Json -Depth 10)
        exit 0
    }
    if ($Action -eq 'render-final-review') {
        if ((Get-ReviewPolicy -Run $run) -ne 'deferred') { throw 'render-final-review is only valid for review_policy=deferred.' }
        if (@('stage3_completed', 'awaiting_final_review') -notcontains $run.status) { throw "render-final-review requires stage3_completed or awaiting_final_review, found $($run.status)" }
        foreach ($stage in @('scoring', 'stage1', 'stage2', 'stage3')) { Assert-SemanticReviewPass -Run $run -RunManifestPath $loaded.Path -Stage $stage }
        $parts = @(
            [pscustomobject]@{ Heading = Convert-UnicodeLiteral '## 1. \u8bc4\u5206\u5305'; Kind = 'scoring'; Scope = Convert-UnicodeLiteral '\u8bc4\u5206\u7ed3\u8bba\u3001\u5386\u53f2\u5bf9\u8d26\u4e0e\u5206\u9879\u8bc1\u636e' },
            [pscustomobject]@{ Heading = Convert-UnicodeLiteral '## 2. \u9636\u6bb5\u4e00\u95ed\u5408\u5305'; Kind = 'stage1'; Scope = Convert-UnicodeLiteral '\u5168\u6587\u5ba1\u6838\u6536\u636e\u3001\u538b\u7f29\u5f02\u5e38\u3001\u98ce\u683c/\u6765\u6e90\u8fb9\u754c\u4e0e\u6279\u6ce8\u6458\u8981' },
            [pscustomobject]@{ Heading = Convert-UnicodeLiteral '## 3. \u9636\u6bb5\u4e8c Wiki \u5f52\u5c5e\u548c\u6279\u6ce8\u6d88\u8d39\u89c4\u5212'; Kind = 'stage2'; Scope = Convert-UnicodeLiteral 'Wiki \u5199\u5165\u89c4\u5212\u3001\u6279\u6ce8\u6d88\u8d39\u7ed3\u8bba\u4e0e\u4f8b\u5916' },
            [pscustomobject]@{ Heading = Convert-UnicodeLiteral '## 4. \u9636\u6bb5\u4e09\u95ed\u5408\u5305'; Kind = 'stage3'; Scope = Convert-UnicodeLiteral '\u7ef4\u62a4\u540c\u6b65\u3001\u56de\u6d4b\u4e0e\u9a8c\u8bc1\u7ed3\u8bba' },
            [pscustomobject]@{ Heading = Convert-UnicodeLiteral '## 5. \u81ea\u52a8\u95e8\u7981\u4e0e\u56de\u6eda\u5ba1\u8ba1'; Kind = 'gate_audit'; Scope = Convert-UnicodeLiteral '\u7194\u65ad\u68c0\u67e5\u3001\u95e8\u7981\u51b3\u7b56\u4e0e\u56de\u6eda\u70b9' }
        )
        $lines = New-Object System.Collections.Generic.List[string]
        [void]$lines.Add((Convert-UnicodeLiteral '# \u81ea\u52a8\u5ba1\u6838\u6a21\u5f0f \u00b7 \u6700\u7ec8\u5ba1\u6838\u5305'))
        [void]$lines.Add('')
        $boundaryPrefix = Convert-UnicodeLiteral '\u8fd0\u884c\u8fb9\u754c\uff1a'
        $itemStatus = Convert-UnicodeLiteral '\u7bc7 / \u72b6\u6001'
        [void]$lines.Add("$boundaryPrefix$($run.orchestration_evidence) / $($run.batch_id) / $(@($run.items).Count) $itemStatus awaiting_final_review")
        foreach ($part in $parts) {
            $full = Assert-RecordedPackage -Run $run -Kind $part.Kind
            $record = $run.packages.($part.Kind)
            $leaf = [IO.Path]::GetFileName([string]$record.path)
            [void]$lines.Add(''); [void]$lines.Add($part.Heading); [void]$lines.Add('')
            [void]$lines.Add(('- ' + (Convert-UnicodeLiteral '\u5b8c\u6574\u8bc1\u636e\uff1a') + '[' + $part.Kind + '](./' + $leaf + ')'))
            [void]$lines.Add(('- SHA-256: ' + [string]$record.sha256))
            [void]$lines.Add(('- ' + (Convert-UnicodeLiteral '\u590d\u6838\u8303\u56f4\uff1a') + $part.Scope))
            if ($part.Kind -in @('scoring', 'stage1', 'stage2', 'stage3') -and (Test-SemanticReviewRun -Run $run) -and $null -ne $run.semantic_reviews.($part.Kind).active) {
                $semantic = $run.semantic_reviews.($part.Kind).active
                $semanticLeaf = [IO.Path]::GetFileName([string]$semantic.receipt_path)
                $semanticLabel = if ((Get-SemanticReviewRunMode -Run $run) -eq 'shadow') { Convert-UnicodeLiteral '\u5f71\u5b50\u8bed\u4e49\u5ba1\u6838\uff1a' } else { Convert-UnicodeLiteral '\u65b0\u4e0a\u4e0b\u6587\u8bed\u4e49\u5ba1\u6838\uff1a' }
                [void]$lines.Add(('- ' + $semanticLabel + "$($semantic.verdict) / [receipt](./semantic-reviews/$($part.Kind)/$semanticLeaf)"))
                [void]$lines.Add(('- semantic SHA-256: ' + [string]$semantic.receipt_sha256))
            }
        }
        $closingInstruction = if ([int]$run.schema_version -ge 4 -and $null -ne $run.managed_task) {
            Convert-UnicodeLiteral '\u8bf7\u6700\u7ec8\u5ba1\u6838\uff1a\u901a\u8fc7\u540e\u7ed3\u675f\u81ea\u52a8\u6a21\u5f0f\u3001\u6267\u884c prepare-managed-close\uff0c\u518d\u7531 task-tool close\uff1b\u82e5\u9700\u4fee\u6539\uff0c\u5217\u51fa\u9879\u540e\u4fdd\u6301 awaiting_final_review\u3002'
        } else {
            Convert-UnicodeLiteral '\u8bf7\u6700\u7ec8\u5ba1\u6838\uff1a\u901a\u8fc7\u540e\u4ec5\u7ed3\u675f\u81ea\u52a8\u6a21\u5f0f\u5e76\u521b\u5efa\u9000\u51fa\u63d0\u4ea4\uff1b\u82e5\u9700\u4fee\u6539\uff0c\u5217\u51fa\u9879\u540e\u4fdd\u6301 awaiting_final_review\u3002'
        }
        [void]$lines.Add(''); [void]$lines.Add($closingInstruction)
        $outputFull = Get-FullPathInsideProject -Path $OutputPath
        if ([int]$run.schema_version -ge 2) { Assert-RunLocalPath -RunManifestPath $loaded.Path -CandidatePath $outputFull }
        Write-Utf8File -Path $outputFull -Text (($lines -join "`n") + "`n")
        $run.final_review.path = Get-RelativeProjectPath -FullPath $outputFull; $run.final_review.sha256 = Get-Sha256 -Path $outputFull
        $run.status = 'awaiting_final_review'
        Save-Run -Path $loaded.Path -Run $run
        $state = Read-JsonFile -Path $script:statePath
        $state.status = 'awaiting_final_review'; $state.stage = 'stage3_completed'
        Write-JsonFile -Path $script:statePath -Value $state
        Write-Output ($run.final_review | ConvertTo-Json -Depth 10)
        exit 0
    }

    if (@('verify-final-review', 'finish') -contains $Action) {
        if ($Action -eq 'finish' -and (Test-ObjectProperty -Value $run -Name 'execution_control') -and (Test-ObjectProperty -Value $run.execution_control -Name 'execution_profile') -and $run.execution_control.execution_profile -eq 'consolidated-v1' -and -not $ViaFinalizer) { throw 'Consolidated finish must use advance or finalize-ingest-stage3 -Phase Finish so timing and cost are recorded.' }
        if ([int]$run.schema_version -lt 7 -and (Get-ReviewPolicy -Run $run) -ne 'deferred') { throw "$Action is only valid for review_policy=deferred on historical runs." }
        if ($run.status -ne 'awaiting_final_review') { throw "$Action requires awaiting_final_review, found $($run.status)" }
        foreach ($kind in @('scoring', 'stage1', 'stage2', 'stage3', 'gate_audit', 'maintenance')) { [void](Assert-RecordedPackage -Run $run -Kind $kind) }
        foreach ($stage in @('scoring', 'stage1', 'stage2', 'stage3')) { Assert-SemanticReviewPass -Run $run -RunManifestPath $loaded.Path -Stage $stage }
        $reviewFull = Get-FullPathInsideProject -Path ([string]$run.final_review.path) -MustExist
        $actual = Get-Sha256 -Path $reviewFull
        if ($actual -ne [string]$run.final_review.sha256) { throw 'Final review package hash drifted.' }
        $reviewText = Get-Content -Raw -Encoding UTF8 -LiteralPath $reviewFull
        $reviewHeadings = @(
            (Convert-UnicodeLiteral '## 1. \u8bc4\u5206\u5305'),
            (Convert-UnicodeLiteral '## 2. \u9636\u6bb5\u4e00\u95ed\u5408\u5305'),
            (Convert-UnicodeLiteral '## 3. \u9636\u6bb5\u4e8c Wiki \u5f52\u5c5e\u548c\u6279\u6ce8\u6d88\u8d39\u89c4\u5212'),
            (Convert-UnicodeLiteral '## 4. \u9636\u6bb5\u4e09\u95ed\u5408\u5305'),
            (Convert-UnicodeLiteral '## 5. \u81ea\u52a8\u95e8\u7981\u4e0e\u56de\u6eda\u5ba1\u8ba1')
        )
        if ([int]$run.schema_version -ge 7) { [void](Invoke-ContentReview -Operation verify -Manifest $loaded.Path); $reviewHeadings = @() }
        foreach ($heading in $reviewHeadings) {
            if (-not $reviewText.Contains($heading)) { throw "Final review package missing heading: $heading" }
        }
        if ($Action -eq 'verify-final-review') { Write-Output ([pscustomobject]@{ status = 'verified'; sha256 = $actual } | ConvertTo-Json); exit 0 }
        if ([string]::IsNullOrWhiteSpace($ApprovedHash) -or $ApprovedHash.ToLowerInvariant() -ne $actual) { throw 'ApprovedHash must exactly match the verified final review SHA-256.' }
        Assert-ArtifactCoverage -Run $run
        $run.final_review.approved_sha256 = $actual; $run.status = 'completed'
        Save-Run -Path $loaded.Path -Run $run
        Update-ReviewIndex -RunManifestPath $loaded.Path -Run $run
        if ((Get-ReviewPolicy -Run $run) -eq 'deferred') {
        $state = Read-JsonFile -Path $script:statePath
        $state.status = 'inactive'; $state.stage = 'none'; $state.batch_id = $null; $state.items = @(); $state.started_at = $null
        $state.last_completed_batch = $run.batch_id; $state.last_completed_at = [DateTime]::UtcNow.ToString('o')
        Write-JsonFile -Path $script:statePath -Value $state
        }
        $nextAction = if ($null -ne $run.managed_task) { 'prepare managed close, then let task-tool create the single result commit' } else { 'run completed; create the direct exit commit' }
        Write-RunOutcome -Run $run -RunManifestPath $loaded.Path -NextAction $nextAction
        exit 0
    }

    if ($Action -eq 'prepare-managed-close') {
        if ($null -eq $managedRunContext) { throw 'prepare-managed-close requires a managed auto-ingest run.' }
        if ($run.status -ne 'completed') { throw "prepare-managed-close requires completed, found $($run.status)" }
        if ($null -eq $run.commits.stage1 -or $null -eq $run.commits.stage3) { throw 'Managed close requires both internal checkpoint revisions.' }
        $runDirectory = Split-Path -Parent $loaded.Path
        if ((Test-ObjectProperty -Value $run -Name 'managed_close') -and $null -ne $run.managed_close) {
            $head = (& git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -C $script:projectRoot rev-parse HEAD).Trim()
            if ($LASTEXITCODE -ne 0 -or $head -ne [string]$run.base_revision) { throw 'Prepared managed close no longer has task base at HEAD.' }
            foreach ($record in @($run.managed_close.patches)) {
                $full = Get-FullPathInsideProject -Path ([string]$record.path) -MustExist
                if ((Get-Sha256 -Path $full) -ne [string]$record.sha256) { throw "Managed checkpoint patch drifted: $($record.path)" }
            }
            Write-Output ($run.managed_close | ConvertTo-Json -Depth 20)
            exit 0
        }
        $head = (& git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -C $script:projectRoot rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0 -or $head -ne [string]$run.commits.stage3) {
            throw 'Managed close requires Stage 3 to remain the current internal commit.'
        }
        $stage1Path = Join-Path $runDirectory 'managed-stage1.patch'
        $stage3Path = Join-Path $runDirectory 'managed-stage3.patch'
        $checkpointPath = Join-Path $runDirectory 'managed-checkpoints.json'
        $plan = [pscustomobject][ordered]@{
            task_id = [string]$run.managed_task.task_id
            base_revision = [string]$run.base_revision
            stage1_revision = [string]$run.commits.stage1
            stage3_revision = [string]$run.commits.stage3
            reset_mode = 'mixed'
            output_paths = @((Get-RelativeProjectPath -FullPath $stage1Path), (Get-RelativeProjectPath -FullPath $stage3Path), (Get-RelativeProjectPath -FullPath $checkpointPath))
        }
        if (-not $Apply) { Write-Output ($plan | ConvertTo-Json -Depth 20); exit 0 }
        Write-Utf8File -Path $stage1Path -Text (Get-GitPatch -From ([string]$run.base_revision) -To ([string]$run.commits.stage1))
        Write-Utf8File -Path $stage3Path -Text (Get-GitPatch -From ([string]$run.commits.stage1) -To ([string]$run.commits.stage3))
        $patches = @(
            [pscustomobject][ordered]@{ path = Get-RelativeProjectPath -FullPath $stage1Path; sha256 = Get-Sha256 -Path $stage1Path },
            [pscustomobject][ordered]@{ path = Get-RelativeProjectPath -FullPath $stage3Path; sha256 = Get-Sha256 -Path $stage3Path }
        )
        $checkpoint = [pscustomobject][ordered]@{
            schema_version = 1
            task_id = [string]$run.managed_task.task_id
            batch_id = [string]$run.batch_id
            base = [pscustomobject][ordered]@{ revision = [string]$run.base_revision; tree = Get-GitTree -Revision ([string]$run.base_revision) }
            stage1 = [pscustomobject][ordered]@{ revision = [string]$run.commits.stage1; tree = Get-GitTree -Revision ([string]$run.commits.stage1) }
            stage3 = [pscustomobject][ordered]@{ revision = [string]$run.commits.stage3; tree = Get-GitTree -Revision ([string]$run.commits.stage3) }
            patches = $patches
            prepared_at = [DateTime]::UtcNow.ToString('o')
        }
        Write-JsonFile -Path $checkpointPath -Value $checkpoint
        $run | Add-Member -NotePropertyName managed_close -NotePropertyValue ([pscustomobject][ordered]@{
            checkpoint_path = Get-RelativeProjectPath -FullPath $checkpointPath
            patches = $patches
            prepared_at = [string]$checkpoint.prepared_at
        }) -Force
        Save-Run -Path $loaded.Path -Run $run
        $resetOutput = @(& git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -C $script:projectRoot reset --mixed ([string]$run.base_revision))
        if ($LASTEXITCODE -ne 0) { throw 'Unable to return managed worktree HEAD to the orchestration task base.' }
        $resetHead = (& git -c "safe.directory=$($script:projectRoot.Replace('\', '/'))" -C $script:projectRoot rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0 -or $resetHead -ne [string]$run.base_revision) { throw 'Managed close reset did not reach the task base.' }
        Write-Output ($run.managed_close | ConvertTo-Json -Depth 20)
        exit 0
    }
} catch {
    [Console]::Error.WriteLine("INGEST_CONTROL_FAILED: $($_.Exception.Message)")
    exit 2
}
