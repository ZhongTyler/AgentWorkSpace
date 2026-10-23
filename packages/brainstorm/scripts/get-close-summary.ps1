[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [string]$SessionRoot = '',
    [string]$TaskStatusPath = '',
    [string]$TaskId = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'session-common.ps1')

$statePath = Resolve-SessionStatePath -SessionPath $SessionPath
$sessionDirectory = Split-Path -Parent $statePath
$validation = Get-SessionValidation -SessionPath $sessionDirectory -SessionRoot $SessionRoot
$state = Read-Utf8Json -Path $statePath

$briefPath = Join-Path $sessionDirectory 'game-concept-brief.md'
$briefPresent = Test-Path -LiteralPath $briefPath -PathType Leaf
$briefStatus = 'absent'
$selectedPackageId = $null
$fromdemotospecIntent = 'not-recorded'
if ($briefPresent) {
    $brief = [IO.File]::ReadAllText($briefPath, $script:BrainstormUtf8NoBom)
    $headers = @('Brief status', 'Selected package ID', 'Decision IDs', 'FromDemoToSpec intent', 'Missing')
    $rows = @(Get-MarkdownTableRows -Content $brief -Heading 'Decision and Handoff' -ExpectedHeaders $headers)
    Assert-SessionContract -Condition ($rows.Count -eq 1) -Message 'Close summary requires exactly one Brief Decision and Handoff row.'
    $briefStatus = [string]$rows[0].cells[0]
    $selectedPackageId = [string]$rows[0].cells[1]
    $fromdemotospecIntent = [string]$rows[0].cells[3]
}

$gapPath = Join-Path $sessionDirectory 'fromdemotospec-gap.json'
$gapPresent = Test-Path -LiteralPath $gapPath -PathType Leaf
$gapStatus = 'not-created'
$externalFlowStarted = $null
if ($gapPresent) {
    $gap = Read-Utf8Json -Path $gapPath
    $gapStatus = [string]$gap.status
    $externalFlowStarted = [bool]$gap.external_flow_started
}
$gapValidationError = $null
if ($gapPresent -and [string]$state.status -cne 'closed') {
    try {
        . (Join-Path $PSScriptRoot 'adapter-common.ps1')
        [void](Get-FromDemoToSpecGapValidation -SessionPath $sessionDirectory -SessionRoot $SessionRoot)
    } catch { $gapStatus = 'review-required'; $gapValidationError = $_.Exception.Message }
}
$handoffPresent = Test-Path -LiteralPath (Join-Path $sessionDirectory 'fromdemotospec-handoff.md') -PathType Leaf

$managedLifecycle = 'not-provided'
$resultRevision = $null
$receiptEventId = $null
$parentIntegrationStatus = 'not-provided'
if (-not [string]::IsNullOrWhiteSpace($TaskStatusPath)) {
    Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($TaskId)) -Message 'TaskId is required with TaskStatusPath.'
    $taskStatus = Read-Utf8Json -Path ([IO.Path]::GetFullPath($TaskStatusPath))
    Assert-ObjectProperty -Object $taskStatus -Name 'data'
    $task = @($taskStatus.data.tasks | Where-Object { [string]$_.task_id -ceq $TaskId })
    $receipt = @($taskStatus.data.receipts | Where-Object { [string]$_.task_id -ceq $TaskId })
    $archivedIds = @($taskStatus.data.lifecycle_summary.archived.task_ids)
    if ($task.Count -eq 1) {
        $managedLifecycle = [string]$task[0].status
    } elseif ($archivedIds -ccontains $TaskId) {
        $managedLifecycle = 'archived'
    } else {
        $managedLifecycle = 'not-found'
    }
    if ($receipt.Count -ge 1) {
        $resultRevision = [string]$receipt[-1].result_revision
        $receiptEventId = [string]$receipt[-1].event_id
    }
    if (@('released', 'archived') -ccontains $managedLifecycle) {
        $parentIntegrationStatus = 'released'
    } elseif ($managedLifecycle -ceq 'ready') {
        $parentIntegrationStatus = 'pending'
    } elseif ($managedLifecycle -ceq 'active') {
        $parentIntegrationStatus = 'not-started'
    } else {
        $parentIntegrationStatus = 'unknown'
    }
}

[pscustomobject][ordered]@{
    summary_complete = $true
    session = [pscustomobject][ordered]@{
        session_id = [string]$state.session_id
        status = [string]$state.status
        current_phase = [string]$validation.current_phase
        continuation = $validation.continuation
    }
    brief = [pscustomobject][ordered]@{
        present = $briefPresent
        status = $briefStatus
        selected_package_id = $selectedPackageId
    }
    fromdemotospec = [pscustomobject][ordered]@{
        intent = $fromdemotospecIntent
        gap_status = $gapStatus
        validation_error = $gapValidationError
        handoff_present = $handoffPresent
        external_flow_started = $externalFlowStarted
    }
    managed = [pscustomobject][ordered]@{
        task_id = if ([string]::IsNullOrWhiteSpace($TaskId)) { $null } else { $TaskId }
        lifecycle = $managedLifecycle
        result_revision = $resultRevision
        receipt_event_id = $receiptEventId
        parent_integration_status = $parentIntegrationStatus
    }
} | ConvertTo-Json -Depth 16
