$script:BrainstormScriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:BrainstormProjectRoot = [IO.Path]::GetFullPath((Join-Path $script:BrainstormScriptsRoot '..'))
$script:BrainstormUtf8NoBom = New-Object Text.UTF8Encoding($false)
$script:BrainstormStates = @('open', 'paused', 'converged', 'handoff-ready', 'closed')
$script:BrainstormModes = @('quick', 'standard', 'deep')
$script:BrainstormVisibilities = @('private', 'shareable', 'example')
$script:BrainstormStorageKinds = @('brainstorm', 'host', 'explicit')
$script:BrainstormAuthorities = @('confirm', 'delegated')

function Stop-SessionContract {
    param([string]$Message)
    throw "Brainstorm session contract failed: $Message"
}

function Assert-SessionContract {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Stop-SessionContract -Message $Message }
}

function Get-BrainstormProjectRoot {
    return $script:BrainstormProjectRoot
}

function Assert-ObjectProperty {
    param([object]$Object, [string]$Name)
    Assert-SessionContract -Condition ($null -ne $Object -and $Object.PSObject.Properties.Name -contains $Name) -Message "Missing property: $Name"
}

function Read-Utf8Json {
    param([string]$Path)
    Assert-SessionContract -Condition (Test-Path -LiteralPath $Path -PathType Leaf) -Message "Missing JSON file: $Path"
    try {
        return [IO.File]::ReadAllText($Path, $script:BrainstormUtf8NoBom) | ConvertFrom-Json
    } catch {
        Stop-SessionContract -Message "Invalid JSON file: $Path"
    }
}

function Write-Utf8JsonAtomic {
    param([string]$Path, [object]$Value, [switch]$NoClobber)
    Assert-SafePhysicalPath -Path $Path
    $parent = Split-Path -Parent $Path
    Assert-SessionContract -Condition (Test-Path -LiteralPath $parent -PathType Container) -Message "Missing JSON parent directory: $parent"
    $temporaryPath = Join-Path $parent ('.' + [IO.Path]::GetFileName($Path) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $json = ($Value | ConvertTo-Json -Depth 32).Replace("`r`n", "`n").Replace("`r", "`n")
        [IO.File]::WriteAllText($temporaryPath, ($json + "`n"), $script:BrainstormUtf8NoBom)
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force:(-not $NoClobber)
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Write-Utf8TextAtomic {
    param([string]$Path, [string]$Value)
    Assert-SafePhysicalPath -Path $Path
    $parent = Split-Path -Parent $Path
    Assert-SessionContract -Condition (Test-Path -LiteralPath $parent -PathType Container) -Message "Missing text parent directory: $parent"
    $temporaryPath = Join-Path $parent ('.' + [IO.Path]::GetFileName($Path) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $normalized = $Value.Replace("`r`n", "`n").Replace("`r", "`n")
        [IO.File]::WriteAllText($temporaryPath, $normalized, $script:BrainstormUtf8NoBom)
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Resolve-SessionStatePath {
    param([string]$SessionPath)
    Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($SessionPath)) -Message 'SessionPath is required.'
    $resolved = [IO.Path]::GetFullPath($SessionPath)
    Assert-SafePhysicalPath -Path $resolved
    if (Test-Path -LiteralPath $resolved -PathType Container) {
        $resolved = Join-Path $resolved 'session-state.json'
    }
    Assert-SessionContract -Condition ([IO.Path]::GetFileName($resolved) -ceq 'session-state.json') -Message 'SessionPath must be a session directory or session-state.json.'
    return $resolved
}

function Resolve-SafeRelativePath {
    param([string]$BasePath, [string]$RelativePath)
    Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($RelativePath)) -Message 'Relative path is empty.'
    Assert-SessionContract -Condition (-not [IO.Path]::IsPathRooted($RelativePath)) -Message "Path must be relative: $RelativePath"
    Assert-SessionContract -Condition (-not ($RelativePath -split '[\\/]' | Where-Object { $_ -ceq '..' })) -Message "Path traversal is not allowed: $RelativePath"
    $baseFull = [IO.Path]::GetFullPath($BasePath)
    $resolved = [IO.Path]::GetFullPath((Join-Path $baseFull $RelativePath))
    $prefix = $baseFull.TrimEnd([char]92, [char]47) + [IO.Path]::DirectorySeparatorChar
    Assert-SessionContract -Condition ($resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) -Message "Path escaped the session directory: $RelativePath"
    Assert-SafePhysicalPath -Path $resolved
    return $resolved
}

function Test-IsoDateTime {
    param([object]$Value)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $false }
    $parsed = [DateTimeOffset]::MinValue
    return [DateTimeOffset]::TryParse([string]$Value, [ref]$parsed)
}

function Test-SessionId {
    param([string]$SessionId)
    if ($SessionId -cnotmatch '^bs-([0-9]{8})-([0-9]{6})-([a-f0-9]{6})$') { return $false }
    $parsed = [DateTime]::MinValue
    return [DateTime]::TryParseExact(
        ($Matches[1] + $Matches[2]),
        'yyyyMMddHHmmss',
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::None,
        [ref]$parsed
    )
}

function Test-AllowedStateTransition {
    param([string]$From, [string]$To)
    if ($From -ceq $To) { return $true }
    $key = "$From->$To"
    return @(
        'open->paused',
        'paused->open',
        'open->converged',
        'converged->open',
        'converged->handoff-ready',
        'open->closed',
        'paused->closed',
        'converged->closed',
        'handoff-ready->closed'
    ) -contains $key
}

function Get-StateTransitionEvent {
    param([string]$From, [string]$To)
    $key = "$From->$To"
    $events = @{
        'open->paused' = 'pause'
        'paused->open' = 'resume'
        'open->converged' = 'converge'
        'converged->open' = 'reopen'
        'converged->handoff-ready' = 'handoff-ready'
        'open->closed' = 'close'
        'paused->closed' = 'close'
        'converged->closed' = 'close'
        'handoff-ready->closed' = 'close'
    }
    Assert-SessionContract -Condition $events.ContainsKey($key) -Message "No event mapping for transition: $key"
    return [string]$events[$key]
}

function Get-SessionBudgetConfig {
    param([string]$ConfigPath = '')
    if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
        $ConfigPath = Join-Path $script:BrainstormProjectRoot 'config\session-storage.json'
    }
    $config = Read-Utf8Json -Path ([IO.Path]::GetFullPath($ConfigPath))
    foreach ($name in @('schema_version', 'canonical_record_warning_bytes', 'single_session_warning_bytes', 'total_sessions_warning_bytes', 'allowed_extensions')) {
        Assert-ObjectProperty -Object $config -Name $name
    }
    Assert-SessionContract -Condition ($config.schema_version -eq 1) -Message 'Session storage schema_version must be 1.'
    Assert-SessionContract -Condition ([long]$config.canonical_record_warning_bytes -gt 0) -Message 'canonical_record_warning_bytes must be positive.'
    Assert-SessionContract -Condition ([long]$config.single_session_warning_bytes -gt 0) -Message 'single_session_warning_bytes must be positive.'
    Assert-SessionContract -Condition ([long]$config.total_sessions_warning_bytes -gt 0) -Message 'total_sessions_warning_bytes must be positive.'
    $extensions = @($config.allowed_extensions)
    Assert-SessionContract -Condition ($extensions.Count -gt 0) -Message 'allowed_extensions must not be empty.'
    foreach ($extension in $extensions) {
        Assert-SessionContract -Condition ([string]$extension -match '^\.[a-z0-9]+$') -Message "Invalid allowed extension: $extension"
    }
    return $config
}

