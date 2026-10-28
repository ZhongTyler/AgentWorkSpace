function Compare-SourceBytes {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]]$Bytes,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256,
        [switch]$AllowEolReplay
    )
    if ($ExpectedSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'Invalid expected source SHA-256.' }
    $expected = $ExpectedSha256.ToLowerInvariant()
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $actual = (([BitConverter]::ToString($hasher.ComputeHash($Bytes))) -replace '-', '').ToLowerInvariant()
        $kind = 'mismatch'
        $replayed = $null
        if ($actual -eq $expected) { $kind = 'exact_bytes' }
        elseif ($AllowEolReplay) {
            # Decode strictly, retaining BOM. Never trim, normalize Unicode, or discard bytes.
            $utf8 = New-Object Text.UTF8Encoding($false, $true)
            $text = $null
            try { $text = $utf8.GetString($Bytes) } catch [System.Text.DecoderFallbackException] {}
            if ($null -ne $text -and $text.Contains("`n") -and $text -notmatch '\r(?!\n)') {
                $candidate = $null
                if (-not $text.Contains("`r")) {
                    $candidate = $text.Replace("`n", "`r`n")
                    $conversion = 'lf_to_crlf'
                }
                elseif ($text -notmatch '(?<!\r)\n') {
                    $candidate = $text.Replace("`r`n", "`n")
                    $conversion = 'crlf_to_lf'
                }
                if ($null -ne $candidate) {
                    $replayed = (([BitConverter]::ToString($hasher.ComputeHash($utf8.GetBytes($candidate)))) -replace '-', '').ToLowerInvariant()
                    if ($replayed -eq $expected) { $kind = $conversion }
                }
            }
        }
        return [pscustomobject][ordered]@{
            matches = ($kind -ne 'mismatch')
            kind = $kind
            expected_sha256 = $expected
            actual_sha256 = $actual
            replayed_sha256 = $replayed
        }
    }
    finally { $hasher.Dispose() }
}

function Get-SourceByteIdentity {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256
    )
    $prefix = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source is outside Knowledge.' }
    $relative = $full.Substring($prefix.Length).Replace('\', '/')
    # EOL replay is a Clipping-source rule, not a global relaxation of artifact hashes.
    $allow = $relative -cmatch '^Clippings/(?!.*(?:^|/)\.\.?/).+\.md$'
    return Compare-SourceBytes -Bytes ([IO.File]::ReadAllBytes($full)) -ExpectedSha256 $ExpectedSha256 -AllowEolReplay:$allow
}

function Test-CanonicalClippingPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    $normalized = $Path.Replace('\', '/').Trim()
    return $normalized -match '^Clippings/\d{8}-.+\.md$'
}

function ConvertTo-ClippingPath {
    param([string]$Reference)
    if ([string]::IsNullOrWhiteSpace($Reference)) { return '' }
    $value = $Reference.Trim().Trim('"', "'")
    if ($value -match '^\[\[(?<path>[^\]]+)\]\]$') { $value = $Matches['path'] }
    $value = $value.Replace('\', '/')
    if (-not $value.StartsWith('Clippings/', [StringComparison]::OrdinalIgnoreCase)) {
        $value = 'Clippings/' + $value.TrimStart('/')
    }
    if (-not $value.EndsWith('.md', [StringComparison]::OrdinalIgnoreCase)) { $value += '.md' }
    return $value
}

function Resolve-ClippingPathMigration {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$RequestedFullPath
    )

    if (Test-Path -LiteralPath $RequestedFullPath -PathType Leaf) { return $RequestedFullPath }
    $root = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\', '/')
    $prefix = $root + [IO.Path]::DirectorySeparatorChar
    $requested = [IO.Path]::GetFullPath($RequestedFullPath)
    if (-not $requested.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $RequestedFullPath }
    $relative = $requested.Substring($prefix.Length).Replace('\', '/')
    if (-not $relative.StartsWith('Clippings/', [StringComparison]::OrdinalIgnoreCase)) { return $RequestedFullPath }

    $mapPath = Join-Path $root 'system/registry/clipping-path-migrations.json'
    if (-not (Test-Path -LiteralPath $mapPath -PathType Leaf)) { return $RequestedFullPath }
    $map = Get-Content -Raw -Encoding UTF8 -LiteralPath $mapPath | ConvertFrom-Json
    if ([int]$map.schema_version -ne 1) { throw 'Unsupported clipping path migration schema.' }
    $matches = @($map.migrations | Where-Object {
        [string]$_.old_path -eq $relative
    })
    if ($matches.Count -eq 0) { return $RequestedFullPath }
    if ($matches.Count -ne 1) { throw "Duplicate clipping migration source: $relative" }

    $entry = $matches[0]
    $targetRelative = [string]$entry.new_path
    if (-not (Test-CanonicalClippingPath -Path $targetRelative)) {
        throw "Clipping migration target is not canonical: $targetRelative"
    }
    $targetFull = [IO.Path]::GetFullPath((Join-Path $root $targetRelative))
    if (-not $targetFull.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Clipping migration target escapes Knowledge: $targetRelative"
    }
    if (-not (Test-Path -LiteralPath $targetFull -PathType Leaf)) {
        throw "Clipping migration target is missing: $targetRelative"
    }
    $identity = Get-SourceByteIdentity -ProjectRoot $root -Path $targetFull -ExpectedSha256 ([string]$entry.sha256)
    if (-not $identity.matches) {
        throw "Clipping migration target hash drifted: $targetRelative"
    }
    return $targetFull
}
