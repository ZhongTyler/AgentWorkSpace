import fs from 'node:fs';
import path from 'node:path';
import {inside,hash,publicUrl} from './core.mjs';

// Static hints only. Never execute a page, access its account data, or load remote resources.
export function archiveInfo(file){
 const full=path.resolve(file);inside(path.dirname(full),path.basename(full));
 const stat=fs.statSync(full);
 if(!stat.isFile()||stat.size>100*1024*1024)throw Error('Expected an HTML file up to 100 MiB');
 if(!['.html','.htm'].includes(path.extname(full).toLowerCase()))throw Error('Expected an HTML archive');
 const bytes=fs.readFileSync(full),html=bytes.toString('utf8');
 const decode=s=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
 const title=decode((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]*>/g,'').trim()).slice(0,200);
 const match=html.match(/\burl:\s*(https?:\/\/[^\r\n<]+)/i);
 let sourceUrl=null;if(match){try{sourceUrl=publicUrl(decode(match[1].trim()));}catch{/* Do not expose an unsafe original URL. */}}
 const resources=[...html.matchAll(/<(?:img|script|iframe|link|source|video|audio)\b[^>]*>/gi)];
 const externalResourceTags=resources.filter(([tag])=>/\b(?:src|href|srcset)\s*=\s*["'][^"']*(?:https?:\/\/|\/\/)/i.test(tag)).length;
 const externalCssUrls=[...html.matchAll(/url\(\s*["']?(?:https?:\/\/|\/\/)/gi)].length;
 return {file:full,bytes:bytes.length,sha256:hash(bytes),title,sourceUrl,
   embeddedImageReferences:[...html.matchAll(/data:image\//gi)].length,externalResourceTags,externalCssUrls,
   scriptTags:[...html.matchAll(/<script\b/gi)].length,requiresBrowserOfflineTest:true,
   limitation:'Static regex hints can miss relative/dynamic references and do not prove complete text, legible images, source identity, or offline usability.'};
}
