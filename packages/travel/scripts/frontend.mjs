// Optional custom-frontend adapter. No project scripts, network or accounts are executed.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inside,read,write,hash,inputHash,loadTrip,now} from './lib/core.mjs';
import {projection,sync} from './lib/generate.mjs';

const ownFile=fileURLToPath(import.meta.url),marker='__TRAVEL_DATA__';
const unsafe=new Set(['__proto__','prototype','constructor']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function valuesAt(value,field){
  if(typeof field!=='string'||!field.split('.').every(p=>/^[a-zA-Z][a-zA-Z0-9_]*(\[\])?$/.test(p)&&!unsafe.has(p.replace('[]',''))))throw Error('Invalid field path: '+field);
  return field.split('.').reduce((items,part)=>items.flatMap(item=>{
    const array=part.endsWith('[]'),key=array?part.slice(0,-2):part,v=item?.[key];
    if(array){if(v===undefined)return [];if(!Array.isArray(v))throw Error('Expected array at '+field);return v;}
    return [v];
  }),[value]);
}
function requireKeys(object,allowed,label){
  if(!object||typeof object!=='object'||Array.isArray(object))throw Error('Expected object: '+label);
  for(const key of Object.keys(object))if(!allowed.includes(key))throw Error('Unknown '+label+' field: '+key);
}
function viewsCheck(views){
  if(!Array.isArray(views)||!views.length)throw Error('At least one view/check is required');
  for(const v of views){
    requireKeys(v,['hash','checks'],'view');
    if(typeof v.hash!=='string'||!v.hash.startsWith('#')||!v.checks?.length)throw Error('Each view needs a hash and checks');
    for(const c of v.checks){
      requireKeys(c,['selector','count','includes','excludes','visible'],'DOM check');
      if(typeof c.selector!=='string'||!c.selector||!['count','includes','excludes','visible'].some(k=>k in c))throw Error('DOM check needs selector and expectation');
      if('count'in c&&(!Number.isInteger(c.count)||c.count<0))throw Error('Invalid DOM count');
      for(const k of ['includes','excludes'])if(k in c&&(typeof c[k]!=='string'||!c[k]))throw Error('Invalid DOM text expectation');
      if('visible'in c&&typeof c.visible!=='boolean')throw Error('Invalid DOM visibility');
    }
  }
}
export function loadContract(project){
  const contract=read(inside(project,'frontend/contract.json'));
  requireKeys(contract,['version','baseline','template','output','spec','fixtures','tokenFile','tokens','bindings','widths','views'],'contract');
  if(contract.version!==1||typeof contract.baseline!=='string'||!contract.baseline.trim())throw Error('Contract version/baseline required');
  for(const k of ['template','output','spec','fixtures','tokenFile']){
    const f=contract[k];if(typeof f!=='string'||!f.startsWith('frontend/'))throw Error(k+' must stay in frontend/');inside(project,f);inside(inside(project,'frontend'),f.slice('frontend/'.length));
  }
  if(!contract.output.endsWith('.html')||new Set([contract.template,contract.spec,contract.fixtures,contract.output]).size!==4||contract.output===contract.tokenFile)throw Error('Output must be a distinct HTML artifact');
  if(!Array.isArray(contract.tokens)||!contract.tokens.length||!contract.tokens.every(t=>/^--[a-z][a-z0-9-]*$/.test(t)))throw Error('Declare CSS token names, not copied values');
  if(!Array.isArray(contract.widths)||![320,390].every(w=>contract.widths.includes(w))||!contract.widths.some(w=>w>=1280)||!contract.widths.every(w=>Number.isInteger(w)&&w>=320&&w<=3840))throw Error('Widths must include 320, 390 and desktop >=1280');
  if(!Array.isArray(contract.bindings)||!contract.bindings.length)throw Error('Declare source/projection/component bindings');
  const ids=new Set();
  for(const b of contract.bindings){
    requireKeys(b,['id','component','source','projection','transform','required','maxChars','multiline'],'binding');
    if(typeof b.id!=='string'||ids.has(b.id)||!b.id||typeof b.component!=='string'||!b.component)throw Error('Binding IDs/components must be explicit and unique');ids.add(b.id);
    valuesAt({},b.projection);if(b.source)valuesAt({},b.source);
    if(!['identity','pending','derived'].includes(b.transform))throw Error('Unsupported binding transform');
    if(b.transform!=='derived'&&!b.source)throw Error('Copied/transformed binding needs source');
    if(b.maxChars!==undefined&&(!Number.isInteger(b.maxChars)||b.maxChars<1))throw Error('Invalid character limit');
    for(const k of ['required','multiline'])if(k in b&&typeof b[k]!=='boolean')throw Error('Invalid binding '+k);
  }
  viewsCheck(contract.views);
  const fixtures=read(inside(project,contract.fixtures));
  if(!Array.isArray(fixtures)||!fixtures.length)throw Error('Representative fixtures required');
  const states=new Set(),caseIds=new Set();
  for(const f of fixtures){
    requireKeys(f,['id','state','patch','views'],'fixture');
    if(!/^[a-z0-9-]+$/.test(f.id)||caseIds.has(f.id))throw Error('Fixture IDs must be unique portable names');caseIds.add(f.id);
    if(!['populated','empty','missing','long-text'].includes(f.state))throw Error('Unknown fixture state');states.add(f.state);
    requireKeys(f.patch,Object.keys(loadTrip(project)).concat(['weather','overviews']),'fixture patch');
    viewsCheck(f.views);
  }
  if(['populated','empty','missing','long-text'].some(s=>!states.has(s)))throw Error('Fixtures must cover populated, empty, missing and long-text');
  return {contract,fixtures};
}
export function inspectBindings(trip,data,contract){
  const errors=[];
  for(const b of contract.bindings){
    const vals=valuesAt(data,b.projection);
    if(b.required&&vals.some(v=>v===undefined||v===null||v===''))errors.push(b.id+': required value missing');
    for(const v of vals)if(typeof v==='string'){
      if(b.maxChars&&[...v].length>b.maxChars)errors.push(b.id+': maxChars exceeded');
      if(b.multiline===false&&/[\r\n]/.test(v))errors.push(b.id+': unexpected newline');
    }
    if(b.transform!=='derived'){
      const source=valuesAt(trip,b.source),expected=b.transform==='pending'?source.map(v=>v==='pending'):source;
      if(!same(expected,vals))errors.push(b.id+': source/projection mismatch');
    }
  }
  return errors;
}
function inputs(project,contract){
  const files=[...new Set(['frontend/contract.json',contract.template,contract.spec,contract.fixtures,contract.tokenFile])];
  return {sourceHash:inputHash(project),adapterHash:hash(fs.readFileSync(ownFile)),files:Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(inside(project,f)))]))};
}
export function renderTemplate(template,data){
  if(template.split(marker).length!==2)throw Error('Template must contain exactly one '+marker+' JSON marker');
  if(!/<script\b(?=[^>]*\btype\s*=\s*["']application\/json["'])[^>]*>\s*__TRAVEL_DATA__\s*<\/script>/i.test(template))throw Error('JSON marker must occupy an application/json script');
  const json=JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  // Literal replacement: data containing $& must never reinsert the marker.
  return template.replace(marker,()=>json);
}
export function frontendCheck(project,{artifact=true}={}){
  const {contract,fixtures}=loadContract(project),errors=[];
  const data=read(inside(project,'generated/data.json')),expected=projection(project);
  if(!same(data,expected))errors.push('generated/data.json is stale or edited; run sync/build');
  errors.push(...inspectBindings(loadTrip(project),data,contract));
  const tokens=fs.readFileSync(inside(project,contract.tokenFile),'utf8');
  for(const token of contract.tokens)if(!new RegExp(token+'\\s*:').test(tokens))errors.push('Missing CSS token '+token);
  const template=fs.readFileSync(inside(project,contract.template),'utf8');renderTemplate(template,data);
  const current=inputs(project,contract);
  if(artifact){
    const output=inside(project,contract.output),receiptFile=inside(project,'frontend/receipt.json');
    if(!fs.existsSync(receiptFile)||!fs.existsSync(output))errors.push('Custom frontend not built');
    else{
      const receipt=read(receiptFile);
      if(!same(receipt.inputs,current)||receipt.artifactHash!==hash(fs.readFileSync(output)))errors.push('Custom frontend is stale or edited');
    }
  }
  return {valid:!errors.length,errors,baseline:contract.baseline,inputs:current,fixtures:fixtures.length,browserChecked:false,humanApproval:'not-asserted'};
}
export function frontendBuild(project){
  // Build only the documented self-contained template; never run an unknown project builder.
  sync(project);
  const check=frontendCheck(project,{artifact:false});if(!check.valid)throw Error(check.errors.join('\n'));
  const {contract}=loadContract(project),data=read(inside(project,'generated/data.json'));
  const html=renderTemplate(fs.readFileSync(inside(project,contract.template),'utf8'),data);
  write(inside(project,contract.output),html);
  write(inside(project,'frontend/receipt.json'),{inputs:check.inputs,artifactHash:hash(html),builtAt:now()});
  return {file:inside(project,contract.output),...frontendCheck(project)};
}
export async function frontendAudit(project,{browser:executablePath}={}){
  const check=frontendCheck(project);if(!check.valid)throw Error(check.errors.join('\n'));
  const {contract,fixtures}=loadContract(project),data=read(inside(project,'generated/data.json'));
  const report={valid:false,startedAt:now(),baseline:contract.baseline,inputs:check.inputs,artifactHash:hash(fs.readFileSync(inside(project,contract.output))),checks:[],errors:[],network:[],browserChecked:false,editorReview:'not-reviewed',humanApproval:'not-asserted'};
  write(inside(project,'reports/frontend-audit.json'),report);
  let browser;
  try{
    const require=createRequire(import.meta.url);
    const {chromium}=await import(pathToFileURL(path.resolve(process.env.TRAVEL_PLAYWRIGHT_MODULE||require.resolve('playwright'))).href);
    browser=await chromium.launch({headless:true,...((executablePath||process.env.TRAVEL_BROWSER)?{executablePath:executablePath||process.env.TRAVEL_BROWSER}:{})});
    report.browserChecked=true;
    const context=await browser.newContext({offline:true});
    // Stop even attempted external requests; offline alone can permit browser cache hits.
    await context.route(/^https?:/,route=>{report.network.push(route.request().url());return route.abort();});
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
    const cases=[{id:'current',views:contract.views},...fixtures];
    const template=fs.readFileSync(inside(project,contract.template),'utf8');
    for(const f of cases){
      const file=f.id==='current'?inside(project,contract.output):inside(project,'.runtime/frontend-audit/'+f.id+'.html');
      if(f.id!=='current')write(file,renderTemplate(template,{...structuredClone(data),...f.patch}));
      for(const width of contract.widths)for(const [i,view] of f.views.entries()){
        const label=f.id+'/'+width+'/'+view.hash;
        try{
          await page.setViewportSize({width,height:900});await page.goto(pathToFileURL(file).href+view.hash);
          for(const expectation of view.checks){
            const loc=page.locator(expectation.selector);
            if('count'in expectation&&await loc.count()!==expectation.count)throw Error('count: '+expectation.selector);
            if('visible'in expectation&&(await loc.isVisible())!==expectation.visible)throw Error('visible: '+expectation.selector);
            if('includes'in expectation)await page.waitForFunction(({selector,text})=>[...document.querySelectorAll(selector)].some(e=>e.textContent.includes(text)),{selector:expectation.selector,text:expectation.includes},{timeout:2000});
            if('excludes'in expectation&&(await loc.allTextContents()).join('\n').includes(expectation.excludes))throw Error('unexpected text: '+expectation.selector);
          }
          if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('horizontal overflow');
          const shot='.runtime/frontend-audit/'+f.id+'-'+width+'-'+i+'.png';await page.screenshot({path:inside(project,shot),fullPage:true});
          report.checks.push({label,screenshot:shot,passed:true});
        }catch(e){report.checks.push({label,passed:false});report.errors.push(label+': '+e.message);}
      }
    }
    if(report.network.length)report.errors.push('External resource requests attempted');
    if(!same(inputs(project,contract),check.inputs)||hash(fs.readFileSync(inside(project,contract.output)))!==report.artifactHash)report.errors.push('Inputs/artifact changed during audit');
  }catch(e){report.errors.push(e.message);}
  finally{if(browser)await browser.close();}
  report.valid=!report.errors.length;report.completedAt=now();write(inside(project,'reports/frontend-audit.json'),report);
  return report;
}
