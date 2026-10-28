[CmdletBinding()]
param(
    [string]$Root = '',
    [ValidateSet('Report', 'Enforce')][string]$Mode = 'Report',
    [switch]$RequireGroupsField,
    [switch]$RejectLegacyThemes,
    [string]$OutputPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Join-Path $PSScriptRoot '../../..' }
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$wikiRoot = Join-Path $rootPath 'wiki'
$groupsRoot = Join-Path $rootPath 'groups'

function Get-FrontmatterBody([string]$Text) {
    $match = [regex]::Match($Text, '(?ms)\A---\s*\r?\n(?<body>.*?)\r?\n---')
    if (-not $match.Success) { return $null }
    return $match.Groups['body'].Value
}

function Get-FrontmatterScalar([string]$Body, [string]$Field) {
    if ($null -eq $Body) { return '' }
    $match = [regex]::Match($Body, '(?m)^' + [regex]::Escape($Field) + ':\s*(?<value>[^\r\n#]+?)\s*$')
    if (-not $match.Success) { return '' }
    return $match.Groups['value'].Value.Trim().Trim('"', "'")
}

function Get-FrontmatterList([string]$Body, [string]$Field) {
    if ($null -eq $Body) { return @() }
    $name = [regex]::Escape($Field)
    $inline = [regex]::Match($Body, '(?m)^' + $name + ':\s*\[(?<items>[^\]]*)\]\s*$')
    if ($inline.Success) { return @($inline.Groups['items'].Value -split ',' | ForEach-Object { $_.Trim().Trim('"', "'") } | Where-Object { $_ -ne '' }) }
    $block = [regex]::Match($Body, '(?m)^' + $name + ':\s*\r?\n(?<items>(?:[ \t]+-\s+.*\r?\n?)+)')
    if ($block.Success) { return @([regex]::Matches($block.Groups['items'].Value, '(?m)^[ \t]+-\s+(?<item>.+?)\s*$') | ForEach-Object { $_.Groups['item'].Value.Trim().Trim('"', "'") } | Where-Object { $_ -ne '' }) }
    return @()
}

function Convert-UnicodeLiteral([string]$Value) {
    return [regex]::Replace($Value, '\\u([0-9a-fA-F]{4})', { param($match) [char][Convert]::ToInt32($match.Groups[1].Value, 16) })
}

function Add-Finding($Findings, [string]$Severity, [string]$Code, [string]$Path, [string]$Detail) {
    [void]$Findings.Add([pscustomobject][ordered]@{ severity = $Severity; code = $Code; path = $Path; detail = $Detail })
}

function Get-GeneratedMembers([string]$Text) {
    $match = [regex]::Match($Text, '(?ms)<!-- generated:wiki-group-members:start -->\r?\n?(?<body>.*?)<!-- generated:wiki-group-members:end -->')
    if (-not $match.Success) { return $null }
    return @([regex]::Matches($match.Groups['body'].Value, '\]\(<?\.\./wiki/(?<name>[^\)>]+)\.md>?\)') | ForEach-Object { [Uri]::UnescapeDataString($_.Groups['name'].Value) } | Sort-Object -Unique)
}

