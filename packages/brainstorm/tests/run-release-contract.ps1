[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$utf8 = New-Object Text.UTF8Encoding($false)
function Assert-Package { param([bool]$Condition,[string]$Message) if(-not $Condition){throw "Release contract: $Message"} }
function Invoke-Json { param([string]$Name,[string[]]$Arguments)
 $out = @(& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\$Name") @Arguments)
 Assert-Package ($LASTEXITCODE -eq 0) "Runtime command failed: $Name"
 return (($out -join [Environment]::NewLine) | ConvertFrom-Json)
}
function Hash-File {
 param([string]$Path)
 $s=[IO.File]::OpenRead($Path);$h=[Security.Cryptography.SHA256]::Create()
 try{return ([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','')}finally{$h.Dispose();$s.Dispose()}
}
function Snapshot { param([string]$Path)
 return @((Get-ChildItem -LiteralPath $Path -Recurse -File -Force) | ForEach-Object { $_.FullName+'='+ (Hash-File $_.FullName) } | Sort-Object)
}
$before = Snapshot $root
Assert-Package (Test-Path -LiteralPath (Join-Path $root '_release.json')) 'Build marker missing.'
foreach($forbidden in @('workspace\sessions','docs\audits','docs\learning-records','docs\research\sources.json','docs\research\source-registry.md','release-input','templates\session-auto-report.md','templates\fromdemotospec-handoff-v1.md')){
 Assert-Package (-not(Test-Path -LiteralPath (Join-Path $root $forbidden))) "Private or retired path: $forbidden"
}
foreach($required in @('scripts\resume-session.ps1','scripts\method-learning.mjs','scripts\brainstorm-analysis-adapter.mjs','templates\perspective-review.md','docs\research\public-sources.json','examples\co-creation\game-open.md')){
 Assert-Package (Test-Path -LiteralPath (Join-Path $root $required)) "Missing runtime/content: $required"
}
$public = [IO.File]::ReadAllText((Join-Path $root 'docs\research\public-sources.json'),$utf8) | ConvertFrom-Json
foreach($source in $public.sources){Assert-Package (-not ($source.PSObject.Properties.Name -contains 'notes')) 'Private source notes leaked.'}
$methods = Invoke-Json 'validate-method.ps1' @()
Assert-Package ($methods.ready_count -eq 15 -and $methods.placeholder_count -eq 4) 'Method inventory drift.'
$perspectives = [IO.File]::ReadAllText((Join-Path $root 'perspectives\catalog.json'),$utf8) | ConvertFrom-Json
Assert-Package (@($perspectives.perspectives).Count -eq 12) 'Perspective inventory drift.'
$playbooks = Invoke-Json 'validate-playbook.ps1' @()
$adapters = Invoke-Json 'validate-adapters.ps1' @()
Assert-Package ($playbooks.structure_passed -and $adapters.structure_passed -and $adapters.adapter_count -eq 3) 'Catalog validation failed.'
# All Markdown local links must remain inside the package and resolve.
foreach($file in Get-ChildItem -LiteralPath $root -Filter '*.md' -File -Recurse){
 $content = [IO.File]::ReadAllText($file.FullName,$utf8)
 foreach($match in [regex]::Matches($content,'\[[^\]]*\]\(([^)]+)\)')){
  $link = $match.Groups[1].Value.Trim('<','>').Split('#')[0]
  if([string]::IsNullOrWhiteSpace($link) -or $link -match '^[A-Za-z][A-Za-z0-9+.-]*:' -or $link -match '^\{\{[A-Z_]+\}\}$'){continue}
  $target = [IO.Path]::GetFullPath((Join-Path $file.DirectoryName $link))
  Assert-Package ($target.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) "Escaping link: $($file.Name): $link"
  Assert-Package (Test-Path -LiteralPath $target) "Broken link: $($file.FullName): $link"
 }
}
$systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = Join-Path $systemTemp ('brainstorm-release-runtime-'+[guid]::NewGuid().ToString('N'))
try{
 $created = Invoke-Json 'new-session.ps1' @('-Title','Synthetic release smoke','-Goal','Compare concrete options','-OutputRoot',$temp)
 $session = [string]$created.session_path
 $statePath = Join-Path $session 'session-state.json'
 $state = [IO.File]::ReadAllText($statePath,$utf8) | ConvertFrom-Json
 Assert-Package ($state.schema_version -eq 2 -and $state.run_mode -ceq 'cocreate' -and $state.pruning_authority -ceq 'confirm') 'New session must use current schema and bounded authority.'
 $resume = Invoke-Json 'resume-session.ps1' @('-SessionPath',$session,'-SessionRoot',$temp)
 Assert-Package (-not $resume.changed -and -not $resume.execution_started) 'Read resume may not execute.'
 $null = Invoke-Json 'set-session-phase.ps1' @('-SessionPath',$session,'-SessionRoot',$temp,'-Phase','paused','-AiResponsibility','Preserve alternatives','-UserAction','Await actual decision','-NextStep','Wait at current boundary','-CurrentFocus','Unselected options','-PauseBoundary','Do not start prototype without user decision')
 $null = Invoke-Json 'set-session-state.ps1' @('-SessionPath',$session,'-ToState','paused')
 $paused = Snapshot $temp
 $resume = Invoke-Json 'resume-session.ps1' @('-SessionPath',$session,'-SessionRoot',$temp)
 Assert-Package ($resume.status -ceq 'paused' -and $resume.waiting_boundary -and $resume.pruning_authority -ceq 'confirm') 'Paused boundary or authority lost.'
 Assert-Package ($resume.current.pause_boundary -ceq 'Do not start prototype without user decision') 'Pause boundary changed.'
 Assert-Package (@($resume.decision_history).Count -eq 0 -and -not $resume.execution_started) 'Resume invented adoption or execution.'
 Assert-Package ((($paused -join '|') -ceq ((Snapshot $temp) -join '|'))) 'Resume modified session or index.'
 $null = Invoke-Json 'validate-session.ps1' @('-SessionPath',$session,'-SessionRoot',$temp)
 # Force missing module via the public API, without relying on machine-installed dependencies.
 $binding = ([uri](Join-Path $root 'scripts\game-analysis-decision-v2-binding.mjs')).AbsoluteUri
 $inputPath = Join-Path $root 'examples\game-analysis-decision\request-v2.json'
 $js = 'import fs from "node:fs"; import {pathToFileURL} from "node:url"; const m=await import(process.argv[2]); const v=JSON.parse(fs.readFileSync(process.argv[3],"utf8")); console.log(JSON.stringify(await m.prepareRequestV2(v,{moduleUrl:pathToFileURL(process.argv[4])})));'
 $jsPath = Join-Path $temp 'check-gameAnalysisDecision.mjs'
 [IO.File]::WriteAllText($jsPath,$js,$utf8)
 $missingModule = Join-Path $temp 'missing-adapter-v2.mjs'
 $gameAnalysisDecisionText = @(& node $jsPath $binding $inputPath $missingModule)
 Assert-Package ($LASTEXITCODE -eq 0) 'GameAnalysisDecision unavailable runtime failed.'
 $gameAnalysisDecision = ($gameAnalysisDecisionText -join '') | ConvertFrom-Json
 Assert-Package ($gameAnalysisDecision.game_analysis_decision_status -ceq 'unavailable' -and -not $gameAnalysisDecision.host_write -and -not $gameAnalysisDecision.formal_decision_written) 'Missing GameAnalysisDecision must be explicit and read-only.'
 Write-Output 'Runtime PASS: create -> resume -> pause -> read-resume preserves state, adoption and waiting boundary; GameAnalysisDecision unavailable is explicit.'
}finally{
 $resolved=[IO.Path]::GetFullPath($temp)
 Assert-Package ($resolved.StartsWith($systemTemp,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved).StartsWith('brainstorm-release-runtime-')) 'Unsafe temporary cleanup.'
 if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
Assert-Package ((($before -join '|') -ceq ((Snapshot $root) -join '|'))) 'Package runtime smoke polluted the package.'
Write-Output 'Release package contract: PASS (structure and runtime only; semantic and real-user outcomes are not established).'
