[CmdletBinding()]
param([string]$Root = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Join-Path $PSScriptRoot '../../..' }
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$failures = New-Object System.Collections.Generic.List[string]

function Relative-Path([string]$Path) {
    return $Path.Substring($rootPath.Length).TrimStart('\', '/').Replace('\', '/')
}

$requiredDirectories = @(
    'Clippings', 'raw-sources', 'wiki', 'domains', 'groups', 'tests', 'system', 'system/protocols',
    'research-reports', 'system/sync', 'system/query', 'system/registry', 'system/integrations', 'system/maintenance',
    'system/maintenance/CHANGELOG_archive', 'system/maintenance/checklists',
    'system/maintenance/ingest-runs', 'system/maintenance/group-proposals',
    'system/maintenance/receipts', 'system/maintenance/schemas', 'system/examples', 'system/examples/ingest-content'
)
$actualDirectories = @(Get-ChildItem -LiteralPath $rootPath -Recurse -Directory -Force | ForEach-Object { Relative-Path $_.FullName })
foreach ($relative in $requiredDirectories) {
    if ($relative -notin $actualDirectories) { $failures.Add("Missing formal directory: $relative") }
}
foreach ($relative in $actualDirectories) {
    if ($relative -notin $requiredDirectories) { $failures.Add("Unexpected directory outside formal tree: $relative") }
}

$requiredFiles = @(
    'README.md', 'AGENTS.md', 'COMMAND_MANUAL.md', 'NOW.md', '.gitignore',
    'domains/domain.template.md', 'raw-sources/raw-source.template.md', 'wiki/wiki.template.md',
    'groups/README.md', 'groups/group.template.md',
    'system/protocols/RUNTIME_ROUTING.md', 'system/protocols/QUERY_PROTOCOL.md',
    'system/protocols/INGEST_PROTOCOL.md', 'system/protocols/SCORING_SYSTEM.md',
    'system/registry/KNOWLEDGE_SCOPE.md', 'system/registry/KNOWLEDGE_STATUS.md',
    'system/maintenance/initialize-knowledge.ps1', 'system/maintenance/setup-wizard.ps1',
    'system/maintenance/checklists/run-query-contract.ps1',
    'system/maintenance/checklists/check-wiki-groups.ps1',
    'system/maintenance/checklists/sync-wiki-groups.ps1',
    'system/maintenance/checklists/sync-quick-reference-groups.ps1',
    'system/maintenance/checklists/validate-wiki-group-query-plan.ps1',
    'system/maintenance/checklists/run-ingest-maintenance.ps1',
    'system/maintenance/checklists/run-platform-contract.ps1',
    'tests/retrieval.contract.mjs', 'tests/retrieval-maintenance.contract.mjs',
    'tests/retrieval-hook.contract.mjs', 'tests/answer-review.contract.mjs'
)
foreach ($relative in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $rootPath $relative) -PathType Leaf)) { $failures.Add("Missing required file: $relative") }
}

if (Test-Path -LiteralPath (Join-Path $rootPath 'agents')) { $failures.Add('Released package must not contain agents/.') }
$allowedRootFiles = @('.gitignore', '_release.json', 'README.md', 'AGENTS.md', 'COMMAND_MANUAL.md', 'NOW.md')
Get-ChildItem -LiteralPath $rootPath -File -Force | Where-Object { $_.Name -notin $allowedRootFiles } | ForEach-Object { $failures.Add("Unexpected root file: $($_.Name)") }
$allowedRootDirectories = @('Clippings', 'raw-sources', 'wiki', 'domains', 'groups', 'tests', 'system', 'research-reports')
Get-ChildItem -LiteralPath $rootPath -Directory -Force | Where-Object { $_.Name -notin $allowedRootDirectories } | ForEach-Object { $failures.Add("Unexpected root directory: $($_.Name)") }
$allowedTests = @('answer-review.contract.mjs', 'ingest-agent-routing.contract.mjs', 'ingest-consolidated.contract.mjs', 'ingest-finalizer.contract.mjs', 'ingest-parent-pipeline.contract.mjs', 'ingest-preflight.contract.mjs', 'research-reports.contract.mjs', 'retrieval-hook.contract.mjs', 'retrieval-maintenance.contract.mjs', 'retrieval.contract.mjs')
Get-ChildItem -LiteralPath (Join-Path $rootPath 'tests') -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notin $allowedTests } | ForEach-Object { $failures.Add("Unexpected regression test file: $($_.Name)") }

$allFiles = @(Get-ChildItem -LiteralPath $rootPath -Recurse -File -Force)
$packageFiles = @($allFiles | Where-Object { (Relative-Path $_.FullName) -notin @('_release.json', 'system/integrations/ima-config.local.json') })
$inventory = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $rootPath '_release.json') | ConvertFrom-Json
if ($packageFiles.Count -ne [int]$inventory.file_count) { $failures.Add("Package files differ from generated marker inventory: $($packageFiles.Count)") }
foreach ($file in $allFiles) {
    $relative = Relative-Path $file.FullName
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { $failures.Add("UTF-8 BOM found: $relative") }
    for ($i = 0; $i -lt $bytes.Length - 1; $i++) {
        if ($bytes[$i] -eq 13 -and $bytes[$i + 1] -eq 10) { $failures.Add("CRLF found: $relative"); break }
    }
}

$markerPath = Join-Path $rootPath '_release.json'
try {
    $marker = Get-Content -LiteralPath $markerPath -Raw -Encoding utf8 | ConvertFrom-Json
    if ($marker.release_schema -ne 1) { $failures.Add('Release marker schema must be 1') }
    if ([string]$marker.source_revision -notmatch '^[0-9a-f]{40}$') { $failures.Add('Release marker source_revision is invalid') }
    if ([string]$marker.manifest_sha256 -notmatch '^[0-9a-f]{64}$') { $failures.Add('Release marker manifest_sha256 is invalid') }
}
catch { $failures.Add('Invalid JSON: _release.json') }

$forbiddenConfigTokens = @('EnableExpertLayer', 'expert_layer_enabled', 'agent_type')
foreach ($file in $allFiles | Where-Object { $_.Extension -in @('.md', '.ps1', '.json') }) {
    $relative = Relative-Path $file.FullName
    if ($relative -in @('system/maintenance/checklists/run-release-contract.ps1', 'system/maintenance/checklists/run-query-contract.ps1')) { continue }
    $text = [IO.File]::ReadAllText($file.FullName, [Text.Encoding]::UTF8)
    foreach ($token in $forbiddenConfigTokens) {
        if ($text.Contains($token)) { $failures.Add("Retired Agent configuration returned in ${relative}: $token") }
    }
}

if ($failures.Count -gt 0) {
    $failures | Sort-Object -Unique | ForEach-Object { Write-Error $_ }
    exit 1
}

& (Join-Path $rootPath 'system/maintenance/checklists/run-query-contract.ps1') -Root $rootPath
& (Join-Path $rootPath 'system/maintenance/checklists/run-platform-contract.ps1') -Root $rootPath
Write-Output "Release contract: PASS ($($packageFiles.Count) business files; $($allFiles.Count) versioned runtime files)"
