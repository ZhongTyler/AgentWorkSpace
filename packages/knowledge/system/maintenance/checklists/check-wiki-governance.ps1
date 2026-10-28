[CmdletBinding()]
param(
    [ValidateSet('Report', 'Enforce')]
    [string]$Mode = 'Report',
    [string]$OutputPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object Text.UTF8Encoding($false)
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$wikiRoot = Join-Path $projectRoot 'wiki'

function Add-Finding {
    param([System.Collections.Generic.List[object]]$Findings, [string]$Code, [string]$Path, [string]$Detail, [string]$Severity = 'warning')
    [void]$Findings.Add([pscustomobject][ordered]@{ severity = $Severity; code = $Code; path = $Path; detail = $Detail })
}

function Convert-UnicodeLiteral {
    param([string]$Value)
    return [regex]::Replace($Value, '\\u([0-9a-fA-F]{4})', { param($match) [char][Convert]::ToInt32($match.Groups[1].Value, 16) })
}

function Get-FrontmatterValues {
    param([string]$Text, [string]$Field)
    $frontmatter = [regex]::Match($Text, '(?ms)\A---\s*\r?\n(?<body>.*?)\r?\n---')
    if (-not $frontmatter.Success) { return @() }
    $body = $frontmatter.Groups['body'].Value
    $name = [regex]::Escape($Field)
    $inline = [regex]::Match($body, '(?m)^' + $name + ':\s*\[(?<items>[^\]]*)\]\s*$')
    if ($inline.Success) { return @($inline.Groups['items'].Value -split '[,\uFF0C]' | ForEach-Object { $_.Trim().Trim('"', "'") } | Where-Object { $_ -ne '' }) }
    $block = [regex]::Match($body, '(?m)^' + $name + ':\s*\r?\n(?<items>(?:[ \t]+-\s+.*\r?\n?)+)')
    if ($block.Success) { return @([regex]::Matches($block.Groups['items'].Value, '(?m)^[ \t]+-\s+(?<item>.+?)\s*$') | ForEach-Object { $_.Groups['item'].Value.Trim().Trim('"', "'") } | Where-Object { $_ -ne '' }) }
    return @()
}

function Get-HeadingSections {
    param([string]$Text)
    $matches = @([regex]::Matches($Text, '(?m)^(?<level>#{2,3})\s+(?<heading>.+?)\s*$'))
    $sections = New-Object 'System.Collections.Generic.List[object]'
    for ($index = 0; $index -lt $matches.Count; $index++) {
        $current = $matches[$index]
        $level = $current.Groups['level'].Value.Length
        $end = $Text.Length
        for ($nextIndex = $index + 1; $nextIndex -lt $matches.Count; $nextIndex++) {
            if ($matches[$nextIndex].Groups['level'].Value.Length -le $level) { $end = $matches[$nextIndex].Index; break }
        }
        [void]$sections.Add([pscustomobject]@{ level = $level; heading = $current.Groups['heading'].Value.Trim(); body = $Text.Substring($current.Index + $current.Length, $end - ($current.Index + $current.Length)); index = $current.Index })
    }
    return @($sections.ToArray())
}

function Test-NonEmptyProperty {
    param($Object, [string]$Name)
    return $null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name] -and -not [string]::IsNullOrWhiteSpace([string]$Object.$Name)
}

function Get-WikiTargets {
    param([string]$Text, [string]$SourcePath, [string]$WikiPrefix)
    $targets = New-Object 'System.Collections.Generic.List[string]'
    foreach ($match in [regex]::Matches($Text, '\[[^\]]+\]\((?<target><[^>]+>|[^\)]+)\)')) {
        $raw = $match.Groups['target'].Value.Trim().Trim('<', '>')
        if ($raw -match '^(?i)(https?|mailto|obsidian):') { continue }
        $pathPart = ($raw -split '#', 2)[0]
        if ([string]::IsNullOrWhiteSpace($pathPart)) { $full = $SourcePath } else { $full = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $SourcePath) ([Uri]::UnescapeDataString($pathPart)))) }
        if ($full.StartsWith($WikiPrefix, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetExtension($full) -eq '.md') { [void]$targets.Add($full) }
    }
    return @($targets.ToArray())
}

