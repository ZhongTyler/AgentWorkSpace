[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SessionPath,
    [Parameter(Mandatory = $true)][string]$ArtifactId,
    [Parameter(Mandatory = $true)][string]$FromDemoToSpecFeedbackPath,
    [string]$SessionRoot = ''
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDirectory 'session-common.ps1')

function Get-Sha256Hex {
    param([string]$LiteralPath)
    $stream = [IO.File]::OpenRead($LiteralPath)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

$candidateArgs = @('-SessionPath', $SessionPath, '-ArtifactId', $ArtifactId)
if (-not [string]::IsNullOrWhiteSpace($SessionRoot)) {
    $candidateArgs += @('-SessionRoot', $SessionRoot)
}
$candidateResult = @(& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptDirectory 'validate-learning-feedback-candidate.ps1') @candidateArgs)
if ($LASTEXITCODE -ne 0) { throw 'Learning candidate validation failed before import.' }
$candidate = ($candidateResult -join "`n") | ConvertFrom-Json
Assert-SessionWritable -SessionPath $SessionPath
$sourceState = Read-Utf8Json -Path (Resolve-SessionStatePath -SessionPath $SessionPath)
Assert-SessionContract -Condition (Test-Path -LiteralPath $FromDemoToSpecFeedbackPath -PathType Leaf) -Message "Missing FromDemoToSpec feedback: $FromDemoToSpecFeedbackPath"
$feedbackPath = [IO.Path]::GetFullPath($FromDemoToSpecFeedbackPath)
$feedback = [IO.File]::ReadAllText($feedbackPath, $script:BrainstormUtf8NoBom)
foreach ($required in @('> Contract: `fromdemotospec-validation-feedback-v1`', '> Status: `ready-for-import`', '> Knowledge write: `false`', '> Upstream Decision ID:')) {
    Assert-SessionContract -Condition ($feedback.Contains($required)) -Message "FromDemoToSpec feedback is missing import requirement: $required"
}
$prototype = [regex]::Match($feedback, '(?m)^> Prototype ID: `([^`]+)`\s*$')
$version = [regex]::Match($feedback, '(?m)^> Prototype version: `([^`]+)`\s*$')
$decision = [regex]::Match($feedback, '(?m)^> Upstream Decision ID: `(DEC-[0-9]{3,})`\s*$')
$upstream = [regex]::Matches($feedback, '(?m)^> Upstream Brainstorm session: `(bs-[0-9]{8}-[0-9]{6}-[a-f0-9]{6})`\s*$')
Assert-SessionContract ($upstream.Count -eq 1 -and $upstream[0].Groups[1].Value -ceq [string]$sourceState.session_id) 'FromDemoToSpec feedback upstream session mismatch or missing identity.'
$impact = [regex]::Match($feedback, '(?m)^> Decision impact: `([^`]+)`\s*$')
Assert-SessionContract -Condition ($prototype.Success -and $version.Success -and $decision.Success -and $impact.Success) -Message 'FromDemoToSpec feedback metadata is incomplete.'
Assert-SessionContract -Condition ($decision.Groups[1].Value -ceq [string]$candidate.decision_id) -Message 'FromDemoToSpec feedback Decision ID does not match the Brainstorm candidate.'
$hash = (Get-Sha256Hex -LiteralPath $feedbackPath).ToLowerInvariant()

Assert-SessionWritable -SessionPath $SessionPath
$statePath = Resolve-SessionStatePath -SessionPath $SessionPath
$sessionDirectory = Split-Path -Parent $statePath
$state = Read-Utf8Json -Path $statePath
$recordPath = Resolve-SafeRelativePath -BasePath $sessionDirectory -RelativePath ([string]$state.record_path)
$record = [IO.File]::ReadAllText($recordPath, $script:BrainstormUtf8NoBom)
$artifactRows = @(Get-MarkdownTableRows -Content $record -Heading 'Artifact Index' -ExpectedHeaders @('Artifact ID', 'Kind', 'Path', 'Source IDs', 'Status', 'Purpose'))
$artifact = @($artifactRows | Where-Object { [string]$_.cells[0] -ceq $ArtifactId })
$artifactPath = Resolve-SafeRelativePath -BasePath $sessionDirectory -RelativePath ([string]$artifact[0].cells[2])
$content = [IO.File]::ReadAllText($artifactPath, $script:BrainstormUtf8NoBom)
Assert-SessionContract -Condition (-not $content.Contains($hash)) -Message 'This FromDemoToSpec feedback was already imported.'
$updated = Add-MarkdownTableRow -Content $content -Heading 'Imported FromDemoToSpec Feedback' -Cells @($hash, $prototype.Groups[1].Value, $version.Groups[1].Value, $decision.Groups[1].Value, $impact.Groups[1].Value, 'imported')
Write-Utf8TextAtomic -Path $artifactPath -Value $updated
$state.updated_at = (Get-Date).ToUniversalTime().ToString('o')
$commit = Complete-SessionUpdate -SessionPath $sessionDirectory -State $state -SessionRoot $SessionRoot

[pscustomobject][ordered]@{
    imported = $true
    artifact_id = $ArtifactId
    feedback_sha256 = $hash
    knowledge_write = $false
    candidate_status = [string]$candidate.candidate_status
} | ConvertTo-Json -Depth 8
