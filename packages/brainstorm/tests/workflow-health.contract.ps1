[CmdletBinding()]
param([switch]$Portable)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
. (Join-Path $project 'scripts\session-common.ps1')
$systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$sandbox = Join-Path $systemTemp ('brainstorm-health-' + [guid]::NewGuid().ToString('N'))
$sessions = Join-Path $sandbox 'sessions'
$reviews = Join-Path $sandbox 'reviews'
function Assert-Test { param([bool]$Condition,[string]$Message) if (-not $Condition) { throw "Workflow health contract: $Message" } }
function Invoke-Tool {
    param([string]$Name,[string[]]$Arguments,[switch]$Fail)
    $prior = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = @(& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $project ('scripts\' + $Name)) @Arguments 2>&1); $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $prior }
    if ($Fail) { Assert-Test ($code -ne 0) "Expected rejection: $Name"; return ($out -join "`n") }
    Assert-Test ($code -eq 0) ("Failed: $Name " + ($out -join "`n"))
    return (($out -join "`n") | ConvertFrom-Json)
}
function New-SessionFixture {
    param([string]$Id)
    $created = Invoke-Tool 'new-session.ps1' @('-Title','Synthetic workflow health','-Goal','Exercise boundaries without real user data','-OutputRoot',$sessions,'-SessionId',$Id)
    return [string]$created.session_path
}
function Record-Review {
    param([string]$Path,[switch]$Revise)
    $arguments = @('-SessionPath',$Path,'-Outcome','no_increment','-Summary','Synthetic health fixture; no actual user outcome','-SourceIds','RAW-001','-DiscussionPurposeVisible','unknown','-SerialQaWithoutProgress','unknown','-PrematureConvergenceOrOverdetail','unknown','-SupportConsumptionCausedRework','unknown','-CompletionLearningRoot',$reviews)
    if ($Revise) { $arguments += '-Revise' }
    return Invoke-Tool 'record-completion-learning-review.ps1' $arguments
}
$junction = $null
try {
    $session = New-SessionFixture 'bs-20261023-040001-d00101'
    $recordPath = Join-Path $session 'session.md'
    $record = [IO.File]::ReadAllText($recordPath,$script:BrainstormUtf8NoBom)
    $record = Add-MarkdownTableRow $record 'Raw Capture' @('RAW-001','user','Synthetic only','clear')
    $record = Add-MarkdownTableRow $record 'Idea Ledger' @('IDEA-001','-','user','-','active','prototype','Synthetic option','-','-','-')
    $record = Add-MarkdownTableRow $record 'Decision Record' @('DEC-001','IDEA-001','Synthetic fixture decision','Synthetic only','-','user')
    [IO.File]::WriteAllText($recordPath,$record,$script:BrainstormUtf8NoBom)
    $candidate = Invoke-Tool 'new-learning-feedback-candidate.ps1' @('-SessionPath',$session,'-ArtifactId','ART-001','-DecisionId','DEC-001','-SourceIds','RAW-001')
    $artifactPath = [string]$candidate.artifact_path
    $feedbackPath = Join-Path $sandbox 'feedback.md'
    $feedback = @('# Synthetic feedback','','> Contract: `fromdemotospec-validation-feedback-v1`','> Status: `ready-for-import`','> Prototype ID: `synthetic`','> Prototype version: `1`','> Upstream Brainstorm session: `bs-20261023-040001-d00101`','> Upstream Decision ID: `DEC-001`','> Decision impact: `supports`','> Knowledge write: `false`') -join "`n"
    $importArgs = @('-SessionPath',$session,'-ArtifactId','ART-001','-FromDemoToSpecFeedbackPath',$feedbackPath)
    $artifactHash = Get-SessionFileSha256 $artifactPath
    foreach ($bad in @($feedback.Replace('bs-20261023-040001-d00101','bs-20261023-040002-d00202'), ($feedback -replace '(?m)^> Upstream Brainstorm session:[^\r\n]*',''))) {
        [IO.File]::WriteAllText($feedbackPath,$bad,$script:BrainstormUtf8NoBom)
        [void](Invoke-Tool 'import-fromdemotospec-learning-feedback.ps1' $importArgs -Fail)
        Assert-Test ((Get-SessionFileSha256 $artifactPath) -ceq $artifactHash) 'Wrong or missing source identity changed the artifact.'
    }
    [IO.File]::WriteAllText($feedbackPath,$feedback,$script:BrainstormUtf8NoBom)
    $content = [IO.File]::ReadAllText($artifactPath,$script:BrainstormUtf8NoBom).Replace('`collecting-evidence`','`accepted-for-host`')
    [IO.File]::WriteAllText($artifactPath,$content,$script:BrainstormUtf8NoBom)
    $imported = Invoke-Tool 'import-fromdemotospec-learning-feedback.ps1' $importArgs
    Assert-Test ($imported.candidate_status -ceq 'accepted-for-host') 'Import returned a false status regression.'

    if (-not $Portable) {
        $first = Record-Review $session
        $firstPath = [string]$first.review_path
        $firstHash = Get-SessionFileSha256 $firstPath
        $reviewText = [IO.File]::ReadAllText($firstPath,$script:BrainstormUtf8NoBom)
        $missingQuestion = $reviewText | ConvertFrom-Json
        $missingQuestion.process_checks.PSObject.Properties.Remove('support_consumption_caused_rework')
        [IO.File]::WriteAllText($firstPath,($missingQuestion | ConvertTo-Json -Depth 32),$script:BrainstormUtf8NoBom)
        [void](Invoke-Tool 'validate-completion-learning-review.ps1' @('-SessionPath',$session,'-CompletionLearningRoot',$reviews) -Fail)
        [IO.File]::WriteAllText($firstPath,$reviewText,$script:BrainstormUtf8NoBom)
    }
    $original = [IO.File]::ReadAllText($recordPath,$script:BrainstormUtf8NoBom)
    $navBefore = @(Get-MarkdownTableRows $original 'Phase Navigator' @('Navigation ID','Phase','Method ID','AI responsibility','User action','Next step')).Count
    $update = Invoke-Tool 'set-session-continuation.ps1' @('-SessionPath',$session,'-CurrentFocus','Synthetic changed focus','-NextAction','Review the final snapshot')
    $updated = [IO.File]::ReadAllText($recordPath,$script:BrainstormUtf8NoBom)
    $navAfter = @(Get-MarkdownTableRows $updated 'Phase Navigator' @('Navigation ID','Phase','Method ID','AI responsibility','User action','Next step')).Count
    Assert-Test ($update.changed -and -not $update.navigation_appended -and $navBefore -eq $navAfter) 'Continuation-only update appended navigation.'
    $beforeRecord = Get-SessionFileSha256 $recordPath
    if (-not $Portable) {
    [void](Invoke-Tool 'set-session-state.ps1' @('-SessionPath',$session,'-ToState','closed','-CompletionLearningRoot',$reviews) -Fail)
    $second = Record-Review $session -Revise
    Assert-Test ($second.revision -eq 2 -and (Get-SessionFileSha256 $firstPath) -ceq $firstHash) 'Review revision rewrote history.'
    [IO.File]::AppendAllText($artifactPath,"`nSynthetic new counterevidence.`n",$script:BrainstormUtf8NoBom)
    [void](Invoke-Tool 'set-session-state.ps1' @('-SessionPath',$session,'-ToState','closed','-CompletionLearningRoot',$reviews) -Fail)
    [void](Record-Review $session -Revise)
    $statePath = Join-Path $session 'session-state.json'
    $beforeState = Get-SessionFileSha256 $statePath
    $beforeRecord = Get-SessionFileSha256 $recordPath
    [void](Invoke-Tool 'set-session-state.ps1' @('-SessionPath',$session,'-RunMode','autonomous','-ToState','closed','-CompletionLearningRoot',$reviews) -Fail)
    Assert-Test ((Get-SessionFileSha256 $statePath) -ceq $beforeState -and (Get-SessionFileSha256 $recordPath) -ceq $beforeRecord) 'Rejected compound close mutated state or record.'
    }
    [void](Invoke-Tool 'set-session-continuation.ps1' @('-SessionPath',$session,'-DecisionRefs','DEC-999') -Fail)
    Assert-Test ((Get-SessionFileSha256 $recordPath) -ceq $beforeRecord) 'Invalid continuation corrupted the record before validation.'
    $stateLock = [IO.File]::Open((Join-Path $session 'session-state.json'),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        [void](Invoke-Tool 'set-session-continuation.ps1' @('-SessionPath',$session,'-NextAction','Synthetic write must roll back') -Fail)
    } finally { $stateLock.Dispose() }
    Assert-Test ((Get-SessionFileSha256 $recordPath) -ceq $beforeRecord) 'State write failure did not restore record bytes.'
    $closeArgs = @('-SessionPath',$session,'-ToState','closed')
    if (-not $Portable) { $closeArgs += @('-CompletionLearningRoot',$reviews) }
    $closed = Invoke-Tool 'set-session-state.ps1' $closeArgs
    Assert-Test ($closed.validation.status -ceq 'closed') 'Reviewed close failed.'
    $afterCloseHash = Get-SessionFileSha256 $artifactPath
    [IO.File]::WriteAllText($feedbackPath,$feedback.Replace('`1`','`2`'),$script:BrainstormUtf8NoBom)
    $failure = Invoke-Tool 'import-fromdemotospec-learning-feedback.ps1' $importArgs -Fail
    Assert-Test ($failure.Contains('Closed sessions') -and (Get-SessionFileSha256 $artifactPath) -ceq $afterCloseHash) 'Legacy import wrote a closed artifact.'

    if (-not $Portable) {
        [void](Invoke-Tool 'import-fromdemotospec-learning-feedback.ps1' $importArgs -Fail)
        Assert-Test ((Get-SessionFileSha256 $artifactPath) -ceq $afterCloseHash) 'Legacy import modified the closed artifact.'
    }

    $safe = New-SessionFixture 'bs-20261023-040002-d00202'
    $safeRecordPath = Join-Path $safe 'session.md'
    $safeRecord = Add-MarkdownTableRow ([IO.File]::ReadAllText($safeRecordPath,$script:BrainstormUtf8NoBom)) 'Raw Capture' @('RAW-001','user','Synthetic path fixture','clear')
    [IO.File]::WriteAllText($safeRecordPath,$safeRecord,$script:BrainstormUtf8NoBom)
    $outside = Join-Path $sandbox 'outside-session'
    [void](New-Item -ItemType Directory -Path $outside)
    $junction = Join-Path $safe 'artifacts'
    [void](New-Item -ItemType Junction -Path $junction -Target $outside)
    [void](Invoke-Tool 'new-session-artifact.ps1' @('-SessionPath',$safe,'-ArtifactId','ART-001','-Kind','comparison','-Title','Synthetic path probe','-SourceIds','RAW-001','-Purpose','Check containment') -Fail)
    Assert-Test (@(Get-ChildItem -LiteralPath $outside -File).Count -eq 0) 'Artifact escaped through a junction.'
    [IO.Directory]::Delete($junction); $junction = $null

    $sibling = New-SessionFixture 'bs-20261023-040003-d00303'
    $siblingPath = Join-Path $sibling 'session-state.json'
    $validSibling = [IO.File]::ReadAllText($siblingPath,$script:BrainstormUtf8NoBom)
    [IO.File]::WriteAllText($siblingPath,'{invalid synthetic json',$script:BrainstormUtf8NoBom)
    $safeHash = Get-SessionFileSha256 $safeRecordPath
    $resume = Invoke-Tool 'resume-session.ps1' @('-SessionPath',$safe)
    Assert-Test ($resume.root_health -ceq 'degraded' -and $resume.root_problems.Count -gt 0 -and -not $resume.execution_started) 'Read resume hid sibling damage or started execution.'
    Assert-Test ((Get-SessionFileSha256 $safeRecordPath) -ceq $safeHash) 'Read resume changed the healthy record.'
    [void](Invoke-Tool 'set-session-state.ps1' @('-SessionPath',$safe,'-ToState','paused') -Fail)
    [void](Invoke-Tool 'build-session-index.ps1' @('-SessionRoot',$sessions) -Fail)
    $index = Read-Utf8Json -Path (Join-Path $sessions 'index.json')
    Assert-Test ($index.health_status -ceq 'degraded' -and $index.invalid_session_count -eq 1 -and $index.valid_session_count -eq 2) 'Index omitted per-object failure diagnostics.'
    [IO.File]::WriteAllText($siblingPath,$validSibling,$script:BrainstormUtf8NoBom)
    [void](Invoke-Tool 'build-session-index.ps1' @('-SessionRoot',$sessions))
    Write-Output 'Brainstorm workflow health: PASS (identity, closed writes, immutable review revisions, artifact snapshot, continuation, junction and recovery isolation)'
} finally {
    if ($null -ne $junction -and (Test-Path -LiteralPath $junction)) { [IO.Directory]::Delete($junction) }
    $resolved = [IO.Path]::GetFullPath($sandbox)
    Assert-Test ($resolved.StartsWith($systemTemp.TrimEnd([char]92) + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved).StartsWith('brainstorm-health-')) 'Unsafe cleanup target.'
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
