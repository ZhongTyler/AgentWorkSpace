[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [string]$SessionRoot = '',
    [string]$CombinationPath = ''
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot 'session-common.ps1')
. (Join-Path $scriptRoot 'playbook-common.ps1')

Assert-SessionWritable -SessionPath $SessionPath
$statePath = Resolve-SessionStatePath -SessionPath $SessionPath
$sessionDirectory = Split-Path -Parent $statePath
$validation = Get-SessionValidation -SessionPath $sessionDirectory -SessionRoot $SessionRoot
$state = Read-Utf8Json -Path $statePath
Assert-PlaybookContract -Condition ([string]$state.status -cne 'closed') -Message 'A closed session cannot receive a new combination gate.'
if ([string]::IsNullOrWhiteSpace($CombinationPath)) {
    $CombinationPath = Join-Path $sessionDirectory 'game-concept-combinations.md'
}
$CombinationPath = [IO.Path]::GetFullPath($CombinationPath)
$sessionPrefix = [IO.Path]::GetFullPath($sessionDirectory).TrimEnd([char]92, [char]47) + [IO.Path]::DirectorySeparatorChar
Assert-PlaybookContract -Condition ($CombinationPath.StartsWith($sessionPrefix, [StringComparison]::OrdinalIgnoreCase)) -Message 'CombinationPath must stay inside the session directory.'
Assert-PlaybookContract -Condition (-not (Test-Path -LiteralPath $CombinationPath)) -Message "Combination gate already exists: $CombinationPath"

$templatePath = Join-Path $script:BrainstormPlaybookProjectRoot 'templates\game-concept-combinations.md'
Assert-PlaybookContract -Condition (Test-Path -LiteralPath $templatePath -PathType Leaf) -Message "Missing combination template: $templatePath"
$createdAt = (Get-Date).ToUniversalTime().ToString('o')
$content = [IO.File]::ReadAllText($templatePath, $script:BrainstormPlaybookUtf8NoBom)
$content = $content.Replace('{{SESSION_ID}}', [string]$state.session_id)
$content = $content.Replace('{{SESSION_TITLE}}', [string]$state.title)
$content = $content.Replace('{{CREATED_AT}}', $createdAt)
Write-PlaybookUtf8TextAtomic -Path $CombinationPath -Value $content

if ([string]::IsNullOrWhiteSpace($SessionRoot)) {
    $SessionRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $sessionDirectory))
}
$index = Write-SessionIndex -SessionRoot ([IO.Path]::GetFullPath($SessionRoot))
[pscustomobject][ordered]@{
    created = $true
    playbook_id = 'game-concept'
    session_id = [string]$state.session_id
    session_status = [string]$validation.status
    combination_path = $CombinationPath
    combination_schema = 2
    gate_status = 'open'
    index_summary = [pscustomobject][ordered]@{
        session_count = [int]$index.session_count
        total_bytes = [long]$index.total_bytes
        warnings = @($index.warnings)
    }
    semantic_review = 'required'
} | ConvertTo-Json -Depth 16