function Get-DirectoryBytes {
    param([string]$Path)
    $total = [long]0
    foreach ($file in @(Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction Stop)) {
        $total += [long]$file.Length
    }
    return $total
}

function Get-SessionDirectories {
    param([string]$SessionRoot)
    if (-not (Test-Path -LiteralPath $SessionRoot -PathType Container)) { return @() }
    return @(
        Get-ChildItem -LiteralPath $SessionRoot -Recurse -File -Filter 'session-state.json' |
            ForEach-Object { $_.Directory.FullName } |
            Sort-Object -Unique
    )
}

function Get-TotalSessionBytes {
    param([string]$SessionRoot)
    $total = [long]0
    foreach ($directory in @(Get-SessionDirectories -SessionRoot $SessionRoot)) {
        $total += Get-DirectoryBytes -Path $directory
    }
    return $total
}

function Split-MarkdownTableRow {
    param([string]$Line)
    $trimmed = $Line.Trim()
    Assert-SessionContract -Condition ($trimmed.StartsWith('|') -and $trimmed.EndsWith('|')) -Message "Invalid Markdown table row: $Line"
    $inner = $trimmed.Substring(1, $trimmed.Length - 2)
    return @(
        [regex]::Split($inner, '(?<!\\)\|') |
            ForEach-Object { $_.Trim().Replace('\|', '|') }
    )
}

function Get-MarkdownTableRows {
    param(
        [string]$Content,
        [string]$Heading,
        [string[]]$ExpectedHeaders
    )
    $headingToken = "## $Heading"
    $headingIndex = $Content.IndexOf($headingToken, [StringComparison]::Ordinal)
    Assert-SessionContract -Condition ($headingIndex -ge 0) -Message "Missing Markdown section: $headingToken"
    $sectionStart = $headingIndex + $headingToken.Length
    $remaining = $Content.Substring($sectionStart)
    $nextHeading = [regex]::Match($remaining, '(?m)^##\s+')
    $section = if ($nextHeading.Success) { $remaining.Substring(0, $nextHeading.Index) } else { $remaining }
    $tableLines = @(
        $section -split "\r?\n" |
            Where-Object { $_.Trim().StartsWith('|') -and $_.Trim().EndsWith('|') }
    )
    Assert-SessionContract -Condition ($tableLines.Count -ge 2) -Message "Section must contain a Markdown table: $Heading"
    $headers = @(Split-MarkdownTableRow -Line $tableLines[0])
    Assert-SessionContract -Condition ($headers.Count -eq $ExpectedHeaders.Count) -Message "Unexpected column count in section: $Heading"
    for ($index = 0; $index -lt $ExpectedHeaders.Count; $index++) {
        Assert-SessionContract -Condition ([string]$headers[$index] -ceq [string]$ExpectedHeaders[$index]) -Message "Unexpected header in ${Heading}: $($headers[$index])"
    }
    $separator = @(Split-MarkdownTableRow -Line $tableLines[1])
    Assert-SessionContract -Condition ($separator.Count -eq $ExpectedHeaders.Count) -Message "Unexpected separator count in section: $Heading"
    foreach ($cell in $separator) {
        Assert-SessionContract -Condition ([string]$cell -match '^:?-{3,}:?$') -Message "Invalid Markdown table separator in section: $Heading"
    }
    $rows = @()
    for ($index = 2; $index -lt $tableLines.Count; $index++) {
        $cells = @(Split-MarkdownTableRow -Line $tableLines[$index])
        Assert-SessionContract -Condition ($cells.Count -eq $ExpectedHeaders.Count) -Message "Unexpected data column count in section: $Heading"
        $rows += [pscustomobject][ordered]@{ cells = @($cells) }
    }
    return @($rows)
}

function Get-SessionRecordSchemaVersion {
    param([string]$Content)
    $match = [regex]::Match($Content, '(?m)^> Record schema: `([0-9]+)`\s*$')
    if (-not $match.Success) { return 0 }
    return [int]$match.Groups[1].Value
}

function Add-MarkdownTableRow {
    param(
        [string]$Content,
        [string]$Heading,
        [string[]]$Cells
    )
    $normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    $lines = @($normalized -split "`n")
    $headingToken = "## $Heading"
    $headingIndex = [Array]::IndexOf($lines, $headingToken)
    Assert-SessionContract -Condition ($headingIndex -ge 0) -Message "Missing Markdown section: $headingToken"

    $tableStart = -1
    for ($index = $headingIndex + 1; $index -lt $lines.Count; $index++) {
        if ($lines[$index].StartsWith('## ')) { break }
        if ($lines[$index].Trim().StartsWith('|') -and $lines[$index].Trim().EndsWith('|')) {
            $tableStart = $index
            break
        }
    }
    Assert-SessionContract -Condition ($tableStart -ge 0) -Message "Section must contain a Markdown table: $Heading"
    $headers = @(Split-MarkdownTableRow -Line $lines[$tableStart])
    Assert-SessionContract -Condition ($headers.Count -eq $Cells.Count) -Message "Unexpected appended column count in section: $Heading"

    $insertIndex = $tableStart
    while ($insertIndex -lt $lines.Count -and $lines[$insertIndex].Trim().StartsWith('|') -and $lines[$insertIndex].Trim().EndsWith('|')) {
        $insertIndex++
    }
    $escaped = @($Cells | ForEach-Object {
        ([string]$_).Replace("`r", ' ').Replace("`n", ' ').Replace('|', '\|').Trim()
    })
    foreach ($cell in $escaped) {
        Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($cell)) -Message "Cannot append an empty Markdown cell in section: $Heading"
    }
    $newRow = '| ' + ($escaped -join ' | ') + ' |'
    $before = if ($insertIndex -gt 0) { @($lines[0..($insertIndex - 1)]) } else { @() }
    $after = if ($insertIndex -lt $lines.Count) { @($lines[$insertIndex..($lines.Count - 1)]) } else { @() }
    return ((@($before) + $newRow + @($after)) -join "`n")
}

function Set-MarkdownTableRow {
    param(
        [string]$Content,
        [string]$Heading,
        [string]$RowId,
        [string[]]$Cells
    )
    $normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    $lines = @($normalized -split "`n")
    $headingIndex = [Array]::IndexOf($lines, "## $Heading")
    Assert-SessionContract -Condition ($headingIndex -ge 0) -Message "Missing Markdown section: ## $Heading"
    $tableStart = -1
    for ($index = $headingIndex + 1; $index -lt $lines.Count; $index++) {
        if ($lines[$index].StartsWith('## ')) { break }
        if ($lines[$index].Trim().StartsWith('|') -and $lines[$index].Trim().EndsWith('|')) {
            $tableStart = $index
            break
        }
    }
    Assert-SessionContract -Condition ($tableStart -ge 0) -Message "Section must contain a Markdown table: $Heading"
    $headers = @(Split-MarkdownTableRow -Line $lines[$tableStart])
    Assert-SessionContract -Condition ($headers.Count -eq $Cells.Count) -Message "Unexpected replacement column count in section: $Heading"
    $replacementIndex = -1
    for ($index = $tableStart + 2; $index -lt $lines.Count; $index++) {
        if (-not ($lines[$index].Trim().StartsWith('|') -and $lines[$index].Trim().EndsWith('|'))) { break }
        $rowCells = @(Split-MarkdownTableRow -Line $lines[$index])
        if ([string]$rowCells[0] -ceq $RowId) {
            Assert-SessionContract -Condition ($replacementIndex -lt 0) -Message "Duplicate row ID in section: $Heading->$RowId"
            $replacementIndex = $index
        }
    }
    Assert-SessionContract -Condition ($replacementIndex -ge 0) -Message "Missing row ID in section: $Heading->$RowId"
    $escaped = @($Cells | ForEach-Object {
        ([string]$_).Replace("`r", ' ').Replace("`n", ' ').Replace('|', '\|').Trim()
    })
    foreach ($cell in $escaped) {
        Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($cell)) -Message "Cannot write an empty Markdown cell in section: $Heading"
    }
    $lines[$replacementIndex] = '| ' + ($escaped -join ' | ') + ' |'
    return ($lines -join "`n")
}

