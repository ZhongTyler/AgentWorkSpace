// Test preload only. Never installed globally; a normal chart does not need it.
const deny = () => { throw new Error('network_or_subprocess_attempted_during_offline_test'); };
for (const [name, methods] of Object.entries({
  http:['request','get'], https:['request','get'],
  net:['connect','createConnection'], tls:['connect'], dgram:['createSocket'],
  dns:['lookup','resolve','resolve4','resolve6'],
  child_process:['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']
})) {
  const mod=require('node:'+name);
  for(const key of methods)mod[key]=deny;
}
globalThis.fetch=deny;
globalThis.WebSocket=class { constructor(){deny();} };
require('node:module').syncBuiltinESMExports();
