# Shared byte-integrity check for packaging and offline verification.
function Get-PresentationInlineIndex {
    param(
        [Parameter(Mandatory = $true)][string]$InlineAssetsPath,
        [Parameter(Mandatory = $true)][string]$AssetManifestPath
    )
    if (-not (Test-Path -LiteralPath $AssetManifestPath -PathType Leaf)) { throw 'Asset manifest required to verify inline bytes.' }
    $manifest = [IO.File]::ReadAllText($AssetManifestPath) | ConvertFrom-Json
    $index = [IO.File]::ReadAllText($InlineAssetsPath) | ConvertFrom-Json
    if ($manifest.schema_version -ne 1 -or $manifest.assets -isnot [System.Array]) { throw 'Invalid asset manifest.' }
    if ($index.schema_version -ne 1 -or $index.assets -isnot [System.Array]) { throw 'Invalid inline index.' }
    $expected = @{}
    foreach ($asset in $manifest.assets) {
        $id = [string]$asset.asset_id
        if ([string]::IsNullOrWhiteSpace($id) -or $expected.ContainsKey($id) -or [string]$asset.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid or duplicate manifest asset.' }
        $expected[$id] = ([string]$asset.sha256).ToLowerInvariant()
    }
    $verified = @{}
    foreach ($asset in $index.assets) {
        $id = [string]$asset.asset_id
        if ($id -notmatch '^[A-Za-z0-9][A-Za-z0-9_:.-]*$' -or $id.Contains('__')) { throw "Invalid asset id: $id" }
        if ($verified.ContainsKey($id)) { throw "Duplicate asset id: $id" }
        if (-not $expected.ContainsKey($id)) { throw "Inline asset is not in manifest: $id" }
        $uri = [string]$asset.data_uri
        if ($uri -notmatch '^data:[A-Za-z0-9.+/-]+;base64,([A-Za-z0-9+/]*={0,2})$') { throw "Invalid base64 data URI: $id" }
        $bytes = [Convert]::FromBase64String($Matches[1])
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $actual = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
        finally { $sha.Dispose() }
        if ($actual -cne $expected[$id]) { throw "Inline asset hash mismatch: $id" }
        $verified[$id] = $uri
    }
    if ($verified.Count -ne $expected.Count) { throw 'Inline index does not cover manifest assets.' }
    return $verified
}