function Split-ControlReferences {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -ceq '-' -or $Value -ceq 'none') { return @() }
    return @($Value -split ',' | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-SessionValidation {
    param(
        [string]$SessionPath,
        [string]$SessionRoot = '',
        [string]$BudgetConfigPath = '',
        [switch]$LocalOnly,
        [object]$StateOverride = $null,
        [string]$RecordOverride = $null
    )

    $statePath = Resolve-SessionStatePath -SessionPath $SessionPath
    Assert-SessionContract -Condition (Test-Path -LiteralPath $statePath -PathType Leaf) -Message "Missing session-state.json: $statePath"
    $sessionDirectory = Split-Path -Parent $statePath
    $state = if ($null -ne $StateOverride) { $StateOverride } else { Read-Utf8Json -Path $statePath }
    $required = @(
        'schema_version', 'session_id', 'title', 'mode', 'run_mode', 'status', 'visibility', 'storage_kind',
        'host_project', 'record_path', 'pruning_authority', 'delegated_scope', 'goal_revision',
        'state_sequence', 'pruning_sequence', 'created_at', 'updated_at', 'closed_at',
        'state_history', 'pruning_history'
    )
    foreach ($name in $required) { Assert-ObjectProperty -Object $state -Name $name }

    Assert-SessionContract -Condition ($state.schema_version -eq 2) -Message 'Active runtime requires session schema_version=2; migrate unfinished legacy sessions before continuing.'
    Assert-SessionContract -Condition (Test-SessionId -SessionId ([string]$state.session_id)) -Message 'Invalid session_id.'
    Assert-SessionContract -Condition ([IO.Path]::GetFileName($sessionDirectory) -ceq [string]$state.session_id) -Message 'Session directory must equal session_id.'
    $sessionDate = ([string]$state.session_id).Substring(3, 8)
    $monthDirectory = Split-Path -Parent $sessionDirectory
    $yearDirectory = Split-Path -Parent $monthDirectory
    Assert-SessionContract -Condition ([IO.Path]::GetFileName($monthDirectory) -ceq $sessionDate.Substring(4, 2)) -Message 'Session month directory must match session_id.'
    Assert-SessionContract -Condition ([IO.Path]::GetFileName($yearDirectory) -ceq $sessionDate.Substring(0, 4)) -Message 'Session year directory must match session_id.'
    Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace([string]$state.title) -and ([string]$state.title).Length -le 160) -Message 'Session title must contain 1-160 characters.'
    Assert-SessionContract -Condition ($script:BrainstormModes -ccontains [string]$state.mode) -Message "Invalid mode: $($state.mode)"
    Assert-SessionContract -Condition (@('cocreate', 'autonomous') -ccontains [string]$state.run_mode) -Message 'run_mode must be cocreate or autonomous.'
    Assert-SessionContract -Condition ($script:BrainstormStates -ccontains [string]$state.status) -Message "Invalid state: $($state.status)"
    Assert-SessionContract -Condition ($script:BrainstormVisibilities -ccontains [string]$state.visibility) -Message "Invalid visibility: $($state.visibility)"
    Assert-SessionContract -Condition ($script:BrainstormStorageKinds -ccontains [string]$state.storage_kind) -Message "Invalid storage_kind: $($state.storage_kind)"
    Assert-SessionContract -Condition ($script:BrainstormAuthorities -ccontains [string]$state.pruning_authority) -Message "Invalid pruning_authority: $($state.pruning_authority)"
    Assert-SessionContract -Condition ([int]$state.goal_revision -ge 1) -Message 'goal_revision must be at least 1.'
    Assert-SessionContract -Condition (Test-IsoDateTime -Value $state.created_at) -Message 'created_at must be an ISO date-time.'
    Assert-SessionContract -Condition (Test-IsoDateTime -Value $state.updated_at) -Message 'updated_at must be an ISO date-time.'

    if ([string]$state.pruning_authority -ceq 'delegated') {
        Assert-SessionContract -Condition ([string]$state.delegated_scope -ceq 'current-session-current-goal') -Message 'delegated requires the current-session-current-goal scope.'
        Assert-SessionContract -Condition ([string]$state.status -cne 'closed') -Message 'closed sessions cannot retain delegated authority.'
    } else {
        Assert-SessionContract -Condition ($null -eq $state.delegated_scope) -Message 'confirm authority requires delegated_scope=null.'
    }

    if ([string]$state.status -ceq 'closed') {
        Assert-SessionContract -Condition (Test-IsoDateTime -Value $state.closed_at) -Message 'closed sessions require closed_at.'
        Assert-SessionContract -Condition ([string]$state.pruning_authority -ceq 'confirm') -Message 'closed sessions must restore confirm authority.'
    } else {
        Assert-SessionContract -Condition ($null -eq $state.closed_at) -Message 'Only closed sessions may have closed_at.'
    }

    $stateHistory = @($state.state_history)
    Assert-SessionContract -Condition ($stateHistory.Count -ge 1) -Message 'state_history must not be empty.'
    $previousState = $null
    for ($index = 0; $index -lt $stateHistory.Count; $index++) {
        $entry = $stateHistory[$index]
        foreach ($name in @('sequence', 'from', 'to', 'event', 'changed_at')) { Assert-ObjectProperty -Object $entry -Name $name }
        Assert-SessionContract -Condition ([int]$entry.sequence -eq $index) -Message 'state_history sequence must be contiguous.'
        Assert-SessionContract -Condition ($script:BrainstormStates -ccontains [string]$entry.to) -Message "Invalid state_history target: $($entry.to)"
        Assert-SessionContract -Condition (Test-IsoDateTime -Value $entry.changed_at) -Message 'state_history changed_at must be an ISO date-time.'
        if ($index -eq 0) {
            Assert-SessionContract -Condition ($null -eq $entry.from -and [string]$entry.to -ceq 'open' -and [string]$entry.event -ceq 'created') -Message 'First state event must create an open session.'
        } else {
            Assert-SessionContract -Condition ([string]$entry.from -ceq [string]$previousState) -Message 'state_history from must match the previous state.'
            Assert-SessionContract -Condition (Test-AllowedStateTransition -From ([string]$entry.from) -To ([string]$entry.to)) -Message "Illegal state_history transition: $($entry.from)->$($entry.to)"
            $expectedEvent = Get-StateTransitionEvent -From ([string]$entry.from) -To ([string]$entry.to)
            Assert-SessionContract -Condition ([string]$entry.event -ceq $expectedEvent) -Message "Unexpected state event: $($entry.event)"
        }
        $previousState = [string]$entry.to
    }
    Assert-SessionContract -Condition ([int]$state.state_sequence -eq ($stateHistory.Count - 1)) -Message 'state_sequence must match state_history.'
    Assert-SessionContract -Condition ([string]$state.status -ceq [string]$previousState) -Message 'status must match the final state_history target.'

    $pruningHistory = @($state.pruning_history)
    Assert-SessionContract -Condition ($pruningHistory.Count -ge 1) -Message 'pruning_history must not be empty.'
    $previousAuthority = $null
    for ($index = 0; $index -lt $pruningHistory.Count; $index++) {
        $entry = $pruningHistory[$index]
        foreach ($name in @('sequence', 'from', 'to', 'event', 'changed_at')) { Assert-ObjectProperty -Object $entry -Name $name }
        Assert-SessionContract -Condition ([int]$entry.sequence -eq $index) -Message 'pruning_history sequence must be contiguous.'
        Assert-SessionContract -Condition ($script:BrainstormAuthorities -ccontains [string]$entry.to) -Message "Invalid pruning_history target: $($entry.to)"
        Assert-SessionContract -Condition (Test-IsoDateTime -Value $entry.changed_at) -Message 'pruning_history changed_at must be an ISO date-time.'
        if ($index -eq 0) {
            Assert-SessionContract -Condition ($null -eq $entry.from -and [string]$entry.to -ceq 'confirm' -and [string]$entry.event -ceq 'default') -Message 'First pruning event must establish confirm authority.'
        } else {
            Assert-SessionContract -Condition ([string]$entry.from -ceq [string]$previousAuthority) -Message 'pruning_history from must match the previous authority.'
            $pruningKey = "$($entry.from)->$($entry.to):$($entry.event)"
            Assert-SessionContract -Condition (@(
                'confirm->delegated:delegated',
                'delegated->confirm:restored',
                'delegated->confirm:goal-changed',
                'delegated->confirm:session-closed'
            ) -ccontains $pruningKey) -Message "Invalid pruning_history event: $pruningKey"
        }
        $previousAuthority = [string]$entry.to
    }
    Assert-SessionContract -Condition ([int]$state.pruning_sequence -eq ($pruningHistory.Count - 1)) -Message 'pruning_sequence must match pruning_history.'
    Assert-SessionContract -Condition ([string]$state.pruning_authority -ceq [string]$previousAuthority) -Message 'pruning_authority must match pruning_history.'

    $recordPath = Resolve-SafeRelativePath -BasePath $sessionDirectory -RelativePath ([string]$state.record_path)
    Assert-SessionContract -Condition (Test-Path -LiteralPath $recordPath -PathType Leaf) -Message "Missing session record: $recordPath"
    $record = if ($PSBoundParameters.ContainsKey('RecordOverride')) { $RecordOverride } else { [IO.File]::ReadAllText($recordPath, $script:BrainstormUtf8NoBom) }
    $runModeHeader = [regex]::Matches($record, '(?m)^> Run mode:[ \t]*([^\r\n]+)')
    Assert-SessionContract -Condition ($runModeHeader.Count -eq 1 -and $runModeHeader[0].Groups[1].Value.Trim() -ceq [string]$state.run_mode) -Message 'Record Run mode must match the state run_mode.'
    $recordSchemaVersion = Get-SessionRecordSchemaVersion -Content $record
    Assert-SessionContract -Condition ($recordSchemaVersion -eq 2) -Message "Unsupported session record schema: $recordSchemaVersion"
    foreach ($section in @('## Session Brief', '## Raw Capture', '## Idea Ledger', '## Method Runs', '## Evidence Annex', '## Decision Record', '## Open Questions', '## Handoff')) {
        Assert-SessionContract -Condition ($record.Contains($section)) -Message "Session record is missing section: $section"
    }

    $ideaSources = @('user', 'ai-independent', 'method-generated', 'project-fact', 'knowledge', 'web')
    $methodCatalog = Read-Utf8Json -Path (Join-Path $script:BrainstormProjectRoot 'methods\catalog.json')
    $readyMethodIds = @{}
    foreach ($method in @($methodCatalog.methods | Where-Object { [string]$_.status -ceq 'ready' })) {
        $readyMethodIds[[string]$method.method_id] = $true
    }
    $currentPhase = 'capture'
    $currentMethodId = '-'
    Assert-SessionContract -Condition ($record.Contains('## Phase Navigator')) -Message 'Session record schema 2 requires Phase Navigator.'
    Assert-SessionContract -Condition ($record.Contains('## Artifact Index')) -Message 'Session record schema 2 requires Artifact Index.'
    $navigationRows = @(Get-MarkdownTableRows -Content $record -Heading 'Phase Navigator' -ExpectedHeaders @('Navigation ID', 'Phase', 'Method ID', 'AI responsibility', 'User action', 'Next step'))
    Assert-SessionContract -Condition ($navigationRows.Count -ge 1) -Message 'Phase Navigator requires at least one row.'
    $navigationIds = @{}
    foreach ($row in $navigationRows) {
        $cells = @($row.cells)
        $navigationId = [string]$cells[0]
        Assert-SessionContract -Condition ($navigationId -cmatch '^NAV-[0-9]{3,}$') -Message "Invalid Navigation ID: $navigationId"
        Assert-SessionContract -Condition (-not $navigationIds.ContainsKey($navigationId)) -Message "Duplicate Navigation ID: $navigationId"
        Assert-SessionContract -Condition (@('capture', 'framing', 'divergence', 'clustering', 'combination', 'convergence', 'recording', 'handoff', 'paused', 'closed') -ccontains [string]$cells[1]) -Message "Invalid navigator phase: $($cells[1])"
        Assert-SessionContract -Condition ([string]$cells[2] -ceq '-' -or $readyMethodIds.ContainsKey([string]$cells[2])) -Message "Navigator method must be '-' or a ready Method ID: $navigationId"
        foreach ($index in @(3, 4, 5)) {
            Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace([string]$cells[$index]) -and [string]$cells[$index] -cne '-') -Message "Navigator guidance is empty: $navigationId"
        }
        $navigationIds[$navigationId] = $true
    }
    $currentPhase = [string]$navigationRows[-1].cells[1]
    $currentMethodId = [string]$navigationRows[-1].cells[2]
    $rawRows = @(Get-MarkdownTableRows -Content $record -Heading 'Raw Capture' -ExpectedHeaders @('Raw ID', 'Source', 'Original input', 'Interpretation status'))
    $rawIds = @{}
    foreach ($row in $rawRows) {
        $cells = @($row.cells)
        $rawId = [string]$cells[0]
        Assert-SessionContract -Condition ($rawId -cmatch '^RAW-[0-9]{3,}$') -Message "Invalid Raw ID: $rawId"
        Assert-SessionContract -Condition (-not $rawIds.ContainsKey($rawId)) -Message "Duplicate Raw ID: $rawId"
        Assert-SessionContract -Condition ($ideaSources -ccontains [string]$cells[1]) -Message "Invalid Raw source: $($cells[1])"
        Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace([string]$cells[2])) -Message "Raw input is empty: $rawId"
        Assert-SessionContract -Condition (@('clear', 'uncertain', 'resolved') -ccontains [string]$cells[3]) -Message "Invalid interpretation status: $($cells[3])"
        $rawIds[$rawId] = $true
    }

    $ideaHeaders = @('Idea ID', 'Parent IDs', 'Source', 'Method ID', 'Disposition', 'Adoption', 'Idea', 'Destination', 'Supersedes', 'Decision reason')
    $ideaRows = @(Get-MarkdownTableRows -Content $record -Heading 'Idea Ledger' -ExpectedHeaders $ideaHeaders)
    $ideaIds = @{}
    $supersededBy = @{}
    foreach ($row in $ideaRows) {
        $cells = @($row.cells)
        $ideaId = [string]$cells[0]
        Assert-SessionContract -Condition ($ideaId -cmatch '^IDEA-[0-9]{3,}$') -Message "Invalid Idea ID: $ideaId"
        Assert-SessionContract -Condition (-not $ideaIds.ContainsKey($ideaId)) -Message "Duplicate Idea ID: $ideaId"
        Assert-SessionContract -Condition ($ideaSources -ccontains [string]$cells[2]) -Message "Invalid Idea source: $($cells[2])"
        if ([string]$cells[2] -ceq 'method-generated') {
            Assert-SessionContract -Condition ($readyMethodIds.ContainsKey([string]$cells[3])) -Message "Method-generated Idea requires a ready Method ID: $ideaId"
        } else {
            Assert-SessionContract -Condition ([string]$cells[3] -ceq '-') -Message "Non-method Idea must use '-' Method ID: $ideaId"
        }
        $disposition = [string]$cells[4]
        $adoption = [string]$cells[5]
        Assert-SessionContract -Condition (@('active', 'merged', 'parked', 'rejected', 'superseded') -ccontains $disposition) -Message "Invalid Idea disposition: $disposition"
        Assert-SessionContract -Condition (@('none', 'shortlist', 'component', 'package', 'prototype', 'later') -ccontains $adoption) -Message "Invalid Idea adoption: $adoption"
        Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace([string]$cells[6])) -Message "Idea text is empty: $ideaId"
        if ($disposition -ceq 'rejected') {
            Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace([string]$cells[9]) -and [string]$cells[9] -cne '-') -Message "Rejected Idea requires a decision reason: $ideaId"
        }
        if (@('merged', 'superseded') -ccontains $disposition) {
            Assert-SessionContract -Condition ([string]$cells[7] -cmatch '^IDEA-[0-9]{3,}$') -Message "$disposition Idea requires a destination: $ideaId"
        }
        if (@('merged', 'rejected', 'superseded') -ccontains $disposition) {
            Assert-SessionContract -Condition ($adoption -ceq 'none') -Message "$disposition Idea must use adoption=none: $ideaId"
        }
        if ($disposition -ceq 'parked') {
            Assert-SessionContract -Condition (@('none', 'later') -ccontains $adoption) -Message "Parked Idea may only use adoption=none/later: $ideaId"
        }
        $supersedes = @(Split-ControlReferences -Value ([string]$cells[8]))
        Assert-SessionContract -Condition ($supersedes.Count -le 1) -Message "Idea may supersede at most one prior revision: $ideaId"
        if ($supersedes.Count -eq 1) {
            Assert-SessionContract -Condition (-not $supersededBy.ContainsKey($supersedes[0])) -Message "Idea revision has multiple successors: $($supersedes[0])"
            $supersededBy[$supersedes[0]] = $ideaId
        }
        $ideaIds[$ideaId] = $row
    }
    foreach ($ideaId in @($ideaIds.Keys)) {
        $cells = @($ideaIds[$ideaId].cells)
        foreach ($parentId in @(Split-ControlReferences -Value ([string]$cells[1]))) {
            Assert-SessionContract -Condition ($parentId -cne $ideaId -and $ideaIds.ContainsKey($parentId)) -Message "Invalid Idea parent reference: $ideaId->$parentId"
        }
        $destinationIndex = 7
        if (@('merged', 'superseded') -ccontains [string]$cells[4]) {
            $destination = [string]$cells[$destinationIndex]
            Assert-SessionContract -Condition ($destination -cne $ideaId -and $ideaIds.ContainsKey($destination)) -Message "Invalid Idea destination: $ideaId->$destination"
        }
        foreach ($supersededId in @(Split-ControlReferences -Value ([string]$cells[8]))) {
            Assert-SessionContract -Condition ($supersededId -cne $ideaId -and $ideaIds.ContainsKey($supersededId)) -Message "Invalid supersedes reference: $ideaId->$supersededId"
            $priorCells = @($ideaIds[$supersededId].cells)
            Assert-SessionContract -Condition ([string]$priorCells[4] -ceq 'superseded') -Message "Superseded revision must use disposition=superseded: $supersededId"
            Assert-SessionContract -Condition ([string]$priorCells[7] -ceq $ideaId) -Message "Superseded revision destination must point to its successor: $supersededId->$ideaId"
        }
        if ([string]$cells[4] -ceq 'superseded') {
            Assert-SessionContract -Condition ($supersededBy.ContainsKey($ideaId)) -Message "Superseded Idea requires a successor row: $ideaId"
        }
    }

    $methodRunRows = @(Get-MarkdownTableRows -Content $record -Heading 'Method Runs' -ExpectedHeaders @('Run ID', 'Method ID', 'Input IDs', 'Output IDs', 'Why selected', 'Exit status'))
    $methodRunIds = @{}
    $methodOutputs = @{}
    foreach ($row in $methodRunRows) {
        $cells = @($row.cells)
        $runId = [string]$cells[0]
        $runMethodId = [string]$cells[1]
        Assert-SessionContract -Condition ($runId -cmatch '^RUN-[0-9]{3,}$') -Message "Invalid Method Run ID: $runId"
        Assert-SessionContract -Condition (-not $methodRunIds.ContainsKey($runId)) -Message "Duplicate Method Run ID: $runId"
        Assert-SessionContract -Condition ($readyMethodIds.ContainsKey($runMethodId)) -Message "Method Run requires a ready Method ID: $runId"
        $inputIds = @(Split-ControlReferences -Value ([string]$cells[2]))
        $outputIds = @(Split-ControlReferences -Value ([string]$cells[3]))
        Assert-SessionContract -Condition ($inputIds.Count -ge 1) -Message "Method Run requires input references: $runId"
        Assert-SessionContract -Condition ($outputIds.Count -ge 1) -Message "Method Run requires output references: $runId"
        foreach ($inputId in $inputIds) {
            Assert-SessionContract -Condition ($rawIds.ContainsKey($inputId) -or $ideaIds.ContainsKey($inputId)) -Message "Invalid Method Run input: $runId->$inputId"
        }
        foreach ($outputId in $outputIds) {
            Assert-SessionContract -Condition ($rawIds.ContainsKey($outputId) -or $ideaIds.ContainsKey($outputId)) -Message "Invalid Method Run output: $runId->$outputId"
            $methodOutputs["$runMethodId|$outputId"] = $true
        }
        Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace([string]$cells[4]) -and [string]$cells[4] -cne '-') -Message "Method Run requires a selection reason: $runId"
        Assert-SessionContract -Condition (@('complete', 'paused', 'blocked') -ccontains [string]$cells[5]) -Message "Invalid Method Run exit status: $runId"
        $methodRunIds[$runId] = $true
    }
    foreach ($ideaId in @($ideaIds.Keys)) {
        $cells = @($ideaIds[$ideaId].cells)
        if ([string]$cells[2] -ceq 'method-generated') {
            Assert-SessionContract -Condition ($methodOutputs.ContainsKey("$([string]$cells[3])|$ideaId")) -Message "Method-generated Idea is not covered by a matching Method Run: $ideaId"
        }
    }

    $evidenceRows = @(Get-MarkdownTableRows -Content $record -Heading 'Evidence Annex' -ExpectedHeaders @('Evidence ID', 'Source type', 'Supports / challenges', 'Finding', 'Limits'))
    $evidenceIds = @{}
    foreach ($row in $evidenceRows) {
        $cells = @($row.cells)
        $evidenceId = [string]$cells[0]
        Assert-SessionContract -Condition ($evidenceId -cmatch '^EVID-[0-9]{3,}$') -Message "Invalid Evidence ID: $evidenceId"
        Assert-SessionContract -Condition (-not $evidenceIds.ContainsKey($evidenceId)) -Message "Duplicate Evidence ID: $evidenceId"
        Assert-SessionContract -Condition ($ideaSources -ccontains [string]$cells[1]) -Message "Invalid Evidence source: $($cells[1])"
        foreach ($targetId in @(Split-ControlReferences -Value ([string]$cells[2]))) {
            Assert-SessionContract -Condition ($ideaIds.ContainsKey($targetId)) -Message "Invalid Evidence target: $evidenceId->$targetId"
        }
        Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace([string]$cells[3])) -Message "Evidence finding is empty: $evidenceId"
        $evidenceIds[$evidenceId] = $true
    }

    $decisionRows = @(Get-MarkdownTableRows -Content $record -Heading 'Decision Record' -ExpectedHeaders @('Decision ID', 'Candidate IDs', 'Decision', 'Criteria', 'Evidence IDs', 'Decider'))
    $decisionIds = @{}
    foreach ($row in $decisionRows) {
        $cells = @($row.cells)
        $decisionId = [string]$cells[0]
        Assert-SessionContract -Condition ($decisionId -cmatch '^DEC-[0-9]{3,}$') -Message "Invalid Decision ID: $decisionId"
        Assert-SessionContract -Condition (-not $decisionIds.ContainsKey($decisionId)) -Message "Duplicate Decision ID: $decisionId"
        $candidateIds = @(Split-ControlReferences -Value ([string]$cells[1]))
        Assert-SessionContract -Condition ($candidateIds.Count -ge 1) -Message "Decision requires candidate references: $decisionId"
        foreach ($candidateId in $candidateIds) {
            Assert-SessionContract -Condition ($ideaIds.ContainsKey($candidateId)) -Message "Invalid Decision candidate: $decisionId->$candidateId"
        }
        Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace([string]$cells[2])) -Message "Decision text is empty: $decisionId"
        Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace([string]$cells[3])) -Message "Decision criteria are empty: $decisionId"
        foreach ($evidenceId in @(Split-ControlReferences -Value ([string]$cells[4]))) {
            Assert-SessionContract -Condition ($evidenceIds.ContainsKey($evidenceId)) -Message "Invalid Decision evidence: $decisionId->$evidenceId"
        }
        Assert-SessionContract -Condition (@('user', 'ai-delegated', 'joint') -ccontains [string]$cells[5]) -Message "Invalid Decision decider: $($cells[5])"
        $decisionIds[$decisionId] = $true
    }

    $artifactCount = 0
    $artifactRows = @(Get-MarkdownTableRows -Content $record -Heading 'Artifact Index' -ExpectedHeaders @('Artifact ID', 'Kind', 'Path', 'Source IDs', 'Status', 'Purpose'))
    $artifactIds = @{}
    foreach ($row in $artifactRows) {
        $cells = @($row.cells)
        $artifactId = [string]$cells[0]
        Assert-SessionContract -Condition ($artifactId -cmatch '^ART-[0-9]{3,}$') -Message "Invalid Artifact ID: $artifactId"
        Assert-SessionContract -Condition (-not $artifactIds.ContainsKey($artifactId)) -Message "Duplicate Artifact ID: $artifactId"
        # The retired report kind is readable only as historical evidence; no creator accepts it.
        Assert-SessionContract -Condition (@('divergence-batch', 'comparison', 'scoring', 'draft-analysis', 'research-notes', 'perspective-review', 'auto-report', 'learning-feedback') -ccontains [string]$cells[1]) -Message "Invalid Artifact kind: $artifactId"
        $artifactPath = Resolve-SafeRelativePath -BasePath $sessionDirectory -RelativePath ([string]$cells[2])
        Assert-SessionContract -Condition ([IO.Path]::GetExtension($artifactPath) -ceq '.md' -and (Test-Path -LiteralPath $artifactPath -PathType Leaf)) -Message "Missing Artifact file: $artifactId"
        $artifactSourceIds = @(Split-ControlReferences -Value ([string]$cells[3]))
        Assert-SessionContract -Condition ($artifactSourceIds.Count -ge 1) -Message "Artifact requires Source IDs: $artifactId"
        foreach ($sourceId in $artifactSourceIds) {
            Assert-SessionContract -Condition ($rawIds.ContainsKey($sourceId) -or $ideaIds.ContainsKey($sourceId)) -Message "Invalid Artifact source: $artifactId->$sourceId"
        }
        Assert-SessionContract -Condition (@('active', 'superseded') -ccontains [string]$cells[4]) -Message "Invalid Artifact status: $artifactId"
        Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace([string]$cells[5]) -and [string]$cells[5] -cne '-') -Message "Artifact purpose is empty: $artifactId"
        $artifactIds[$artifactId] = $true
    }
    $artifactCount = $artifactRows.Count

    $continuation = Get-SessionContinuation -Content $record
    foreach ($decisionRef in @($continuation.decision_refs)) {
        Assert-SessionContract -Condition ($decisionIds.ContainsKey($decisionRef)) -Message "Unknown current Decision ref: $decisionRef"
    }

    $config = Get-SessionBudgetConfig -ConfigPath $BudgetConfigPath
    $allowed = @($config.allowed_extensions | ForEach-Object { ([string]$_).ToLowerInvariant() })
    foreach ($file in @(Get-ChildItem -LiteralPath $sessionDirectory -Recurse -File)) {
        Assert-SessionContract -Condition ($allowed -ccontains $file.Extension.ToLowerInvariant()) -Message "Session contains forbidden file type: $($file.FullName)"
    }

    if ([string]::IsNullOrWhiteSpace($SessionRoot)) {
        $SessionRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $sessionDirectory))
    }
    $SessionRoot = [IO.Path]::GetFullPath($SessionRoot)
    if (-not $LocalOnly) {
        $rootCheck = Get-SessionRootDiagnostics -SessionRoot $SessionRoot
        Assert-SessionContract ($rootCheck.problems.Count -eq 0) ('Invalid sibling session state: ' + ($rootCheck.problems -join '; '))
        $duplicates = @($rootCheck.identities | Where-Object { $_.session_id -ceq [string]$state.session_id }).Count
        Assert-SessionContract ($duplicates -eq 1) "session_id must be unique within SessionRoot: $($state.session_id)"
    }
    $sessionBytes = Get-DirectoryBytes -Path $sessionDirectory
    $recordBytes = if ($PSBoundParameters.ContainsKey('RecordOverride')) { $script:BrainstormUtf8NoBom.GetByteCount($record) } else { (Get-Item -LiteralPath $recordPath).Length }
    $totalBytes = if ($LocalOnly) { $null } else { Get-TotalSessionBytes -SessionRoot $SessionRoot }
    $warnings = @()
    if ($recordBytes -gt [long]$config.canonical_record_warning_bytes) {
        $warnings += "canonical_record_budget_exceeded:$recordBytes>$($config.canonical_record_warning_bytes)"
    }
    if ($sessionBytes -gt [long]$config.single_session_warning_bytes) {
        $warnings += "single_session_budget_exceeded:$sessionBytes>$($config.single_session_warning_bytes)"
    }
    if ($totalBytes -gt [long]$config.total_sessions_warning_bytes) {
        $warnings += "total_sessions_budget_exceeded:$totalBytes>$($config.total_sessions_warning_bytes)"
    }

    return [pscustomobject][ordered]@{
        structure_passed = $true
        session_id = [string]$state.session_id
        status = [string]$state.status
        schema_version = [int]$state.schema_version
        run_mode = [string]$state.run_mode
        continuation = $continuation
        record_schema = $recordSchemaVersion
        current_phase = $currentPhase
        current_method_id = $currentMethodId
        artifact_count = $artifactCount
        pruning_authority = [string]$state.pruning_authority
        record_bytes = $recordBytes
        session_bytes = $sessionBytes
        total_session_bytes = $totalBytes
        root_scope_checked = -not [bool]$LocalOnly
        warnings = @($warnings)
        semantic_review = 'required'
    }
}

