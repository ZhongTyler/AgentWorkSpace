param(
    [Parameter(Mandatory=$true)][ValidateSet('research-github','research-v2ex','research-zhihu')][string]$Server,
    [Parameter(Mandatory=$true)][string]$Runtime,
    [Parameter(Mandatory=$true)][string]$Node,
    [string]$SecretDirectory = (Join-Path $env:LOCALAPPDATA 'ResearchMCP/secrets'),
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
$names = @{ 'research-github'='GITHUB_PERSONAL_ACCESS_TOKEN'; 'research-v2ex'='V2EX_API_KEY'; 'research-zhihu'='ZHIHU_ACCESS_SECRET' }
$name = $names[$Server]
$value = [Environment]::GetEnvironmentVariable($name, 'Process')
if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, 'User') }
$credentialPath = Join-Path $SecretDirectory ($name + '.xml')
$encryptedPath = Join-Path $SecretDirectory ($name + '.dpapi')
if (-not $value -and (Test-Path -LiteralPath $encryptedPath)) {
    Add-Type -AssemblyName System.Security
    $value = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect(
        [IO.File]::ReadAllBytes($encryptedPath), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))
} elseif (-not $value -and (Test-Path -LiteralPath $credentialPath)) {
    $credential = Import-Clixml -LiteralPath $credentialPath
    $value = $credential.GetNetworkCredential().Password
}
if ($Check) { Write-Output ([bool]$value); exit 0 }
if (-not $value) { throw "Missing local credential for $Server; save the local credential first (Zhihu: connect-local.py)" }
try {
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    if ($Server -eq 'research-v2ex') {
        & $Node (Join-Path $Runtime 'node_modules/mcp-server-v2ex/dist/index.js')
    } else {
        & $Node (Join-Path $Runtime 'auth-http-bridge.mjs') $Server
    }
    $code = $LASTEXITCODE
} finally {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    $value = $null
}
exit $code
