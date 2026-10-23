[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SelectionPath,
    [string]$AssetRepositoryPath,
    [Parameter(Mandatory = $true)][string]$ProjectPath,
    [switch]$PublicRelease,
    [switch]$VerifyOffline,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot 'presentation-inline-integrity.ps1')

function Get-FullPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [IO.Path]::GetFullPath($Path)
}

function Assert-ChildPath {
    param([Parameter(Mandatory = $true)][string]$Parent, [Parameter(Mandatory = $true)][string]$Child, [Parameter(Mandatory = $true)][string]$Label)
    $parentFull = (Get-FullPath $Parent).TrimEnd('\', '/')
    $childFull = Get-FullPath $Child
    $prefix = $parentFull + [IO.Path]::DirectorySeparatorChar
    if (-not $childFull.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label is outside the allowed root: $childFull"
    }

    $probe = $childFull
    while ($probe -and $probe.Length -gt $parentFull.Length) {
        if (Test-Path -LiteralPath $probe) {
            if (((Get-Item -LiteralPath $probe -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "$Label crosses a link or junction: $probe" }
        }
        $probe = Split-Path -Parent $probe
    }
}

function Assert-SafeRelativePath {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Label)
    $normalized = $Path.Replace('\', '/')
    if ([string]::IsNullOrWhiteSpace($normalized) -or $normalized.StartsWith('/') -or $normalized -match '^[A-Za-z]:' -or $normalized.Split('/') -contains '..' -or $normalized.Split('/') -contains '.') {
        throw "$Label is not a safe relative path: $Path"
    }
    return $normalized
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-Utf8Lf {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Content)
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [IO.File]::WriteAllText($Path, $Content.Replace("`r`n", "`n"), $Utf8NoBom)
}

function Assert-SelectionContract {
    param([Parameter(Mandatory = $true)]$Selection, [Parameter(Mandatory = $true)][string]$ProjectPath)

    if ([int]$Selection.schema_version -eq 2) {
        foreach ($name in @('prototype_id', 'lifecycle', 'direction', 'choice', 'asset_source', 'assets')) {
            if ($null -eq $Selection.$name) { throw "Selection is missing required field: $name" }
        }
        if ([string]::IsNullOrWhiteSpace([string]$Selection.prototype_id)) { throw 'prototype_id must not be empty' }
        if (@('single-file', 'maintained-project') -notcontains [string]$Selection.lifecycle) { throw 'Invalid lifecycle' }
        foreach ($name in @('intent', 'rationale')) {
            if ([string]::IsNullOrWhiteSpace([string]$Selection.direction.$name)) { throw "direction.$name is required" }
        }
        if (@('agent', 'user-constraint') -notcontains [string]$Selection.choice.mode) { throw 'Invalid choice mode' }
        if ([string]$Selection.choice.mode -eq 'user-constraint' -and [string]::IsNullOrWhiteSpace([string]$Selection.choice.source_ref)) { throw 'User constraint requires source_ref' }
        if ([string]$Selection.asset_source.repository_id -ne 'prototype-assets') { throw 'Importer requires prototype-assets source' }
        if ($Selection.assets -isnot [System.Array]) { throw 'assets must be an array' }
        foreach ($asset in @($Selection.assets)) {
            if ([string]::IsNullOrWhiteSpace([string]$asset.asset_id) -or [string]$asset.export_sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Selected asset requires ID and SHA256' }
        }
        return
    }

    foreach ($name in @('schema_version', 'prototype_id', 'presentation_grade', 'selection_status', 'kit', 'view_contract', 'asset_source', 'assets')) {
        if ($null -eq $Selection.$name) { throw "Selection is missing required field: $name" }
    }
    if ([int]$Selection.schema_version -ne 1) { throw 'Unsupported selection schema_version' }
    if (@('A', 'B', 'C') -notcontains [string]$Selection.presentation_grade) { throw 'presentation_grade must be A, B, or C' }
    if (@('auto', 'confirmed', 'fallback') -notcontains [string]$Selection.selection_status) { throw 'selection_status is invalid' }
    if (@('B', 'C') -contains [string]$Selection.presentation_grade -and [string]$Selection.selection_status -ne 'confirmed') {
        throw 'B/C presentation selection requires user-confirmed preview; use neutral-readable A fallback until confirmed'
    }
    if (@('B', 'C') -contains [string]$Selection.presentation_grade) {
        if ($null -eq $Selection.presentation_brief) { throw 'B/C presentation selection requires presentation_brief' }
        foreach ($name in @('decision_owner', 'input_type', 'experience_moment', 'first_screen_focus', 'core_feedback_moment', 'resource_exclusions')) {
            if ($null -eq $Selection.presentation_brief.$name -or [string]::IsNullOrWhiteSpace([string]$Selection.presentation_brief.$name)) { throw "presentation_brief is missing required field: $name" }
        }
        if (@('sketch', 'annotation', 'reference_board', 'quarantine_image', 'text') -notcontains [string]$Selection.presentation_brief.input_type) { throw 'presentation_brief.input_type is invalid' }
        if (@($Selection.presentation_brief.resource_exclusions).Count -lt 1) { throw 'presentation_brief.resource_exclusions must not be empty' }
        if ($null -eq $Selection.preview_gate) { throw 'B/C presentation selection requires preview_gate' }
        if ([string]$Selection.preview_gate.status -ne 'confirmed' -or [string]::IsNullOrWhiteSpace([string]$Selection.preview_gate.reviewer) -or [string]::IsNullOrWhiteSpace([string]$Selection.preview_gate.confirmed_at)) {
            throw 'B/C presentation selection requires a confirmed preview_gate with reviewer and confirmed_at'
        }
        $previewKinds = @{}
        foreach ($artifact in @($Selection.preview_gate.artifacts)) {
            if ([string]$artifact.decision -ne 'approved') { throw 'Every B/C preview artifact must be approved' }
            if (@('first_screen', 'core_feedback') -notcontains [string]$artifact.kind) { throw 'preview artifact kind must be first_screen or core_feedback' }
            if ($previewKinds.ContainsKey([string]$artifact.kind)) { throw "Preview artifact is duplicated: $($artifact.kind)" }
            $previewKinds[[string]$artifact.kind] = $true
            $relative = Assert-SafeRelativePath -Path ([string]$artifact.path) -Label 'preview artifact path'
            $artifactPath = Get-FullPath (Join-Path $ProjectPath $relative)
            Assert-ChildPath -Parent $ProjectPath -Child $artifactPath -Label 'preview artifact'
            if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) { throw "Preview artifact is missing: $relative" }
        }
        foreach ($kind in @('first_screen', 'core_feedback')) {
            if (-not $previewKinds.ContainsKey($kind)) { throw "B/C preview gate is missing required artifact: $kind" }
        }
    }
    foreach ($name in @('skeleton', 'skin', 'cast', 'feedback_modules')) {
        if ($null -eq $Selection.kit.$name) { throw "kit is missing required field: $name" }
    }
    if (@($Selection.kit.feedback_modules).Count -lt 1) { throw 'kit.feedback_modules must not be empty' }
    if ([string]$Selection.view_contract.state_source -ne 'shared' -or [string]$Selection.view_contract.player_mode -ne 'player' -or [string]$Selection.view_contract.analysis_mode -ne 'analysis') {
        throw 'view_contract must use shared state source with player and analysis modes'
    }
    $toggles = @($Selection.view_contract.toggles)
    foreach ($toggle in @('background', 'motion', 'vfx', 'audio')) {
        if ($toggles -notcontains $toggle) { throw "view_contract.toggles is missing $toggle" }
    }
    if ([string]$Selection.asset_source.repository_id -ne 'prototype-assets') { throw 'asset_source.repository_id must be prototype-assets' }
    foreach ($asset in @($Selection.assets)) {
        if ([string]::IsNullOrWhiteSpace([string]$asset.asset_id) -or [string]::IsNullOrWhiteSpace([string]$asset.export_sha256)) {
            throw 'Every selected asset requires asset_id and export_sha256'
        }
    }
}

try {
    $ProjectPath = Get-FullPath $ProjectPath
    if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) { throw "Project path does not exist: $ProjectPath" }
    $SelectionPath = Get-FullPath $SelectionPath
    if (-not (Test-Path -LiteralPath $SelectionPath -PathType Leaf)) { throw "Selection file does not exist: $SelectionPath" }

    if ($VerifyOffline) {
        $manifestPath = Join-Path $ProjectPath 'presentation\asset-manifest.json'
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Offline asset manifest does not exist: $manifestPath" }
        $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
        if ([int]$manifest.schema_version -ne 1) { throw 'Unsupported project asset-manifest schema_version' }
        $provenanceVerified = 0
        foreach ($asset in @($manifest.assets)) {
            if ([int]$manifest.selection_schema_version -eq 2 -and @($asset.source.provenance_files).Count -lt 2) { throw 'V2 manifest requires local provenance evidence' }
            $relative = Assert-SafeRelativePath -Path ([string]$asset.project_path) -Label 'project asset path'
            $path = Get-FullPath (Join-Path $ProjectPath $relative)
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Offline asset is missing: $relative" }
            Assert-ChildPath -Parent $ProjectPath -Child $path -Label 'offline asset'
            if ((Get-Sha256 $path) -ne ([string]$asset.sha256).ToLowerInvariant()) { throw "Offline asset hash mismatch: $relative" }
            if (@($asset.source.provenance_files).Count -ge 2) { $provenanceVerified++ }
            foreach ($proof in @($asset.source.provenance_files)) {
                if ($null -eq $proof) { continue }
                $proofRelative = Assert-SafeRelativePath -Path ([string]$proof.project_path) -Label 'offline provenance'
                $proofPath = Get-FullPath (Join-Path $ProjectPath $proofRelative)
                Assert-ChildPath -Parent $ProjectPath -Child $proofPath -Label 'offline provenance'
                if (-not (Test-Path -LiteralPath $proofPath -PathType Leaf) -or (Get-Sha256 $proofPath) -ne [string]$proof.sha256) { throw 'Offline provenance missing or changed' }
            }
        }
        $inlineVerified = $false
        $inlineCount = 0
        if ([string]$manifest.lifecycle -eq 'single-file') {
            $inlinePath = Join-Path $ProjectPath 'presentation\inline-assets.json'
            Assert-ChildPath -Parent $ProjectPath -Child $inlinePath -Label 'inline index'
            $inlineIndex = Get-PresentationInlineIndex -InlineAssetsPath $inlinePath -AssetManifestPath $manifestPath
            $inlineVerified = $true
            $inlineCount = $inlineIndex.Count
        }
        Write-Output (@{ schema_version = 1; mode = 'offline-verify'; verified_assets = @($manifest.assets).Count; provenance_verified_assets = $provenanceVerified; inline_index_verified = $inlineVerified; inline_assets_verified = $inlineCount; final_html_verified = $false; network_accessed = $false } | ConvertTo-Json)
        exit 0
    }

    if ([string]::IsNullOrWhiteSpace($AssetRepositoryPath)) { throw 'AssetRepositoryPath is required unless -VerifyOffline is used' }
    $AssetRepositoryPath = Get-FullPath $AssetRepositoryPath
    if (-not (Test-Path -LiteralPath $AssetRepositoryPath -PathType Container)) { throw "Asset repository does not exist: $AssetRepositoryPath" }
    $catalogPath = Join-Path $AssetRepositoryPath 'catalog\assets.json'
    if (-not (Test-Path -LiteralPath $catalogPath -PathType Leaf)) { throw "Asset catalog does not exist: $catalogPath" }

    $selection = Get-Content -Raw -Encoding UTF8 -LiteralPath $SelectionPath | ConvertFrom-Json
    Assert-SelectionContract -Selection $selection -ProjectPath $ProjectPath
    $catalog = Get-Content -Raw -Encoding UTF8 -LiteralPath $catalogPath | ConvertFrom-Json
    if ([int]$catalog.schema_version -ne 1) { throw 'Unsupported asset catalog schema_version' }
    $catalogById = @{}
    foreach ($entry in @($catalog.assets)) {
        if ($catalogById.ContainsKey([string]$entry.asset_id)) { throw 'Duplicate catalog asset ID' }
        $catalogById[[string]$entry.asset_id] = $entry
    }

    $manifestAssets = @()
    $inlineAssets = @()
    $copyPlan = @()
    $seen = @{}
    foreach ($selected in @($selection.assets)) {
        $assetId = [string]$selected.asset_id
        if ($seen.ContainsKey($assetId)) { throw "Asset is selected more than once: $assetId" }
        $seen[$assetId] = $true
        if (-not $catalogById.ContainsKey($assetId)) { throw "Unknown asset_id in catalog: $assetId" }
        $entry = $catalogById[$assetId]

        if ([string]::IsNullOrWhiteSpace([string]$entry.source.provider) -or [string]::IsNullOrWhiteSpace([string]$entry.source.url) -or [string]::IsNullOrWhiteSpace([string]$entry.license.spdx)) { throw "Asset provenance is missing: $assetId" }
        $receiptRelative = Assert-SafeRelativePath -Path ([string]$entry.license.receipt_path) -Label 'license receipt'
        $receiptPath = Get-FullPath (Join-Path $AssetRepositoryPath $receiptRelative)
        Assert-ChildPath -Parent $AssetRepositoryPath -Child $receiptPath -Label 'license receipt'
        if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) { throw "License receipt is missing: $assetId" }
        $receipt = [IO.File]::ReadAllText($receiptPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        if ([string]$receipt.license_spdx -ne [string]$entry.license.spdx -or [string]$receipt.source_url -ne [string]$entry.source.url -or [string]::IsNullOrWhiteSpace([string]$receipt.verified_at) -or [string]::IsNullOrWhiteSpace([string]$receipt.verification) -or @($receipt.evidence_paths).Count -lt 1) { throw "License receipt is incomplete or conflicts with catalog: $assetId" }
        if ($PublicRelease -and -not [bool]$receipt.public_release_allowed) { throw "Receipt disallows public release: $assetId" }
        $provenanceFiles = @()
        foreach ($relative in @($receiptRelative) + @($receipt.evidence_paths)) {
            $safeRelative = Assert-SafeRelativePath -Path ([string]$relative) -Label 'license evidence'
            $proof = Get-FullPath (Join-Path $AssetRepositoryPath $safeRelative)
            Assert-ChildPath -Parent $AssetRepositoryPath -Child $proof -Label 'license evidence'
            if (-not (Test-Path -LiteralPath $proof -PathType Leaf)) { throw "License evidence is missing: $safeRelative" }
            $proofHash = Get-Sha256 $proof
            $proofLocal = 'presentation/provenance/' + $proofHash + [IO.Path]::GetExtension($proof)
            $proofTarget = Get-FullPath (Join-Path $ProjectPath $proofLocal)
            Assert-ChildPath -Parent $ProjectPath -Child $proofTarget -Label 'project provenance'
            $copyPlan += [ordered]@{ source = $proof; destination = $proofTarget }
            $provenanceFiles += [ordered]@{ project_path = $proofLocal; sha256 = $proofHash; source_path = $safeRelative }
        }

        $expectedHash = ([string]$entry.files.export_sha256).ToLowerInvariant()
        if (($selected.export_sha256).ToLowerInvariant() -ne $expectedHash) { throw "Selection hash does not match catalog for $assetId" }
        if ($PublicRelease -and -not [bool]$entry.public_release_allowed) { throw "Asset is not allowed in a public release: $assetId" }
        $exportRelative = Assert-SafeRelativePath -Path ([string]$entry.export_path) -Label "catalog export_path for $assetId"
        if (-not $exportRelative.StartsWith('exports/fromdemotospec/')) { throw "Catalog export_path is outside FromDemoToSpec export area: $assetId" }
        $sourcePath = Get-FullPath (Join-Path $AssetRepositoryPath $exportRelative)
        Assert-ChildPath -Parent $AssetRepositoryPath -Child $sourcePath -Label 'source export'
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Catalog export file is missing: $assetId" }
        if ((Get-Sha256 $sourcePath) -ne $expectedHash) { throw "Catalog export hash mismatch: $assetId" }
        $projectRelative = 'presentation/assets/' + $exportRelative.Substring('exports/fromdemotospec/'.Length)
        $destinationPath = Get-FullPath (Join-Path $ProjectPath $projectRelative)
        Assert-ChildPath -Parent $ProjectPath -Child $destinationPath -Label 'project asset'
        $mime = switch ([IO.Path]::GetExtension($sourcePath).ToLowerInvariant()) { '.png' { 'image/png' }; '.svg' { 'image/svg+xml' }; '.wav' { 'audio/wav' }; '.mp3' { 'audio/mpeg' }; default { 'application/octet-stream' } }
        $manifestAssets += [ordered]@{
            asset_id = $assetId
            project_path = $projectRelative.Replace('\\', '/')
            sha256 = $expectedHash
            license = [string]$entry.license.spdx
            public_release_allowed = [bool]$entry.public_release_allowed
            source = [ordered]@{ provider = [string]$entry.source.provider; url = [string]$entry.source.url; receipt_path = [string]$entry.license.receipt_path; provenance_files = $provenanceFiles }
        }
        $inlineAssets += [ordered]@{ asset_id = $assetId; mime_type = $mime; data_uri = 'data:' + $mime + ';base64,' + [Convert]::ToBase64String([IO.File]::ReadAllBytes($sourcePath)) }
        $copyPlan += [ordered]@{ source = $sourcePath; destination = $destinationPath }
    }

    $presentationDir = Join-Path $ProjectPath 'presentation'
    $manifest = [ordered]@{
        schema_version = 1
        prototype_id = [string]$selection.prototype_id
        presentation_grade = [string]$selection.presentation_grade
        selection_status = [string]$selection.selection_status
        lifecycle = $(if ([int]$selection.schema_version -eq 2) { [string]$selection.lifecycle } else { 'single-file' })
        selection_schema_version = [int]$selection.schema_version
        direction = $selection.direction
        choice = $selection.choice
        kit = $selection.kit
        view_contract = $selection.view_contract
        assets = $manifestAssets
        generated_at = [DateTime]::UtcNow.ToString('o')
    }
    $attributionLines = @('# Presentation asset attribution', '', '> Generated by `scripts/import-presentation-assets.ps1`; do not edit by hand.', '')
    foreach ($asset in $manifestAssets) { $attributionLines += "- $($asset.asset_id) — $($asset.license) — $($asset.source.provider): $($asset.source.url)" }

    foreach ($generatedName in @('asset-manifest.json', 'ATTRIBUTION.md', 'inline-assets.json')) {
        Assert-ChildPath -Parent $ProjectPath -Child (Join-Path $presentationDir $generatedName) -Label 'generated project file'
    }
    if ($Apply) {
        foreach ($copy in $copyPlan) {
            $parent = Split-Path -Parent $copy.destination
            if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
            Copy-Item -LiteralPath $copy.source -Destination $copy.destination -Force
        }
        Write-Utf8Lf -Path (Join-Path $presentationDir 'asset-manifest.json') -Content (($manifest | ConvertTo-Json -Depth 10) + "`n")
        if ($manifest.lifecycle -eq 'single-file') {
            Write-Utf8Lf -Path (Join-Path $presentationDir 'inline-assets.json') -Content (([ordered]@{ schema_version = 1; assets = $inlineAssets } | ConvertTo-Json -Depth 10) + "`n")
        }
        Write-Utf8Lf -Path (Join-Path $presentationDir 'ATTRIBUTION.md') -Content (($attributionLines -join "`n") + "`n")
    }
    Write-Output ([ordered]@{ schema_version = 1; mode = $(if ($Apply) { 'apply' } else { 'dry-run' }); imported_assets = $manifestAssets.Count; public_release_checked = [bool]$PublicRelease; network_accessed = $false } | ConvertTo-Json)
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 3
}
