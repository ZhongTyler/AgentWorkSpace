import fs from 'node:fs';
import {safe,sha} from './raw-quality.mjs';

// Only transport differences are equivalent. Metadata, whitespace, prose and
// section moves remain meaningful inputs; no model judgment is inferred here.
export const canonicalInput = bytes => bytes.toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
export const inputFingerprint = (root,p) => sha(canonicalInput(fs.readFileSync(safe(root,p))));

export function wikiHeadings(markdown) {
  const lines=canonicalInput(markdown).replace(/^---\n[\s\S]*?\n---\n/,'').split('\n');
  let fence=null; const headings=[];
  for(let i=0;i<lines.length;i++) {
    const marker=lines[i].match(/^\s*(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;continue;}
    if(fence)continue;
    const h=lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if(h)headings.push({level:h[1].length,title:h[2],line:i});
  }
  return {lines,headings};
}
export function substantiveSection(markdown,heading) {
  const prose=canonicalInput(markdown).replace(/^---\n[\s\S]*?\n---\n/,'').replace(/<!--[\s\S]*?(?:-->|$)/g,'');
  let fence=null;
  const lines=prose.split('\n').map(x=>{
    const marker=x.match(/^\s*(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;return '';}
    return fence?'':x;
  });
  const matches=lines.map((x,i)=>/^#{1,6} /.test(x)&&x.replace(/^#+\s*/,'')===heading?i:-1).filter(i=>i>=0);
  if(matches.length>1)throw Error(`Ambiguous substantive Wiki heading: ${heading}`);
  const start=matches[0]??-1;
  if(start<0||['来源','相关页面'].includes(heading))throw Error(`Missing substantive Wiki heading: ${heading}`);
  const depth=lines[start].match(/^#+/)[0].length;let end=start+1;
  while(end<lines.length&&!(new RegExp('^#{1,'+depth+'} ')).test(lines[end]))end++;
  return lines.slice(start+1,end).filter(x=>!/^\s*(?:>|-\s*\[\[raw-sources\/)/.test(x)).join('\n');
}
export function checkWikiInput(root,page,scope) {
  const markdown=canonicalInput(fs.readFileSync(safe(root,page)));
  const {lines,headings}=wikiHeadings(markdown);
  const h2=headings.filter(h=>h.level===2),footer=new Set(['来源','相关页面']);
  for(const name of footer){
    const matches=h2.filter(h=>h.title===name);
    if(matches.length>1)throw Error(`Duplicate footer: ${page} ${name}`);
    if(matches.length&&h2.some(h=>h.line>matches[0].line&&!footer.has(h.title)))throw Error(`${name==='来源'?'source_section_not_footer':'related_pages_not_footer'}: ${page}`);
  }
  for(const row of scope)for(const d of row.decisions)for(const to of d.destinations){
    const matches=headings.filter(h=>h.title===to.heading);
    if(matches.length!==1||footer.has(to.heading))throw Error(`Missing or ambiguous destination heading: ${page} ${to.heading}`);
    const h=matches[0],end=headings.find(x=>x.line>h.line&&x.level<=h.level)?.line??lines.length;
    const body=lines.slice(h.line+1,end).join('\n');
    if(body.trim().length<12)throw Error(`Empty destination section: ${page} ${to.heading}`);
    // Delivery can use a plan without a quote. Once supplied, it must be exact.
    if(to.quote!==undefined&&!(d.disposition==='planned'&&to.quote==='')&&(!to.quote.trim()||!substantiveSection(markdown,to.heading).includes(canonicalInput(to.quote))))throw Error(`Destination quote not found: ${page} ${to.heading}`);
  }
}

export function decisionFingerprint(scope){
  // planned -> absorbed is execution bookkeeping. Both are reviewed against
  // actual delivered prose. Changed headings/reasons/claims/conditions invalidate.
  const normalized=scope.map(row=>({...row,decisions:row.decisions.map(d=>({...d,
    disposition:d.disposition==='planned'?'absorbed':d.disposition,
    destinations:d.destinations.map(({quote,...to})=>to)
  }))}));
  return sha(JSON.stringify(normalized));
}
