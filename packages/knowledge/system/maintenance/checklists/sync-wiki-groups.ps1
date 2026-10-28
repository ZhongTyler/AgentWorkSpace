[CmdletBinding()]
param([ValidateSet('Check', 'Sync')][string]$Mode = 'Check', [string]$Root = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Join-Path $PSScriptRoot '../../..' }
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$wikiRoot = Join-Path $rootPath 'wiki'
$groupsRoot = Join-Path $rootPath 'groups'
$utf8NoBom = New-Object Text.UTF8Encoding($false)

function Get-FrontmatterBody([string]$Text) { $match = [regex]::Match($Text, '(?ms)\A---\s*\r?\n(?<body>.*?)\r?\n---'); if ($match.Success) { return $match.Groups['body'].Value }; return $null }
function Get-FrontmatterScalar([string]$Body, [string]$Field) { if ($null -eq $Body) { return '' }; $match = [regex]::Match($Body, '(?m)^' + [regex]::Escape($Field) + ':\s*(?<value>[^\r\n#]+?)\s*$'); if ($match.Success) { return $match.Groups['value'].Value.Trim().Trim('"', "'") }; return '' }
function Get-FrontmatterList([string]$Body, [string]$Field) { if ($null -eq $Body) { return @() }; $match = [regex]::Match($Body, '(?m)^' + [regex]::Escape($Field) + ':\s*\[(?<items>[^\]]*)\]\s*$'); if ($match.Success) { return @($match.Groups['items'].Value -split ',' | ForEach-Object { $_.Trim().Trim('"', "'") } | Where-Object { $_ -ne '' }) }; return @() }

try {
    if (-not (Test-Path -LiteralPath $groupsRoot -PathType Container)) { Write-Output (@{ status = 'passed'; groups = 0 } | ConvertTo-Json); exit 0 }
    $members = @{}
    foreach ($wiki in @(Get-ChildItem -LiteralPath $wikiRoot -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' })) {
        $body = Get-FrontmatterBody (Get-Content -Raw -Encoding UTF8 -LiteralPath $wiki.FullName)
        foreach ($id in @(Get-FrontmatterList $body 'groups')) { if (-not $members.ContainsKey($id)) { $members[$id] = New-Object 'System.Collections.Generic.List[string]' }; [void]$members[$id].Add($wiki.BaseName) }
    }
    $changed = 0
    foreach ($group in @(Get-ChildItem -LiteralPath $groupsRoot -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' -and $_.Name -ne 'group.template.md' } | Sort-Object Name)) {
        $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $group.FullName
        $frontmatter = Get-FrontmatterBody $text
        $id = Get-FrontmatterScalar $frontmatter 'id'
        $status = Get-FrontmatterScalar $frontmatter 'status'
        $approvalStatus = Get-FrontmatterScalar $frontmatter 'approval_status'
        $receipt = Get-FrontmatterScalar $frontmatter 'last_review_receipt'
        if ([string]::IsNullOrWhiteSpace($id)) { throw "Group has no id: $($group.FullName)" }
        if ($status -ne 'active' -or $approvalStatus -ne 'approved') { throw "Group is not active and approved: $($group.FullName)" }
        if ([string]::IsNullOrWhiteSpace($receipt) -or -not (Test-Path -LiteralPath (Join-Path $rootPath $receipt) -PathType Leaf)) { throw "Group review receipt is unavailable: $($group.FullName)" }
        # Culture-sensitive Sort-Object differs between Windows PowerShell and
        # PowerShell 7 for mixed CJK/Latin names. Persist one ordinal order.
        $memberNames = New-Object 'System.Collections.Generic.SortedSet[string]' ([StringComparer]::Ordinal)
        if ($members.ContainsKey($id)) {
            foreach ($member in $members[$id]) { [void]$memberNames.Add($member) }
        }
        $rows = @($memberNames | ForEach-Object { '- [' + $_ + '](<../wiki/' + $_ + '.md>)' })
        $replacement = "<!-- generated:wiki-group-members:start -->`n" + ($rows -join "`n") + $(if ($rows.Count -gt 0) { "`n" } else { '' }) + '<!-- generated:wiki-group-members:end -->'
        $markerPattern = '(?ms)<!-- generated:wiki-group-members:start -->\r?\n?.*?<!-- generated:wiki-group-members:end -->'
        if (-not [regex]::IsMatch($text, $markerPattern)) { throw "Group member markers missing: $($group.FullName)" }
        $updated = [regex]::Replace($text, $markerPattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $replacement })
        if ($updated -ne $text) { $changed++; if ($Mode -eq 'Sync') { [IO.File]::WriteAllText($group.FullName, $updated.Replace("`r`n", "`n"), $utf8NoBom) } }
    }
    if ($Mode -eq 'Check' -and $changed -gt 0) { throw "Group navigation is stale for $changed file(s). Run sync-wiki-groups.ps1 -Mode Sync." }
    Write-Output (([ordered]@{ status = if ($Mode -eq 'Sync') { 'synced' } else { 'passed' }; groups = @(Get-ChildItem -LiteralPath $groupsRoot -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' -and $_.Name -ne 'group.template.md' }).Count; changed = $changed } | ConvertTo-Json))
} catch { [Console]::Error.WriteLine("WIKI_GROUP_SYNC_FAILED: $($_.Exception.Message)"); exit 2 }
