param([Parameter(Mandatory=$true)][ValidateSet('register','status','enable','disable','uninstall','restore')][string]$Action,[Parameter(Mandatory=$true)][string]$Config,[ValidateSet('publish-content','pull-compounding')][string]$Direction,[switch]$ReadOnly)
$ErrorActionPreference='Stop'
$taskPath='\Tyler\KnowledgeSync\'
$configPath=(Resolve-Path -LiteralPath $Config).Path
$value=Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$identity=[Security.Principal.WindowsIdentity]::GetCurrent();$sid=$identity.User.Value
if($value.schemaVersion -ne 1 -or $value.principalSid -ne $sid){throw 'Configured login SID mismatch'}
if($configPath.Contains('"') -or $PSScriptRoot.Contains('"')){throw 'Unsafe task argument'}
$receiptRoot=Join-Path $value.privateHome 'scheduler'
if(-not $ReadOnly){New-Item -ItemType Directory -Force -Path $receiptRoot | Out-Null}
if($ReadOnly -and $Action -ne 'status'){throw 'Read-only mode only permits status'}
$owner='knowledge-local-sync-client-v1'
$directions=if($Direction){@($Direction)}else{@('publish-content','pull-compounding')}
if($Action -eq 'enable'){
 $ready=& $value.nodeExecutable (Join-Path $PSScriptRoot 'runner.mjs') readiness $configPath | ConvertFrom-Json
 if($LASTEXITCODE -ne 0){throw 'Readiness failed'}
 foreach($selected in $directions){if($ready.$selected.ready -ne $true){throw 'Required endpoint/snapshot/policy binding is not ready'}}
}
$rows=@()
foreach($direction in $directions){
 $name='Knowledge-'+$direction
 $existing=Get-ScheduledTask -TaskName $name -TaskPath $taskPath -ErrorAction SilentlyContinue
 if($existing -and $existing.Description -ne $owner){throw 'Task name owned by another installer'}
 $backup=Join-Path $receiptRoot ($direction+'.before.xml')
 if($existing -and $Action -eq 'register' -and -not (Test-Path -LiteralPath $backup)){Export-ScheduledTask -TaskName $name -TaskPath $taskPath | Set-Content -LiteralPath $backup -Encoding UTF8}
 if($Action -eq 'register'){
  # Register disabled first. InteractiveToken needs the same logged-in user;
  # it never stores a password or promises that a locked SSH key is usable.
  $job=$value.jobs.$direction
  if($job.intervalMinutes -lt 5 -or $job.intervalMinutes -gt 1440){throw 'Invalid interval'}
  $start=(Get-Date).Date.AddMinutes([int]$job.offsetMinutes)
  $trigger=New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Minutes $job.intervalMinutes)
  $settings=New-ScheduledTaskSettingsSet -Disable -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds ([Math]::Ceiling($job.maxDurationMs/1000)+30)) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RunOnlyIfNetworkAvailable -Hidden
  $principal=New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
  $arguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "'+(Join-Path $PSScriptRoot 'task-runner.ps1')+'" -Config "'+$configPath+'" -Direction '+$direction
  $exec=New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $arguments
  if(-not (Test-Path -LiteralPath $exec.Execute)){$exec=New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'pwsh.exe') -Argument $arguments}
  Register-ScheduledTask -TaskPath $taskPath -TaskName $name -Action $exec -Trigger $trigger -Settings $settings -Principal $principal -Description $owner -Force -ErrorAction Stop | Out-Null
  $registered=Get-ScheduledTask -TaskName $name -TaskPath $taskPath -ErrorAction Stop
  if($registered.Description -ne $owner -or $registered.Settings.Enabled){throw 'Disabled registration readback mismatch'}
 }
 if($Action -eq 'enable'){
  Enable-ScheduledTask -TaskName $name -TaskPath $taskPath | Out-Null
  # A task disabled across its trigger need not be queued by Windows. Start
  # the first ready run explicitly; IgnoreNew and the file lock still apply.
  Start-ScheduledTask -TaskName $name -TaskPath $taskPath -ErrorAction Stop
 }
 if($Action -eq 'restore'){
  $restoreFile=Join-Path $receiptRoot ($direction+'.removed.xml')
  if(-not(Test-Path -LiteralPath $restoreFile)){$restoreFile=$backup}
  [xml]$xml=Get-Content -Raw -LiteralPath $restoreFile
  if($xml.Task.RegistrationInfo.Description -ne $owner){throw 'Restore owner mismatch'}
  $xml.Task.Settings.Enabled='false'
  Register-ScheduledTask -TaskName $name -TaskPath $taskPath -Xml $xml.OuterXml -Force -ErrorAction Stop | Out-Null
 }
 if($Action -eq 'disable' -and $existing){Disable-ScheduledTask -TaskName $name -TaskPath $taskPath | Out-Null}
 if($Action -eq 'uninstall' -and $existing){
  Export-ScheduledTask -TaskName $name -TaskPath $taskPath | Set-Content -LiteralPath (Join-Path $receiptRoot ($direction+'.removed.xml')) -Encoding UTF8
  Unregister-ScheduledTask -TaskName $name -TaskPath $taskPath -Confirm:$false
 }
 $current=Get-ScheduledTask -TaskName $name -TaskPath $taskPath -ErrorAction SilentlyContinue
 $info=if($current){Get-ScheduledTaskInfo -TaskName $name -TaskPath $taskPath}else{$null}
 $matched=$false
 if($current){try{$principalName=$current.Principal.UserId;if($principalName -notmatch '[\\@]' -and $principalName -notmatch '^S-1-'){$principalName=$env:COMPUTERNAME+'\'+$principalName};$account=[Security.Principal.NTAccount]::new($principalName);$matched=($account.Translate([Security.Principal.SecurityIdentifier]).Value -eq $sid)}catch{$matched=($current.Principal.UserId -eq $sid)}}
 $rows+=@{direction=$direction;taskName=$name;taskPath=$taskPath;installed=($null -ne $current);enabled=if($current){[bool]$current.Settings.Enabled}else{$false};principalMatched=$matched;lastTaskResult=if($info){$info.LastTaskResult}else{$null};lastRunTime=if($info){$info.LastRunTime.ToUniversalTime().ToString('o')}else{$null};nextRunTime=if($info){$info.NextRunTime.ToUniversalTime().ToString('o')}else{$null};startWhenAvailable=if($current){[bool]$current.Settings.StartWhenAvailable}else{$null};multipleInstances=if($current){[string]$current.Settings.MultipleInstances}else{$null}}
}
$result=@{schemaVersion=1;owner=$owner;at=(Get-Date).ToUniversalTime().ToString('o');action=$Action;jobs=$rows}
if(-not $ReadOnly){$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $receiptRoot 'last-readback.json') -Encoding UTF8}
$result | ConvertTo-Json -Depth 5
