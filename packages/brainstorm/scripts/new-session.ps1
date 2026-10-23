[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Goal,
    [ValidateSet('quick', 'standard', 'deep')][string]$Mode = 'standard',
    [ValidateSet('cocreate', 'autonomous')][string]$RunMode = 'cocreate',
    [ValidateSet('private', 'shareable', 'example')][string]$Visibility = 'private',
    [string]$HostProject = '',
    [string]$HostProjectRoot = '',
    [string]$OutputRoot = '',
    [string]$SessionId = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'session-common.ps1')

Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($Title) -and $Title.Length -le 160) -Message 'Title must contain 1-160 characters.'
Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($Goal)) -Message 'Goal is required.'

$now = (Get-Date).ToUniversalTime()
if ([string]::IsNullOrWhiteSpace($SessionId)) {
    $SessionId = 'bs-' + $now.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
}
Assert-SessionContract -Condition (Test-SessionId -SessionId $SessionId) -Message 'SessionId must contain a valid date/time and match bs-YYYYMMDD-HHmmss-<6 lowercase hex>.'

$storageKind = 'brainstorm'
if (-not [string]::IsNullOrWhiteSpace($OutputRoot)) {
    $resolvedRoot = [IO.Path]::GetFullPath($OutputRoot)
    $storageKind = 'explicit'
} elseif (-not [string]::IsNullOrWhiteSpace($HostProjectRoot)) {
    $resolvedRoot = [IO.Path]::GetFullPath((Join-Path $HostProjectRoot 'docs\brainstorm'))
    $storageKind = 'host'
    if ([string]::IsNullOrWhiteSpace($HostProject)) { $HostProject = Split-Path -Leaf ([IO.Path]::GetFullPath($HostProjectRoot)) }
} else {
    $resolvedRoot = [IO.Path]::GetFullPath((Join-Path (Get-BrainstormProjectRoot) 'workspace\sessions'))
}

$datePart = $SessionId.Substring(3, 8)
$year = $datePart.Substring(0, 4)
$month = $datePart.Substring(4, 2)
$sessionDirectory = Join-Path (Join-Path (Join-Path $resolvedRoot $year) $month) $SessionId
Assert-SessionContract -Condition (-not (Test-Path -LiteralPath $sessionDirectory)) -Message "Session already exists: $sessionDirectory"

$createdAt = $now.ToString('o')
$hostValue = if ([string]::IsNullOrWhiteSpace($HostProject)) { $null } else { $HostProject }

$state = [pscustomobject][ordered]@{
    schema_version = 2
    session_id = $SessionId
    title = $Title
    mode = $Mode
    run_mode = $RunMode
    status = 'open'
    visibility = $Visibility
    storage_kind = $storageKind
    host_project = $hostValue
    record_path = 'session.md'
    pruning_authority = 'confirm'
    delegated_scope = $null
    goal_revision = 1
    state_sequence = 0
    pruning_sequence = 0
    created_at = $createdAt
    updated_at = $createdAt
    closed_at = $null
    state_history = @(
        [pscustomobject][ordered]@{
            sequence = 0
            from = $null
            to = 'open'
            event = 'created'
            changed_at = $createdAt
        }
    )
    pruning_history = @(
        [pscustomobject][ordered]@{
            sequence = 0
            from = $null
            to = 'confirm'
            event = 'default'
            changed_at = $createdAt
        }
    )
}

$templatePath = Join-Path (Get-BrainstormProjectRoot) 'templates\session-record.md'
Assert-SessionContract -Condition (Test-Path -LiteralPath $templatePath -PathType Leaf) -Message "Missing session template: $templatePath"
$record = [IO.File]::ReadAllText($templatePath, (New-Object Text.UTF8Encoding($false)))
$record = $record.Replace('{{SESSION_ID}}', $SessionId)
$record = $record.Replace('{{TITLE}}', $Title)
$record = $record.Replace('{{GOAL}}', $Goal)
$record = $record.Replace('{{MODE}}', $Mode)
$record = $record.Replace('{{RUN_MODE}}', $RunMode)
$record = $record.Replace('{{CREATED_AT}}', $createdAt)
$record = $record.Replace('{{VISIBILITY}}', $Visibility)
$record = $record.Replace('{{HOST_PROJECT}}', $(if ($null -eq $hostValue) { 'none' } else { [string]$hostValue }))

Assert-SafePhysicalPath -Path $sessionDirectory
$sessionCommitted = $false
try {
    [void](New-Item -ItemType Directory -Path $sessionDirectory -Force)
    [IO.File]::WriteAllText((Join-Path $sessionDirectory 'session.md'), $record, (New-Object Text.UTF8Encoding($false)))
    Write-Utf8JsonAtomic -Path (Join-Path $sessionDirectory 'session-state.json') -Value $state
    $result = Get-SessionValidation -SessionPath $sessionDirectory -SessionRoot $resolvedRoot
    $sessionCommitted = $true
    $index = Write-SessionIndex -SessionRoot $resolvedRoot
    [pscustomobject][ordered]@{
        created = $true
        session_path = $sessionDirectory
        validation = $result
        index_summary = [pscustomobject][ordered]@{
            session_count = [int]$index.session_count
            total_bytes = [long]$index.total_bytes
            warnings = @($index.warnings)
        }
    } | ConvertTo-Json -Depth 16
} catch {
    if (-not $sessionCommitted -and (Test-Path -LiteralPath $sessionDirectory -PathType Container)) {
        $expectedPrefix = $resolvedRoot.TrimEnd([char]92, [char]47) + [IO.Path]::DirectorySeparatorChar
        $cleanupTarget = [IO.Path]::GetFullPath($sessionDirectory)
        if ($cleanupTarget.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $cleanupTarget -Recurse -Force
        }
    }
    if ($sessionCommitted) {
        Stop-SessionContract -Message "Session was created at $sessionDirectory, but index rebuild failed. Repair the root and rerun build-session-index; do not recreate the session ID. Cause: $($_.Exception.Message)"
    }
    throw
}