function Write-SessionIndex {
    param(
        [string]$SessionRoot,
        [string]$OutputPath = '',
        [string]$BudgetConfigPath = ''
    )

    $SessionRoot = [IO.Path]::GetFullPath($SessionRoot)
    Assert-SessionContract -Condition (Test-Path -LiteralPath $SessionRoot -PathType Container) -Message "Missing SessionRoot: $SessionRoot"
    if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $SessionRoot 'index.json' }
    $OutputPath = [IO.Path]::GetFullPath($OutputPath)
    $rootPrefix = $SessionRoot.TrimEnd([char]92, [char]47) + [IO.Path]::DirectorySeparatorChar
    Assert-SessionContract -Condition ($OutputPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) -Message 'OutputPath must stay inside SessionRoot.'

    Assert-SafePhysicalPath -Path $OutputPath
    $config = Get-SessionBudgetConfig -ConfigPath $BudgetConfigPath
    $problems = @()
    $sessions = @()
    $warnings = @()
    $directories = @(Get-SessionDirectories -SessionRoot $SessionRoot)
    foreach ($directory in $directories) {
        try {
        $state = Read-Utf8Json -Path (Join-Path $directory 'session-state.json')
        $archiveOnly = [int]$state.schema_version -eq 1 -and [string]$state.status -ceq 'closed'
        if ($archiveOnly) {
            Assert-SessionContract -Condition (Test-SessionId -SessionId ([string]$state.session_id)) -Message 'Invalid archive session ID.'
            Assert-SessionContract -Condition ((Split-Path -Leaf $directory) -ceq [string]$state.session_id) -Message 'Archive directory identity mismatch.'
            Assert-SessionContract -Condition (Test-IsoDateTime -Value $state.closed_at) -Message 'Archive must have a closure timestamp.'
            $history = @($state.state_history)
            Assert-SessionContract -Condition ($history.Count -ge 2 -and [string]$history[-1].to -ceq 'closed' -and [string]$history[-1].event -ceq 'close' -and [int]$state.state_sequence -eq ($history.Count - 1)) -Message 'Archive must have a matching terminal close event.'
            $archiveRecord = Resolve-SafeRelativePath -BasePath $directory -RelativePath ([string]$state.record_path)
            Assert-SessionContract -Condition (Test-Path -LiteralPath $archiveRecord -PathType Leaf) -Message 'Missing archive record.'
            $validation = [pscustomobject]@{ session_bytes = (Get-DirectoryBytes -Path $directory); warnings = @() }
        } else {
            $validation = Get-SessionValidation -SessionPath $directory -SessionRoot $SessionRoot -BudgetConfigPath $BudgetConfigPath -LocalOnly
        }
        $relativePath = $directory.Substring($rootPrefix.Length).Replace([char]92, [char]47)
        $sessions += [pscustomobject][ordered]@{
            session_id = [string]$state.session_id
            title = [string]$state.title
            mode = [string]$state.mode
            status = [string]$state.status
            visibility = [string]$state.visibility
            updated_at = [string]$state.updated_at
            schema_version = [int]$state.schema_version
            archive_only = $archiveOnly
            runtime_eligible = -not $archiveOnly -and [string]$state.status -cne 'closed'
            relative_path = $relativePath
            bytes = [long]$validation.session_bytes
            warnings = @($validation.warnings)
        }
        foreach ($warning in @($validation.warnings)) {
            if (-not ($warnings -ccontains [string]$warning)) { $warnings += [string]$warning }
        }
        } catch { $problems += [pscustomobject]@{ path = $directory; error = $_.Exception.Message } }
    }

    $duplicateIds = @($sessions | Group-Object session_id | Where-Object { $_.Count -gt 1 })
    foreach ($duplicate in $duplicateIds) { $problems += [pscustomobject]@{ path = $SessionRoot; error = ('Duplicate session identity: ' + $duplicate.Name) } }
    $totalBytes = Get-TotalSessionBytes -SessionRoot $SessionRoot
    if ($totalBytes -gt [long]$config.total_sessions_warning_bytes) {
        $warning = "total_sessions_budget_exceeded:$totalBytes>$($config.total_sessions_warning_bytes)"
        if (-not ($warnings -ccontains $warning)) { $warnings += $warning }
    }

    $index = [pscustomobject][ordered]@{
        schema_version = 1
        generated_at = (Get-Date).ToUniversalTime().ToString('o')
        session_count = $directories.Count
        valid_session_count = $sessions.Count
        invalid_session_count = $problems.Count
        health_status = if ($problems.Count -eq 0) { 'healthy' } else { 'degraded' }
        problems = @($problems)
        total_bytes = $totalBytes
        warnings = @($warnings | Sort-Object -Unique)
        sessions = @($sessions | Sort-Object session_id)
    }
    Write-Utf8JsonAtomic -Path $OutputPath -Value $index
    Assert-SessionContract ($problems.Count -eq 0) "Session index is degraded; per-object problems preserved at $OutputPath. Repair those objects and rerun build-session-index."
    return $index
}

