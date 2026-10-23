[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [string]$SessionRoot = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'session-common.ps1')
$statePath = Resolve-SessionStatePath -SessionPath $SessionPath
$directory = Split-Path -Parent $statePath
$validation = Get-SessionValidation -SessionPath $directory -SessionRoot $SessionRoot -LocalOnly
$state = Read-Utf8Json -Path $statePath
if ([string]::IsNullOrWhiteSpace($SessionRoot)) { $SessionRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $directory)) }
$rootDiagnostics = Get-SessionRootDiagnostics -SessionRoot $SessionRoot
Assert-SessionContract (@($rootDiagnostics.identities | Where-Object { $_.session_id -ceq [string]$state.session_id }).Count -eq 1) 'Ambiguous session identity; repair duplicate identities before resuming.'
Assert-SessionContract -Condition ([string]$state.status -cne 'closed') -Message 'Closed sessions are archives and cannot resume.'
$recordPath = Resolve-SafeRelativePath -BasePath $directory -RelativePath ([string]$state.record_path)
$record = [IO.File]::ReadAllText($recordPath, $script:BrainstormUtf8NoBom)
$continuation = $validation.continuation
$decisions = @(Get-MarkdownTableRows -Content $record -Heading 'Decision Record' -ExpectedHeaders @('Decision ID', 'Candidate IDs', 'Decision', 'Criteria', 'Evidence IDs', 'Decider'))
$history = @($decisions | ForEach-Object {
    [pscustomobject][ordered]@{
        decision_id = [string]$_.cells[0]
        candidate_ids = @(Split-ControlReferences -Value ([string]$_.cells[1]))
        decision = [string]$_.cells[2]
        criteria = [string]$_.cells[3]
        evidence_ids = @(Split-ControlReferences -Value ([string]$_.cells[4]))
        decider = [string]$_.cells[5]
    }
})
[pscustomobject][ordered]@{
    resumed_context = $true
    root_health = if ($rootDiagnostics.problems.Count -eq 0) { 'healthy' } else { 'degraded' }
    root_problems = @($rootDiagnostics.problems)
    root_health_scope = 'identity scan only; sibling content not validated'
    changed = $false
    execution_started = $false
    session_id = [string]$state.session_id
    session_path = $directory
    schema_version = [int]$state.schema_version
    status = [string]$state.status
    run_mode = [string]$state.run_mode
    pruning_authority = [string]$state.pruning_authority
    goal_revision = [int]$state.goal_revision
    current = $continuation
    waiting_boundary = [string]$state.status -ceq 'paused' -or [string]$continuation.pause_boundary -cne 'none'
    current_decisions = @($history | Where-Object { @($continuation.decision_refs) -ccontains $_.decision_id })
    decision_history = $history
    session_brief = Get-SessionSection -Content $record -Heading 'Session Brief'
    open_questions = Get-SessionSection -Content $record -Heading 'Open Questions'
    handoff = Get-SessionSection -Content $record -Heading 'Handoff'
    last_recorded_phase = [string]$validation.current_phase
    last_recorded_method = [string]$validation.current_method_id
    semantic_review = 'required; current refs are explicit and do not revoke unlisted historical decisions'
} | ConvertTo-Json -Depth 20
