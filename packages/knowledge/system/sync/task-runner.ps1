param([Parameter(Mandatory=$true)][string]$Config,[Parameter(Mandatory=$true)][ValidateSet('publish-content','pull-compounding')][string]$Direction)
$ErrorActionPreference='Stop'
try {
 $value=Get-Content -Raw -LiteralPath $Config | ConvertFrom-Json
 foreach($entry in $value.clientHashes.PSObject.Properties){
  if($entry.Name -notmatch '^[a-z-]+\.(mjs|ps1)$' -or (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $entry.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value){throw 'Installed client drift'}
 }
 if(-not [IO.Path]::IsPathRooted($value.nodeExecutable)){exit 50}
 & $value.nodeExecutable (Join-Path $PSScriptRoot 'runner.mjs') run $Config $Direction
 exit $LASTEXITCODE
} catch { Write-Output '{"status":"failed","reason":"task_runner_unavailable","exitCode":50}';exit 50 }
