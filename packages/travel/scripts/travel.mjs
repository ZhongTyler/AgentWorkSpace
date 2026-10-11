#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {init,read,loadTrip,budget,routeHash,dayHash,routeUrl,inside} from './lib/core.mjs';
import {validate} from './lib/validate.mjs';
import {register,screen,importSource,digest,researchStatus,rawGallery} from './lib/research.mjs';
import {sync,build,freshness} from './lib/generate.mjs';
import {scaffoldRoutes,drivingOverviews,routeReview,captureRoute,refreshWeather} from './lib/maps-weather.mjs';
import * as mcp from './lib/mcp.mjs';
import {doctor,packageCheck,pack,verifyPackage,installSkill,release} from './lib/package.mjs';
import {importAsset} from './lib/assets.mjs';
import {routeAccessReport} from './lib/route-access.mjs';
import {intake,sourceAudit} from './lib/intake.mjs';
import {archiveInfo} from './lib/archive-info.mjs';
import {quality} from './lib/quality.mjs';

export function parse(argv){
  const [command='help',...rest]=argv,opts={};
  const flags=new Set(['network','allow-private','refresh','strict','apply']);
  for(let i=0;i<rest.length;i++){
    if(!rest[i].startsWith('--'))throw Error('Expected --option, received '+rest[i]);
    const key=rest[i].slice(2);if(key in opts)throw Error('Duplicate --'+key);
    if(flags.has(key))opts[key]=true;
    else {const value=rest[++i];if(!value||value.startsWith('--'))throw Error('Value required for --'+key);opts[key]=value;}
  }
  return {command,opts};
}
const commands={
 help:[],doctor:[],init:['project','title','start','end'],validate:['project','strict'],sync:['project'],build:['project'],status:['project'],quality:['project'],budget:['project'],asset:['project','file','metadata','target'],
 candidates:['project','file'],screen:['project','id','decision','reason'],source:['project','file','refresh'],digest:['project','file'],gallery:['project','id'],
 'research-status':['project'],intake:['project','file','refresh'],'source-audit':['project'],'archive-info':['file'],routes:['project','mode'],'route-info':['project','id'],'route-review':['project','id','file'],'route-access':['project'],
 capture:['project','id','network','allow-private','browser'],weather:['project','network'],
 'mcp-install':['runtime','tag','network'],'mcp-start':['runtime','port','executable','network'],'mcp-login':['runtime','endpoint','network'],'mcp-status':['runtime','endpoint'],
 'mcp-search':['project','query','runtime','endpoint','network'],'mcp-extract':['project','query','ids','runtime','endpoint','network','refresh'],
 'package-check':[],pack:['out'],release:['apply','out'],'verify-package':['root'],'install-skill':['workspace']
};
export async function run(argv){
  const {command:c,opts:o}=parse(argv);
  if(!commands[c])throw Error('Unknown command '+c);
  for(const k of Object.keys(o))if(!commands[c].includes(k))throw Error('Unknown option --'+k+' for '+c);
  const need=k=>{if(!o[k])throw Error('Missing --'+k);return o[k];};
  const net=()=>{if(!o.network)throw Error('External network requires --network; read privacy and source guidance first');};
  const project=()=>path.resolve(need('project'));
  const json=()=>read(path.resolve(need('file')));
  const runtime=o.runtime?path.resolve(o.runtime):undefined;
  switch(c){
    case 'help':return {usage:'node scripts/travel.mjs <command> [--project <directory>] [options]',commands,documentation:'运行/命令参考.md'};
    case 'doctor':return doctor();
    case 'init':return init(project(),need('title'),need('start'),need('end'));
    case 'validate':{const r=validate(loadTrip(project()),project());const passed=r.valid&&(!o.strict||r.warnings.length===0);if(!passed)process.exitCode=1;return {...r,strict:!!o.strict,passed};}
    case 'sync':return sync(project());
    case 'build':return build(project());
    case 'status':return {freshness:freshness(project()),research:researchStatus(project()).counts};
    case 'budget':return budget(loadTrip(project()));
    case 'quality':return quality(project());
    case 'asset':return importAsset(project(),path.resolve(need('file')),read(path.resolve(need('metadata'))),need('target'));
    case 'candidates':return register(project(),json());
    case 'screen':return screen(project(),need('id'),need('decision'),need('reason'))||{updated:true};
    case 'source':return importSource(project(),json(),path.dirname(path.resolve(o.file)),{refresh:o.refresh});
    case 'digest':return digest(project(),json());
    case 'gallery':return rawGallery(project(),need('id'));
    case 'research-status':return researchStatus(project());
    case 'intake':return intake(project(),path.resolve(need('file')),{refresh:o.refresh});
    case 'source-audit':{const r=sourceAudit(project());if(!r.valid)process.exitCode=1;return r;}
    case 'archive-info':return archiveInfo(path.resolve(need('file')));
    case 'routes':return scaffoldRoutes(project(),need('mode'));
    case 'route-access':{const t=loadTrip(project()),r=routeAccessReport(t.routes,t.places);if(r.errors.length)process.exitCode=1;return r;}
    case 'route-info':{const t=loadTrip(project()),r=[...t.routes,...drivingOverviews(t)].find(x=>x.id===need('id'));if(!r)throw Error('Route not found');const f=inside(project(),'assets/routes/'+r.id+'.json');return {route:r,routeHash:routeHash(t,r),dayHash:dayHash(t.days.find(d=>d.date===r.date)),url:routeUrl(t,r),overviewCapture:fs.existsSync(f)?read(f):null};}
    case 'route-review':return routeReview(project(),need('id'),json());
    case 'capture':net();return captureRoute(project(),need('id'),{allowPrivate:o['allow-private'],executablePath:o.browser});
    case 'weather':net();return refreshWeather(project());
    case 'mcp-install':net();return mcp.install(runtime,o.tag);
    case 'mcp-start':net();return mcp.start(runtime,{port:o.port?Number(o.port):18060,executable:o.executable});
    case 'mcp-login':net();return mcp.login(runtime,o.endpoint);
    case 'mcp-status':return mcp.status(runtime,o.endpoint);
    case 'mcp-search':net();return mcp.search(project(),need('query'),{runtime,endpoint:o.endpoint});
    case 'mcp-extract':{net();const r=await mcp.extract(project(),need('query'),need('ids').split(','),{runtime,endpoint:o.endpoint,refresh:o.refresh});if(r.failed)process.exitCode=1;return r;}
    case 'package-check':{const r=packageCheck();if(!r.valid)process.exitCode=1;return r;}
    case 'pack':return pack(need('out'));
    case 'release':return release({apply:!!o.apply,out:o.out});
    case 'verify-package':{const r=verifyPackage(need('root'));if(!r.valid)process.exitCode=1;return r;}
    case 'install-skill':return installSkill(need('workspace'));
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await run(process.argv.slice(2)),null,2));}
  catch(e){console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;}
}
