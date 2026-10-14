// Read-only v1 release/installation checks, shared by the copied project template.
import fs from 'node:fs';
import path from 'node:path';

export function inspectReleases({root,config,catalog,file,hash,inside}) {
 const errors=[],warnings=[],receipts=new Map(),expected=new Map(),seen=new Map();
 const attempt=fn=>{try{fn();}catch(e){errors.push(e.message);}};
 for(const a of catalog.assets)if(a.desired_release!==null)attempt(()=>{
  const p=a.desired_release;
  if(a.stage!=='ready'||!p?.startsWith(config.assets.directory+'/releases/'))throw Error('desired release requires ready asset and workbench path: '+a.id);
  const r=JSON.parse(fs.readFileSync(file(p),'utf8')),base=path.posix.dirname(p);
  if(r.contract!=='gamepresentation-release-v1'||!Array.isArray(r.assets)||!Array.isArray(r.bindings))throw Error('invalid release: '+p);
  if(!/^[a-z][a-z0-9-]{0,47}$/.test(r.bundle)||!/^[a-z][a-z0-9-]{0,47}$/.test(r.revision)||p!==config.assets.directory+'/releases/'+r.bundle+'/'+r.revision+'/release.json')throw Error('release identity/path mismatch');
  for(const [rel,h] of Object.entries(r.files??{})){inside(path.dirname(file(p)),rel);hash(base+'/'+rel,h);}
  const binding=r.bindings.find(b=>b.id===a.id),asset=r.assets.find(x=>x.asset_id===a.id);
  if(!binding||!asset||asset.purpose!==a.purpose||binding.purpose!==a.purpose||binding.spec!==a.spec||JSON.stringify(binding.source)!==JSON.stringify(a.source)||JSON.stringify(binding.delivery)!==JSON.stringify(a.delivery??null))throw Error('stale release binding: '+a.id);
  hash(a.spec,binding.gate_evidence.spec_sha256);
  for(const key of ['concept','purpose','technical','rights']){
   const gate=a.gates?.[key];if(gate?.status!=='pass'||!gate.evidence?.length)throw Error('release gate no longer approved: '+a.id);
   for(const e of gate.evidence)hash(e,binding.gate_evidence.evidence[e]);
  }
  hash(binding.input.path,binding.input.sha256);
  for(const [e,h] of Object.entries(binding.gate_evidence.evidence))hash(e,h);
  if(r.files[asset.path]!==asset.delivered_sha256)throw Error('release media hash inconsistent');
  const install=config.engine.directory+'/assets/project/'+r.bundle+'/receipt.json';
  const group=expected.get(install)??{r,items:[]};
  if(group.r.revision!==r.revision)throw Error('mixed desired versions in bundle');
  group.items.push({a,p,asset});expected.set(install,group);
 });
 const base=config.engine.directory+'/assets/project',dir=inside(root,base);
 if(fs.existsSync(dir))for(const e of fs.readdirSync(dir,{withFileTypes:true}))if(e.isDirectory())attempt(()=>{
  const p=base+'/'+e.name+'/receipt.json';
  if(!fs.existsSync(inside(root,p)))return; // Unowned media is caught by the enclosing runtime scan.
  const r=JSON.parse(fs.readFileSync(file(p),'utf8'));
  if(r.contract!=='gamepresentation-project-install-v1'||r.bundle!==e.name||!Array.isArray(r.assets))throw Error('invalid workbench install receipt');
  for(const [rel,h] of Object.entries(r.files??{})){inside(path.dirname(file(p)),rel);hash(path.posix.dirname(p)+'/'+rel,h);}
  if(r.assets.length&&!expected.has(p))throw Error('installed bundle has no desired project mapping: '+p);
  for(const a of r.assets){
   const desired=expected.get(p)?.items.find(i=>i.a.id===a.asset_id);
   if(!desired)throw Error('unregistered workbench installed asset: '+a.asset_id);
   if(r.files[a.path]!==a.delivered_sha256)throw Error('installed media hash inconsistent');
   if(a.release?.revision!==expected.get(p).r.revision||a.delivered_sha256!==desired.asset.delivered_sha256)warnings.push('desired/installed drift: '+a.asset_id);
   else hash(desired.p,a.release?.sha256);
  }
  receipts.set(p,r);seen.set(p,r.assets.map(a=>a.asset_id));
 });
 for(const [p,group] of expected)for(const {a} of group.items)if(!seen.get(p)?.includes(a.id))warnings.push('desired asset not installed: '+a.id);
 return {errors,warnings,receipts};
}
