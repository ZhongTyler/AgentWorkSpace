[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('scoring', 'stage1', 'stage2', 'stage3', 'gate_audit')]
    [string]$Package,
    [Parameter(Mandatory = $true)]
    [string]$RunPath,
    [Parameter(Mandatory = $true)]
    [string]$PackageDataPath,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,
    [ValidateSet('summary', 'full')]
    [string]$OutputMode = 'summary'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:utf8NoBom = New-Object Text.UTF8Encoding($false)
$script:projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))

function Get-ProjectPath {
    param([string]$Path, [switch]$MustExist)
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'A required path is missing.' }
    $full = if ([IO.Path]::IsPathRooted($Path)) { [IO.Path]::GetFullPath($Path) } else { [IO.Path]::GetFullPath((Join-Path $script:projectRoot $Path)) }
    $prefix = $script:projectRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Path must stay inside Knowledge: $Path" }
    $probe = $full
    while ($probe -and $probe -ne $script:projectRoot) {
        if (Test-Path -LiteralPath $probe) { if (((Get-Item -LiteralPath $probe -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked paths are not valid evidence/output targets: $Path" } }
        $probe = Split-Path -Parent $probe
    }
    if ($MustExist -and -not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "File does not exist: $Path" }
    return $full
}

function Get-RelativePath {
    param([string]$FullPath)
    return $FullPath.Substring($script:projectRoot.TrimEnd('\', '/').Length + 1).Replace('\', '/')
}

function Get-Sha256 {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Convert-CleanJson {
    param([object]$Value, [int]$Depth = 30)
    return (@(($Value | ConvertTo-Json -Depth $Depth) -split '\r?\n' | ForEach-Object { $_.TrimEnd() }) -join "`n") + "`n"
}

function Read-JsonFile {
    param([string]$Path)
    $json = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
    # Windows PowerShell 5.1 lacks ConvertFrom-Json -DateKind, while the
    # public renderer remains callable through the legacy entrypoint.
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        return ($json | ConvertFrom-Json -DateKind String)
    }
    return ($json | ConvertFrom-Json)
}

function Test-ObjectProperty {
    param([object]$Value, [string]$Name)
    return $null -ne $Value -and $null -ne $Value.PSObject.Properties[$Name]
}

function Write-Utf8 {
    param([string]$Path, [string]$Text)
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [IO.File]::WriteAllText($Path, $Text, $script:utf8NoBom)
}

function Escape-Cell {
    param([object]$Value)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return '-' }
    return ([string]$Value).Replace('|', '\|').Replace("`r", ' ').Replace("`n", '<br>')
}

function ConvertTo-MarkdownLink {
    param([string]$RelativePath, [string]$BaseDirectory)
    $normalized = ([string]$RelativePath).Replace('\', '/')
    $targetFull = Get-ProjectPath -Path $normalized
    $baseFull = [IO.Path]::GetFullPath($BaseDirectory).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $baseUri = [Uri]::new($baseFull, [UriKind]::Absolute)
    $targetUri = [Uri]::new($targetFull, [UriKind]::Absolute)
    $destination = $baseUri.MakeRelativeUri($targetUri).ToString()
    return '[' + (Escape-Cell $normalized) + '](' + $destination + ')'
}

function Add-ObjectTable {
    param(
        [System.Collections.Generic.List[string]]$Lines,
        [object[]]$Rows,
        [string[]]$Columns,
        [string[]]$LinkColumns = @(),
        [string]$LinkBaseDirectory = ''
    )
    if (@($Rows).Count -eq 0) { [void]$Lines.Add('- none.'); return }
    [void]$Lines.Add('| ' + ($Columns -join ' | ') + ' |')
    [void]$Lines.Add('| ' + (($Columns | ForEach-Object { '---' }) -join ' | ') + ' |')
    foreach ($row in @($Rows)) {
        $values = @($Columns | ForEach-Object {
            $property = $_
            if (-not (Test-ObjectProperty -Value $row -Name $property)) { return '-' }
            $value = [string]$row.$property
            if ($LinkColumns -contains $property -and -not [string]::IsNullOrWhiteSpace($value) -and $value -ne '-' -and -not [string]::IsNullOrWhiteSpace($LinkBaseDirectory)) {
                return ConvertTo-MarkdownLink -RelativePath $value -BaseDirectory $LinkBaseDirectory
            }
            return Escape-Cell $value
        })
        [void]$Lines.Add('| ' + ($values -join ' | ') + ' |')
    }
}

try {
    $runFull = Get-ProjectPath -Path $RunPath -MustExist
    $dataFull = Get-ProjectPath -Path $PackageDataPath -MustExist
    $outputFull = Get-ProjectPath -Path $OutputPath
    # Timestamps participate in display and hash inputs; keep their raw text
    # where the runtime supports DateKind to prevent precision drift.
    $run = Read-JsonFile -Path $runFull
    $data = Read-JsonFile -Path $dataFull
    if (-not (([int]$data.schema_version -eq 1 -and [string]$data.renderer_version -eq 'ingest-package-renderer-v1') -or ([int]$data.schema_version -eq 2 -and [string]$data.renderer_version -eq 'ingest-package-renderer-v2'))) { throw 'Unsupported package-data schema or renderer version.' }
    if ([string]$data.batch_id -ne [string]$run.batch_id) { throw 'package-data batch_id does not match run manifest.' }
    $section = $data.sections.$Package
    if ($null -eq $section -or [string]$section.status -ne 'sealed') { throw "Package section must be sealed before rendering: $Package" }
    $payload = [ordered]@{ semantic = $section.semantic; derived = $section.derived }
    $expectedSectionHash = (Convert-CleanJson -Value $payload | ForEach-Object { [Text.Encoding]::UTF8.GetBytes($_) })
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $actualSectionHash = ([BitConverter]::ToString($hasher.ComputeHash($expectedSectionHash))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
    if ([string]$section.section_sha256 -ne $actualSectionHash) { throw "Sealed section hash drifted: $Package" }

    $labels = @{ scoring = 'Scoring Package'; stage1 = 'Stage 1 Package'; stage2 = 'Stage 2 Package'; stage3 = 'Stage 3 Package'; gate_audit = 'Gate Audit Package' }
    $columns = @{
        scoring = @('source', 'A1', 'A2', 'A3', 'B1', 'B2', 'total', 'decision', 'confidence', 'evidence')
        stage1 = @('raw', 'writing_skeleton', 'coverage', 'boundary', 'disposition')
        stage2 = @('raw', 'wiki', 'section', 'action', 'rationale', 'risk')
        stage3 = @('artifact', 'knowledge_summary', 'source_boundary', 'disposition', 'verification')
        gate_audit = @('category', 'impact', 'repair', 'status', 'evidence')
    }
    if ([int]$data.schema_version -eq 2) { $columns.stage1 = @('raw','content_summary','writing_skeleton','coverage','boundary','disposition') }
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $linkColumns = switch ($Package) {
        'stage1' { @('raw') }
        'stage2' { @('raw', 'wiki') }
        default { @() }
    }
    [void]$lines.Add("## $($labels[$Package]) - $($data.batch_id)")
    [void]$lines.Add('')
    [void]$lines.Add("<!-- ingest-package-renderer:v$($data.schema_version) package:$Package section:$actualSectionHash -->")
    [void]$lines.Add('')
    [void]$lines.Add('### Runtime facts')
    [void]$lines.Add('')
    $sealedRunStatus = if (Test-ObjectProperty -Value $section.derived -Name 'run_status') { [string]$section.derived.run_status } else { [string]$run.status }
    $facts = @(
        [pscustomobject][ordered]@{ item = 'batch_id'; value = [string]$run.batch_id },
        [pscustomobject][ordered]@{ item = 'run_status_at_seal'; value = $sealedRunStatus },
        [pscustomobject][ordered]@{ item = 'section_sha256'; value = $actualSectionHash },
        [pscustomobject][ordered]@{ item = 'package_data'; value = Get-RelativePath -FullPath $dataFull }
    )
    Add-ObjectTable -Lines $lines -Rows $facts -Columns @('item', 'value')
    [void]$lines.Add('')
    [void]$lines.Add('### Semantic judgment')
    [void]$lines.Add('')
    [void]$lines.Add((Escape-Cell $section.semantic.summary))
    [void]$lines.Add('')
    [void]$lines.Add('### Fixed judgment table')
    [void]$lines.Add('')
      Add-ObjectTable -Lines $lines -Rows @($section.semantic.rows) -Columns $columns[$Package] -LinkColumns $linkColumns -LinkBaseDirectory (Split-Path -Parent $outputFull)
      if ($section.semantic.PSObject.Properties['consumption']) {
          [void]$lines.Add('')
          [void]$lines.Add('### Raw to Wiki consumption (traceability, not semantic approval)')
          foreach ($entry in @($section.semantic.consumption)) {
              [void]$lines.Add('')
              [void]$lines.Add('#### ' + [string]$entry.raw)
              [void]$lines.Add((Escape-Cell $entry.coverage_reason))
              $decisionRows = @($entry.decisions | ForEach-Object {
                  [pscustomobject]@{
                      claim_ids = @($_.claim_ids) -join ', '
                      disposition = $_.disposition
                      destinations = if ($_.PSObject.Properties['destinations']) { ConvertTo-Json -InputObject @($_.destinations) -Depth 8 -Compress } else { '-' }
                      reason = $_.reason
                      registry_tag = if ($_.PSObject.Properties['registry_tag']) { $_.registry_tag } else { '-' }
                      review_when = if ($_.PSObject.Properties['review_when']) { $_.review_when } else { '-' }
                  }
              })
              Add-ObjectTable -Lines $lines -Rows $decisionRows -Columns @('claim_ids','disposition','destinations','reason','registry_tag','review_when') -LinkColumns @() -LinkBaseDirectory (Split-Path -Parent $outputFull)
          }
      }
    foreach ($slot in @('semantic_exceptions', 'unresolved_risks', 'structure_change_requests', 'micro_failures')) {
        [void]$lines.Add('')
        [void]$lines.Add('### ' + $slot)
        [void]$lines.Add('')
        $entries = @($section.semantic.$slot)
        if ($entries.Count -eq 0) { [void]$lines.Add('- none.') }
        else { foreach ($entry in $entries) { [void]$lines.Add('- ' + (Escape-Cell ($entry | ConvertTo-Json -Compress -Depth 10))) } }
    }
    [void]$lines.Add('')
    [void]$lines.Add('### Script-derived facts')
    [void]$lines.Add('')
    $derivedRows = @($section.derived.PSObject.Properties | Sort-Object Name | ForEach-Object { [pscustomobject][ordered]@{ item = $_.Name; value = $_.Value } })
    Add-ObjectTable -Lines $lines -Rows $derivedRows -Columns @('item', 'value')
    # Normalize the deterministic package to exactly one trailing LF.
    $renderedText = (($lines -join "`n").TrimEnd() + "`n")
    $outputParent = Split-Path -Parent $outputFull
    if (-not (Test-Path -LiteralPath $outputParent -PathType Container)) { New-Item -ItemType Directory -Path $outputParent -Force | Out-Null }
    [IO.File]::WriteAllText($outputFull, $renderedText, $script:utf8NoBom)
    $result = [pscustomobject][ordered]@{ status = 'rendered'; path = Get-RelativePath -FullPath $outputFull; sha256 = Get-Sha256 -Path $outputFull; section_sha256 = $actualSectionHash; next_action = 'record-package' }
    if ($OutputMode -eq 'full') { $result | Add-Member -NotePropertyName section -NotePropertyValue $section }
    Write-Output ($result | ConvertTo-Json -Depth 30)
} catch {
    [Console]::Error.WriteLine('INGEST_PACKAGE_RENDER_FAILED: ' + $_.Exception.Message)
    exit 1
}
