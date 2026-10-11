#!/usr/bin/env node
import path from 'node:path';
import {read,loadTrip,write,inside} from './lib/core.mjs';
import {scheduleReport,setChannel,changeReport,assistantCoverage} from './lib/operations.mjs';
const [command,...args]=process.argv.slice(2), o={};
try {
  for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--'))throw Error('Expected --key value');o[args[i].slice(2)]=args[i+1];}
  let r;
  if(command==='check')r=scheduleReport(loadTrip(path.resolve(o.project)));
  else if(command==='channel')r=setChannel(path.resolve(o.project),{...o,runtime:o.runtime,explicitUserResume:o['user-resume']==='true'});
  else if(command==='change'){
    const p=path.resolve(o.project);r=changeReport(read(path.resolve(o.before)),loadTrip(p),read(path.resolve(o.observations)));
    if(r.valid)write(inside(p,'private/change-reviews/'+r.date+'-'+r.afterHash.slice(0,12)+'.json'),r,{exclusive:true});
  } else if(command==='assistant-check')r=assistantCoverage(read(path.resolve(o.expected)),read(path.resolve(o.result)));
  else throw Error('Commands: check --project; channel --project --state --reason --by [--runtime] [--user-resume true]; change --project --before --observations; assistant-check --expected --result');
  console.log(JSON.stringify(r,null,2));if(r.valid===false)process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}
