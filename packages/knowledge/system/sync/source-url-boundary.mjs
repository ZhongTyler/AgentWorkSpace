/** Deterministic public-source projection. Never probe URLs or rewrite provider wire. */
import {createHash} from 'node:crypto';

export const SOURCE_URL_POLICY='wechat-source-query-v1';
export const SOURCE_URL_PARAMETERS=Object.freeze(['pass_ticket','exportkey','abtest_cookie','sessionid']);
const restricted=new Set(SOURCE_URL_PARAMETERS);
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const key=value=>{try{return decodeURIComponent(value.replaceAll('+',' ')).toLowerCase();}catch{return value.toLowerCase();}};
const urls=()=>/https?:\/\/mp\.weixin\.qq\.com(?=[:/?#]|$)[^\s<>"'\\\x00-\x1f]*/gi;

/** Preserve article identity, surviving query bytes/order, fragment and encoding. */
export function projectWeChatURL(value){
 let parsed;try{parsed=new URL(value);}catch{return {url:value,removed:[]};}
 if(parsed.hostname.toLowerCase()!=='mp.weixin.qq.com')return {url:value,removed:[]};
 const query=value.indexOf('?'),fragment=value.indexOf('#');
 if(query<0||fragment>=0&&fragment<query)return {url:value,removed:[]};
 const end=fragment<0?value.length:fragment,parts=value.slice(query+1,end).split(/(&(?:amp;)?)/i),kept=[],removed=[];
 for(let i=0;i<parts.length;i+=2){const raw=parts[i],name=key(raw.split('=',1)[0]);
  if(restricted.has(name)){removed.push(name);continue;}
  kept.push({raw,separator:i?parts[i-1]:''});
 }
 if(!removed.length)return {url:value,removed:[]};
 const next=kept.map((part,i)=>(i?part.separator:'')+part.raw).join('');
 return {url:value.slice(0,query)+(next?'?'+next:'')+value.slice(end),removed:[...new Set(removed)].sort()};
}

/** Findings contain location and field names, never URL/token values. */
export function sourceURLFindings(text){
 const findings=[];for(const match of String(text).matchAll(urls())){const projected=projectWeChatURL(match[0]);
  if(projected.removed.length)findings.push({line:String(text).slice(0,match.index).split('\n').length,parameter_names:projected.removed});
 }return findings;
}

export function assertPublicSourceText(text){
 if(sourceURLFindings(text).length)fail('source_url_parameters_forbidden');
}

/** Only top-frontmatter source URL scalars and source_url lists are editable.
 * Any remaining finding (body, unsupported metadata form) is an exception, not prose repair.
 */
export function projectPublicSource(bytes){
 const original=Buffer.from(bytes),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(original);
 const front=/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
 let header=front?.[0]??'',removed=[],field=null;
 header=header.replace(/^[^\r\n]+/gm,line=>{
  const root=/^([\w-]+):/.exec(line);if(root)field=root[1];
  const list=/^[ \t]+-/.test(line);if(list&&field!=='source_url')return line;
  const scalar=/^([ \t]*(?:source|source_url|url|original_url):[ \t]*|[ \t]+-[ \t]*)(["']?)(https?:\/\/[^\s"'<>]+)\2([ \t]*(?:#[^\r\n]*)?)$/.exec(line);
  if(!scalar)return line;
  const result=projectWeChatURL(scalar[3]);removed.push(...result.removed);
  return scalar[1]+scalar[2]+result.url+scalar[2]+scalar[4];
 });
 const projected=header+text.slice(front?.[0].length??0),exceptions=sourceURLFindings(projected);
 if(exceptions.length){const error=new Error('source_url_manual_review_required');error.code=error.message;error.findings=exceptions;throw error;}
 const output=Buffer.from(projected);
 return {bytes:output,policy:SOURCE_URL_POLICY,source_sha256:hash(original),public_sha256:hash(output),changed:!original.equals(output),removed_parameters:[...new Set(removed)].sort(),body_sha256:hash(Buffer.from(text.slice(front?.[0].length??0)))};
}

/** Final body-only guard, before credential access, reservation or supplier send.
 * Inspect nested text/JSON envelopes without logging values or changing source hashes.
 */
export function assertPublicProviderBody(value){
 const visit=(item,depth=0)=>{
  if(depth>64)fail('source_url_check_depth');
  if(typeof item==='string'){
   assertPublicSourceText(item);
   const trimmed=item.trim();if((trimmed.startsWith('{')&&trimmed.endsWith('}'))||(trimmed.startsWith('[')&&trimmed.endsWith(']'))){let parsed;try{parsed=JSON.parse(trimmed);}catch{return;}visit(parsed,depth+1);}
  }else if(Array.isArray(item)){for(const child of item)visit(child,depth+1);}
  else if(item&&typeof item==='object'){for(const child of Object.values(item))visit(child,depth+1);}
 };visit(value);
}
