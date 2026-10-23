[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$HtmlPath,
  [Parameter(Mandatory = $true)][string]$InlineAssetsPath,
  [string]$AssetManifestPath
)
$ErrorActionPreference = 'Stop'
$resolvedHtml = (Resolve-Path -LiteralPath $HtmlPath).Path
$resolvedAssets = (Resolve-Path -LiteralPath $InlineAssetsPath).Path
$html = [IO.File]::ReadAllText($resolvedHtml)
. (Join-Path $PSScriptRoot 'presentation-inline-integrity.ps1')
if (-not $AssetManifestPath) { $AssetManifestPath = Join-Path (Split-Path -Parent $resolvedAssets) 'asset-manifest.json' }
$assetIndex = Get-PresentationInlineIndex -InlineAssetsPath $resolvedAssets -AssetManifestPath $AssetManifestPath
$markers = [regex]::Matches($html, '__ASSET_(.+?)__')
foreach ($marker in $markers) {
  $assetId = $marker.Groups[1].Value
  if (-not $assetIndex.ContainsKey($assetId)) { throw "Asset missing from inline index: $assetId" }
  $html = $html.Replace($marker.Value, $assetIndex[$assetId])
}
if ($html.Contains('__ASSET_')) { throw 'Unresolved asset marker' }
[IO.File]::WriteAllText($resolvedHtml, $html, (New-Object Text.UTF8Encoding($false)))
Write-Output "Inlined $($markers.Count) references with manifest byte hashes verified: $resolvedHtml"