# A count threshold is a review signal, not evidence that an approved Group is
# wrong. Only an explicit, current, version-bound assessment can acknowledge it.
function Test-ThresholdAssessment($Group, [string]$Condition, [string[]]$Members) {
    try {
        $document = $Group.receipt_document
        if ($null -eq $document -or $document.kind -ne 'wiki_group_adjudication_receipt') { return $false }
        if ($document.group_id -ne $Group.id -or $document.definition_hash -ne $Group.definition_hash -or $document.repository_revision -ne $Group.reviewed_revision) { return $false }
        if (-not $document.PSObject.Properties['threshold_assessment']) { return $false }
        $assessment = $document.threshold_assessment
        if ($Condition -notin @($assessment.conditions) -or [string]::IsNullOrWhiteSpace([string]$assessment.reason)) { return $false }
        if ($assessment.not_a_permanent_waiver -ne $true -or [string]::IsNullOrWhiteSpace([string]$assessment.review_when)) { return $false }
        if ([string]$assessment.evidence -notmatch '^docs/[^:]+\.(md|json)$' -or [string]$assessment.evidence -match '(^|[/\\])\.\.([/\\]|$)') { return $false }
        if (-not (Test-Path -LiteralPath (Join-Path $rootPath $assessment.evidence) -PathType Leaf)) { return $false }
        if ([DateTimeOffset]::Parse($assessment.review_by) -le [DateTimeOffset]::UtcNow) { return $false }
        $canonical = [regex]::Replace($Group.text.Replace("`r`n", "`n"), '(?ms)\A---\n.*?\n---\n?', '')
        $canonical = [regex]::Replace($canonical, '(?ms)<!-- generated:wiki-group-members:start -->.*?<!-- generated:wiki-group-members:end -->', '').Trim()
        $digest = [Security.Cryptography.SHA256]::Create()
        try { $actual = ([BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical)))).Replace('-', '').ToLowerInvariant() } finally { $digest.Dispose() }
        if ($assessment.group_semantic_sha256 -ne $actual) { return $false }
        $expected = @($Members | ForEach-Object { 'wiki/' + $_ + '.md' } | Sort-Object -Unique)
        if (($expected -join "`n") -ne (@($assessment.members | Sort-Object -Unique) -join "`n")) { return $false }
        $required = @($expected + @($Group.candidate_members) | Sort-Object -Unique)
        $bindings = @($assessment.input_hashes.PSObject.Properties)
        foreach ($item in $required) { if ($item -notin @($bindings.Name)) { return $false } }
        foreach ($item in $bindings) {
            if ($item.Name -notmatch '^wiki/[^/\\]+\.md$' -or $item.Value -notmatch '^[a-f0-9]{64}$') { return $false }
            $file = Join-Path $rootPath $item.Name
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
            if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.Value) { return $false }
        }
        [void]$script:thresholdReviewDeadlines.Add([DateTimeOffset]::Parse($assessment.review_by).UtcDateTime.ToString('o'))
        return $true
    } catch { return $false } # Malformed or incomplete evidence must remain due.
}

