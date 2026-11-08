param([Parameter(Mandatory=$true)][string]$Destination,[Parameter(Mandatory=$true)][string]$NodeExecutable,[Parameter(Mandatory=$true)][string]$ContractPath,[Parameter(Mandatory=$true)][string]$BindingPath,[string]$PreviousConfig,[switch]$VerifyOnly,[string]$ToolsRoot)
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent();$sid=$identity.User.Value
$dest=[IO.Path]::GetFullPath($Destination)
if(Test-Path -LiteralPath $dest){throw 'Use a new versioned installation directory; preserve prior installation'}
if(-not [IO.Path]::IsPathRooted($NodeExecutable) -or -not(Test-Path -LiteralPath $NodeExecutable)){throw 'Node runtime unavailable'}
$sourceRepo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$gitArgs=@('-c',('safe.directory='+$sourceRepo),'-C',$sourceRepo)
$runtimeFiles=@('analysis.mjs','analytics-snapshot.mjs','clients.mjs','content-policy.mjs','data-health.mjs','health.mjs','metric-boundary.mjs','private-metadata.mjs','publication-maintenance.mjs','snapshot-admission.mjs','approved-source-projections.mjs','source-url-boundary.mjs','schema-check.mjs','recovery.mjs','resources.mjs','runner.mjs','runtime-closure.mjs','state.mjs','transport.mjs','query-package-sync.mjs','install-local.ps1','task-control.ps1','task-runner.ps1')
$integrationFiles=@('query-package.mjs','query-package-local.mjs')
$relativeFiles=@($runtimeFiles|ForEach-Object {'system/sync/'+$_})+@($integrationFiles|ForEach-Object {'system/integrations/'+$_})
$sourceInventoryPath=Join-Path $PSScriptRoot 'runtime-source-inventory.json'
$sourceInventory=Get-Content -Raw -Encoding UTF8 -LiteralPath $sourceInventoryPath | ConvertFrom-Json
function Assert-PackageSource {
 foreach($relative in $relativeFiles){
  $expected=$sourceInventory.files.PSObject.Properties[$relative].Value
  if($expected -notmatch '^[a-f0-9]{64}$'){throw 'Runtime file missing from package inventory'}
  $file=Join-Path $sourceRepo $relative
  if((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked runtime source refused'}
  if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Runtime source differs from package inventory'}
 }
}
Assert-PackageSource
$sourceCommit=$sourceInventory.source_revision
$packageMarker=Join-Path $sourceRepo '_release.json'
if(Test-Path -LiteralPath $packageMarker){
 $marker=Get-Content -Raw -Encoding UTF8 -LiteralPath $packageMarker | ConvertFrom-Json
 if($marker.component_id -ne 'knowledge' -or ($marker.preview -and -not $VerifyOnly)){throw 'Committed Knowledge package required for installation'}
 $sourceCommit=$marker.source_revision
}

if($sourceCommit -notmatch '^[a-f0-9]{40}$'){throw 'Source revision unavailable'}
$previous=$null
if($PreviousConfig){
 $previousPath=(Resolve-Path -LiteralPath $PreviousConfig).Path
 $previous=Get-Content -Raw -LiteralPath $previousPath | ConvertFrom-Json
 if($previous.schemaVersion -ne 1 -or $previous.principalSid -ne $sid -or -not [IO.Path]::IsPathRooted($previous.privateHome) -or -not(Test-Path -LiteralPath $previous.privateHome -PathType Container) -or -not [IO.Path]::IsPathRooted($previous.toolsRoot)){throw 'Previous installation identity or private home invalid'}
 if((Get-Item -LiteralPath $previous.privateHome).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Previous private home must not be linked'}
 if(-not $previous.jobs.'publish-content' -or -not $previous.jobs.'pull-compounding' -or -not $previous.transport){throw 'Previous job policy missing'}
 $toolsRoot=$previous.toolsRoot
}
if(-not $toolsRoot -or -not [IO.Path]::IsPathRooted($toolsRoot)){throw 'Explicit absolute ToolsRoot or PreviousConfig required'}
$closureInput=@{sourceRoot=$sourceRepo;files=$relativeFiles;toolsRoot=$toolsRoot}|ConvertTo-Json -Compress
$closureOutput=$closureInput | & $NodeExecutable (Join-Path $PSScriptRoot 'runtime-closure.mjs')
if($LASTEXITCODE -ne 0){throw 'Runtime dependency closure failed'}
$closure=$closureOutput | ConvertFrom-Json
if($VerifyOnly){@{sourceCommit=$sourceCommit;sourceRepository=$sourceRepo;runtimeFiles=$runtimeFiles;integrationFiles=$integrationFiles;closure=$closure;previousPrivateHome=if($previous){$previous.privateHome}else{$null};writes=0}|ConvertTo-Json -Depth 8;return}
New-Item -ItemType Directory -Path $dest | Out-Null
$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false)
foreach($principal in @($sid,'S-1-5-18','S-1-5-32-544')){
 $rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($principal),'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $dest -AclObject $acl
$client=Join-Path $dest 'client';$private=Join-Path $dest 'private'
New-Item -ItemType Directory -Path $client | Out-Null
if($previous){$private=$previous.privateHome}else{New-Item -ItemType Directory -Path $private | Out-Null}
$hashes=@{}
foreach($name in $runtimeFiles){
 $file=Join-Path $PSScriptRoot $name
 Copy-Item -LiteralPath $file -Destination (Join-Path $client $name)
 $hashes[$name]=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
 if((Get-FileHash -LiteralPath (Join-Path $client $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hashes[$name]){throw 'Copy hash mismatch'}
}
foreach($name in $integrationFiles){
 $file=Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'integrations') $name
 Copy-Item -LiteralPath $file -Destination (Join-Path $client $name)
 $hashes[$name]=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
 if((Get-FileHash -LiteralPath (Join-Path $client $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hashes[$name]){throw 'Query package copy hash mismatch'}
}
Assert-PackageSource
$installedClosure=@{sourceRoot=$client;files=$relativeFiles;toolsRoot=$toolsRoot;layout='installed'}|ConvertTo-Json -Compress
$installedClosure | & $NodeExecutable (Join-Path $client 'runtime-closure.mjs') | Out-Null
if($LASTEXITCODE -ne 0){throw 'Installed runtime import failed before binding or task registration'}
$contract=(Resolve-Path -LiteralPath $ContractPath).Path
$config=@{schemaVersion=1;sourceCommit=$sourceCommit;principalSid=$sid;nodeExecutable=$NodeExecutable;privateHome=$private;maxPrivateBytes=134217728;toolsRoot=$toolsRoot;clientHashes=$hashes;
 transport=@{kind='ssh_fixed_command';approvedContractPath=$contract;approvedContractSha256=(Get-FileHash -LiteralPath $contract -Algorithm SHA256).Hash.ToLowerInvariant();dedicatedIdentityConfirmed=$false};
 jobs=@{'publish-content'=@{enabled=$false;disabledReason='dedicated_endpoint_and_accepted_snapshot_unconfigured';intervalMinutes=30;offsetMinutes=2;maxDurationMs=300000;maxAttempts=3;failureAlertAfter=3};
 'pull-compounding'=@{enabled=$false;disabledReason='dedicated_endpoint_and_privacy_policy_unconfigured';intervalMinutes=15;offsetMinutes=9;maxDurationMs=300000;maxAttempts=3;failureAlertAfter=3;retentionPolicyConfirmed=$false;improvementUseOnLocalConfirmed=$false;analyticsSnapshotImportConfirmed=$false;controlReceiptConfirmed=$false;allowedNamespaces=@()}}}
if($previous){
 Copy-Item -LiteralPath $previousPath -Destination (Join-Path $dest 'previous-config.json')
 $config=$previous
 $config.sourceCommit=$sourceCommit;$config.nodeExecutable=$NodeExecutable;$config.clientHashes=$hashes
 $config.transport.approvedContractPath=$contract;$config.transport.approvedContractSha256=(Get-FileHash -LiteralPath $contract -Algorithm SHA256).Hash.ToLowerInvariant()
}
$configPath=Join-Path $dest 'config.json';$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding UTF8
$shell=Join-Path $PSHOME 'pwsh.exe';if(-not(Test-Path -LiteralPath $shell)){$shell=Join-Path $PSHOME 'powershell.exe'}
$binding=@{schemaVersion=1;sourceCommit=$sourceCommit;principalSid=$sid;configPath=$configPath;privateHome=$private;clientDirectory=$client;clientHashes=$hashes;powershellExecutable=$shell}
$parent=Split-Path -Parent $BindingPath;if(-not(Test-Path -LiteralPath $parent)){throw 'Existing protected ops state required'}
if(Test-Path -LiteralPath $BindingPath){Copy-Item -LiteralPath $BindingPath -Destination (Join-Path $dest 'previous-binding.json')}
$binding | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $BindingPath -Encoding UTF8
& (Join-Path $client 'task-control.ps1') -Action register -Config $configPath
if(-not $?){throw 'Task registration failed; preserve installation and binding'}
