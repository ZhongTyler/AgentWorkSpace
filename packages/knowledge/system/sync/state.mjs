import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
export function canonical(value){
 const walk=v=>{if(v===null||typeof v==='boolean'||typeof v==='string')return v;if(typeof v==='number'&&Number.isFinite(v))return v;
  if(Array.isArray(v))return v.map(walk);
  requireValue(v&&Object.getPrototypeOf(v)===Object.prototype,'invalid_json_value');
  const result={};for(const k of Object.keys(v).sort()){requireValue(!['__proto__','constructor','prototype'].includes(k),'invalid_json_key');result[k]=walk(v[k]);}return result;};
 return JSON.stringify(walk(value));
}
export class SyncError extends Error {constructor(code,retryable=false){super(code);this.code=code;this.retryable=retryable;}}
export const requireValue=(ok,code)=>{if(!ok)throw new SyncError(code);};
export const readJson=(file,fallback=null)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')):fallback;
export function atomicJson(file,value){
 ensurePrivateHome(path.dirname(file));
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 requireValue(!fs.existsSync(file)||!fs.lstatSync(file).isSymbolicLink(),'unsafe_state');
 const temp=file+'.'+crypto.randomUUID()+'.tmp',fd=fs.openSync(temp,'wx',0o600);
 try{fs.writeFileSync(fd,canonical(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
export function ensurePrivateHome(home){
 requireValue(typeof home==='string'&&path.isAbsolute(home),'private_home_required');
 let at=path.resolve(home);while(!fs.existsSync(at))at=path.dirname(at);
 requireValue(path.resolve(fs.realpathSync(at)).toLowerCase()===at.toLowerCase(),'unsafe_private_home');
 fs.mkdirSync(home,{recursive:true,mode:0o700});
 requireValue(!fs.lstatSync(home).isSymbolicLink(),'unsafe_private_home');
}
export async function withLock(home,direction,work){
 ensurePrivateHome(home);const file=path.join(home,direction+'.lock'),token=crypto.randomUUID();let fd;
 try{fd=fs.openSync(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new SyncError('lock_busy');throw e;}
 try{fs.writeFileSync(fd,canonical({pid:process.pid,token,startedAt:new Date().toISOString()})+'\n');fs.fsyncSync(fd);return await work();}
 finally{fs.closeSync(fd);if(readJson(file)?.token===token)fs.unlinkSync(file);}
}
// Explicit recovery only. Age alone never proves that the writer is dead.
export function recoverLock(home,direction,token){
 const file=path.join(home,direction+'.lock'),value=readJson(file);
 requireValue(value&&value.token===token&&Number.isSafeInteger(value.pid),'lock_identity_mismatch');
 let dead=false;try{process.kill(value.pid,0);}catch(e){dead=e.code==='ESRCH';}
 requireValue(dead,'lock_owner_not_confirmed_dead');fs.unlinkSync(file);
 return {status:'recovered_dead_lock',direction};
}
export function namespaceKey(ns){
 requireValue(ns&&Object.keys(ns).sort().join(',')==='host,library_id,view'&&Object.values(ns).every(v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v)),'invalid_namespace');
 return hash(canonical(ns));
}
export function scopedFile(root,relative){
 requireValue(typeof relative==='string'&&relative.length<=1024&&!relative.includes('\\')&&!relative.includes('\0')&&!relative.includes(':')&&!relative.startsWith('/')&&!relative.split('/').some(p=>!p||p==='.'||p==='..'),'unsafe_content_path');
 requireValue(path.resolve(fs.realpathSync(root)).toLowerCase()===path.resolve(root).toLowerCase(),'content_symlink');
 const target=path.resolve(root,...relative.split('/'));
 requireValue(target.startsWith(path.resolve(root)+path.sep),'unsafe_content_path');
 let at=target;while(at!==path.resolve(root)){requireValue(!fs.lstatSync(at).isSymbolicLink(),'content_symlink');at=path.dirname(at);}
 requireValue(fs.statSync(target).isFile(),'content_not_regular');return target;
}
