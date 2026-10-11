import fs from 'node:fs';
import {inside,loadTrip,write,uid,hash,safeUrl} from './core.mjs';
import {sniff} from './research.mjs';

export function importAsset(project,file,metadata,target){
  if(!metadata.caption||!metadata.license||!safeUrl(metadata.source))throw Error('Photo needs caption, public source and a human-reviewed usage license');
  const bytes=fs.readFileSync(file),mime=sniff(bytes);if(!mime||bytes.length>25*1024*1024)throw Error('Supported local raster under 25 MB required');
  const [kind,id,...extra]=String(target).split(':');uid(id);
  if(extra.length||!['place','journal'].includes(kind))throw Error('Target is place:ID or journal:ID');
  const trip=loadTrip(project),record=trip[kind==='place'?'places':'journal'].find(x=>x.id===id);
  if(!record)throw Error('Photo target does not exist');
  const destination='assets/photos/'+id+'-'+hash(bytes).slice(0,16)+'.'+mime.split('/')[1];
  if(!fs.existsSync(inside(project,destination)))write(inside(project,destination),bytes,{exclusive:true});
  record.photo={file:destination,caption:metadata.caption,source:metadata.source,license:metadata.license};
  write(inside(project,'trip.json'),trip);
  return {target,file:destination,sha256:hash(bytes),note:'Usage rights and depicted entity are reviewer decisions; old images are retained.'};
}
