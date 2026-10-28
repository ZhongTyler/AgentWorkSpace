[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Inspect','Diagnose','Preflight','Prepare','Seal','Review','Finish','Costs','CostsSnapshot')][string]$Phase,
    [Parameter(Mandatory = $true)][string]$RunPath,
    [string]$Stage1Revision = '',
    [string]$Stage3Revision = '',
    [string]$ApprovedHash = '',
    [string]$ParentSessionId = '',
    [string]$HostSessionRoot = '',
    [string]$AgentIds = '',
    [switch]$PrimaryWriter,
    [string]$Stage3SemanticPath = '',
    [string]$GateAuditSemanticPath = '',
    [string]$Stage3PackagePath = '',
    [string]$GateAuditPackagePath = '',
    [string]$MaintenancePath = '',
    [string]$CheckId = '',
    [string]$CostStart = '',
    [string]$CostEnd = '',
    [string]$RegistrationPath = '',
    [ValidateSet('summary','full')][string]$OutputMode = 'summary'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$hostExecutable = (Get-Process -Id $PID).Path
$control = Join-Path $PSScriptRoot 'ingest-control.ps1'

function Project-Path([string]$Value, [switch]$MustExist) {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw 'A required path is empty.' }
    $full = if ([IO.Path]::IsPathRooted($Value)) { [IO.Path]::GetFullPath($Value) } else { [IO.Path]::GetFullPath((Join-Path $projectRoot $Value)) }
    $prefix = $projectRoot.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Path must stay inside Knowledge: $full" }
    if ($MustExist -and -not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "File does not exist: $full" }
    return $full
}

