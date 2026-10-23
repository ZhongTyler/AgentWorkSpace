[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Tool = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/inline-presentation-assets.ps1'
$Temp = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('fromdemotospec-inline-' + [guid]::NewGuid().ToString('N'))))
$Utf8 = New-Object Text.UTF8Encoding($false)
function Run-Inline {
    $old = $ErrorActionPreference
    try { $ErrorActionPreference='Continue'; $result = & powershell -NoProfile -ExecutionPolicy Bypass -File $Tool -HtmlPath (Join-Path $Temp 'game.html') -InlineAssetsPath (Join-Path $Temp 'inline.json') 2>&1; $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$old }
    return [pscustomobject]@{code=$code; output=($result -join "`n")}
}
try {
    New-Item -ItemType Directory -Path $Temp | Out-Null
    $html=Join-Path $Temp 'game.html'
    $index=Join-Path $Temp 'inline.json'
    $manifest=Join-Path $Temp 'asset-manifest.json'
    $id='kenney:ui-pack:ui_button.id-1'
    $sha=[Security.Cryptography.SHA256]::Create()
    try { $hash=([BitConverter]::ToString($sha.ComputeHash([byte[]](97)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    $manifestContent=@{schema_version=1;assets=@(@{asset_id=$id;sha256=$hash})} | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($manifest,$manifestContent,$Utf8)
    $cleanIndex='{"schema_version":1,"assets":[{"asset_id":"kenney:ui-pack:ui_button.id-1","data_uri":"data:image/png;base64,YQ=="}]}'
    [IO.File]::WriteAllText($index,$cleanIndex,$Utf8)
    [IO.File]::WriteAllText($html,'<img src="__ASSET_kenney:ui-pack:ui_button.id-1__">',$Utf8)
    $ok=Run-Inline
    if($ok.code -ne 0 -or [IO.File]::ReadAllText($html) -ne '<img src="data:image/png;base64,YQ==">') { throw "Inline failed: $($ok.output)" }
    foreach($bad in @('__ASSET_missing__','__ASSET_incomplete')) {
        [IO.File]::WriteAllText($html,$bad,$Utf8)
        $negative=Run-Inline
        if($negative.code -eq 0 -or [IO.File]::ReadAllText($html) -ne $bad) { throw 'Missing markers must fail without modifying HTML' }
    }
    $original='<img src="__ASSET_kenney:ui-pack:ui_button.id-1__">'
    foreach($badIndex in @($cleanIndex.Replace('YQ==','Yg=='),$cleanIndex.Replace($id,'foreign:id'),'{"schema_version":1,"assets":[]}')) {
        [IO.File]::WriteAllText($index,$badIndex,$Utf8)
        [IO.File]::WriteAllText($html,$original,$Utf8)
        $bad=Run-Inline
        if($bad.code -eq 0 -or [IO.File]::ReadAllText($html) -cne $original) { throw 'Untrusted or incomplete inline bytes changed HTML' }
    }
    [IO.File]::WriteAllText($index,('{"schema_version":1,"assets":[{"asset_id":"'+$id+'","data_uri":"data:image/png;base64,YQ=="},{"asset_id":"'+$id+'","data_uri":"data:image/png;base64,YQ=="}]}'),$Utf8)
    $duplicate=Run-Inline
    if($duplicate.code -eq 0 -or $duplicate.output -notmatch 'Duplicate asset id') { throw 'Duplicate asset id not specifically rejected' }
    [IO.File]::WriteAllText($index,$cleanIndex,$Utf8)
    Remove-Item -LiteralPath $manifest
    $missing=Run-Inline
    if($missing.code -eq 0 -or [IO.File]::ReadAllText($html) -cne $original) { throw 'Missing manifest must fail without modifying HTML' }
    Write-Output 'PASS inline-presentation-assets.contract (manifest hashes, identity, completeness and no-write rejection)'
} finally {
    $prefix=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if(-not $Temp.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe temp cleanup' }
    if(Test-Path -LiteralPath $Temp) { Remove-Item -LiteralPath $Temp -Recurse -Force }
}
