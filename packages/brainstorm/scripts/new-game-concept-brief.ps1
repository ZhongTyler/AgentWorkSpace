[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [string]$SessionRoot = '',
    [string]$BriefPath = ''
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot 'session-common.ps1')
. (Join-Path $scriptRoot 'playbook-common.ps1')
. (Join-Path $scriptRoot 'game-concept-common.ps1')

Assert-SessionWritable -SessionPath $SessionPath
$statePath = Resolve-SessionStatePath -SessionPath $SessionPath
$sessionDirectory = Split-Path -Parent $statePath
$validation = Get-SessionValidation -SessionPath $sessionDirectory -SessionRoot $SessionRoot
$state = Read-Utf8Json -Path $statePath
Assert-PlaybookContract -Condition ([string]$state.status -cne 'closed') -Message 'A closed session cannot receive a new Game Concept brief.'
$combinationValidation = Get-GameConceptCombinationValidation -SessionPath $sessionDirectory -SessionRoot $SessionRoot
Assert-PlaybookContract -Condition ([string]$combinationValidation.gate_status -ceq 'selected') -Message 'Select one Game Concept package before creating the brief.'
$selectedPackageId = [string]$combinationValidation.selected_package_id

if ([string]::IsNullOrWhiteSpace($BriefPath)) {
    $BriefPath = Join-Path $sessionDirectory 'game-concept-brief.md'
}
$BriefPath = [IO.Path]::GetFullPath($BriefPath)
$sessionPrefix = [IO.Path]::GetFullPath($sessionDirectory).TrimEnd([char]92, [char]47) + [IO.Path]::DirectorySeparatorChar
Assert-PlaybookContract -Condition ($BriefPath.StartsWith($sessionPrefix, [StringComparison]::OrdinalIgnoreCase)) -Message 'BriefPath must stay inside the session directory.'
Assert-PlaybookContract -Condition (-not (Test-Path -LiteralPath $BriefPath)) -Message "Brief already exists: $BriefPath"

$templatePath = Join-Path $script:BrainstormPlaybookProjectRoot 'templates\game-concept-brief.md'
Assert-PlaybookContract -Condition (Test-Path -LiteralPath $templatePath -PathType Leaf) -Message "Missing Game Concept template: $templatePath"
$createdAt = (Get-Date).ToUniversalTime().ToString('o')
$brief = [IO.File]::ReadAllText($templatePath, $script:BrainstormPlaybookUtf8NoBom)
$brief = $brief.Replace('{{SESSION_ID}}', [string]$state.session_id)
$brief = $brief.Replace('{{SESSION_TITLE}}', [string]$state.title)
$brief = $brief.Replace('{{CREATED_AT}}', $createdAt)
$brief = $brief.Replace('{{SELECTED_PACKAGE_ID}}', $selectedPackageId)
Write-PlaybookUtf8TextAtomic -Path $BriefPath -Value $brief

if ([string]::IsNullOrWhiteSpace($SessionRoot)) {
    $SessionRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $sessionDirectory))
}
try {
    $index = Write-SessionIndex -SessionRoot ([IO.Path]::GetFullPath($SessionRoot))
} catch {
    Stop-PlaybookContract -Message "Brief was created at $BriefPath, but index rebuild failed. Keep the brief and rerun build-session-index; do not recreate or overwrite it. Cause: $($_.Exception.Message)"
}

[pscustomobject][ordered]@{
    created = $true
    playbook_id = 'game-concept'
    session_id = [string]$state.session_id
    session_status = [string]$validation.status
    selected_package_id = $selectedPackageId
    brief_path = $BriefPath
    index_summary = [pscustomobject][ordered]@{
        session_count = [int]$index.session_count
        total_bytes = [long]$index.total_bytes
        warnings = @($index.warnings)
    }
    semantic_review = 'required'
} | ConvertTo-Json -Depth 16