function Relative-Path([string]$Full) {
    return $Full.Substring($projectRoot.TrimEnd('\','/').Length + 1).Replace('\','/')
}

function Invoke-Control([string[]]$Arguments) {
    $priorPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $text = @(& $hostExecutable -NoProfile -ExecutionPolicy Bypass -File $control @Arguments 2>&1) -join "`n"
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $priorPreference }
    if ($exitCode -ne 0) { throw "ingest-control failed: $text" }
    return $text
}

function Read-Json([string]$Path) {
    return Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
}

function Get-SectionStatus([string]$RunFull, [string]$Section) {
    $run = Read-Json $RunFull
    $data = Read-Json (Project-Path ([string]$run.package_data.path) -MustExist)
    return [string]$data.sections.$Section.status
}

function Check-Registration([bool]$Staged) {
    $result = @(& node (Join-Path $PSScriptRoot 'ingest-stage3-preflight.mjs') --root $projectRoot --run $runRelative --staged $Staged.ToString().ToLowerInvariant() 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Registration preflight failed (no package was bound): $result" }
    return $result
}

function Record-Timing([string]$Name, [string]$At) {
    $timingPath = Join-Path $runDirectory 'lifecycle-timing.json'
    $timing = if (Test-Path -LiteralPath $timingPath) { Read-Json $timingPath } else { [pscustomobject]@{schema_version=1} }
    if (-not $timing.PSObject.Properties[$Name]) {
        $timing | Add-Member -NotePropertyName $Name -NotePropertyValue $At
        [IO.File]::WriteAllText($timingPath, ($timing | ConvertTo-Json) + "`n", [Text.UTF8Encoding]::new($false))
    }
}

function Check-AllDependencies([bool]$Staged, [bool]$RequireReview = $true) {
    $failures = New-Object System.Collections.Generic.List[object]
    try { [void](Check-Registration $Staged) } catch { $failures.Add([pscustomobject]@{check='registration';detail=$_.Exception.Message}) }
    foreach ($check in @('sync-wiki-source-ledgers.ps1','sync-capacity-risks.ps1')) {
        $output = @(& $hostExecutable -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $check) -Mode Check 2>&1) -join "`n"
        if ($LASTEXITCODE -ne 0) { $failures.Add([pscustomobject]@{check=$check;detail=$output}) }
    }
    if ($current.PSObject.Properties['execution_control'] -and ($current.execution_control.PSObject.Properties['wiki_consumption_contract_version'] -or ($current.execution_control.PSObject.Properties['runtime_contract_version'] -and $current.execution_control.runtime_contract_version -ge 3))) {
        $semanticPath = if ($Stage3SemanticPath) { $Stage3SemanticPath } else { Join-Path $runDirectory 'semantic-stage3.json' }
        try {
            $semanticFull = Project-Path $semanticPath -MustExist
            $consumptionAction = if ($RequireReview) { 'diagnose' } else { 'prepare' }
            $output = @(& node (Join-Path $PSScriptRoot 'wiki-consumption.mjs') $consumptionAction --root $projectRoot --run $runFull --semantic $semanticFull --stage stage3 2>&1) -join "`n"
            if ($LASTEXITCODE -ne 0) { $failures.Add([pscustomobject]@{check='wiki_consumption';detail=$output}) }
        } catch { $failures.Add([pscustomobject]@{check='wiki_consumption';detail=$_.Exception.Message}) }
    }
    if ($RequireReview -and $current.PSObject.Properties['execution_control'] -and $current.execution_control.PSObject.Properties['page_review_queue_version'] -and $current.execution_control.page_review_queue_version -eq 1) {
        try {
            $semanticPath = if ($Stage3SemanticPath) { $Stage3SemanticPath } else { Join-Path $runDirectory 'semantic-stage3.json' }
            $semanticFull = Project-Path $semanticPath -MustExist
            $output = @(& node (Join-Path $PSScriptRoot 'ingest-pipeline.mjs') check-page-reviews --root $projectRoot --run $runFull --semantic $semanticFull 2>&1) -join "`n"
            if ($LASTEXITCODE -ne 0) { $failures.Add([pscustomobject]@{check='page_review_queue';detail=$output}) }
        } catch { $failures.Add([pscustomobject]@{check='page_review_queue';detail=$_.Exception.Message}) }
    }
    if ($failures.Count) { throw ('Pre-seal failures (no package bound): ' + (ConvertTo-Json -InputObject @($failures.ToArray()) -Depth 8)) }
    return '{"status":"passed","scope":"registration, source ledgers, capacity, consumption"}'
}

try {
    if ($PrimaryWriter -and -not [string]::IsNullOrWhiteSpace($AgentIds)) { throw 'PrimaryWriter and AgentIds are mutually exclusive.' }
    $runFull = Project-Path $RunPath -MustExist
    $runDirectory = Split-Path -Parent $runFull
    $runRelative = Relative-Path $runFull
    $current = Read-Json $runFull
    if (-not $Stage1Revision) { $Stage1Revision = [string]$current.commits.stage1 }
    if ($Phase -eq 'Diagnose') {
        $receiptPath = if ($MaintenancePath) { Project-Path $MaintenancePath -MustExist } else { Join-Path $runDirectory 'maintenance.json' }
        $diagnosticArgs = @('--receipt',$receiptPath)
        if ($CheckId) { $diagnosticArgs += @('--check',$CheckId) }
        & node (Join-Path $PSScriptRoot 'ingest-maintenance-summary.mjs') @diagnosticArgs
        if ($LASTEXITCODE -ne 0) { throw 'Maintenance diagnostic failed.' }
        exit 0
    }
    if ($Phase -in @('Costs','CostsSnapshot')) {
        if ($current.status -ne 'completed') { throw 'Costs requires completed run.' }
        if (-not $ParentSessionId -and $current.execution_control.PSObject.Properties['host_cost']) { $ParentSessionId = $current.execution_control.host_cost.parent_session_id }
        if (-not $ParentSessionId) { $ParentSessionId = $env:CODEX_THREAD_ID }
        if (-not $ParentSessionId) { throw 'Costs requires actual ParentSessionId.' }
        if (-not $HostSessionRoot) { $HostSessionRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'sessions' } else { Join-Path $env:USERPROFILE '.codex/sessions' } }
        $costArgs = @('--run',$runFull,'--sessions',$HostSessionRoot,'--parent',$ParentSessionId,'--timing',(Join-Path $runDirectory 'lifecycle-timing.json'))
        if ($CostStart) { $costArgs += @('--start',$CostStart) }
        if ($CostEnd) { $costArgs += @('--end',$CostEnd) }
        if ($Phase -eq 'Costs') { $costArgs += @('--output',(Join-Path $runDirectory 'cost-final.json')) }
        & node (Join-Path $PSScriptRoot 'ingest-cost-lifecycle.mjs') @costArgs
        if ($LASTEXITCODE -ne 0) { throw 'Post-Finish cost collection failed; completed approval is unchanged. Retry Costs.' }
        exit 0
    }
    if ($Phase -eq 'Preflight') { Write-Output (Check-AllDependencies $false $false); exit 0 }
    if ($Phase -in @('Inspect','Review','Finish')) {
        if ($Phase -eq 'Review') {
            if ($current.status -eq 'stage2_planned') {
                if (-not $Stage3Revision) { $Stage3Revision = (@(& git -C $projectRoot rev-parse HEAD) -join '').Trim(); if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve Stage3 HEAD.' } }
                $fullRevision = (@(& git -C $projectRoot rev-parse --verify ($Stage3Revision + '^{commit}')) -join '').Trim()
                if ($LASTEXITCODE -ne 0) { throw 'Invalid Stage3 revision.' }
                if ($null -eq $current.counts.after -or [int]$current.counts.after -lt 0) { throw 'Review requires the verified post-ingest raw count.' }
                [void](Invoke-Control @('-Action','check-stage3','-RunPath',$runRelative,'-Stage3Revision',$fullRevision,'-AfterCount',([string][int]$current.counts.after)))
                $current = Read-Json $runFull
            }
            if ($current.status -eq 'stage3_completed') {
                [void](Invoke-Control @('-Action','render-final-review','-RunPath',$runRelative,'-OutputPath',(Relative-Path (Join-Path $runDirectory 'final-review.md'))))
            } elseif ($current.status -ne 'awaiting_final_review') { throw 'Review requires a completed Stage3 or pending final review.' }
            [void](Invoke-Control @('-Action','verify-final-review','-RunPath',$runRelative))
            if ($current.status -eq 'stage3_completed') { Record-Timing 'review_ready_at' ([DateTime]::UtcNow.ToString('o')) }
            $current = Read-Json $runFull
            if ($current.PSObject.Properties['execution_control'] -and $current.execution_control.PSObject.Properties['host_cost']) {
                if (-not $ParentSessionId) { $ParentSessionId = $current.execution_control.host_cost.parent_session_id }
                if (-not $HostSessionRoot) { $HostSessionRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'sessions' } else { Join-Path $env:USERPROFILE '.codex/sessions' } }
                $reviewCost = @(& node (Join-Path $PSScriptRoot 'ingest-cost-lifecycle.mjs') --run $runFull --sessions $HostSessionRoot --parent $ParentSessionId --timing (Join-Path $runDirectory 'lifecycle-timing.json') --phase review --output (Join-Path $runDirectory 'cost-review.json') 2>&1) -join "`n"
                if ($LASTEXITCODE -ne 0) { throw "Review verified but cost snapshot failed; retry Review: $reviewCost" }
            }
        }
        if ($Phase -eq 'Finish') {
            if ($ApprovedHash -notmatch '^[a-fA-F0-9]{64}$') { throw 'Finish requires the exact user-approved SHA256.' }
            if ($current.status -eq 'completed') {
                if ($current.final_review.approved_sha256 -ne $ApprovedHash -or (Get-FileHash -LiteralPath (Project-Path $current.final_review.path -MustExist)).Hash.ToLowerInvariant() -ne $ApprovedHash.ToLowerInvariant()) { throw 'Completed run approval mismatch.' }
            } else {
                $finishStarted = [DateTime]::UtcNow.ToString('o')
                [void](Invoke-Control @('-Action','verify-final-review','-RunPath',$runRelative))
                [void](Invoke-Control @('-Action','finish','-RunPath',$runRelative,'-ApprovedHash',$ApprovedHash,'-ViaFinalizer'))
                Record-Timing 'finish_started_at' $finishStarted
                Record-Timing 'finish_completed_at' ([DateTime]::UtcNow.ToString('o'))
            }
            if ($current.PSObject.Properties['execution_control'] -and $current.execution_control.PSObject.Properties['page_review_contract_version'] -and $current.execution_control.page_review_contract_version -ge 2) {
                & node (Join-Path $PSScriptRoot 'ingest-current-state.mjs') --root $projectRoot --run $runRelative | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Approval completed but current-state sync failed; retry Finish without changing the approval.' }
            }
            $current = Read-Json $runFull
            if ($current.PSObject.Properties['execution_control'] -and $current.execution_control.PSObject.Properties['runtime_contract_version'] -and $current.execution_control.runtime_contract_version -ge 3) {
                if (-not $ParentSessionId -and $current.execution_control.PSObject.Properties['host_cost']) { $ParentSessionId = $current.execution_control.host_cost.parent_session_id }
                if (-not $ParentSessionId) { throw 'Approval completed but final cost collection needs the bound parent session ID; retry Finish with -ParentSessionId.' }
                if (-not $HostSessionRoot) { $HostSessionRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'sessions' } else { Join-Path $env:USERPROFILE '.codex/sessions' } }
                $costArgs = @('--run',$runFull,'--sessions',$HostSessionRoot,'--parent',$ParentSessionId,'--timing',(Join-Path $runDirectory 'lifecycle-timing.json'),'--output',(Join-Path $runDirectory 'cost-final.json'))
                if ($CostStart) { $costArgs += @('--start',$CostStart) }
                if ($CostEnd) { $costArgs += @('--end',$CostEnd) }
                $costText = @(& node (Join-Path $PSScriptRoot 'ingest-cost-lifecycle.mjs') @costArgs 2>&1) -join "`n"
                if ($LASTEXITCODE -ne 0) { throw "Approval completed but final cost collection failed; retry Finish without changing approval: $costText" }
            }
        }
        $planText = @(& node (Join-Path $PSScriptRoot 'ingest-close-plan.mjs') --root $projectRoot --run $runRelative --phase $Phase 2>&1) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "Unable to build close plan: $planText" }
        Write-Output $planText
        exit 0
    }
    if ($current.status -in @('completed','abandoned')) { throw 'Terminal run is read-only.' }
    $consolidated = $current.PSObject.Properties['execution_control'] -and $current.execution_control.PSObject.Properties['execution_profile'] -and $current.execution_control.execution_profile -eq 'consolidated-v1'
    $automaticPreparation = $consolidated -or ($current.PSObject.Properties['execution_control'] -and $current.execution_control.PSObject.Properties['page_review_contract_version'] -and $current.execution_control.page_review_contract_version -eq 3)
    if ($automaticPreparation -and $Phase -in @('Prepare','Seal') -and (Get-SectionStatus $runFull 'stage3') -eq 'open') {
        if (-not $Stage3SemanticPath) { $Stage3SemanticPath = Join-Path $runDirectory 'semantic-stage3.json' }
        $prepareArgs = @('--root',$projectRoot,'--run',$runRelative,'--semantic',$Stage3SemanticPath,'--shell',$hostExecutable)
        if ($consolidated -and $Phase -eq 'Seal') { $prepareArgs += @('--mode','inspect') }
        if ($RegistrationPath) { $prepareArgs += @('--registration',$RegistrationPath) }
        $preparedText = @(& node (Join-Path $PSScriptRoot 'ingest-stage3-prepare.mjs') @prepareArgs 2>&1) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "Stage3 preparation failed before sealing: $preparedText" }
        $prepared = $preparedText | ConvertFrom-Json
        $Stage3SemanticPath = [string]$prepared.semantic_path
        $current = Read-Json $runFull
        if (-not $consolidated) { [void](Check-AllDependencies $false $false) }
        if ($Phase -eq 'Prepare') { Write-Output $preparedText; exit 0 }
        # All semantic checks run before touching the index. A semantic failure
        # is not repaired by staging or by manufacturing another report.
        [void](Check-AllDependencies $false)
        & git -C $projectRoot -c core.excludesFile= add -- @($prepared.stage_paths)
        if ($LASTEXITCODE -ne 0) { throw 'Unable to stage exact prepared paths; no package sealed.' }
    }
    if ($Phase -eq 'Prepare') {
        & $hostExecutable -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sync-wiki-source-ledgers.ps1') -Mode Sync -ProjectRoot $projectRoot | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Wiki source-ledger sync failed.' }
        & $hostExecutable -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sync-capacity-risks.ps1') -Mode Sync | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Capacity-risk sync failed.' }
        [void](Check-AllDependencies $false $false)
        $changed = @(& git -c "safe.directory=$($projectRoot.Replace('\','/'))" -c core.excludesFile= -c core.quotepath=false -C $projectRoot status --short)
        if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect Stage3 changes.' }
        [pscustomobject][ordered]@{ status='prepared'; phase='Prepare'; review_status='not_checked'; changed_count=$changed.Count; changed=@($changed); next_action='Complete the risk review against these synchronized inputs, then stage the intended changes and run Seal. Preparation does not require or approve a review report.' } | ConvertTo-Json -Depth 10
        exit 0
    }

    if (-not $Stage3SemanticPath) { $Stage3SemanticPath = Join-Path $runDirectory 'semantic-stage3.json' }
    if (-not $GateAuditSemanticPath) { $GateAuditSemanticPath = Join-Path $runDirectory 'semantic-gate-audit.json' }
    # Collect independent failures once, before writer hashes, packages or host costs.
    [void](Check-AllDependencies $true)
    $actualRawCount = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'raw-sources') -File -Filter '*.md' | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' }).Count
    [void](Invoke-Control @('-Action','check-backtests','-RunPath',$runRelative,'-AfterCount',([string]$actualRawCount)))
    $runRelative = Relative-Path $runFull
    $sessionArgs = @('-Action','sync-agent-sessions','-RunPath',$runRelative)
    if ($HostSessionRoot) { $sessionArgs += @('-HostSessionRoot',$HostSessionRoot) }
    [void](Invoke-Control $sessionArgs)
    if (-not $ParentSessionId) { $ParentSessionId = $env:CODEX_THREAD_ID }
    if ($ParentSessionId -and $null -eq $current.packages.maintenance) {
        if (-not $HostSessionRoot) {
            $HostSessionRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'sessions' } else { Join-Path $env:USERPROFILE '.codex/sessions' }
        }
        $costText = @(& node (Join-Path $PSScriptRoot 'ingest-session-cost.mjs') --run $runFull --sessions $HostSessionRoot --parent $ParentSessionId 2>&1) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "Host cost collection failed: $costText" }
        $cost = $costText | ConvertFrom-Json
        $current = Read-Json $runFull
        if ($cost.actual_child_session_count -gt $current.execution_control.child_session_cap) { throw 'Observed child session count exceeds the batch cap.' }
        if (@($cost.sessions | Where-Object { $_.configuration_drift -and $_.role -in @('content_writer','raw_writer','wiki_writer','raw_reviewer','core_reviewer') -and $_.registered_status -notin @('replaced','aborted','failed') }).Count -gt 0) { throw 'Observed writer/reviewer configuration drift; review the affected evidence before sealing.' }
        $current.execution_control | Add-Member -NotePropertyName host_cost -NotePropertyValue $cost -Force
        [IO.File]::WriteAllText($runFull, ($current | ConvertTo-Json -Depth 40) + "`n", [Text.UTF8Encoding]::new($false))
    }
    if (@(& git -c core.excludesFile= -C $projectRoot diff --cached --name-only).Count -eq 0) { throw 'Seal requires the intended Stage3 changes to be staged once.' }
    $stage3Package = if ($Stage3PackagePath) { Project-Path $Stage3PackagePath } else { Join-Path $runDirectory 'package-stage3.md' }
    $gatePackage = if ($GateAuditPackagePath) { Project-Path $GateAuditPackagePath } else { Join-Path $runDirectory 'package-gate-audit.md' }
    $maintenance = if ($MaintenancePath) { Project-Path $MaintenancePath } else { Join-Path $runDirectory 'maintenance.json' }
    $stage3SemanticRelative = Relative-Path (Project-Path $Stage3SemanticPath -MustExist)
    $gateSemanticRelative = Relative-Path (Project-Path $GateAuditSemanticPath -MustExist)
    $reused = New-Object System.Collections.Generic.List[string]

    if ((Get-SectionStatus $runFull 'stage3') -eq 'open') {
        $semantic = Read-Json (Project-Path $Stage3SemanticPath -MustExist)
        if (-not $PrimaryWriter -and [string]::IsNullOrWhiteSpace($AgentIds) -and @($semantic.rows).Count -gt 0) { throw 'Stage3 content requires explicit PrimaryWriter or completed writer AgentIds.' }
    }

    # Maintenance is the last read-only/content check before package state changes.
    # A failed check may leave a run-local diagnostic receipt, but it must not seal Stage3.
    $runState = Read-Json $runFull
    $maintenanceReusable = $null -ne $runState.packages.maintenance -and (Test-Path -LiteralPath $maintenance -PathType Leaf)
    if ($maintenanceReusable) {
        $maintenanceRelative = Relative-Path $maintenance
        $maintenanceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $maintenance).Hash.ToLowerInvariant()
        if ([string]$runState.packages.maintenance.path -ne $maintenanceRelative -or [string]$runState.packages.maintenance.sha256 -ne $maintenanceHash) { throw 'Recorded maintenance receipt drifted; preserve it and reopen with a new evidence path.' }
    } else {
        # Native stderr warnings from a successful child must not become a terminating
        # PowerShell error; the child's actual exit code remains the gate.
        $previousErrorAction = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $maintenanceText = @(& $hostExecutable -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'run-ingest-maintenance.ps1') -Stage1Revision $Stage1Revision -Staged -OutputPath (Relative-Path $maintenance) -OutputMode $OutputMode 2>&1) -join "`n"
            $maintenanceExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousErrorAction }
        if ($maintenanceExitCode -ne 0) { throw "Stage3 maintenance failed before package sealing: $maintenanceText" }
    }

    if ((Get-SectionStatus $runFull 'stage3') -eq 'open') {
        $writerArgs = @('-Action','record-writer-stage','-RunPath',$runRelative,'-Package','stage3','-SemanticDataPath',$stage3SemanticRelative)
        if ($PrimaryWriter) { $writerArgs += '-PrimaryWriter' } elseif ($AgentIds) { $writerArgs += @('-AgentIds',$AgentIds) }
        [void](Invoke-Control $writerArgs)
        [void](Invoke-Control @('-Action','seal-package-section','-RunPath',$runRelative,'-Package','stage3','-SemanticDataPath',$stage3SemanticRelative))
        [void](Invoke-Control @('-Action','render-package','-RunPath',$runRelative,'-Package','stage3','-OutputPath',(Relative-Path $stage3Package)))
    } else { [void]$reused.Add('stage3') }
    [void](Invoke-Control @('-Action','record-package','-RunPath',$runRelative,'-Package','stage3','-PackagePath',(Relative-Path $stage3Package)))

    if ($maintenanceReusable) {
        [void](Invoke-Control @('-Action','record-package','-RunPath',$runRelative,'-Package','maintenance','-PackagePath',(Relative-Path $maintenance)))
        [void]$reused.Add('maintenance')
    } else {
        [void](Invoke-Control @('-Action','record-package','-RunPath',$runRelative,'-Package','maintenance','-PackagePath',(Relative-Path $maintenance)))
    }

    if ((Get-SectionStatus $runFull 'gate_audit') -eq 'open') {
        [void](Invoke-Control @('-Action','seal-package-section','-RunPath',$runRelative,'-Package','gate_audit','-SemanticDataPath',$gateSemanticRelative))
        [void](Invoke-Control @('-Action','render-package','-RunPath',$runRelative,'-Package','gate_audit','-OutputPath',(Relative-Path $gatePackage)))
    } else { [void]$reused.Add('gate_audit') }
    [void](Invoke-Control @('-Action','record-package','-RunPath',$runRelative,'-Package','gate_audit','-PackagePath',(Relative-Path $gatePackage)))
    [pscustomobject][ordered]@{ status='sealed'; phase='Seal'; reused=@($reused | ForEach-Object { $_ }); stage3_package=Relative-Path $stage3Package; maintenance=Relative-Path $maintenance; gate_audit_package=Relative-Path $gatePackage; next_action='Stage the generated run-local evidence, create the single Stage3 commit, then run check-stage3.' } | ConvertTo-Json -Depth 10
} catch {
    [Console]::Error.WriteLine('FINALIZE_INGEST_STAGE3_FAILED: ' + $_.Exception.Message)
    exit 2
}
