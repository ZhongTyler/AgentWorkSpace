[CmdletBinding()]
param(
    [ValidateSet('Report', 'Enforce')]
    [string]$Mode = 'Report',
    [string[]]$Path = @(),
    [string]$OutputPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object Text.UTF8Encoding($false)
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$wikiRoot = Join-Path $projectRoot 'wiki'
$closurePath = Join-Path $projectRoot 'system/maintenance/wiki-split-closures.json'

function Add-Finding {
    param(
        [System.Collections.Generic.List[object]]$Findings,
        [string]$Severity,
        [string]$Code,
        [string]$Path,
        [string]$Detail,
        [string]$TargetPath = ''
    )
    [void]$Findings.Add([pscustomobject][ordered]@{
        severity = $Severity
        code = $Code
        path = $Path
        detail = $Detail
        target_path = $TargetPath
    })
}

function Get-Section {
    param([string]$Text, [string]$Heading)
    return [regex]::Match($Text, '(?ms)^##\s+' + [regex]::Escape($Heading) + '\s*$\r?\n(?<body>.*?)(?=^##\s+|\z)')
}

function Convert-UnicodeLiteral {
    param([string]$Value)
    return [regex]::Replace($Value, '\\u([0-9a-fA-F]{4})', {
        param($match)
        return [char][Convert]::ToInt32($match.Groups[1].Value, 16)
    })
}

function Get-RelatedLimit {
    param([int]$Lines)
    if ($Lines -le 300) { return 5 }
    return 8
}

function Get-SourceCount {
    param([string]$Text)
    $frontmatter = [regex]::Match($Text, '(?ms)\A---\s*\r?\n(?<body>.*?)\r?\n---')
    if (-not $frontmatter.Success) { return 0 }
    $sources = [regex]::Match($frontmatter.Groups['body'].Value, '(?ms)^sources:\s*\r?\n(?<items>(?:[ \t]+-\s+.*\r?\n?)+)')
    if (-not $sources.Success) { return 0 }
    return @([regex]::Matches($sources.Groups['items'].Value, '(?m)^[ \t]+-\s+\S.*$')).Count
}

function Get-RelatedEntries {
    param([string]$Body)
    $entries = New-Object 'System.Collections.Generic.List[object]'
    foreach ($line in ($Body -split '\r?\n')) {
        $match = [regex]::Match($line, '^\s*-\s+\[(?<label>[^\]]+)\]\((?<target>[^\)]+)\)(?<tail>.*)$')
        if (-not $match.Success) { continue }
        $target = $match.Groups['target'].Value.Trim().Trim('<', '>')
        if ($target -match '^(?i)(https?|mailto|obsidian):') { continue }
        [void]$entries.Add([pscustomobject]@{
            label = $match.Groups['label'].Value.Trim()
            target = $target
            tail = $match.Groups['tail'].Value.Trim()
            line = $line.Trim()
        })
    }
    return @($entries.ToArray())
}

function Get-HeadingAnchorSet {
    param([string]$Text)
    $anchors = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($match in [regex]::Matches($Text, '(?m)^#{1,6}\s+(?<heading>.+?)\s*$')) {
        $heading = $match.Groups['heading'].Value
        $heading = [regex]::Replace($heading, '\[([^\]]+)\]\([^\)]+\)', '$1')
        $heading = [regex]::Replace($heading, '<[^>]+>', '')
        $heading = [regex]::Replace($heading.Trim().Trim('#').Trim(), '[`*_~]', '')
        [void]$anchors.Add([regex]::Replace($heading, '\s', '-'))
    }
    return ,$anchors
}

function Get-ChineseOrdinalValue {
    param([string]$Value)
    $digits = @{ ([char]0x4e00) = 1; ([char]0x4e8c) = 2; ([char]0x4e09) = 3; ([char]0x56db) = 4; ([char]0x4e94) = 5; ([char]0x516d) = 6; ([char]0x4e03) = 7; ([char]0x516b) = 8; ([char]0x4e5d) = 9 }
    $units = @{ ([char]0x5341) = 10; ([char]0x767e) = 100; ([char]0x5343) = 1000 }
    $total = 0
    $current = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($digits.ContainsKey($character)) { $current = $digits[$character]; continue }
        if ($units.ContainsKey($character)) {
            if ($current -eq 0) { $current = 1 }
            $total += $current * $units[$character]
            $current = 0
            continue
        }
        return $null
    }
    return $total + $current
}

