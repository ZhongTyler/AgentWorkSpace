[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Importer = Join-Path $ProjectRoot 'scripts\import-presentation-assets.ps1'
$TempBase = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('fromdemotospec-presentation-contract-' + [Guid]::NewGuid().ToString('N'))))
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Remove-SafeTempTree {
    param([Parameter(Mandatory = $true)][string]$Path)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to delete outside the system temp directory: $full" }
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
}

function Write-Utf8Json {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Value)
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 10) + "`n"), $Utf8NoBom)
}

function Invoke-Importer {
    param([hashtable]$Parameters)
    $output = @(& $Importer @Parameters 2>&1)
    return [ordered]@{ Code = $LASTEXITCODE; Output = ($output -join "`n") }
}

try {
    $assetRoot = Join-Path $TempBase 'PrototypeAssets'
    $project = Join-Path $TempBase 'DemoProject'
    $selectionPath = Join-Path $TempBase 'selection.json'
    New-Item -ItemType Directory -Path (Join-Path $assetRoot 'exports\fromdemotospec\fixture') -Force | Out-Null
    New-Item -ItemType Directory -Path $project -Force | Out-Null
    $assetFile = Join-Path $assetRoot 'exports\fromdemotospec\fixture\button.png'
    [IO.File]::WriteAllBytes($assetFile, [byte[]](137,80,78,71,13,10,26,10,0,0,0,0))
    New-Item -ItemType Directory -Path (Join-Path $project 'presentation\previews') -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $project 'presentation\previews\first-screen.png'), [byte[]](137,80,78,71,13,10,26,10,0,0,0,0))
    [IO.File]::WriteAllBytes((Join-Path $project 'presentation\previews\core-feedback.png'), [byte[]](137,80,78,71,13,10,26,10,0,0,0,0))
    $hash = (Get-FileHash -LiteralPath $assetFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $asset = [ordered]@{
        schema_version = 1; asset_id = 'fixture:ui:button'; category = 'ui-button'
        source = [ordered]@{ provider = 'fixture'; url = 'https://example.invalid/fixture' }
        license = [ordered]@{ spdx = 'CC0-1.0'; receipt_path = 'licenses/fixture.json' }
        files = [ordered]@{ export_sha256 = $hash }
        public_release_allowed = $true
        export_path = 'exports/fromdemotospec/fixture/button.png'
    }
    Write-Utf8Json -Path (Join-Path $assetRoot 'catalog\assets.json') -Value ([ordered]@{ schema_version = 1; assets = @($asset) })

    [IO.Directory]::CreateDirectory((Join-Path $assetRoot 'licenses')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $assetRoot 'licenses\fixture.txt'), 'SYNTHETIC CC0 LICENSE EVIDENCE')
    Write-Utf8Json -Path (Join-Path $assetRoot 'licenses\fixture.json') -Value ([ordered]@{
        schema_version = 1; license_spdx = 'CC0-1.0'; source_url = 'https://example.invalid/fixture'
        verified_at = '2026-09-07'; verification = 'Synthetic fixture only'; public_release_allowed = $true
        evidence_paths = @('licenses/fixture.txt')
    })

    $selection = [ordered]@{
        schema_version = 1; prototype_id = 'fixture-demo'; presentation_grade = 'B'; selection_status = 'confirmed'
        kit = [ordered]@{ skeleton = 'tactical-board'; skin = 'arcade-kinetic'; cast = 'tactical-team'; feedback_modules = @('core-feedback') }
        view_contract = [ordered]@{ state_source = 'shared'; player_mode = 'player'; analysis_mode = 'analysis'; toggles = @('background','motion','vfx','audio') }
        presentation_brief = [ordered]@{ decision_owner = 'interaction-planner'; input_type = 'sketch'; experience_moment = 'confirm tactical action'; first_screen_focus = 'active unit and board'; core_feedback_moment = 'damage result on target'; resource_exclusions = @('unreviewed theme packs') }
        preview_gate = [ordered]@{ status = 'confirmed'; reviewer = 'interaction-planner'; confirmed_at = '2026-08-25'; artifacts = @(
            [ordered]@{ kind = 'first_screen'; path = 'presentation/previews/first-screen.png'; decision = 'approved' },
            [ordered]@{ kind = 'core_feedback'; path = 'presentation/previews/core-feedback.png'; decision = 'approved' }
        ) }
        asset_source = [ordered]@{ repository_id = 'prototype-assets' }
        assets = @([ordered]@{ asset_id = $asset.asset_id; export_sha256 = $hash })
    }
    Write-Utf8Json -Path $selectionPath -Value $selection
    $cleanSelectionJson = $selection | ConvertTo-Json -Depth 10

    $dryRun = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; AssetRepositoryPath = $assetRoot; ProjectPath = $project }
    if ($dryRun.Code -ne 0 -or $dryRun.Output -notmatch '"imported_assets":\s+1') { throw "Positive dry-run failed: $($dryRun.Output)" }
    if (Test-Path -LiteralPath (Join-Path $project 'presentation\asset-manifest.json')) { throw 'Dry-run wrote project files' }
    $apply = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; AssetRepositoryPath = $assetRoot; ProjectPath = $project; Apply = $true }
    if ($apply.Code -ne 0) { throw "Positive apply failed: $($apply.Output)" }
    foreach ($path in @('presentation\asset-manifest.json', 'presentation\inline-assets.json', 'presentation\ATTRIBUTION.md', 'presentation\assets\fixture\button.png')) {
        if (-not (Test-Path -LiteralPath (Join-Path $project $path))) { throw "Importer did not create $path" }
    }
    $offline = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; ProjectPath = $project; VerifyOffline = $true }
    if ($offline.Code -ne 0 -or $offline.Output -notmatch '"network_accessed":\s+false') { throw "Offline verification failed: $($offline.Output)" }

    $badGrade = $cleanSelectionJson | ConvertFrom-Json; $badGrade.selection_status = 'auto'; Write-Utf8Json -Path $selectionPath -Value $badGrade
    $gradeFailure = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; AssetRepositoryPath = $assetRoot; ProjectPath = $project }
    if ($gradeFailure.Code -ne 3) { throw "B preview gate was not enforced: $($gradeFailure.Output)" }

    $missingKeyframe = $cleanSelectionJson | ConvertFrom-Json; $missingKeyframe.preview_gate.artifacts[1].path = 'presentation/previews/missing.png'; Write-Utf8Json -Path $selectionPath -Value $missingKeyframe
    $keyframeFailure = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; AssetRepositoryPath = $assetRoot; ProjectPath = $project }
    if ($keyframeFailure.Code -ne 3) { throw "B keyframe existence gate was not enforced: $($keyframeFailure.Output)" }

    $badHash = $cleanSelectionJson | ConvertFrom-Json; $badHash.assets = @([ordered]@{ asset_id = $asset.asset_id; export_sha256 = ('0' * 64) }); Write-Utf8Json -Path $selectionPath -Value $badHash
    $hashFailure = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; AssetRepositoryPath = $assetRoot; ProjectPath = $project }
    if ($hashFailure.Code -ne 3) { throw "Hash gate was not enforced: $($hashFailure.Output)" }

    $badPathAsset = $asset | ConvertTo-Json -Depth 10 | ConvertFrom-Json; $badPathAsset.export_path = '../outside.png'; Write-Utf8Json -Path (Join-Path $assetRoot 'catalog\assets.json') -Value ([ordered]@{ schema_version = 1; assets = @($badPathAsset) }); Write-Utf8Json -Path $selectionPath -Value ($cleanSelectionJson | ConvertFrom-Json)
    $pathFailure = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; AssetRepositoryPath = $assetRoot; ProjectPath = $project }
    if ($pathFailure.Code -ne 3) { throw "Path traversal gate was not enforced: $($pathFailure.Output)" }

    $restricted = $asset | ConvertTo-Json -Depth 10 | ConvertFrom-Json; $restricted.public_release_allowed = $false; Write-Utf8Json -Path (Join-Path $assetRoot 'catalog\assets.json') -Value ([ordered]@{ schema_version = 1; assets = @($restricted) })
    $publicFailure = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; AssetRepositoryPath = $assetRoot; ProjectPath = $project; PublicRelease = $true }
    if ($publicFailure.Code -ne 3) { throw "Public release gate was not enforced: $($publicFailure.Output)" }


    Write-Utf8Json -Path (Join-Path $assetRoot 'catalog\assets.json') -Value ([ordered]@{ schema_version = 1; assets = @($asset) })
    $v2 = [ordered]@{
        schema_version = 2; prototype_id = 'fixture-v2'; lifecycle = 'maintained-project'
        direction = [ordered]@{ intent = 'Readable action and impact'; rationale = 'One coherent family for this fixture' }
        choice = [ordered]@{ mode = 'agent' }
        asset_source = [ordered]@{ repository_id = 'prototype-assets' }
        assets = @([ordered]@{ asset_id = $asset.asset_id; export_sha256 = $hash })
    }
    $v2Json = $v2 | ConvertTo-Json -Depth 10
    $maintained = Join-Path $TempBase 'Maintained'
    New-Item -ItemType Directory -Path $maintained -Force | Out-Null
    Write-Utf8Json -Path $selectionPath -Value $v2
    $auto = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; AssetRepositoryPath = $assetRoot; ProjectPath = $maintained; Apply = $true }
    if ($auto.Code -ne 0) { throw "Autonomous v2 failed: $($auto.Output)" }
    if (Test-Path -LiteralPath (Join-Path $maintained 'presentation\inline-assets.json')) { throw 'Maintained project should consume asset files directly' }
    $v2Manifest = [IO.File]::ReadAllText((Join-Path $maintained 'presentation\asset-manifest.json')) | ConvertFrom-Json
    if ($v2Manifest.lifecycle -ne 'maintained-project' -or @($v2Manifest.assets[0].source.provenance_files).Count -lt 2) { throw 'Missing lifecycle or local provenance' }
    $verifyV2 = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; ProjectPath = $maintained; VerifyOffline = $true }
    if ($verifyV2.Code -ne 0) { throw 'V2 offline verification failed' }
    $proofFile = Join-Path $maintained $v2Manifest.assets[0].source.provenance_files[0].project_path
    [IO.File]::AppendAllText($proofFile, 'tampered')
    $tampered = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; ProjectPath = $maintained; VerifyOffline = $true }
    if ($tampered.Code -ne 3) { throw 'Offline provenance hash gate missing' }
    $single = Join-Path $TempBase 'SingleV2'
    New-Item -ItemType Directory -Path $single -Force | Out-Null
    $v2.lifecycle = 'single-file'
    Write-Utf8Json -Path $selectionPath -Value $v2
    $singleResult = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; AssetRepositoryPath = $assetRoot; ProjectPath = $single; Apply = $true }
    if ($singleResult.Code -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $single 'presentation\inline-assets.json'))) { throw 'Single-file v2 inline output failed' }
    $inlinePath = Join-Path $single 'presentation\inline-assets.json'
    $inlineBytes = [IO.File]::ReadAllBytes($inlinePath)
    $htmlPath = Join-Path $single 'game.html'
    [IO.File]::WriteAllText($htmlPath, '<img src="__ASSET_fixture:ui:button__">', $Utf8NoBom)
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot 'scripts\inline-presentation-assets.ps1') -HtmlPath $htmlPath -InlineAssetsPath $inlinePath
    if ($LASTEXITCODE -ne 0) { throw 'Imported inline bytes did not package successfully' }
    $singleVerified = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; ProjectPath = $single; VerifyOffline = $true }
    if ($singleVerified.Code -ne 0) { throw 'Single-file offline verification failed' }
    $coverage = $singleVerified.Output | ConvertFrom-Json
    if (-not $coverage.inline_index_verified -or $coverage.inline_assets_verified -ne 1 -or $coverage.final_html_verified) { throw 'Offline verification scope is inaccurate' }
    $changedInline = [IO.File]::ReadAllText($inlinePath) | ConvertFrom-Json
    $changedInline.assets[0].data_uri = 'data:image/png;base64,Yg=='
    Write-Utf8Json -Path $inlinePath -Value $changedInline
    $inlineTamper = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; ProjectPath = $single; VerifyOffline = $true }
    if ($inlineTamper.Code -ne 3) { throw 'Modified inline bytes passed offline verification' }
    [IO.File]::WriteAllBytes($inlinePath, $inlineBytes)
    $v2.choice.mode = 'user-constraint'
    Write-Utf8Json -Path $selectionPath -Value $v2
    $falseUser = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; AssetRepositoryPath = $assetRoot; ProjectPath = $single }
    if ($falseUser.Code -ne 3) { throw 'User constraint without source should fail' }
    Write-Utf8Json -Path $selectionPath -Value ($v2Json | ConvertFrom-Json)
    $receiptPath = Join-Path $assetRoot 'licenses\fixture.json'
    $receiptBytes = [IO.File]::ReadAllBytes($receiptPath)
    [IO.File]::WriteAllText($receiptPath, '{}')
    $unreviewed = Invoke-Importer -Parameters @{ SelectionPath = $selectionPath; AssetRepositoryPath = $assetRoot; ProjectPath = $single }
    if ($unreviewed.Code -ne 3) { throw 'Unreviewed receipt should fail' }
    [IO.File]::WriteAllBytes($receiptPath, $receiptBytes)

    Write-Output 'PASS presentation-layer.contract v1 compatibility and v2 autonomous dual paths'
} finally {
    Remove-SafeTempTree -Path $TempBase
}
