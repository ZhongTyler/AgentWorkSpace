[CmdletBinding()]
param(
    [ValidateSet('Check', 'Sync')][string]$Mode = 'Check',
    [string]$ProjectRoot,
    [string]$PathsCsv = '',
    [switch]$RegistryOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object Text.UTF8Encoding($false)
$projectRoot = if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
} else {
    [IO.Path]::GetFullPath($ProjectRoot)
}
$wikiRoot = Join-Path $projectRoot 'wiki'
$rawRoot = Join-Path $projectRoot 'raw-sources'
$rawListPath = Join-Path $projectRoot 'system/registry/raw-list.md'
$sourceHeading = ConvertFrom-Json '"\u6765\u6e90"'

function Get-OrderedUnique {
    param([string[]]$Values)
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $result = New-Object 'System.Collections.Generic.List[string]'
    foreach ($value in @($Values)) {
        $normalized = $value.Trim().Replace('\', '/')
        if (-not [string]::IsNullOrWhiteSpace($normalized) -and $seen.Add($normalized)) { [void]$result.Add($normalized) }
    }
    return @($result.ToArray())
}

function Get-RawLinks {
    param([string]$Text)
    $links = New-Object 'System.Collections.Generic.List[string]'
    foreach ($match in [regex]::Matches($Text, '\[\[raw-sources/(?<name>[^\]|#]+?)(?:\.md)?(?:[|#][^\]]*)?\]\]')) {
        [void]$links.Add('raw-sources/' + $match.Groups['name'].Value + '.md')
    }
    # The source section supports both Obsidian links and portable Markdown
    # relative links; ledger counts must include either form.
    foreach ($match in [regex]::Matches($Text, '(?m)\[[^\]]+\]\((?<target><[^>]+>|[^\)]+)\)')) {
        $target = $match.Groups['target'].Value.Trim('<', '>')
        $target = $target.Split('#')[0]
        $target = [Uri]::UnescapeDataString($target)
        if ($target -match '(?i)(?:^|/)raw-sources/(?<name>[^/]+\.md)$') {
            [void]$links.Add('raw-sources/' + $Matches['name'])
        }
    }
    return @(Get-OrderedUnique @($links.ToArray()))
}

function Get-WikiLedger {
    param([string]$Text, [string]$Path)
    $frontmatter = [regex]::Match($Text, '(?ms)\A---\s*\r?\n(?<body>.*?)\r?\n---(?:\r?\n|\z)')
    if (-not $frontmatter.Success) { throw "Wiki frontmatter is missing: $Path" }
    $sourcesBlock = [regex]::Match($frontmatter.Groups['body'].Value, '(?m)^sources:\s*\r?\n(?<items>(?:[ \t]+-\s+.*\r?\n?)+)')
    if (-not $sourcesBlock.Success) { throw "Wiki sources block is missing or unsupported: $Path" }
    $frontSources = @(Get-OrderedUnique @([regex]::Matches($sourcesBlock.Groups['items'].Value, '(?m)^[ \t]+-\s+(?<value>.+?)\s*$') | ForEach-Object {
        $_.Groups['value'].Value.Trim().Trim('"', "'")
    }))
    $sourceSection = [regex]::Match($Text, '(?ms)^##\s+' + [regex]::Escape($sourceHeading) + '\s*\r?\n(?<body>.*?)(?=^##\s+|\z)')
    if (-not $sourceSection.Success) { throw "Wiki source section is missing: $Path" }
    $sectionSources = @(Get-RawLinks $sourceSection.Groups['body'].Value)
    $bodyWithoutSourceSection = $Text.Remove($sourceSection.Index, $sourceSection.Length)
    $bodySources = @(Get-RawLinks $bodyWithoutSourceSection)
    $canonical = @(Get-OrderedUnique @($frontSources + $sectionSources + $bodySources))
    return [pscustomobject]@{
        frontmatter = $frontmatter
        sources_block = $sourcesBlock
        source_section = $sourceSection
        front_sources = $frontSources
        section_sources = $sectionSources
        body_sources = $bodySources
        canonical = $canonical
        missing_front = @($canonical | Where-Object { $frontSources -notcontains $_ })
        missing_section = @($canonical | Where-Object { $sectionSources -notcontains $_ })
    }
}

function Add-FrontmatterSources {
    param([string]$Text, [string[]]$Sources, [string]$Path)
    if ($Sources.Count -eq 0) { return $Text }
    $frontmatter = [regex]::Match($Text, '(?ms)\A---\s*\r?\n(?<body>.*?)\r?\n---(?:\r?\n|\z)')
    $body = $frontmatter.Groups['body'].Value
    $block = [regex]::Match($body, '(?m)^sources:\s*\r?\n(?<items>(?:[ \t]+-\s+.*\r?\n?)+)')
    if (-not $block.Success) { throw "Wiki sources block is missing or unsupported: $Path" }
    $items = $block.Groups['items'].Value.TrimEnd("`r", "`n")
    $addition = @($Sources | ForEach-Object { '  - ' + $_ }) -join "`n"
    $newBody = $body.Remove($block.Groups['items'].Index, $block.Groups['items'].Length).Insert($block.Groups['items'].Index, ($items + "`n" + $addition + "`n"))
    return $Text.Remove($frontmatter.Groups['body'].Index, $frontmatter.Groups['body'].Length).Insert($frontmatter.Groups['body'].Index, $newBody)
}

function Add-SectionSources {
    param([string]$Text, [string[]]$Sources, [string]$Path)
    if ($Sources.Count -eq 0) { return $Text }
    $section = [regex]::Match($Text, '(?ms)^##\s+' + [regex]::Escape($sourceHeading) + '\s*\r?\n(?<body>.*?)(?=^##\s+|\z)')
    if (-not $section.Success) { throw "Wiki source section is missing: $Path" }
    $body = $section.Groups['body'].Value.TrimEnd("`r", "`n")
    $addition = @($Sources | ForEach-Object {
        $name = $_.Substring('raw-sources/'.Length)
        if ($name -match '[\[\]|#]') {
            '- [Raw](<../raw-sources/' + [Uri]::EscapeDataString($name) + '>)'
            return
        }
        if ($name.EndsWith('.md')) { $name = $name.Substring(0, $name.Length - 3) }
        '- [[raw-sources/' + $name + ']]'
    }) -join "`n"
    $newBody = $body + "`n" + $addition + "`n`n"
    return $Text.Remove($section.Groups['body'].Index, $section.Groups['body'].Length).Insert($section.Groups['body'].Index, $newBody)
}

function Get-SourceCounts {
    $counts = @{}
    foreach ($rawFile in @(Get-ChildItem -LiteralPath $rawRoot -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' })) {
        $counts[$rawFile.Name] = 0
    }
    foreach ($wikiFile in @(Get-ChildItem -LiteralPath $wikiRoot -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' })) {
        $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $wikiFile.FullName
        $ledger = Get-WikiLedger $text $wikiFile.FullName
        foreach ($source in @($ledger.section_sources)) {
            $name = $source.Substring('raw-sources/'.Length)
            if ($counts.ContainsKey($name)) { $counts[$name]++ }
        }
    }
    return $counts
}

try {
    foreach ($required in @($wikiRoot, $rawRoot, $rawListPath)) {
        if (-not (Test-Path -LiteralPath $required)) { throw "Missing required Knowledge path: $required" }
    }
    $changes = New-Object 'System.Collections.Generic.List[object]'
    $selected = @{}
    if ($PathsCsv) { foreach ($rel in ($PathsCsv -split '\|')) {
        $full = [IO.Path]::GetFullPath((Join-Path $projectRoot $rel))
        if (-not $full.StartsWith($wikiRoot.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Invalid scoped Wiki: $rel" }
        $selected[$full] = $true
    } }
    $scopedRaw = @{}
    foreach ($wikiFile in @(Get-ChildItem -LiteralPath $wikiRoot -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' -and (-not $PathsCsv -or $selected.ContainsKey($_.FullName)) } | Sort-Object Name)) {
        $relative = 'wiki/' + $wikiFile.Name
        $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $wikiFile.FullName
        $ledger = Get-WikiLedger $text $relative
        foreach ($source in @($ledger.front_sources) + @($ledger.section_sources) + @($ledger.body_sources)) { $scopedRaw[$source.Substring('raw-sources/'.Length)] = $true }
        if ($ledger.missing_front.Count -eq 0 -and $ledger.missing_section.Count -eq 0) { continue }
        [void]$changes.Add([pscustomobject][ordered]@{
            path = $relative
            added_to_frontmatter = @($ledger.missing_front)
            added_to_source_section = @($ledger.missing_section)
        })
        if ($Mode -eq 'Sync' -and -not $RegistryOnly) {
            $updated = Add-FrontmatterSources $text $ledger.missing_front $relative
            $updated = Add-SectionSources $updated $ledger.missing_section $relative
            [IO.File]::WriteAllText($wikiFile.FullName, $updated.Replace("`r`n", "`n"), $utf8NoBom)
        }
    }

    $counts = Get-SourceCounts
    $rawListText = Get-Content -Raw -Encoding UTF8 -LiteralPath $rawListPath
    $rawListDrifts = New-Object 'System.Collections.Generic.List[object]'
    $updatedLines = New-Object 'System.Collections.Generic.List[string]'
    foreach ($line in ($rawListText -split '\r?\n')) {
        if ($line -notmatch '^\|\s*[^|]+\.md\s*\|') { [void]$updatedLines.Add($line); continue }
        $columns = @($line -split '\|')
        $name = $columns[1].Trim()
        if ($PathsCsv -and -not $scopedRaw.ContainsKey($name)) { [void]$updatedLines.Add($line); continue }
        if (-not $counts.ContainsKey($name)) { [void]$updatedLines.Add($line); continue }
        $match = [regex]::Match($columns[5].Trim(), '^(?<count>\d+)')
        if (-not $match.Success) { throw "Invalid raw-list reference count: $name" }
        $before = [int]$match.Groups['count'].Value
        $after = [int]$counts[$name]
        if ($before -ne $after) {
            [void]$rawListDrifts.Add([pscustomobject][ordered]@{ path = 'raw-sources/' + $name; before = $before; after = $after })
            $columns[5] = if ($after -eq 0) { ' 0 ' + (ConvertFrom-Json '"\u26aa \u5b64\u7acb"') + ' ' } else { ' ' + $after + ' ' }
            $line = $columns -join '|'
        }
        [void]$updatedLines.Add($line)
    }
    if ($Mode -eq 'Sync' -and $rawListDrifts.Count -gt 0) {
        [IO.File]::WriteAllText($rawListPath, ((@($updatedLines.ToArray()) -join "`n").TrimEnd() + "`n"), $utf8NoBom)
    }

    $result = [pscustomobject][ordered]@{
        schema_version = 1
        status = if ($Mode -eq 'Sync') { 'synced' } elseif ($changes.Count -eq 0 -and $rawListDrifts.Count -eq 0) { 'passed' } else { 'drifted' }
        mode = $Mode
        wiki_updates = $changes.Count
        raw_list_updates = $rawListDrifts.Count
        changes = @($changes.ToArray())
        raw_list_drifts = @($rawListDrifts.ToArray())
    }
    $result | ConvertTo-Json -Depth 10
    if ($Mode -eq 'Check' -and ($changes.Count -gt 0 -or $rawListDrifts.Count -gt 0)) { exit 2 }
    exit 0
} catch {
    [Console]::Error.WriteLine("WIKI_SOURCE_LEDGER_SYNC_FAILED: $($_.Exception.Message)")
    [Console]::Error.WriteLine("WIKI_SOURCE_LEDGER_SYNC_LOCATION: $($_.InvocationInfo.ScriptLineNumber)")
    exit 3
}