$findings = New-Object 'System.Collections.Generic.List[object]'
$script:thresholdReviewDeadlines = New-Object 'System.Collections.Generic.List[string]'
$requiredHeadings = @('\u5B9A\u4E49', '\u68C0\u7D22\u4E0E\u5171\u540C\u9605\u8BFB\u7528\u4F8B', '\u7EB3\u5165\u8FB9\u754C', '\u6392\u9664\u8FB9\u754C', '\u53CD\u4F8B', '\u8986\u76D6\u7EF4\u5EA6', '\u76F8\u5173 Wiki \u9875\u9762') | ForEach-Object { Convert-UnicodeLiteral $_ }
try {
    $wikiFiles = @(Get-ChildItem -LiteralPath $wikiRoot -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' } | Sort-Object Name)
    $groupFiles = @($(if (Test-Path -LiteralPath $groupsRoot -PathType Container) { Get-ChildItem -LiteralPath $groupsRoot -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.template.md' -and $_.Name -ne 'group.template.md' } | Sort-Object Name }))
    $groupById = @{}
    $termOwners = @{}
    $groupMembers = @{}

    foreach ($file in $groupFiles) {
        $relative = 'groups/' + $file.Name
        $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName
        $body = Get-FrontmatterBody $text
        if ($null -eq $body) { Add-Finding $findings 'error' 'group_frontmatter_missing' $relative 'Missing YAML frontmatter.'; continue }
        $id = Get-FrontmatterScalar $body 'id'
        $name = Get-FrontmatterScalar $body 'name'
        $kind = Get-FrontmatterScalar $body 'kind'
        $status = Get-FrontmatterScalar $body 'status'
        $maturity = Get-FrontmatterScalar $body 'maturity'
        $approvalStatus = Get-FrontmatterScalar $body 'approval_status'
        $approvedBy = Get-FrontmatterScalar $body 'approved_by'
        $reviewedRevision = Get-FrontmatterScalar $body 'reviewed_revision'
        $definitionHash = Get-FrontmatterScalar $body 'definition_hash'
        $receipt = Get-FrontmatterScalar $body 'last_review_receipt'
        $coverageMatrix = Get-FrontmatterScalar $body 'coverage_matrix'
        $candidateReview = Get-FrontmatterScalar $body 'candidate_review'
        $candidateMembers = @(Get-FrontmatterList $body 'candidate_members')
        $aliases = @(Get-FrontmatterList $body 'aliases')
        $reviewWhen = @(Get-FrontmatterList $body 'review_when')
        foreach ($required in @(@{ n = 'id'; v = $id }, @{ n = 'name'; v = $name }, @{ n = 'kind'; v = $kind }, @{ n = 'status'; v = $status }, @{ n = 'maturity'; v = $maturity }, @{ n = 'approval_status'; v = $approvalStatus }, @{ n = 'approved_by'; v = $approvedBy }, @{ n = 'reviewed_revision'; v = $reviewedRevision }, @{ n = 'definition_hash'; v = $definitionHash }, @{ n = 'last_review_receipt'; v = $receipt }, @{ n = 'coverage_matrix'; v = $coverageMatrix })) {
            if ([string]::IsNullOrWhiteSpace([string]$required.v)) { Add-Finding $findings 'error' 'group_required_field_missing' $relative $required.n }
        }
        if ($id -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') { Add-Finding $findings 'error' 'group_id_invalid' $relative $id }
        if ($file.BaseName -ne $id) { Add-Finding $findings 'error' 'group_filename_id_mismatch' $relative "filename=$($file.BaseName); id=$id" }
        if ($status -notin @('active', 'retired')) { Add-Finding $findings 'error' 'group_status_invalid' $relative $status }
        if ($maturity -notin @('seed', 'connected')) { Add-Finding $findings 'error' 'group_maturity_invalid' $relative $maturity }
        if ($approvalStatus -notin @('approved', 'rejected')) { Add-Finding $findings 'error' 'group_approval_status_invalid' $relative $approvalStatus }
        if ($status -eq 'active' -and $approvalStatus -ne 'approved') { Add-Finding $findings 'error' 'group_active_unapproved' $relative $approvalStatus }
        if ($reviewedRevision -notmatch '^[a-f0-9]{40}$') { Add-Finding $findings 'error' 'group_reviewed_revision_invalid' $relative $reviewedRevision }
        if ($definitionHash -notmatch '^[a-f0-9]{64}$') { Add-Finding $findings 'error' 'group_definition_hash_invalid' $relative $definitionHash }
        $receiptPath = if ([string]::IsNullOrWhiteSpace($receipt)) { '' } else { Join-Path $rootPath $receipt }
        if (-not [string]::IsNullOrWhiteSpace($receipt) -and -not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) { Add-Finding $findings 'error' 'group_review_receipt_missing' $relative $receipt }
        if (-not [string]::IsNullOrWhiteSpace($coverageMatrix) -and -not (Test-Path -LiteralPath (Join-Path $rootPath $coverageMatrix) -PathType Leaf)) { Add-Finding $findings 'error' 'group_coverage_matrix_missing' $relative $coverageMatrix }
        $candidateDecisionPaths = @{}
        $candidateReviewPath = if ([string]::IsNullOrWhiteSpace($candidateReview)) { '' } else { Join-Path $rootPath $candidateReview }
        if (-not [string]::IsNullOrWhiteSpace($candidateReview) -and -not (Test-Path -LiteralPath $candidateReviewPath -PathType Leaf)) { Add-Finding $findings 'error' 'group_candidate_review_missing' $relative $candidateReview }
        if (-not [string]::IsNullOrWhiteSpace($candidateReviewPath) -and (Test-Path -LiteralPath $candidateReviewPath -PathType Leaf)) {
            try {
                $candidateDocument = Get-Content -Raw -Encoding UTF8 -LiteralPath $candidateReviewPath | ConvertFrom-Json
                if ([string]$candidateDocument.group_id -ne $id) { Add-Finding $findings 'error' 'group_candidate_review_id_mismatch' $relative ([string]$candidateDocument.group_id) }
                foreach ($decision in @($candidateDocument.decisions)) { if ($null -ne $decision -and -not [string]::IsNullOrWhiteSpace([string]$decision.path)) { $candidateDecisionPaths[[string]$decision.path] = [string]$decision.decision } }
            } catch { Add-Finding $findings 'error' 'group_candidate_review_invalid_json' $relative $_.Exception.Message }
        }
        if (@($candidateMembers | Sort-Object -Unique).Count -ne $candidateMembers.Count) { Add-Finding $findings 'error' 'group_candidate_duplicate' $relative ($candidateMembers -join ', ') }
        foreach ($candidate in $candidateMembers) {
            if ($candidate -notmatch '^wiki/.+\.md$') { Add-Finding $findings 'error' 'group_candidate_path_invalid' $relative $candidate; continue }
            if (-not (Test-Path -LiteralPath (Join-Path $rootPath $candidate) -PathType Leaf)) { Add-Finding $findings 'error' 'group_candidate_page_missing' $relative $candidate }
            if (-not $candidateDecisionPaths.ContainsKey($candidate)) { Add-Finding $findings 'error' 'group_candidate_decision_missing' $relative $candidate }
            elseif ($candidateDecisionPaths[$candidate] -notin @('exclude', 'unresolved')) { Add-Finding $findings 'error' 'group_candidate_not_nonmember' $relative "$candidate=$($candidateDecisionPaths[$candidate])" }
        }
        foreach ($candidatePath in $candidateDecisionPaths.Keys) {
            if ($candidateDecisionPaths[$candidatePath] -in @('exclude', 'unresolved') -and $candidatePath -notin $candidateMembers) { Add-Finding $findings 'error' 'group_candidate_record_missing' $relative $candidatePath }
        }
        $receiptDocument = $null
        if (-not [string]::IsNullOrWhiteSpace($receiptPath) -and (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
            try {
                $receiptDocument = Get-Content -Raw -Encoding UTF8 -LiteralPath $receiptPath | ConvertFrom-Json
                if ([string]$receiptDocument.group_id -ne $id) { Add-Finding $findings 'error' 'group_review_receipt_id_mismatch' $relative ([string]$receiptDocument.group_id) }
                if ([string]$receiptDocument.repository_revision -ne $reviewedRevision) { Add-Finding $findings 'error' 'group_review_receipt_revision_mismatch' $relative ([string]$receiptDocument.repository_revision) }
                if ([string]$receiptDocument.definition_hash -ne $definitionHash) { Add-Finding $findings 'error' 'group_review_receipt_definition_mismatch' $relative ([string]$receiptDocument.definition_hash) }
            } catch { Add-Finding $findings 'error' 'group_review_receipt_invalid_json' $relative $_.Exception.Message }
        }
        if ($kind -notin @('genre', 'mechanic', 'system', 'experience', 'method')) { Add-Finding $findings 'error' 'group_kind_invalid' $relative $kind }
        if ($reviewWhen.Count -eq 0) { Add-Finding $findings 'error' 'group_review_when_missing' $relative 'review_when needs at least one trigger.' }
        if ([string]::IsNullOrWhiteSpace($candidateReview)) { Add-Finding $findings 'warning' 'group_candidate_review_missing' $relative 'Add candidate_review and candidate_members: [] when the next review occurs.' }
        foreach ($heading in $requiredHeadings) {
            if ($text -notmatch ('(?m)^##[ \t]+' + [regex]::Escape($heading) + '[ \t]*\r?$')) { Add-Finding $findings 'error' 'group_required_section_missing' $relative $heading }
        }
        foreach ($term in @($id, $name) + $aliases) {
            if ([string]::IsNullOrWhiteSpace($term)) { continue }
            $key = $term.Trim().ToLowerInvariant()
            if ($termOwners.ContainsKey($key) -and $termOwners[$key] -ne $id) { Add-Finding $findings 'error' 'group_term_duplicate' $relative "term=$term; owner=$($termOwners[$key])" } else { $termOwners[$key] = $id }
        }
        if ($groupById.ContainsKey($id)) { Add-Finding $findings 'error' 'group_id_duplicate' $relative $id; continue }
        $groupById[$id] = [pscustomobject]@{ id = $id; name = $name; status = $status; maturity = $maturity; path = $relative; text = $text; candidate_members = $candidateMembers; receipt_document = $receiptDocument; definition_hash = $definitionHash; reviewed_revision = $reviewedRevision }
        $members = Get-GeneratedMembers $text
        if ($null -eq $members) { Add-Finding $findings 'error' 'group_member_markers_missing' $relative 'Run sync-wiki-groups.ps1 -Mode Sync.'; $members = @() }
        $groupMembers[$id] = @($members)
    }

    $wikiMembers = @{}
    foreach ($file in $wikiFiles) {
        $relative = 'wiki/' + $file.Name
        $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName
        $body = Get-FrontmatterBody $text
        if ($null -eq $body) { Add-Finding $findings 'error' 'wiki_frontmatter_missing' $relative 'Missing YAML frontmatter.'; continue }
        $hasGroupsField = $body -match '(?m)^groups:\s*(?:\[[^\]]*\]|\r?$)'
        if ($RequireGroupsField -and -not $hasGroupsField) { Add-Finding $findings 'error' 'wiki_groups_field_missing' $relative 'Expected groups: [] or a list.' }
        $ids = @(Get-FrontmatterList $body 'groups')
        if (@($ids | Sort-Object -Unique).Count -ne $ids.Count) { Add-Finding $findings 'error' 'wiki_group_duplicate' $relative ($ids -join ', ') }
        foreach ($id in $ids) {
            if (-not $groupById.ContainsKey($id)) { Add-Finding $findings 'error' 'wiki_group_unknown' $relative $id; continue }
            if ($groupById[$id].status -ne 'active') { Add-Finding $findings 'error' 'wiki_group_retired' $relative $id }
        }
        if ($RejectLegacyThemes -and $body -match '(?m)^related_themes:') { Add-Finding $findings 'error' 'legacy_related_themes_present' $relative 'Remove after groups migration.' }
        $wikiMembers[$file.BaseName] = @($ids)
    }

    foreach ($group in $groupById.Values) {
        $expected = @($wikiMembers.Keys | Where-Object { $group.id -in $wikiMembers[$_] } | Sort-Object)
        $actual = @($groupMembers[$group.id] | Sort-Object -Unique)
        foreach ($candidate in @($group.candidate_members)) {
            $candidateName = [IO.Path]::GetFileNameWithoutExtension($candidate.Substring('wiki/'.Length))
            if ($candidateName -in $expected) { Add-Finding $findings 'error' 'group_candidate_is_member' $group.path $candidate }
        }
        if (($expected -join "`n") -ne ($actual -join "`n")) { Add-Finding $findings 'error' 'group_member_navigation_drift' $group.path "expected=$($expected.Count); actual=$($actual.Count)" }
        if ($group.status -eq 'retired' -and $expected.Count -gt 0) { Add-Finding $findings 'error' 'retired_group_has_members' $group.path $expected.Count }
        if ($group.status -eq 'active' -and $group.maturity -eq 'seed' -and $expected.Count -le 1) {
            if (Test-ThresholdAssessment $group 'seed' $expected) { Add-Finding $findings 'info' 'seed_group_reviewed' $group.path "members=$($expected.Count); retained by current assessment; review_when still applies" }
            else { Add-Finding $findings 'warning' 'seed_group_review_due' $group.path "members=$($expected.Count); no current threshold assessment" }
        }
        if ($group.status -eq 'active' -and $expected.Count -ge 20) {
            if (Test-ThresholdAssessment $group 'breadth' $expected) { Add-Finding $findings 'info' 'group_breadth_reviewed' $group.path "members=$($expected.Count); soft_threshold=20; retained by current assessment" }
            else { Add-Finding $findings 'warning' 'group_breadth_review_due' $group.path "members=$($expected.Count); soft_threshold=20; no current threshold assessment" }
        }
    }
    $ids = @($groupById.Keys | Sort-Object)
    for ($left = 0; $left -lt $ids.Count; $left++) {
        for ($right = $left + 1; $right -lt $ids.Count; $right++) {
            $a = @($wikiMembers.Keys | Where-Object { $ids[$left] -in $wikiMembers[$_] })
            $b = @($wikiMembers.Keys | Where-Object { $ids[$right] -in $wikiMembers[$_] })
            $union = @($a + $b | Sort-Object -Unique)
            $intersection = @($a | Where-Object { $_ -in $b })
            if ($union.Count -gt 0 -and ($intersection.Count / $union.Count) -ge 0.8) { Add-Finding $findings 'warning' 'group_overlap_review_due' "groups/$($ids[$left]).md" "other=$($ids[$right]); overlap=$([math]::Round($intersection.Count / $union.Count, 2))" }
        }
    }
    $findingArray = @($findings.ToArray())
    $errors = @($findingArray | Where-Object { $_.severity -eq 'error' })
    $warnings = @($findingArray | Where-Object { $_.severity -eq 'warning' })
    $nextThresholdReview = @($script:thresholdReviewDeadlines | Sort-Object | Select-Object -First 1)
    $receipt = [pscustomobject][ordered]@{ schema_version = 1; status = if ($errors.Count -eq 0) { 'passed' } else { 'failed' }; summary = [pscustomobject]@{ wiki = $wikiFiles.Count; groups = $groupFiles.Count; errors = $errors.Count; warnings = $warnings.Count; next_threshold_review_at = if ($nextThresholdReview.Count) { $nextThresholdReview[0] } else { $null } }; findings = $findingArray }
    $json = $receipt | ConvertTo-Json -Depth 8
    if (-not [string]::IsNullOrWhiteSpace($OutputPath)) { [IO.File]::WriteAllText((Join-Path $rootPath $OutputPath), ($json + "`n"), (New-Object Text.UTF8Encoding($false))) }
    Write-Output $json
    if ($Mode -eq 'Enforce' -and $errors.Count -gt 0) { exit 1 }
} catch {
    [Console]::Error.WriteLine("WIKI_GROUP_CHECK_FAILED: $($_.Exception.Message) at $($_.InvocationInfo.ScriptName):$($_.InvocationInfo.ScriptLineNumber)")
    exit 2
}
