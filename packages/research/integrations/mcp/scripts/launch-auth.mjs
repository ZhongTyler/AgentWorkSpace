// Keep MCP stdio in Node; PowerShell only decrypts through a private captured pipe.
import {spawnSync} from 'node:child_process';
const [profile,shell,...args]=process.argv.slice(2);
const names={'research-github':'GITHUB_PERSONAL_ACCESS_TOKEN','research-v2ex':'V2EX_API_KEY','research-zhihu':'ZHIHU_ACCESS_SECRET'};
const name=names[profile];
if(!name || !shell){console.error('Missing supported profile or credential reader');process.exit(1)}
const directoryIndex=args.indexOf('--secret-directory');
const directory=directoryIndex>=0?args[directoryIndex+1]:undefined;
let value=process.env[name];
if(!value){
 const code=`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
 $name=$env:RESEARCH_CREDENTIAL_NAME
 $value=[Environment]::GetEnvironmentVariable($name,'User')
 $directory=$env:RESEARCH_SECRET_DIRECTORY
 if(-not $directory){$directory=Join-Path $env:LOCALAPPDATA 'ResearchMCP/secrets'}
 $encrypted=Join-Path $directory ($name+'.dpapi')
 $xml=Join-Path $directory ($name+'.xml')
 if(-not $value -and (Test-Path -LiteralPath $encrypted)){
   Add-Type -AssemblyName System.Security
   $value=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($encrypted),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 } elseif(-not $value -and (Test-Path -LiteralPath $xml)){
   $value=(Import-Clixml -LiteralPath $xml).GetNetworkCredential().Password
 }
 if($value){[Console]::Out.Write($value)}`;
 const result=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',code],{
   encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:32768,
   env:{...process.env,RESEARCH_CREDENTIAL_NAME:name,...(directory?{RESEARCH_SECRET_DIRECTORY:directory}:{})}
 });
 if(result.status!==0){console.error('Local credential reader failed; no credential values printed');process.exit(1)}
 value=result.stdout;
}
if(args.includes('--check')){console.log(value?'True':'False');process.exit(0)}
if(!value){console.error('Missing local credential; Zhihu entry: connect-local.py');process.exit(1)}
process.env[name]=value;
value=null;
try{
 if(profile==='research-v2ex'){
   await import(new URL('./node_modules/mcp-server-v2ex/dist/index.js',import.meta.url));
 }else{
   await import(new URL('./auth-http-bridge.mjs',import.meta.url));
 }
}catch{
 console.error('Research authenticated launcher failed; no credential values printed');process.exit(1)
}
