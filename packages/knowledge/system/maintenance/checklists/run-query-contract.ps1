[CmdletBinding()]
param([string]$Root = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Join-Path $PSScriptRoot '../../..' }
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$failures = New-Object System.Collections.Generic.List[string]

function Require-Text([string]$RelativePath, [string[]]$Tokens) {
    $path = Join-Path $rootPath $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $failures.Add("Missing file: $RelativePath"); return }
    $text = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
    foreach ($token in $Tokens) {
        if ($text.IndexOf($token, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
            $failures.Add("${RelativePath}: missing token $token")
        }
    }
}

if (Test-Path -LiteralPath (Join-Path $rootPath 'agents')) { $failures.Add('Published package must not contain agents/.') }
Require-Text 'system/protocols/RUNTIME_ROUTING.md' @('QUERY_PROTOCOL.md', 'INGEST_PROTOCOL.md')
Require-Text 'system/protocols/QUERY_PROTOCOL.md' @('query-evidence.mjs', 'source_read', 'source_reused', 'claim_support', 'budget_exhausted')
Require-Text 'system/protocols/QUERY_PROTOCOL.md' @('Wiki Group', 'selected_via_group', 'raw', 'candidate_order')
Require-Text 'system/maintenance/checklists/knowledge-health-check.md' @('Raw', 'Wiki', 'Query')
Require-Text 'groups/README.md' @('Wiki Group', 'active', 'frontmatter')
Require-Text 'system/maintenance/checklists/check-wiki-groups.ps1' @('group_member_navigation_drift', 'wiki_group_unknown')
Require-Text 'system/maintenance/checklists/validate-wiki-group-query-plan.ps1' @('wiki_group_query_selection_receipt', 'candidate_order', 'group_peer', 'wiki_budget')
Require-Text 'system/maintenance/receipts/wiki-group-query-selection.template.json' @('schema_version', 'selected_via_group', 'raw_expansion')

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}

& node (Join-Path $rootPath 'system/query/query-evidence-check.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Query evidence behavior checks failed.' }
Write-Output 'Query contract: PASS (entry wiring and isolated behavior; semantic quality is separate)'
