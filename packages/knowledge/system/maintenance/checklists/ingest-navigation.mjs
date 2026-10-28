import fs from 'node:fs';
import path from 'node:path';
import {safe} from './raw-quality.mjs';
import {splitRaw} from './ingest-review-support.mjs';

// Derived navigation only: never create a domain or touch its principles.
export function syncNavigation(root,pages){
  const edits=new Map(),owned=new Set();
  const read=p=>edits.get(p)??fs.readFileSync(safe(root,p),'utf8');
  const append=(p,heading,line,present)=>{
    const text=read(p);owned.add(p);
    const escaped=heading.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const section=new RegExp('(^## '+escaped+'\\r?\\n)([\\s\\S]*?)(?=^## |$(?![\\s\\S]))','m');
    const found=text.match(section);
    if(!found)throw Error('Navigation section missing: '+p+' / '+heading);
    if(present(found[2]))return;
    edits.set(p,text.replace(section,(whole,h,b,offset)=>h+b.trimEnd()+'\n\n'+line+(offset+whole.length===text.length?'\n':'\n\n')));
  };
  for(const p of [...new Set(pages)].sort()){
    if(!/^wiki\/[^/\\]+\.md$/.test(p)||p==='wiki/README.md')throw Error('Invalid Wiki navigation target: '+p);
    const name=path.posix.basename(p,'.md'),text=read(p),field=splitRaw(text).fields.domains??'';
    const match=field.match(/^domains:\s*\[([^\]]+)\]\s*$/);
    if(!match)throw Error('Wiki navigation requires explicit inline domain choices: '+p);
    const domains=match[1].split(',').map(s=>s.trim().replace(/^['"]|['"]$/g,''));
    for(const d of domains){
      if(!d||/[\/\\\r\n]/.test(d)||d==='README')throw Error('Invalid existing domain: '+d);
      const target='../'+p;
      append('domains/'+d+'.md','相关 Wiki 页面',`- [${name}](<${target}>)`,s=>s.includes('('+target+')')||s.includes('(<'+target+'>)'));
    }
    append('system/registry/index.md','Wiki 页面',`- \`${p}\``,s=>s.includes('`'+p+'`'));
    append('system/registry/quick-reference.md','Wiki','- '+name,s=>s.split(/\r?\n/).some(l=>l.trim()==='- '+name));
  }
  const changed=[];
  // Validate all sections before the first write; independent files are resumable.
  for(const [p,bytes] of edits){const full=safe(root,p),temporary=full+'.pending';safe(root,temporary,false);fs.writeFileSync(temporary,bytes);fs.renameSync(temporary,full);changed.push(p);}
  return {changed,paths:[...owned].sort()};
}