function Resolve-WikiLinkTarget {
    param([string]$SourcePath, [string]$Target, [string]$WikiPrefix)
    $raw = $Target.Trim().Trim('<', '>')
    if ($raw -match '^(?i)(https?|mailto|obsidian):') { return $null }
    $hashIndex = $raw.IndexOf('#')
    if ($hashIndex -lt 0) { return $null }
    try {
        $pathPart = [Uri]::UnescapeDataString($raw.Substring(0, $hashIndex))
        $fragment = [Uri]::UnescapeDataString($raw.Substring($hashIndex + 1))
    } catch {
        return $null
    }
    $fullPath = if ([string]::IsNullOrWhiteSpace($pathPart)) {
        [IO.Path]::GetFullPath($SourcePath)
    } else {
        [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $SourcePath) $pathPart))
    }
    if (-not $fullPath.StartsWith($WikiPrefix, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($fullPath) -ne '.md') { return $null }
    return [pscustomobject]@{ path = $fullPath; fragment = $fragment; target = $raw }
}

try {
    if (-not (Test-Path -LiteralPath $wikiRoot -PathType Container)) { throw "Missing wiki root: $wikiRoot" }
    $findings = New-Object 'System.Collections.Generic.List[object]'
    $pages = New-Object 'System.Collections.Generic.List[object]'
    $sourceHeading = Convert-UnicodeLiteral '\u6765\u6e90'
    $relatedHeading = Convert-UnicodeLiteral '\u76f8\u5173\u9875\u9762'
    if (-not (Test-Path -LiteralPath $closurePath -PathType Leaf)) { throw "Missing split-closure registry: $closurePath" }
    $closureDocument = Get-Content -Raw -Encoding UTF8 -LiteralPath $closurePath | ConvertFrom-Json
    if ($closureDocument.schema_version -ne 1) { throw 'Unsupported split-closure registry schema_version.' }
    $closuresByPath = @{}
    foreach ($closure in @($closureDocument.records)) { $closuresByPath[[string]$closure.path] = $closure }

    $allWikiFiles = @(Get-ChildItem -LiteralPath $wikiRoot -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' } | Sort-Object Name)
    $wikiPrefix = $wikiRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if ($Path.Count -eq 0) {
        $wikiFiles = $allWikiFiles
    } else {
        $selected = @{}
        foreach ($candidate in $Path) {
            if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
            $full = if ([IO.Path]::IsPathRooted($candidate)) {
                [IO.Path]::GetFullPath($candidate)
            } else {
                [IO.Path]::GetFullPath((Join-Path $projectRoot $candidate))
            }
            if (-not $full.StartsWith($wikiPrefix, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($full) -ne '.md' -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
                throw "Path must name an existing Wiki page under wiki/: $candidate"
            }
            $selected[$full] = Get-Item -LiteralPath $full
        }
        $wikiFiles = @($selected.Values | Sort-Object Name)
    }
    $anchorCache = @{}
    foreach ($wikiFile in $allWikiFiles) {
        $anchorCache[$wikiFile.FullName] = Get-HeadingAnchorSet (Get-Content -Raw -Encoding UTF8 -LiteralPath $wikiFile.FullName)
    }

    foreach ($file in $wikiFiles) {
        $relative = 'wiki/' + $file.Name
        $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName
        $lines = [IO.File]::ReadAllLines($file.FullName, [Text.Encoding]::UTF8).Count
        $sourceCount = Get-SourceCount $text
        $headings = @([regex]::Matches($text, '(?m)^(?<level>#{1,6})\s+(?<text>.+?)\s*$'))
        $h1 = @($headings | Where-Object { $_.Groups['level'].Value.Length -eq 1 })
        if ($h1.Count -eq 0) {
            Add-Finding $findings 'error' 'wiki_title_missing' $relative 'Wiki must contain one H1 title.'
        } elseif ($h1.Count -gt 1) {
            Add-Finding $findings 'error' 'wiki_title_multiple' $relative "count=$($h1.Count)"
        } else {
            $firstHeading = @($headings | Select-Object -First 1)
            if ($firstHeading.Count -gt 0 -and $firstHeading[0].Groups['level'].Value.Length -ne 1) {
                Add-Finding $findings 'warning' 'wiki_title_not_first_heading' $relative ("first_heading=" + $firstHeading[0].Groups['text'].Value)
            }
        }

        $source = Get-Section $text $sourceHeading
        if (-not $source.Success) {
            Add-Finding $findings 'error' 'wiki_source_section_missing' $relative 'Missing source section.'
        }
        $related = Get-Section $text $relatedHeading
        $entries = @()
        if (-not $related.Success) {
            Add-Finding $findings 'warning' 'related_pages_section_missing' $relative 'Add a related-pages section when the page has irreplaceable cross-page dependencies.'
        } else {
            $entries = @(Get-RelatedEntries $related.Groups['body'].Value)
            $limit = Get-RelatedLimit $lines
            if ($entries.Count -gt $limit) {
                $code = if ($lines -gt 500) { 'related_pages_over_limit_split_first' } else { 'related_pages_over_limit' }
                $detail = "lines=$lines; actual=$($entries.Count); limit=$limit"
                Add-Finding $findings 'warning' $code $relative $detail
            }
            $seen = @{}
            foreach ($entry in $entries) {
                $key = $entry.target.ToLowerInvariant()
                if ($seen.ContainsKey($key)) {
                    Add-Finding $findings 'warning' 'related_pages_duplicate_target' $relative $entry.target
                } else {
                    $seen[$key] = $true
                }
                if ($entry.target -notmatch '#.+$') {
                    Add-Finding $findings 'warning' 'related_pages_anchor_missing' $relative $entry.target
                }
                $description = $entry.tail -replace '^[\u2014\u2013-]\s*', ''
                if ([string]::IsNullOrWhiteSpace($description)) {
                    Add-Finding $findings 'warning' 'related_pages_description_missing' $relative $entry.target
                }
                if ($entry.tail -match '\u2192\s*\u672c\u6587\s*\u00A7.+?\u5904\u5df2\u63d2\u5165') {
                    $targetPattern = [regex]::Escape($entry.target)
                    $beforeFooter = $text.Substring(0, $related.Index)
                    if (-not [regex]::IsMatch($beforeFooter, '(?m)^>\s*\uD83D\uDCCE\s*\u53c2\u89c1\uFF1A?\s*\[[^\]]+\]\((?:' + $targetPattern + '|<' + $targetPattern + '>)\)')) {
                        Add-Finding $findings 'warning' 'related_pages_inline_mirror_missing' $relative $entry.target
                    }
                }
            }
            $followingHeadings = @($headings | Where-Object {
                $_.Index -gt $related.Index -and $_.Groups['level'].Value.Length -eq 2 -and $_.Groups['text'].Value -ne $sourceHeading
            })
            if ($followingHeadings.Count -gt 0) {
                Add-Finding $findings 'warning' 'related_pages_not_footer' $relative ("following=" + (($followingHeadings | ForEach-Object { $_.Groups['text'].Value }) -join ', '))
            }
        }

        if ($source.Success) {
            $nonFooter = @($headings | Where-Object {
                $_.Index -gt $source.Index -and $_.Groups['level'].Value.Length -eq 2 -and $_.Groups['text'].Value -ne $relatedHeading
            })
            if ($nonFooter.Count -gt 0) {
                Add-Finding $findings 'warning' 'source_section_not_footer' $relative ("following=" + (($nonFooter | ForEach-Object { $_.Groups['text'].Value }) -join ', '))
            }
        }

        $readingRouteHeading = Convert-UnicodeLiteral '\u9605\u8bfb\u8def\u7ebf'
        $batchHeadingPattern = Convert-UnicodeLiteral '^(?:\u672c\u6279(?:\u65b0\u589e|\u8865\u5145)|\u65b0\u589e|\u8865\u5145)[\uFF1A:]'
        $contentH2 = @($headings | Where-Object {
            $_.Groups['level'].Value.Length -eq 2 -and $_.Groups['text'].Value -notin @($sourceHeading, $relatedHeading, $readingRouteHeading)
        })
        $numberedH2 = New-Object 'System.Collections.Generic.List[object]'
        foreach ($heading in $contentH2) {
            $ordinalMatch = [regex]::Match($heading.Groups['text'].Value, '^(?<ordinal>[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343]+)\u3001')
            if (-not $ordinalMatch.Success) { continue }
            [void]$numberedH2.Add([pscustomobject]@{ heading = $heading; value = Get-ChineseOrdinalValue $ordinalMatch.Groups['ordinal'].Value })
        }
        if ($numberedH2.Count -ge 4) {
            $expected = [int]$numberedH2[0].value
            if ($expected -ne 1) {
                Add-Finding $findings 'warning' 'wiki_h2_numbering_start' $relative ("expected=1; actual=$expected; heading=" + $numberedH2[0].heading.Groups['text'].Value)
            }
            foreach ($numbered in $numberedH2) {
                if ([int]$numbered.value -ne $expected) {
                    Add-Finding $findings 'warning' 'wiki_h2_numbering_gap' $relative ("expected=$expected; actual=$($numbered.value); heading=" + $numbered.heading.Groups['text'].Value)
                    $expected = [int]$numbered.value
                }
                $expected++
            }
            $firstNumberedIndex = $numberedH2[0].heading.Index
            $unnumberedAfterSequence = @($contentH2 | Where-Object {
                $_.Index -gt $firstNumberedIndex -and [regex]::IsMatch($_.Groups['text'].Value, $batchHeadingPattern)
            })
            if ($unnumberedAfterSequence.Count -gt 0) {
                Add-Finding $findings 'warning' 'wiki_h2_numbering_mixed' $relative ("headings=" + (($unnumberedAfterSequence | ForEach-Object { $_.Groups['text'].Value }) -join ', '))
            }
        }

        foreach ($linkMatch in [regex]::Matches($text, '\[[^\]]+\]\((?<target><[^>]+>|[^\)]+)\)')) {
            $resolved = Resolve-WikiLinkTarget $file.FullName $linkMatch.Groups['target'].Value $wikiPrefix
            if ($null -eq $resolved) { continue }
            $targetRelative = 'wiki/' + (Split-Path -Leaf $resolved.path)
            if (-not (Test-Path -LiteralPath $resolved.path -PathType Leaf)) {
                Add-Finding $findings 'warning' 'wiki_link_target_missing' $relative $resolved.target $targetRelative
                continue
            }
            if ([string]::IsNullOrWhiteSpace($resolved.fragment) -or -not $anchorCache[$resolved.path].Contains($resolved.fragment)) {
                Add-Finding $findings 'warning' 'wiki_link_anchor_target_missing' $relative $resolved.target $targetRelative
            }
        }

        $capacityState = 'normal'
        if ($lines -ge 300 -or $sourceCount -ge 8) {
            if ($lines -ge 500) {
                Add-Finding $findings 'warning' 'wiki_capacity_must_split' $relative "lines=$lines; sources=$sourceCount"
            }
            if (-not $closuresByPath.ContainsKey($relative)) {
                Add-Finding $findings 'warning' 'wiki_capacity_closure_missing' $relative "lines=$lines; sources=$sourceCount"
                $capacityState = 'closure_missing'
            } else {
                $closure = $closuresByPath[$relative]
                $capacityState = [string]$closure.state
                # A historic split receipt cannot exempt the current page size.
                if ($lines -ge 500) {
                    if ($capacityState -eq 'completed') {
                        Add-Finding $findings 'warning' 'wiki_split_completion_stale' $relative 'A completed split is historical evidence; current capacity requires a new assessment.'
                    }
                }
                if ($capacityState -eq 'planned') {
                    Add-Finding $findings 'warning' 'wiki_capacity_evaluate_split' $relative "lines=$lines; sources=$sourceCount; split assessment has not been documented"
                } elseif ($capacityState -eq 'deferred') {
                    if ([string]::IsNullOrWhiteSpace([string]$closure.reason) -or [string]::IsNullOrWhiteSpace([string]$closure.review_when)) {
                        Add-Finding $findings 'warning' 'wiki_capacity_closure_incomplete' $relative 'deferred requires reason and review_when'
                    }
                } elseif ($capacityState -eq 'completed') {
                    $plan = [string]$closure.plan
                    $receipt = [string]$closure.receipt
                    $planExists = -not [string]::IsNullOrWhiteSpace($plan) -and (Test-Path -LiteralPath (Join-Path $projectRoot $plan) -PathType Leaf)
                    $receiptExists = -not [string]::IsNullOrWhiteSpace($receipt) -and (Test-Path -LiteralPath (Join-Path $projectRoot $receipt) -PathType Leaf)
                    if (-not ($planExists -and $receiptExists)) {
                        Add-Finding $findings 'warning' 'wiki_split_completion_receipt_missing' $relative "plan=$plan; receipt=$receipt"
                    }
                } else {
                    Add-Finding $findings 'warning' 'wiki_capacity_closure_state_invalid' $relative "state=$capacityState"
                }
            }
        }

        [void]$pages.Add([pscustomobject][ordered]@{
            path = $relative
            lines = $lines
            sources = $sourceCount
            related_pages = $entries.Count
            related_limit = Get-RelatedLimit $lines
            split_state = $capacityState
        })
    }

    $errorCount = @($findings | Where-Object { $_.severity -eq 'error' }).Count
    $warningCount = @($findings | Where-Object { $_.severity -eq 'warning' }).Count
    $receipt = [pscustomobject][ordered]@{
        schema_version = 1
        scope = if ($Path.Count -eq 0) { 'all_wiki' } else { 'selected_wiki' }
        status = if ($errorCount -gt 0) { 'failed' } elseif ($warningCount -gt 0) { 'needs_attention' } else { 'passed' }
        policy = [pscustomobject][ordered]@{
            related_pages_max_lines_lte_300 = 5
            related_pages_max_lines_301_to_500 = 8
            related_pages_over_500 = 'split_first_then_recheck'
        }
        summary = [pscustomobject][ordered]@{
            wiki = $pages.Count
            errors = $errorCount
            warnings = $warningCount
        }
        pages = @($pages.ToArray())
        findings = @($findings.ToArray())
    }
    $json = (($receipt | ConvertTo-Json -Depth 12) -split '\r?\n' | ForEach-Object { $_.TrimEnd() }) -join "`n"
    if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
        $full = if ([IO.Path]::IsPathRooted($OutputPath)) { [IO.Path]::GetFullPath($OutputPath) } else { [IO.Path]::GetFullPath((Join-Path $projectRoot $OutputPath)) }
        if (-not $full.StartsWith($projectRoot.TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "OutputPath escapes project root: $full" }
        $parent = Split-Path -Parent $full
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) { [void](New-Item -ItemType Directory -Path $parent -Force) }
        [IO.File]::WriteAllText($full, ($json + "`n"), $utf8NoBom)
    }
    Write-Output $json
    if ($Mode -eq 'Enforce' -and $errorCount -gt 0) { exit 2 }
    exit 0
} catch {
    [Console]::Error.WriteLine("WIKI_PAGE_HEALTH_CHECK_FAILED: $($_.Exception.Message)")
    [Console]::Error.WriteLine("WIKI_PAGE_HEALTH_CHECK_LOCATION: $($_.InvocationInfo.ScriptLineNumber)")
    [Console]::Error.WriteLine("WIKI_PAGE_HEALTH_CHECK_STACK: $($_.ScriptStackTrace)")
    exit 3
}