function Get-SessionSection {
    param([string]$Content, [string]$Heading)
    $normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    $pattern = '(?ms)^## ' + [regex]::Escape($Heading) + '[ \t]*\n(.*?)(?=^## |\z)'
    $matches = [regex]::Matches($normalized, $pattern)
    Assert-SessionContract -Condition ($matches.Count -eq 1) -Message "Expected one session section: $Heading"
    return $matches[0].Groups[1].Value.Trim()
}

function Get-SessionContinuation {
    param([string]$Content)
    $section = Get-SessionSection -Content $Content -Heading 'Current Continuation'
    $result = [ordered]@{}
    foreach ($field in @('Current focus', 'Next action', 'Pause boundary', 'Decision refs')) {
        $matches = [regex]::Matches($section, '(?m)^- ' + [regex]::Escape($field) + ':[ \t]*(.+)$')
        Assert-SessionContract -Condition ($matches.Count -eq 1) -Message "Current Continuation requires one non-empty $field."
        $value = $matches[0].Groups[1].Value.Trim()
        Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($value) -and $value -cne '-') -Message "Current Continuation requires explicit $field (use none when absent)."
        $key = $field.ToLowerInvariant().Replace(' ', '_')
        $result[$key] = $value
    }
    $result['decision_refs'] = @(Split-ControlReferences -Value $result['decision_refs'])
    foreach ($id in $result['decision_refs']) {
        Assert-SessionContract -Condition ($id -cmatch '^DEC-[0-9]{3,}$') -Message "Invalid current Decision ref: $id"
    }
    return [pscustomobject]$result
}

