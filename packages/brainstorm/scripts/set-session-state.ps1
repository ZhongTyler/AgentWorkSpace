[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [string]$ToState = '',
    [ValidateSet('unchanged', 'delegate', 'confirm')][string]$PruningAction = 'unchanged',
    [switch]$GoalChanged,
    [ValidateSet('cocreate', 'autonomous')][string]$RunMode
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'session-common.ps1')

if (-not [string]::IsNullOrWhiteSpace($ToState)) {
    Assert-SessionContract -Condition ($script:BrainstormStates -ccontains $ToState) -Message "Invalid ToState: $ToState"
}
Assert-SessionContract -Condition (-not ($GoalChanged -and $PruningAction -ceq 'delegate')) -Message 'GoalChanged cannot reuse delegated authority in the same command.'

$statePath = Resolve-SessionStatePath -SessionPath $SessionPath
$state = Read-Utf8Json -Path $statePath
$initialValidation = Get-SessionValidation -SessionPath $statePath
if ([string]$state.status -ceq 'closed') {
    $closedNoOp = ([string]::IsNullOrWhiteSpace($ToState) -or $ToState -ceq 'closed') -and
        $PruningAction -ceq 'unchanged' -and -not $GoalChanged -and -not $PSBoundParameters.ContainsKey('RunMode')
    Assert-SessionContract -Condition $closedNoOp -Message 'Closed sessions are immutable.'
    [pscustomobject][ordered]@{
        changed = $false
        state_path = $statePath
        validation = $initialValidation
    } | ConvertTo-Json -Depth 16
    exit 0
}

$changed = $false
$recordUpdatePending = $false
$now = (Get-Date).ToUniversalTime().ToString('o')
$currentState = [string]$state.status
if ($PSBoundParameters.ContainsKey('RunMode') -and $RunMode -cne [string]$state.run_mode) {
    $state.run_mode = $RunMode
    $recordPath = Resolve-SafeRelativePath -BasePath (Split-Path -Parent $statePath) -RelativePath ([string]$state.record_path)
    $record = [IO.File]::ReadAllText($recordPath, $script:BrainstormUtf8NoBom)
    $record = [regex]::Replace($record, '(?m)^> Run mode:[^\r\n]*', "> Run mode: $RunMode")
    $recordUpdatePending = $true
    $changed = $true
}

if (-not [string]::IsNullOrWhiteSpace($ToState) -and $ToState -cne $currentState) {
    Assert-SessionContract -Condition (Test-AllowedStateTransition -From $currentState -To $ToState) -Message "Illegal state transition: $currentState->$ToState"
    $eventName = Get-StateTransitionEvent -From $currentState -To $ToState
    $nextSequence = [int]$state.state_sequence + 1
    $state.state_history = @($state.state_history) + [pscustomobject][ordered]@{
        sequence = $nextSequence
        from = $currentState
        to = $ToState
        event = $eventName
        changed_at = $now
    }
    $state.state_sequence = $nextSequence
    $state.status = $ToState
    if ($ToState -ceq 'closed') { $state.closed_at = $now }
    $changed = $true
}

function Set-PruningAuthority {
    param([string]$Authority, [string]$Event)
    if ([string]$state.pruning_authority -ceq $Authority) { return }
    $from = [string]$state.pruning_authority
    $nextSequence = [int]$state.pruning_sequence + 1
    $state.pruning_history = @($state.pruning_history) + [pscustomobject][ordered]@{
        sequence = $nextSequence
        from = $from
        to = $Authority
        event = $Event
        changed_at = $now
    }
    $state.pruning_sequence = $nextSequence
    $state.pruning_authority = $Authority
    $state.delegated_scope = if ($Authority -ceq 'delegated') { 'current-session-current-goal' } else { $null }
    $script:changed = $true
}

if ($GoalChanged) {
    $state.goal_revision = [int]$state.goal_revision + 1
    Set-PruningAuthority -Authority 'confirm' -Event 'goal-changed'
    $changed = $true
}

if ($PruningAction -ceq 'delegate') {
    Set-PruningAuthority -Authority 'delegated' -Event 'delegated'
} elseif ($PruningAction -ceq 'confirm') {
    Set-PruningAuthority -Authority 'confirm' -Event 'restored'
}

if ([string]$state.status -ceq 'closed') {
    Set-PruningAuthority -Authority 'confirm' -Event 'session-closed'
}

$validation = $initialValidation
$indexSummary = $null
if ($changed) {
    $state.updated_at = $now
    $commitArgs = @{ SessionPath = $statePath; State = $state }
    if ($recordUpdatePending) { $commitArgs.Record = $record }
    $commit = Complete-SessionUpdate @commitArgs
    $validation = $commit.validation
    $indexSummary = [pscustomobject]@{ session_count = $commit.index.session_count; total_bytes = $commit.index.total_bytes; warnings = @($commit.index.warnings) }
}
[pscustomobject][ordered]@{
    changed = $changed
    state_path = $statePath
    validation = $validation
    index_summary = $indexSummary
} | ConvertTo-Json -Depth 16