try {
    $sourceHeading = Convert-UnicodeLiteral '\u6765\u6e90'
    $relatedHeading = Convert-UnicodeLiteral '\u76f8\u5173\u9875\u9762'
    $readingHeading = Convert-UnicodeLiteral '\u9605\u8bfb\u8def\u7ebf'
    $sourceMarkerPattern = Convert-UnicodeLiteral '(?m)^>\s*\uD83D\uDCCD\s*\u6765\u6e90\uFF1A'
    $conflictPattern = Convert-UnicodeLiteral '((?<!\u4e92)\u76f8\u53cd|\u76f8\u4e92\u51b2\u7a81|\u8bf4\u6cd5\u4e0d\u540c|\u4e0d\u540c\u6765\u6e90)'
    $conflictMarkerPattern = Convert-UnicodeLiteral '\[!\u51b2\u7a81\]'
    $semanticClosurePath = Join-Path $projectRoot 'system/maintenance/wiki-semantic-review-closures.json'
    $semanticClosure = if (Test-Path -LiteralPath $semanticClosurePath -PathType Leaf) { Get-Content -Raw -Encoding UTF8 -LiteralPath $semanticClosurePath | ConvertFrom-Json } else { $null }
    $sourceMarkerDeferred = $false
    if ($null -ne $semanticClosure -and $null -ne $semanticClosure.source_marker_policy) {
        $policy = $semanticClosure.source_marker_policy
        $sourceMarkerDeferred = ([string]$policy.state -eq 'deferred' -and (Test-NonEmptyProperty $policy 'reason') -and (Test-NonEmptyProperty $policy 'review_when'))
    }
    $domainReviewByPath = @{}
    $conflictReviewByKey = @{}
    if ($null -ne $semanticClosure) {
        foreach ($review in @($semanticClosure.domain_reviews)) { if (Test-NonEmptyProperty $review 'path') { $domainReviewByPath[[string]$review.path] = $review } }
        foreach ($review in @($semanticClosure.conflict_reviews)) { if ((Test-NonEmptyProperty $review 'path') -and (Test-NonEmptyProperty $review 'heading')) { $conflictReviewByKey[([string]$review.path + "`n" + [string]$review.heading)] = $review } }
    }
    $closedSourceMarkerCandidates = 0
    $closedConflictCandidates = 0
    $closedDomainCandidates = 0
    $files = @(Get-ChildItem -LiteralPath $wikiRoot -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' } | Sort-Object Name)
    $wikiPrefix = $wikiRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $findings = New-Object 'System.Collections.Generic.List[object]'
    $wikiMeta = @{}
    $incoming = @{}
    foreach ($file in $files) { $incoming[$file.FullName] = 0 }

    foreach ($file in $files) {
        $relative = 'wiki/' + $file.Name
        $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName
        $sections = @(Get-HeadingSections $text)
        $domains = @(Get-FrontmatterValues $text 'domains')
        $lines = [IO.File]::ReadAllLines($file.FullName, [Text.Encoding]::UTF8).Count
        $sources = @(Get-FrontmatterValues $text 'sources')
        $outgoing = @(Get-WikiTargets $text $file.FullName $wikiPrefix | Sort-Object -Unique)
        foreach ($target in $outgoing) { if ($incoming.ContainsKey($target) -and $target -ne $file.FullName) { $incoming[$target]++ } }
        $wikiMeta[$file.FullName] = [pscustomobject]@{ path = $file.FullName; relative = $relative; title = $file.BaseName; text = $text; sections = $sections; domains = $domains; lines = $lines; sources = $sources.Count; outgoing = $outgoing }

        foreach ($section in $sections) {
            if ($section.heading -in @($sourceHeading, $relatedHeading, $readingHeading)) { continue }
            $contentLength = ([regex]::Replace($section.body, '\s', '')).Length
            if ($contentLength -ge 120 -and $section.body -notmatch $sourceMarkerPattern) {
                if ($sourceMarkerDeferred) { $closedSourceMarkerCandidates++ } else { Add-Finding $findings 'section_source_marker_missing_candidate' $relative ("H$($section.level):$($section.heading); non_whitespace=$contentLength") }
            }
            $sectionRawCount = @([regex]::Matches($section.body, '\[\[raw-sources/[^\]|#]+')).Count
            if ($sectionRawCount -ge 2 -and $section.body -match $conflictPattern -and $section.body -notmatch $conflictMarkerPattern) {
                $review = $conflictReviewByKey[$relative + "`n" + $section.heading]
                if ($null -ne $review -and [string]$review.state -eq 'not_a_conflict' -and (Test-NonEmptyProperty $review 'reason') -and (Test-NonEmptyProperty $review 'review_when')) { $closedConflictCandidates++ } else { Add-Finding $findings 'source_conflict_review_candidate' $relative ("H$($section.level):$($section.heading)") }
            }
        }
        if ($domains.Count -ge 4) {
            $review = $domainReviewByPath[$relative]
            $reviewedDomains = if ($null -ne $review -and $null -ne $review.domain_sections) { @($review.domain_sections.PSObject.Properties.Name) } else { @() }
            $coversDomains = @($domains | Where-Object { $_ -notin $reviewedDomains }).Count -eq 0
            $headings = @($sections | Where-Object { $_.level -eq 2 } | ForEach-Object { $_.heading })
            $mappedSectionsExist = $true
            if ($null -eq $review -or $null -eq $review.domain_sections) { $mappedSectionsExist = $false } else {
                foreach ($domain in $domains) {
                    $property = $review.domain_sections.PSObject.Properties[$domain]
                    $mapped = if ($null -ne $property) { @($property.Value) } else { @() }
                    if ($mapped.Count -eq 0 -or @($mapped | Where-Object { $_ -notin $headings }).Count -gt 0) { $mappedSectionsExist = $false; break }
                }
            }
            if ($null -ne $review -and [string]$review.state -eq 'validated' -and $coversDomains -and $mappedSectionsExist -and (Test-NonEmptyProperty $review 'reason') -and (Test-NonEmptyProperty $review 'review_when')) { $closedDomainCandidates++ } else { Add-Finding $findings 'domain_semantic_review_candidate' $relative ("domains=" + ($domains -join ', ') + '; headings=' + (($sections | Where-Object { $_.level -eq 2 } | ForEach-Object { $_.heading }) -join ' / ')) }
        }
    }

    foreach ($meta in $wikiMeta.Values) {
        if ($incoming[$meta.path] -eq 0 -and $meta.outgoing.Count -eq 0) {
            Add-Finding $findings 'wiki_island_candidate' $meta.relative 'zero incoming Wiki links and zero outgoing Wiki links'
        }
    }


    $closurePath = Join-Path $projectRoot 'system/maintenance/wiki-split-closures.json'
    $closures = @{}
    if (Test-Path -LiteralPath $closurePath -PathType Leaf) {
        $closureDocument = Get-Content -Raw -Encoding UTF8 -LiteralPath $closurePath | ConvertFrom-Json
        foreach ($record in @($closureDocument.records)) { $closures[[string]$record.path] = $record }
    }
    foreach ($meta in $wikiMeta.Values) {
        if ($meta.lines -le 300 -and $meta.sources -lt 8) { continue }
        $record = $closures[$meta.relative]
        if ($null -eq $record) { Add-Finding $findings 'split_closure_missing' $meta.relative "lines=$($meta.lines); sources=$($meta.sources)"; continue }
        if ([string]$record.state -notin @('planned', 'deferred', 'completed')) { Add-Finding $findings 'split_closure_state_invalid' $meta.relative "state=$($record.state)"; continue }
        if ([string]$record.state -eq 'deferred' -and ([string]::IsNullOrWhiteSpace([string]$record.reason) -or [string]::IsNullOrWhiteSpace([string]$record.review_when))) { Add-Finding $findings 'split_closure_deferred_incomplete' $meta.relative 'deferred requires reason and review_when' }
        if ([string]$record.state -eq 'completed' -and ([string]::IsNullOrWhiteSpace([string]$record.plan) -or [string]::IsNullOrWhiteSpace([string]$record.receipt))) { Add-Finding $findings 'split_propagation_record_incomplete' $meta.relative 'completed requires plan and receipt' }
        if ($meta.lines -gt 500 -and [string]$record.state -eq 'deferred') { Add-Finding $findings 'split_closure_must_split_deferred' $meta.relative "lines=$($meta.lines)" }
    }

    $nowText = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot 'NOW.md')
    $statusText = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot 'system/registry/KNOWLEDGE_STATUS.md')
    $expectedCounts = @{ Wiki = $files.Count; raw = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'raw-sources') -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' }).Count; domains = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'domains') -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' }).Count }
    foreach ($pair in @(@{ label = 'NOW.md'; text = $nowText }, @{ label = 'system/registry/KNOWLEDGE_STATUS.md'; text = $statusText })) {
        foreach ($entry in @(@{ label = Convert-UnicodeLiteral '\u9886\u57df'; expected = $expectedCounts.domains }, @{ label = 'Wiki'; expected = $expectedCounts.Wiki }, @{ label = 'raw'; expected = $expectedCounts.raw })) {
            $match = [regex]::Match($pair.text, [regex]::Escape($entry.label) + '\s*[\uFF1A:]\s*(?<count>\d+)')
            if ($match.Success -and [int]$match.Groups['count'].Value -ne $entry.expected) { Add-Finding $findings 'maintenance_count_drift' $pair.label ("$($entry.label): expected=$($entry.expected); actual=$($match.Groups['count'].Value)") }
        }
    }

    $warningCount = $findings.Count
    $receipt = [pscustomobject][ordered]@{ schema_version = 1; status = if ($warningCount -eq 0) { 'passed' } else { 'needs_attention' }; policy = [pscustomobject]@{ source_marker_min_non_whitespace = 120; split_assessment_lines = 300; split_assessment_sources = 8; split_must_lines = 500 }; summary = [pscustomobject]@{ wiki = $files.Count; warnings = $warningCount; semantic_review_closures = [pscustomobject]@{ source_marker_policy = if ($sourceMarkerDeferred) { 'deferred' } else { 'unclosed' }; source_marker_candidates_deferred = $closedSourceMarkerCandidates; conflict_candidates_closed = $closedConflictCandidates; domain_candidates_closed = $closedDomainCandidates } }; findings = @($findings.ToArray()) }
    $json = (($receipt | ConvertTo-Json -Depth 12) -split '\r?\n' | ForEach-Object { $_.TrimEnd() }) -join "`n"
    if (-not [string]::IsNullOrWhiteSpace($OutputPath)) { $full = [IO.Path]::GetFullPath((Join-Path $projectRoot $OutputPath)); if (-not $full.StartsWith($projectRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "OutputPath escapes project root: $full" }; [IO.File]::WriteAllText($full, ($json + "`n"), $utf8NoBom) }
    Write-Output $json
    exit 0
} catch {
    [Console]::Error.WriteLine("WIKI_GOVERNANCE_CHECK_FAILED: $($_.Exception.Message)")
    [Console]::Error.WriteLine("WIKI_GOVERNANCE_CHECK_LOCATION: $($_.InvocationInfo.ScriptLineNumber)")
    exit 3
}
