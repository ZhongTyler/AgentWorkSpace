. (Join-Path $PSScriptRoot 'session-common.ps1')
$script:MethodUtf8NoBom = New-Object Text.UTF8Encoding($false)
$script:MethodCategories = @('capture', 'framing', 'divergence', 'synthesis', 'convergence')
$script:MethodStatuses = @('ready', 'placeholder', 'rejected')
$script:RequiredMethodHeadings = @(
    '## Contract',
    '## Purpose',
    '## Input contract',
    '## Use when',
    '## Avoid when',
    '## Procedure',
    '## Output contract',
    '## Exit conditions',
    '## Single-user + AI adaptation',
    '## Traceability',
    '## Sources',
    '## Behavior cases',
    '### Positive case',
    '### Negative case'
)

function Stop-MethodContract {
    param([string]$Message)
    throw "Brainstorm method contract failed: $Message"
}

function Assert-MethodContract {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Stop-MethodContract -Message $Message }
}

function Get-MethodProjectRoot {
    param([string]$ProjectRoot, [string]$ScriptPath)
    if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
        $ProjectRoot = Join-Path (Split-Path -Parent $ScriptPath) '..'
    }
    return [IO.Path]::GetFullPath($ProjectRoot)
}

function Read-MethodJson {
    param([string]$Path)
    Assert-MethodContract -Condition (Test-Path -LiteralPath $Path -PathType Leaf) -Message "Missing JSON file: $Path"
    try {
        return [IO.File]::ReadAllText($Path, $script:MethodUtf8NoBom) | ConvertFrom-Json
    } catch {
        Stop-MethodContract -Message "Invalid JSON file: $Path"
    }
}

function Write-MethodTextAtomic {
    param([string]$Path, [string]$Content)
    Assert-SafePhysicalPath -Path $Path
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $directory -Force)
    }
    $tempPath = Join-Path $directory ('.tmp-' + [guid]::NewGuid().ToString('N'))
    try {
        [IO.File]::WriteAllText($tempPath, ($Content.Replace("`r`n", "`n").Replace("`r", "`n").TrimEnd() + "`n"), $script:MethodUtf8NoBom)
        Move-Item -LiteralPath $tempPath -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $tempPath -PathType Leaf) {
            Remove-Item -LiteralPath $tempPath -Force
        }
    }
}

function Resolve-MethodRelativePath {
    param([string]$ProjectRoot, [string]$RelativePath)
    Assert-MethodContract -Condition (-not [IO.Path]::IsPathRooted($RelativePath)) -Message "Method path must be relative: $RelativePath"
    $resolved = [IO.Path]::GetFullPath((Join-Path $ProjectRoot $RelativePath))
    $prefix = $ProjectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    Assert-MethodContract -Condition ($resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) -Message "Method path escapes project root: $RelativePath"
    Assert-SafePhysicalPath -Path $resolved
    return $resolved
}

function ConvertTo-MethodJson {
    param($Value)
    return (($Value | ConvertTo-Json -Depth 12) + "`n")
}
