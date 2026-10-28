[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Stage1Revision,
    [string]$Stage3Revision = '',
    [switch]$Staged,
    [ValidateSet('affected', 'full')][string]$HealthScope = 'affected',
    [string]$PreviousHealthReport = '',
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [ValidateSet('summary', 'full')][string]$OutputMode = 'summary'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object Text.UTF8Encoding($false)
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$safeProject = $projectRoot.Replace('\', '/')
$excludedPathspecs = @(
    ':(exclude).obsidian/workspace.json',
    ':(exclude)system/maintenance/ingest-runs/**/semantic-reviews/**/actual.diff'
)
$hostExecutable = (Get-Process -Id $PID).Path

function Add-Check {
    param([System.Collections.Generic.List[object]]$List, [string]$Id, [bool]$Passed, [string]$Details)
    [void]$List.Add([pscustomobject][ordered]@{ id = $Id; passed = $Passed; details = $Details })
}

function Get-HealthModule {
    param([string]$Id)
    $module = @($healthEvidence.checks | Where-Object { $_.id -eq $Id })
    if ($module.Count -ne 1) { throw "Unified health result missing module: $Id" }
    return $module[0]
}

function Get-HealthModuleOutput {
    param([string]$Id)
    $module = Get-HealthModule $Id
    $summary = if ($null -ne $module.details -and $null -ne $module.details.PSObject.Properties['summary']) { $module.details.summary } else { $null }
    return ([ordered]@{ status = $module.status; summary = $summary; findings = @($module.findings); execution = $module.execution } | ConvertTo-Json -Depth 12)
}

function Convert-UnicodeLiteral {
    param([string]$Value)
    return [regex]::Replace($Value, '\\u([0-9a-fA-F]{4})', {
        param($match)
        return [char][Convert]::ToInt32($match.Groups[1].Value, 16)
    })
}

function Get-ProjectPath {
    param([string]$Path)
    $full = if ([IO.Path]::IsPathRooted($Path)) { [IO.Path]::GetFullPath($Path) } else { [IO.Path]::GetFullPath((Join-Path $projectRoot $Path)) }
    $prefix = $projectRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "OutputPath must stay inside Knowledge: $full" }
    return $full
}

function Assert-Revision {
    param([string]$Revision)
    & git -c "safe.directory=$safeProject" -c core.excludesFile= -C $projectRoot cat-file -e ($Revision + '^{commit}') 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Revision does not exist: $Revision" }
}

function Get-EvidenceCostSummary {
    param([string]$RunDirectory)
    if (-not (Test-Path -LiteralPath $RunDirectory -PathType Container)) {
        return [pscustomobject][ordered]@{
            evidence_file_count = 0
            evidence_bytes = 0
            audit_report_count = 0
            audit_request_count = 0
            audit_receipt_count = 0
            retry_directory_count = 0
            reused_receipt_count = 0
            raw_review_attempt_count = 0
            terra_full_count = 0
            terra_targeted_count = 0
            sol_full_count = 0
            sol_targeted_count = 0
            astra_escalation_count = 0
            distinct_child_agent_count = 0
            actual_child_session_count = 0
            failed_or_interrupted_session_count = 0
            child_session_duration_seconds = $null
            child_session_cap = $null
            writer_completion_count = 0
            token_usage = 'unavailable'
            note = 'Run-local evidence directory is unavailable; token usage is not inferred.'
        }
    }
    $files = @(Get-ChildItem -LiteralPath $RunDirectory -Recurse -File -Force)
    $reusedCount = 0
    foreach ($file in @($files | Where-Object { $_.Name -match '^content-backtest.*receipt\.json$' })) {
        try {
            $record = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName | ConvertFrom-Json
            if ($null -ne $record.PSObject.Properties['reused_receipt_count']) { $reusedCount += [int]$record.reused_receipt_count }
        } catch { }
    }
    $attempts = @()
    $historicalAttempts = @()
    $writerRecords = @()
    $agentSessions = @()
    $qualityEvents = @()
    $coreAttempts = @()
    $childSessionCap = $null
    $run = $null
    $runPath = Join-Path $RunDirectory 'run.json'
    if (Test-Path -LiteralPath $runPath -PathType Leaf) {
        try {
            $run = Get-Content -Raw -Encoding UTF8 -LiteralPath $runPath | ConvertFrom-Json
            if ($null -ne $run.PSObject.Properties['execution_control']) {
                $attempts = @($run.execution_control.raw_review_attempts)
                if ($run.execution_control.PSObject.Properties['raw_review_history']) { $historicalAttempts = @($run.execution_control.raw_review_history) }
                if ($null -ne $run.execution_control.PSObject.Properties['agent_sessions']) { $agentSessions = @($run.execution_control.agent_sessions) }
                if ($run.execution_control.PSObject.Properties['core_review_attempts']) { $coreAttempts = @($run.execution_control.core_review_attempts) }
                if ($run.execution_control.PSObject.Properties['core_review_history']) { $coreAttempts += @($run.execution_control.core_review_history) }
                if ($null -ne $run.execution_control.PSObject.Properties['quality_events']) { $qualityEvents = @($run.execution_control.quality_events) }
                $childSessionCap = [int]$run.execution_control.child_session_cap
                foreach ($stage in @('stage1', 'stage3')) {
                    $record = $run.execution_control.writer_stages.$stage
                    if ($null -ne $record) { $writerRecords += $record }
                }
                $writerRecords += @($run.execution_control.writer_stage_history)
            }
        } catch { }
    }
    $agentIds = @(
        @($attempts | Where-Object { $_.PSObject.Properties['agent_id'] } | ForEach-Object { [string]$_.agent_id }) +
        @($writerRecords | ForEach-Object { @($_.agent_ids) } | ForEach-Object { [string]$_ }) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Sort-Object -Unique
    )
    $retryCount = if ($attempts.Count -gt 0) {
        @($attempts | Where-Object { [int]$_.sequence -gt 1 }).Count
    } else {
        @(Get-ChildItem -LiteralPath $RunDirectory -Recurse -Directory -Force | Where-Object { $_.Name -match '(?:^|-)r\d+$' }).Count
    }
    $usageRecords = @($agentSessions | Where-Object { $null -ne $_.usage })
    $usageAvailable = $usageRecords.Count -gt 0
    $hostCost = $null
    if ($null -ne $run -and $run.PSObject.Properties['execution_control'] -and $run.execution_control.PSObject.Properties['host_cost']) { $hostCost = $run.execution_control.host_cost }
    $invalidDurationCount = @($agentSessions | Where-Object { $null -ne $_.duration_seconds -and $_.duration_seconds -lt 0 }).Count
    $firstReviewFindingCount = 0
    $firstReviewArticles = @($qualityEvents | Where-Object { $_.PSObject.Properties['detection_stage'] -and $_.detection_stage -eq 'first_review' -and $_.raw_path } | Sort-Object recorded_at | Group-Object raw_path | ForEach-Object { $_.Group[0] })
    $firstReviewPassed = @($firstReviewArticles | Where-Object { $_.result -eq 'passed' }).Count
    $repairResidualCount = 0
    $repairIntroducedCount = 0
    foreach ($event in $qualityEvents) {
        if ($null -ne $event.PSObject.Properties['repair_residual_count']) { $repairResidualCount += [int]$event.repair_residual_count }
        if ($null -ne $event.PSObject.Properties['repair_introduced_count']) { $repairIntroducedCount += [int]$event.repair_introduced_count }
    }
    foreach ($event in $firstReviewArticles) { if ($event.PSObject.Properties['first_review_finding_count']) { $firstReviewFindingCount += [int]$event.first_review_finding_count } }
    $firstReviewFailureSignalCount = 0
    $legacyCoreFindingCount = $false
    foreach ($event in $firstReviewArticles) {
        if ($event.PSObject.Properties['review_kind'] -and $event.review_kind -eq 'core_full') {
            if ($event.PSObject.Properties['failure_signal_count']) { $firstReviewFailureSignalCount += [int]$event.failure_signal_count }
            else { $firstReviewFailureSignalCount += [int]$event.finding_count; $legacyCoreFindingCount = $true }
        }
    }
    $tokenUsage = if ($usageAvailable) {
        [pscustomobject][ordered]@{
            input_tokens = [int64](($usageRecords | ForEach-Object { if ($null -eq $_.usage.input_tokens) { 0 } else { [int64]$_.usage.input_tokens } } | Measure-Object -Sum).Sum)
            cached_input_tokens = [int64](($usageRecords | ForEach-Object { if ($null -eq $_.usage.cached_input_tokens) { 0 } else { [int64]$_.usage.cached_input_tokens } } | Measure-Object -Sum).Sum)
            output_tokens = [int64](($usageRecords | ForEach-Object { if ($null -eq $_.usage.output_tokens) { 0 } else { [int64]$_.usage.output_tokens } } | Measure-Object -Sum).Sum)
            source = 'registered_child_sessions_only'
            coverage = 'partial; excludes parent and any undiscovered sessions'
        }
    } else { 'unavailable' }
    if ($null -ne $hostCost) {
        $tokenUsage = [pscustomobject]@{ known_usage=$hostCost.total.known_usage; coverage=$hostCost.total.status; coverage_scope='explicit_window_only'; lifecycle_complete=$false; missing_session_ids=$hostCost.total.missing_session_ids; source='host_session_counter_deltas'; parent=$hostCost.parent; children=$hostCost.children; window=$hostCost.window }
    }
    return [pscustomobject][ordered]@{
        evidence_file_count = $files.Count
        evidence_bytes = [int64](($files | Measure-Object -Property Length -Sum).Sum)
        audit_report_count = @($files | Where-Object { $_.Name -match '^report(?:-[^.]+)?\.json$' }).Count
        audit_request_count = @($files | Where-Object { $_.Name -match '^request(?:-[^.]+)?\.json$' }).Count
        audit_receipt_count = @($files | Where-Object { $_.Name -match '^receipt(?:-[^.]+)?\.json$' }).Count
        retry_directory_count = $retryCount
        reused_receipt_count = $reusedCount
        raw_review_attempt_count = $attempts.Count
        historical_raw_review_attempt_count = $historicalAttempts.Count
        total_raw_review_attempt_count = $attempts.Count + $historicalAttempts.Count
        raw_review_count_scope = 'current and historical attempts are separate; total includes replaced reviews and targeted rechecks'
        terra_full_count = @($attempts | Where-Object { [string]$_.kind -eq 'full_default' -and [string]$_.model -eq 'gpt-5.6-terra' }).Count
        terra_targeted_count = @($attempts | Where-Object { [string]$_.kind -eq 'targeted_recheck' -and [string]$_.model -eq 'gpt-5.6-terra' }).Count
        sol_full_count = @($attempts | Where-Object { [string]$_.kind -eq 'full_default' -and [string]$_.model -eq 'gpt-5.6-sol' }).Count
        sol_targeted_count = @($attempts | Where-Object { [string]$_.kind -eq 'targeted_recheck' -and [string]$_.model -eq 'gpt-5.6-sol' }).Count
        astra_escalation_count = @($attempts | Where-Object { [string]$_.kind -eq 'escalated_review' -and [string]$_.model -eq 'gpt-6-astra' }).Count
        distinct_child_agent_count = $(if ($null -ne $hostCost) { $hostCost.actual_child_session_count } else { @(@($agentIds) + @($agentSessions | ForEach-Object { $_.agent_id }) | Where-Object { $_ } | Sort-Object -Unique).Count })
        core_review_attempt_count = $coreAttempts.Count
        actual_child_session_count = $(if ($null -ne $hostCost) { $hostCost.actual_child_session_count } elseif ($agentSessions.Count -gt 0) { $agentSessions.Count } else { $agentIds.Count })
        failed_or_interrupted_session_count = @($agentSessions | Where-Object { [string]$_.status -in @('failed','aborted','replaced') }).Count
        completed_session_count = @($agentSessions | Where-Object { [string]$_.status -eq 'completed' }).Count
        completion_count_scope = 'session termination only; task_complete does not prove file access or successful delivery'
        permission_failed_session_count = @($agentSessions | Where-Object { $_.PSObject.Properties['work_outcome'] -and $_.work_outcome -eq 'permission_failed' }).Count
        successful_work_session_count = @($agentSessions | Where-Object { $_.PSObject.Properties['work_outcome'] -and $_.work_outcome -eq 'succeeded' }).Count
        unknown_work_outcome_count = @($agentSessions | Where-Object { -not $_.PSObject.Properties['work_outcome'] -or $_.work_outcome -eq 'unknown' }).Count
        replaced_session_count = @($agentSessions | Where-Object { [string]$_.status -eq 'replaced' }).Count
        aborted_session_count = @($agentSessions | Where-Object { [string]$_.status -eq 'aborted' }).Count
        failure_count_scope = 'known registered terminal statuses; unregistered or incomplete host sessions are not assumed successful'
        child_session_duration_seconds = $(if ($invalidDurationCount -eq 0 -and @($agentSessions | Where-Object { $null -ne $_.duration_seconds }).Count -gt 0) { [Math]::Round([double](($agentSessions | Where-Object { $null -ne $_.duration_seconds } | Measure-Object -Property duration_seconds -Sum).Sum), 3) } else { $null })
        invalid_duration_count = $invalidDurationCount
        unregistered_child_ids = $(if ($null -ne $hostCost) { @($hostCost.unregistered_child_ids) } else { @() })
        child_session_cap = $childSessionCap
        writer_completion_count = @($writerRecords | Where-Object { [string]$_.status -eq 'completed' }).Count
        first_review_finding_count = $(if ($legacyCoreFindingCount) { $null } else { $firstReviewFindingCount })
        first_review_failure_signal_count = $firstReviewFailureSignalCount
        finding_count_scope = 'Explicit report findings; legacy core events counted failure signals, not distinct findings. Unknown explicit totals remain null. No semantic deduplication is inferred.'
        first_review_article_count = $firstReviewArticles.Count
        first_review_passed_count = $firstReviewPassed
        first_review_pass_rate = $(if ($firstReviewArticles.Count) { $firstReviewPassed / $firstReviewArticles.Count } else { $null })
        missed_defect_rate = $null
        quality_counting_scope = 'First chronological review per article; rebinds and re-reviews do not reset first-pass history. Missed-defect rate needs independent sampling.'
        repair_residual_count = $repairResidualCount
        repair_introduced_count = $repairIntroducedCount
        token_usage = $tokenUsage
        note = 'Known counter deltas are not billing totals. Missing sessions remain explicit; cached input is a subset of input. Session durations include overlap/idle and are not wall time.'
    }
}

try {
    Assert-Revision $Stage1Revision
    if ($Staged -and -not [string]::IsNullOrWhiteSpace($Stage3Revision)) { throw 'Use either -Staged or -Stage3Revision, not both.' }
    if (-not $Staged -and [string]::IsNullOrWhiteSpace($Stage3Revision)) { throw 'Stage3Revision is required unless -Staged is used.' }
    if (-not $Staged) { Assert-Revision $Stage3Revision }
    $checks = New-Object System.Collections.Generic.List[object]
    $maintenanceRunPath = Join-Path (Split-Path -Parent (Get-ProjectPath $OutputPath)) 'run.json'
    $maintenanceRun = if (Test-Path -LiteralPath $maintenanceRunPath -PathType Leaf) { Get-Content -Raw -Encoding UTF8 -LiteralPath $maintenanceRunPath | ConvertFrom-Json } else { $null }
    if ($null -eq $maintenanceRun) {
        Add-Check $checks 'run_manifest_available' $true 'skipped: standalone or legacy maintenance invocation without adjacent run.json'
    } else {
        Add-Check $checks 'run_manifest_available' $true $maintenanceRunPath
        $sessions = @(if ($null -ne $maintenanceRun.PSObject.Properties['execution_control'] -and $null -ne $maintenanceRun.execution_control.PSObject.Properties['agent_sessions']) { $maintenanceRun.execution_control.agent_sessions })
        $nonterminalSessions = @($sessions | Where-Object { [string]$_.status -notin @('completed','failed','aborted','replaced') })
        Add-Check $checks 'agent_sessions_terminal' ($nonterminalSessions.Count -eq 0) $(if ($nonterminalSessions.Count -eq 0) { "terminal=$($sessions.Count)" } else { 'nonterminal: ' + (($nonterminalSessions | ForEach-Object { "$($_.session_key):$($_.status)" }) -join ', ') })

        $ingestedRawArtifacts = @($maintenanceRun.artifacts | Where-Object { [string]$_.kind -eq 'raw' -and [string]$_.disposition -eq 'ingested' })
        $preparedReviews = @(if ($null -ne $maintenanceRun.PSObject.Properties['execution_control']) { $maintenanceRun.execution_control.raw_review_attempts | Where-Object { [string]$_.status -eq 'prepared' } })
        Add-Check $checks 'raw_reviews_terminal' ($preparedReviews.Count -eq 0) $(if ($preparedReviews.Count -eq 0) { 'no prepared review attempts' } else { ($preparedReviews | ForEach-Object { [string]$_.raw_path }) -join ', ' })
        if ($null -eq $maintenanceRun.PSObject.Properties['schema_version'] -or [int]$maintenanceRun.schema_version -lt 8) {
            Add-Check $checks 'raw_audit_coverage_exact' $true 'skipped: legacy or synthetic pre-schema8 run'
        } elseif ($null -eq $maintenanceRun.PSObject.Properties['content_audits']) {
            Add-Check $checks 'raw_audit_coverage_exact' $false 'schema8 run is missing content_audits'
        } else {
            $auditProblems = New-Object System.Collections.Generic.List[string]
            foreach ($artifact in $ingestedRawArtifacts) {
                $rawPath = [string]$artifact.path
                $auditCount = @($maintenanceRun.content_audits | Where-Object { [string]$_.raw_path -eq $rawPath }).Count
                if ($auditCount -ne 1) { [void]$auditProblems.Add("$rawPath audits=$auditCount") }
            }
            Add-Check $checks 'raw_audit_coverage_exact' ($auditProblems.Count -eq 0) $(if ($auditProblems.Count -eq 0) { "raw=$($ingestedRawArtifacts.Count)" } else { $auditProblems -join ', ' })
        }
    }
    $changed = if ($Staged) {
        @(& git -c "safe.directory=$safeProject" -c core.excludesFile= -c core.quotepath=false -C $projectRoot diff --cached --name-only $Stage1Revision -- $excludedPathspecs)
    } else {
        @(& git -c "safe.directory=$safeProject" -c core.excludesFile= -c core.quotepath=false -C $projectRoot diff --name-only $Stage1Revision $Stage3Revision -- $excludedPathspecs)
    }
    if ($LASTEXITCODE -ne 0) { throw 'Unable to read Stage 3 changed paths.' }
    $changed = @($changed | ForEach-Object { $_.Trim().Replace('\', '/') } | Where-Object { $_ -ne '' })
    Add-Check $checks 'stage3_has_changes' ($changed.Count -gt 0) (($changed | Sort-Object) -join ', ')
    $verifiedCaptures = @()
    if ($null -ne $maintenanceRun -and [int]$maintenanceRun.schema_version -ge 8 -and @($changed | Where-Object { $_ -like 'Clippings/_source-captures/*' }).Count -gt 0) {
        $captureOutput = @(& node (Join-Path $PSScriptRoot 'ingest-maintenance-scope.mjs') --root $projectRoot --runDirectory (Split-Path -Parent $maintenanceRunPath) --captureEvidence true 2>&1) -join "`n"
        if ($LASTEXITCODE -eq 0) {
            $verifiedCaptures = [string[]](ConvertFrom-Json -InputObject $captureOutput)
            Add-Check $checks 'source_capture_manifest_bytes' $true "verified_files=$($verifiedCaptures.Count)"
        } else {
            Add-Check $checks 'source_capture_manifest_bytes' $false $captureOutput
        }
    }
    $healthChanged = @($changed | Where-Object { $verifiedCaptures -notcontains $_ })

    # Same read-only judgment core as standalone Lint. No repair, status write, or approval.
    $healthWork = Join-Path (Split-Path -Parent (Get-ProjectPath $OutputPath)) 'work'
    New-Item -ItemType Directory -Path $healthWork -Force | Out-Null
    $healthChangedFile = Join-Path $healthWork 'health-changed-paths.json'
    [IO.File]::WriteAllText($healthChangedFile, (ConvertTo-Json -InputObject @($healthChanged) -Compress -Depth 3), $utf8NoBom)
    $healthChangedRelative = $healthChangedFile.Substring($projectRoot.TrimEnd('\', '/').Length + 1).Replace('\', '/')
    $healthArguments = @((Join-Path $PSScriptRoot 'ingest-health-runner.mjs'), '--root', $projectRoot, '--scope', $HealthScope, '--changed-file', $healthChangedRelative)
    if ($PreviousHealthReport) { $healthArguments += @('--previous', $PreviousHealthReport) }
    # Verified captures stay in changed_paths/coverage, but are not migrated Clippings.
    $healthOutput = @(& node @healthArguments) -join "`n"
    $healthExit = $LASTEXITCODE
    $healthEvidence = $null
    try { $healthEvidence = $healthOutput | ConvertFrom-Json } catch { }
    $healthExecuted = $null -ne $healthEvidence -and $healthExit -in @(0, 2) -and $healthEvidence.status -ne 'incomplete'
    Add-Check $checks 'knowledge_health_execution' $healthExecuted $(if ($healthExecuted) { "status=$($healthEvidence.status); report retained; semantic findings are review work, not automated content decisions" } else { $healthOutput })
    if ($healthExecuted) {
        $scopeErrors = @($healthEvidence.checks | Where-Object {
            $item = $_
            $affectedModule = $HealthScope -eq 'full'
            # The clipping migration checker reads only migrated Clippings and its map.
            # A changed Raw does not make unrelated historical clipping hash drift new.
            $dependencies = if ([string]$item.id -eq 'clipping_identity') { @('Clippings', 'system/registry/clipping-path-migrations.json') } else { @($item.dependencies) }
            foreach ($dependency in $dependencies) {
                if (@($healthChanged | Where-Object { $_ -eq $dependency -or $_.StartsWith($dependency.TrimEnd('/') + '/') }).Count -gt 0) { $affectedModule = $true }
            }
            $affectedModule -and @($item.findings | Where-Object { $_.severity -eq 'error' }).Count -gt 0
        })
        Add-Check $checks 'knowledge_health_affected_errors' ($scopeErrors.Count -eq 0) $(if ($scopeErrors.Count -eq 0) { 'No mechanical errors in affected dependency modules; see health evidence for unrelated findings and semantic review.' } else { ($scopeErrors.id -join ', ') })
    }


    $rawPathCandidates = New-Object System.Collections.Generic.List[string]
    foreach ($path in @($changed | Where-Object { $_.StartsWith('raw-sources/') -and $_.EndsWith('.md') -and $_ -ne 'raw-sources/README.md' })) {
        [void]$rawPathCandidates.Add($path)
    }
    $runManifestPaths = @($changed | Where-Object { $_ -match '^system/maintenance/ingest-runs/[^/]+/run\.json$' })
    foreach ($manifestPath in $runManifestPaths) {
        $manifestFull = Join-Path $projectRoot $manifestPath
        if (-not (Test-Path -LiteralPath $manifestFull -PathType Leaf)) { continue }
        $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestFull | ConvertFrom-Json
        if ($null -eq $manifest.PSObject.Properties['artifacts']) { continue }
        foreach ($artifact in @($manifest.artifacts)) {
            if ($null -eq $artifact) { continue }
            $artifactPath = ([string]$artifact.path).Replace('\', '/')
            if ([string]$artifact.kind -eq 'raw' -and [string]$artifact.disposition -eq 'ingested' -and $artifactPath.StartsWith('raw-sources/') -and $artifactPath.EndsWith('.md') -and $artifactPath -ne 'raw-sources/README.md') {
                [void]$rawPathCandidates.Add($artifactPath)
            }
        }
    }
    $rawPaths = @($rawPathCandidates | Sort-Object -Unique)
    $rawResidue = New-Object System.Collections.Generic.List[string]
    $validDomains = @{}
    foreach ($domainFile in Get-ChildItem -LiteralPath (Join-Path $projectRoot 'domains') -Filter '*.md' -File) {
        if ($domainFile.Name -in @('README.md', 'domain-principles.template.md')) { continue }
        $validDomains[$domainFile.BaseName] = $true
    }
    $rawDomainProblems = New-Object System.Collections.Generic.List[string]
    foreach ($path in $rawPaths) {
        $full = Join-Path $projectRoot $path
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
        $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $full
        $frontmatter = [regex]::Match($text, '(?ms)\A---\s*\r?\n(?<body>.*?)\r?\n---')
        $declaredDomains = New-Object System.Collections.Generic.List[string]
        if (-not $frontmatter.Success) {
            [void]$rawDomainProblems.Add("$path::frontmatter-missing")
        } else {
            $inlineDomains = [regex]::Match($frontmatter.Groups['body'].Value, '(?m)^domains:\s*\[(?<values>[^\]]*)\]\s*$')
            $blockDomains = [regex]::Match($frontmatter.Groups['body'].Value, '(?m)^domains:\s*\r?\n(?<values>(?:[ \t]+-\s+.*\r?\n?)+)')
            if ($inlineDomains.Success) {
                foreach ($value in $inlineDomains.Groups['values'].Value.Split(',')) {
                    $name = $value.Trim().Trim('"', "'")
                    if (-not [string]::IsNullOrWhiteSpace($name)) { [void]$declaredDomains.Add($name) }
                }
            } elseif ($blockDomains.Success) {
                foreach ($domainMatch in [regex]::Matches($blockDomains.Groups['values'].Value, '(?m)^[ \t]+-\s+(?<value>.+?)\s*$')) {
                    $name = $domainMatch.Groups['value'].Value.Trim().Trim('"', "'")
                    if (-not [string]::IsNullOrWhiteSpace($name)) { [void]$declaredDomains.Add($name) }
                }
            } else {
                [void]$rawDomainProblems.Add("$path::domains-missing")
            }
        }
        foreach ($domain in $declaredDomains) {
            if (-not $validDomains.ContainsKey($domain)) { [void]$rawDomainProblems.Add("$path::unknown-domain:$domain") }
        }
        foreach ($marker in @((Convert-UnicodeLiteral '## \u6279\u6ce8'), 'RAW_DEPTH_AUDIT_V1', 'RAW_STYLE_AUDIT_V1')) {
            if ($text.Contains($marker)) { [void]$rawResidue.Add("$path::$marker") }
        }
    }
    $rawDomainDetails = if ($rawDomainProblems.Count -eq 0) { 'passed' } else { $rawDomainProblems -join ', ' }
    Add-Check $checks 'changed_raw_domains_valid' ($rawDomainProblems.Count -eq 0) $rawDomainDetails
    $rawResidueDetails = if ($rawResidue.Count -eq 0) { '0' } else { $rawResidue -join ', ' }
    Add-Check $checks 'raw_review_residue_zero' ($rawResidue.Count -eq 0) $rawResidueDetails

    $rawListPath = Join-Path $projectRoot 'system/registry/raw-list.md'
    $rawListText = Get-Content -Raw -Encoding UTF8 -LiteralPath $rawListPath
    $categoryMatches = [regex]::Matches($rawListText, '(?ms)^###\s+[^\r\n]+\r?\n(?<body>.*?)(?=^###\s+|\z)')
    $declaredCountPattern = Convert-UnicodeLiteral '\uff08\u5171\s*(?<count>\d+)\s*\u7bc7\uff09'
    $rawListProblems = New-Object System.Collections.Generic.List[string]
    $listedTotal = 0
    $countedCategories = 0
    foreach ($categoryMatch in $categoryMatches) {
        $body = $categoryMatch.Groups['body'].Value
        $declaredMatch = [regex]::Match($body, $declaredCountPattern)
        if (-not $declaredMatch.Success) { continue }
        $countedCategories++
        $declared = [int]$declaredMatch.Groups['count'].Value
        $listed = [regex]::Matches($body, '(?m)^\|\s*[^|\r\n]+\.md\s*\|').Count
        $listedTotal += $listed
        if ($declared -ne $listed) {
            [void]$rawListProblems.Add("category-$countedCategories declared=$declared listed=$listed")
        }
    }
    if ($countedCategories -ne 2) {
        [void]$rawListProblems.Add("category-count expected=2 actual=$countedCategories")
    }
    $physicalRawCount = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'raw-sources') -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' }).Count
    if ($listedTotal -ne $physicalRawCount) {
        [void]$rawListProblems.Add("total listed=$listedTotal physical=$physicalRawCount")
    }
    $rawListDetails = if ($rawListProblems.Count -eq 0) { "categories=$countedCategories listed=$listedTotal physical=$physicalRawCount" } else { $rawListProblems -join ', ' }
    Add-Check $checks 'raw_list_counts_match' ($rawListProblems.Count -eq 0) $rawListDetails
    if ($null -ne $maintenanceRun) {
        $registryProblems = New-Object System.Collections.Generic.List[string]
        foreach ($artifact in @($maintenanceRun.artifacts | Where-Object { [string]$_.kind -eq 'raw' -and [string]$_.disposition -eq 'ingested' })) {
            $name = [IO.Path]::GetFileName([string]$artifact.path)
            $occurrences = [regex]::Matches($rawListText, '(?m)^\|\s*' + [regex]::Escape($name) + '\s*\|').Count
            if ($occurrences -ne 1) { [void]$registryProblems.Add("$name occurrences=$occurrences") }
        }
        Add-Check $checks 'batch_raw_registry_exact' ($registryProblems.Count -eq 0) $(if ($registryProblems.Count -eq 0) { 'each ingested batch Raw appears exactly once' } else { $registryProblems -join ', ' })
        if ($null -ne $maintenanceRun.PSObject.Properties['schema_version'] -and [int]$maintenanceRun.schema_version -ge 8 -and $null -ne $maintenanceRun.PSObject.Properties['counts']) {
            $countNeedle = (Convert-UnicodeLiteral 'raw\uff1a') + $physicalRawCount
            $statusProblems = New-Object System.Collections.Generic.List[string]
            foreach ($relative in @('NOW.md','system/registry/KNOWLEDGE_STATUS.md')) {
                $text = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot $relative)
                if (-not $text.Contains($countNeedle)) { [void]$statusProblems.Add("$relative missing $countNeedle") }
            }
            Add-Check $checks 'status_raw_counts_current' ($statusProblems.Count -eq 0) $(if ($statusProblems.Count -eq 0) { $countNeedle } else { $statusProblems -join ', ' })
        } else {
            Add-Check $checks 'status_raw_counts_current' $true 'skipped: legacy or synthetic run without schema8 count contract'
        }
    }

    $wikiPaths = @($changed | Where-Object { $_.StartsWith('wiki/') -and $_.EndsWith('.md') -and $_ -ne 'wiki/README.md' })
    $independentMaintenance = @()
    $presealScope = $null
    if ($null -ne $maintenanceRun -and [int]$maintenanceRun.schema_version -ge 8 -and $wikiPaths.Count -gt 0) {
        $scopeScript = Join-Path $PSScriptRoot 'ingest-preseal-maintenance.mjs'
        $scopeOutput = @(& node $scopeScript $projectRoot $maintenanceRunPath @wikiPaths 2>&1) -join "`n"
        $scopeExit = $LASTEXITCODE
        if ($scopeExit -eq 0) {
            $presealScope = $scopeOutput | ConvertFrom-Json
            $independentMaintenance = @($presealScope.maintenance)
            Add-Check $checks 'independent_wiki_maintenance_preseal' $true "status=$($presealScope.status); independently_reviewed=$($independentMaintenance.Count); new_knowledge=$(@($presealScope.newKnowledge).Count)"
        } else {
            Add-Check $checks 'independent_wiki_maintenance_preseal' $false $scopeOutput
        }
    }
    $linkProblems = New-Object System.Collections.Generic.List[string]
    $reviewedWholePageLinks = New-Object System.Collections.Generic.List[string]
    foreach ($path in $wikiPaths) {
        $full = Join-Path $projectRoot $path
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
        $lineNumber = 0
        foreach ($line in Get-Content -Encoding UTF8 -LiteralPath $full) {
            $lineNumber++
            foreach ($match in [regex]::Matches($line, '\]\(\./(?<target>[^)#]+\.md)\)')) {
                $target = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $full) $match.Groups['target'].Value))
                $insideWiki = $target.StartsWith((Join-Path $projectRoot 'wiki').TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
                if ($independentMaintenance -contains $path -and $insideWiki -and (Test-Path -LiteralPath $target -PathType Leaf)) {
                    [void]$reviewedWholePageLinks.Add("$path`:$lineNumber $($match.Value)")
                } else {
                    [void]$linkProblems.Add("$path`:$lineNumber $($match.Value)")
                }
            }
        }
    }
    $linkDetails = "blockers=$($linkProblems.Count); independently_reviewed_whole_page_links=$($reviewedWholePageLinks.Count)"
    if ($linkProblems.Count -gt 0) { $linkDetails += '; ' + ($linkProblems -join ', ') }
    if ($reviewedWholePageLinks.Count -gt 0) { $linkDetails += '; reviewed=' + ($reviewedWholePageLinks -join ', ') }
    Add-Check $checks 'wiki_links_have_anchors' ($linkProblems.Count -eq 0) $linkDetails

    $pageHealthScript = Join-Path $projectRoot 'system/maintenance/checklists/check-wiki-page-health.ps1'
    if ($wikiPaths.Count -eq 0) {
        Add-Check $checks 'changed_wiki_page_health' $true 'skipped:no changed wiki'
    } else {
        $pageHealthOutput = Get-HealthModuleOutput 'page_health'
        $pageHealthExit = (Get-HealthModule 'page_health').exit_code
        $pageHealth = if ($pageHealthExit -eq 0) { $pageHealthOutput | ConvertFrom-Json } else { $null }
        $pageHealthBlockers = @()
        $reviewedNumbering = @()
        if ($null -ne $pageHealth) {
            $pageHealthCandidates = @($pageHealth.findings | Where-Object {
                ($wikiPaths -contains $_.path -or ($null -ne $_.PSObject.Properties['target_path'] -and $wikiPaths -contains $_.target_path)) -and
                $_.code -in @(
                    'wiki_title_missing', 'wiki_title_multiple', 'wiki_title_not_first_heading',
                    'wiki_source_section_missing', 'source_section_not_footer', 'related_pages_not_footer',
                    'related_pages_over_limit', 'related_pages_over_limit_split_first',
                    'related_pages_duplicate_target', 'related_pages_anchor_missing', 'related_pages_description_missing', 'related_pages_inline_mirror_missing',
                    'wiki_h2_numbering_gap', 'wiki_h2_numbering_mixed',
                    'wiki_link_target_missing', 'wiki_link_anchor_target_missing'
                )
            })
            $reviewedNumbering = @($pageHealthCandidates | Where-Object {
                $candidate = $_
                $candidate.code -eq 'wiki_h2_numbering_gap' -and $independentMaintenance -contains $candidate.path -and
                @($presealScope.reviewedNumbering | Where-Object { $_.path -eq $candidate.path -and $_.code -eq $candidate.code -and $_.detail -eq $candidate.detail }).Count -gt 0
            })
            $pageHealthBlockers = @($pageHealthCandidates | Where-Object {
                $candidate = $_
                -not @($reviewedNumbering | Where-Object { $_.path -eq $candidate.path -and $_.code -eq $candidate.code -and $_.detail -eq $candidate.detail }).Count
            })
        }
        $pageHealthPassed = $pageHealthExit -eq 0 -and $pageHealthBlockers.Count -eq 0
        $pageHealthDetails = if ($null -eq $pageHealth) {
            $pageHealthOutput
        } elseif ($pageHealthBlockers.Count -eq 0) {
            "status=$($pageHealth.status); warnings=$($pageHealth.summary.warnings); blockers=0; independently_reviewed_numbering_gaps=$($reviewedNumbering.Count)"
        } else {
            "status=$($pageHealth.status); independently_reviewed_numbering_gaps=$($reviewedNumbering.Count); blockers=" + (($pageHealthBlockers | ForEach-Object { "$($_.path):$($_.code)" }) -join ', ')
        }
        Add-Check $checks 'changed_wiki_page_health' $pageHealthPassed $pageHealthDetails
    }

    $groupsRoot = Join-Path $projectRoot 'groups'
    $quickReferenceScript = Join-Path $projectRoot 'system/maintenance/checklists/sync-quick-reference-groups.ps1'
    $groupSyncScript = Join-Path $projectRoot 'system/maintenance/checklists/sync-wiki-groups.ps1'
    $groupCheckScript = Join-Path $projectRoot 'system/maintenance/checklists/check-wiki-groups.ps1'
    if ($wikiPaths.Count -eq 0) {
        Add-Check $checks 'quick_reference_groups_current' $true 'skipped:no changed wiki'
        Add-Check $checks 'wiki_groups_current' $true 'skipped:no changed wiki'
        Add-Check $checks 'changed_wiki_related_review_queue' $true 'skipped:no changed wiki'
        Add-Check $checks 'wiki_governance_report' $true 'skipped:no changed wiki'
    } else {
        if (-not (Test-Path -LiteralPath $groupsRoot -PathType Container)) {
            Add-Check $checks 'quick_reference_groups_current' $true 'skipped:legacy fixture without groups directory'
            Add-Check $checks 'wiki_groups_current' $true 'skipped:legacy fixture without groups directory'
        } else {
            $quickReferenceOutput = Get-HealthModuleOutput 'quick_reference'
            $quickReferencePassed = (Get-HealthModule 'quick_reference').exit_code -eq 0
            Add-Check $checks 'quick_reference_groups_current' $quickReferencePassed $quickReferenceOutput
            $groupSyncOutput = Get-HealthModuleOutput 'group_navigation'
            $groupSyncPassed = (Get-HealthModule 'group_navigation').exit_code -eq 0
            $groupCheckOutput = Get-HealthModuleOutput 'groups'
            $groupCheckPassed = (Get-HealthModule 'groups').exit_code -eq 0
            $groupDetails = "navigation=$groupSyncPassed; contract=$groupCheckPassed`n$groupSyncOutput`n$groupCheckOutput"
            Add-Check $checks 'wiki_groups_current' ($groupSyncPassed -and $groupCheckPassed) $groupDetails
        }

        $impactScript = Join-Path $projectRoot 'system/maintenance/checklists/get-wiki-change-impact.ps1'
        $impactOutput = if ($Staged) {
            @(& $hostExecutable -NoProfile -File $impactScript -BaseRevision $Stage1Revision -Staged) -join "`n"
        } else {
            @(& $hostExecutable -NoProfile -File $impactScript -BaseRevision $Stage1Revision -TargetRevision $Stage3Revision) -join "`n"
        }
        $impactPassed = $LASTEXITCODE -eq 0
        $impactDetails = if (-not $impactPassed) {
            $impactOutput
        } else {
            $impact = $impactOutput | ConvertFrom-Json
            $items = @($impact.impacts)
            if ($items.Count -eq 0) { 'queue=0' } else { 'queue=' + $items.Count + '; ' + (($items | ForEach-Object { "$($_.path):$($_.reasons -join '+')" }) -join ', ') }
        }
        Add-Check $checks 'changed_wiki_related_review_queue' $impactPassed $impactDetails

        $governanceScript = Join-Path $projectRoot 'system/maintenance/checklists/check-wiki-governance.ps1'
        $governanceOutput = Get-HealthModuleOutput 'governance'
        $governancePassed = (Get-HealthModule 'governance').exit_code -eq 0
        $governanceDetails = if (-not $governancePassed) {
            $governanceOutput
        } else {
            $governance = $governanceOutput | ConvertFrom-Json
            "status=$($governance.status); warnings=$($governance.summary.warnings); report-only"
        }
        Add-Check $checks 'wiki_governance_report' $governancePassed $governanceDetails
    }

    $hasRaw = @($changed | Where-Object { $_.StartsWith('raw-sources/') }).Count -gt 0
    $hasWiki = $wikiPaths.Count -gt 0
    $wikiRegistryChanges = if ($Staged) {
        @(& git -c "safe.directory=$safeProject" -c core.excludesFile= -C $projectRoot diff --cached --name-only --diff-filter=ADR $Stage1Revision -- 'wiki/')
    } else {
        @(& git -c "safe.directory=$safeProject" -c core.excludesFile= -C $projectRoot diff --name-only --diff-filter=ADR $Stage1Revision $Stage3Revision -- 'wiki/')
    }
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect Wiki registry-affecting paths.' }
    $wikiRegistryChanges = @($wikiRegistryChanges | ForEach-Object { $_.Trim().Replace('\', '/') } | Where-Object { $_ -ne '' -and $_ -ne 'wiki/README.md' })
    $required = New-Object System.Collections.Generic.List[string]
    foreach ($path in @('NOW.md', 'system/maintenance/CHANGELOG.md', 'system/registry/KNOWLEDGE_STATUS.md')) { [void]$required.Add($path) }
    if ($hasRaw) { [void]$required.Add('system/registry/raw-list.md') }
    if ($wikiRegistryChanges.Count -gt 0) { [void]$required.Add('system/registry/index.md') }
    $missingSync = @($required | Where-Object { $changed -notcontains $_ })
    $syncDetails = if ($missingSync.Count -eq 0) { ($required -join ', ') } else { 'missing: ' + ($missingSync -join ', ') }
    Add-Check $checks 'maintenance_sync_paths' ($missingSync.Count -eq 0) $syncDetails

    $capacityRiskPath = Join-Path $projectRoot 'system/maintenance/checklists/sync-capacity-risks.ps1'
    $capacityRiskOutput = Get-HealthModuleOutput 'capacity'
    $capacityRiskPassed = (Get-HealthModule 'capacity').exit_code -eq 0
    Add-Check $checks 'capacity_risk_status' $capacityRiskPassed $capacityRiskOutput

    $contractPath = Join-Path $projectRoot 'system/maintenance/checklists/run-query-contract.ps1'
    $contractOutput = Get-HealthModuleOutput 'query_contract'
    $contractPassed = (Get-HealthModule 'query_contract').exit_code -eq 0
    Add-Check $checks 'query_contract' $contractPassed $contractOutput

    $scopeArgs = @('--root', $projectRoot, '--base', $Stage1Revision, '--runDirectory', (Split-Path -Parent (Get-ProjectPath $OutputPath)))
    if ($Staged) { $scopeArgs += @('--staged', 'true') } else { $scopeArgs += @('--revision', $Stage3Revision) }
    $diffOutput = @(& node (Join-Path $PSScriptRoot 'ingest-maintenance-scope.mjs') @scopeArgs) -join "`n"
    $diffPassed = $LASTEXITCODE -eq 0
    $validationScope = if ($diffPassed) { $diffOutput | ConvertFrom-Json } else { $null }
    $diffDetails = if ($diffPassed) { 'passed' } else { $diffOutput }
    Add-Check $checks 'git_diff_check' $diffPassed $diffDetails

    $status = if (@($checks | Where-Object { -not $_.passed }).Count -eq 0) { 'passed' } else { 'failed' }
    $receipt = [pscustomobject][ordered]@{
        schema_version = 1; status = $status; source = $(if ($Staged) { 'staged' } else { 'revision' }); stage1_revision = $Stage1Revision.ToLowerInvariant(); stage3_revision = $(if ($Staged) { $null } else { $Stage3Revision.ToLowerInvariant() })
        validation_scope = $validationScope
        health = $healthEvidence; changed_paths = @($changed); checks = @($checks | ForEach-Object { $_ }); evidence_cost = Get-EvidenceCostSummary -RunDirectory (Split-Path -Parent (Get-ProjectPath $OutputPath)); generated_at = [DateTime]::UtcNow.ToString('o')
    }
    $outputFull = Get-ProjectPath $OutputPath
    $parent = Split-Path -Parent $outputFull
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $receiptJson = @(($receipt | ConvertTo-Json -Depth 20) -split '\r?\n' | ForEach-Object { $_.TrimEnd() }) -join "`n"
    [IO.File]::WriteAllText($outputFull, ($receiptJson + "`n"), $utf8NoBom)
    if ($OutputMode -eq 'full') {
        Write-Output ($receipt | ConvertTo-Json -Depth 20)
    } else {
        $failedChecks = @($checks | Where-Object { -not $_.passed } | ForEach-Object { $_.id })
        Write-Output ([pscustomobject][ordered]@{
            status = $status
            output_path = $OutputPath.Replace('\', '/')
            changed_path_count = $changed.Count
            failed_check_ids = @($failedChecks)
            evidence_bytes = [int64]$receipt.evidence_cost.evidence_bytes
            audit_report_count = [int]$receipt.evidence_cost.audit_report_count
            retry_directory_count = [int]$receipt.evidence_cost.retry_directory_count
            raw_review_attempt_count = [int]$receipt.evidence_cost.raw_review_attempt_count
            distinct_child_agent_count = [int]$receipt.evidence_cost.distinct_child_agent_count
            actual_child_session_count = [int]$receipt.evidence_cost.actual_child_session_count
            next_action = if ($status -eq 'passed') { 'record maintenance receipt' } else { 'inspect the persisted maintenance receipt with -OutputMode full' }
        } | ConvertTo-Json -Depth 10)
    }
    if ($status -ne 'passed') { exit 2 }
} catch {
    [Console]::Error.WriteLine("INGEST_MAINTENANCE_FAILED: $($_.Exception.Message)")
    [Console]::Error.WriteLine("INGEST_MAINTENANCE_LOCATION: $($_.InvocationInfo.ScriptLineNumber)")
    [Console]::Error.WriteLine("INGEST_MAINTENANCE_STACK: $($_.ScriptStackTrace)")
    exit 3
}
