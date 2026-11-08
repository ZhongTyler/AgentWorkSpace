import fs from 'node:fs';
import path from 'node:path';
import {requireValue} from './state.mjs';
export function privateUsage(home,{maxFiles=10000}={}){
 let files=0,bytes=0;const pending=[home];
 while(pending.length){const at=pending.pop();if(!fs.existsSync(at))continue;const s=fs.lstatSync(at);requireValue(!s.isSymbolicLink(),'unsafe_state');
  if(s.isDirectory()){for(const entry of fs.readdirSync(at)){pending.push(path.join(at,entry));requireValue(pending.length+files<=maxFiles,'private_file_capacity');}}
  else{requireValue(s.isFile(),'unsafe_state');files++;bytes+=s.size;requireValue(files<=maxFiles,'private_file_capacity');}
 }
 return {status:'observed',files,bytes};
}