function Set-SessionContinuationField {
    param([string]$Content, [string]$Field, [string]$Value)
    Assert-SessionContract -Condition (@('Current focus', 'Next action', 'Pause boundary', 'Decision refs') -ccontains $Field) -Message 'Unknown continuation field.'
    Assert-SessionContract -Condition (-not [string]::IsNullOrWhiteSpace($Value) -and $Value -cne '-') -Message 'Continuation values must be explicit; use none when absent.'
    $section = Get-SessionSection -Content $Content -Heading 'Current Continuation'
    $escapedValue = $Value.Replace("`r", ' ').Replace("`n", ' ')
    $pattern = '(?m)^- ' + [regex]::Escape($Field) + ':[ \t]*[^\r\n]+'
    $matches = [regex]::Matches($section, $pattern)
    Assert-SessionContract -Condition ($matches.Count -eq 1) -Message "Missing or duplicate continuation field: $Field"
    $updated = [regex]::Replace($section, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($m) return ('- ' + $Field + ': ' + $escapedValue) })
    return $Content.Replace($section, $updated)
}


# Shared boundaries for every session writer. Reject reparse ancestry before mkdir/write.
function Assert-SafePhysicalPath {
    param([string]$Path)
    $cursor = [IO.Path]::GetFullPath($Path)
    while (-not [string]::IsNullOrWhiteSpace($cursor)) {
        $attributes = $null
        try { $attributes = [IO.File]::GetAttributes($cursor) }
        catch [IO.FileNotFoundException] { }
        catch [IO.DirectoryNotFoundException] { }
        if ($null -ne $attributes) {
            Assert-SessionContract (($attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) "Reparse point is not allowed in a protected path: $cursor"
        }
        $parent = Split-Path -Parent $cursor
        if ($parent -ceq $cursor) { break }
        $cursor = $parent
    }
}

function Assert-SessionWritable {
    param([string]$SessionPath)
    $statePath = Resolve-SessionStatePath -SessionPath $SessionPath
    $currentState = Read-Utf8Json -Path $statePath
    Assert-SessionContract ([string]$currentState.status -cne 'closed') 'Closed sessions are immutable.'
}

function Get-SessionFileSha256 {
    param([string]$Path)
    Assert-SafePhysicalPath -Path $Path
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}

function Get-SessionRootDiagnostics {
    param([string]$SessionRoot)
    $identities = @(); $problems = @()
    foreach ($directory in @(Get-SessionDirectories -SessionRoot $SessionRoot)) {
        try {
            $path = Join-Path $directory 'session-state.json'
            Assert-SafePhysicalPath -Path $path
            $s = Read-Utf8Json -Path $path
            Assert-SessionContract (Test-SessionId -SessionId ([string]$s.session_id)) "Invalid sibling identity: $path"
            $identities += [pscustomobject]@{ session_id = [string]$s.session_id; path = $path }
        } catch { $problems += $_.Exception.Message }
    }
    return [pscustomobject]@{ identities = @($identities); problems = @($problems) }
}

function Complete-SessionUpdate {
    param([string]$SessionPath, [object]$State, [string]$Record, [string]$SessionRoot = '')
    Assert-SessionWritable -SessionPath $SessionPath
    $statePath = Resolve-SessionStatePath -SessionPath $SessionPath
    $directory = Split-Path -Parent $statePath
    $recordPath = Resolve-SafeRelativePath -BasePath $directory -RelativePath ([string]$State.record_path)
    $arguments = @{ SessionPath = $directory; SessionRoot = $SessionRoot; StateOverride = $State }
    if ($PSBoundParameters.ContainsKey('Record')) { $arguments.RecordOverride = $Record }
    [void](Get-SessionValidation @arguments)
    $oldState = [IO.File]::ReadAllBytes($statePath)
    $oldRecord = [IO.File]::ReadAllBytes($recordPath)
    try {
        if ($PSBoundParameters.ContainsKey('Record')) { Write-Utf8TextAtomic -Path $recordPath -Value $Record }
        Write-Utf8JsonAtomic -Path $statePath -Value $State
    } catch {
        $cause = $_.Exception.Message
        try {
            if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($recordPath)) -cne [Convert]::ToBase64String($oldRecord)) { [IO.File]::WriteAllBytes($recordPath, $oldRecord) }
            if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($statePath)) -cne [Convert]::ToBase64String($oldState)) { [IO.File]::WriteAllBytes($statePath, $oldState) }
        }
        catch { throw "Session write failed and rollback needs repair at $directory. Original: $cause; recovery: $($_.Exception.Message)" }
        throw "Session write failed; original record and state restored. Cause: $cause"
    }
    $validation = Get-SessionValidation -SessionPath $directory -SessionRoot $SessionRoot
    if ([string]::IsNullOrWhiteSpace($SessionRoot)) { $SessionRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $directory)) }
    try { $index = Write-SessionIndex -SessionRoot $SessionRoot }
    catch { throw "Session update committed at $directory; index rebuild failed. Keep this session and rerun build-session-index; do not repeat the mutation. $($_.Exception.Message)" }
    return [pscustomobject]@{ validation = $validation; index = $index }
}

function Get-HandoffSourceSnapshot {
    param([string]$SessionDirectory)
    $s = Read-Utf8Json -Path (Join-Path $SessionDirectory 'session-state.json')
    $recordPath = Resolve-SafeRelativePath -BasePath $SessionDirectory -RelativePath ([string]$s.record_path)
    $record = [IO.File]::ReadAllText($recordPath, $script:BrainstormUtf8NoBom)
    $decisions = @(Get-MarkdownTableRows -Content $record -Heading 'Decision Record' -ExpectedHeaders @('Decision ID','Candidate IDs','Decision','Criteria','Evidence IDs','Decider'))
    $ledger = (@($decisions | ForEach-Object { $_.cells -join '|' }) -join "`n")
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $ledgerHash = ([BitConverter]::ToString($sha.ComputeHash($script:BrainstormUtf8NoBom.GetBytes($ledger)))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    return [pscustomobject][ordered]@{
        brief_sha256 = Get-SessionFileSha256 -Path (Join-Path $SessionDirectory 'game-concept-brief.md')
        combinations_sha256 = Get-SessionFileSha256 -Path (Join-Path $SessionDirectory 'game-concept-combinations.md')
        decision_ledger_sha256 = $ledgerHash
    }
}
