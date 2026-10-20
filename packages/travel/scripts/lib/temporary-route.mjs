// A disposable route draft: never writes itinerary facts or computes road geometry/ETA.
import { hasLocation, amapNavigation, amapSearch, googleDirections } from './maps.mjs';

export function splitDirections(stops, mode, places, provider = 'google', city = '') {
  if (!['driving','walking','bicycling','transit'].includes(mode)) throw Error('Unsupported direction mode');
  if (stops.length<2) return [];
  const resolve=id=>{
    const p=places.find(p=>p.id===id);
    if(!p?.address)throw Error('Missing exact registered destination: '+id);
    if(provider==='google'){
      if(!p.mapUrl)throw Error('Missing exact registered destination: '+id);
      const original=new URL(p.mapUrl);
      if(original.protocol!=='https:'||!/(^|\.)google\.(com|no|se)$/.test(original.hostname))throw Error('Not a registered Google Maps point');
    }
    return p;
  };
  const points=stops.map(resolve);
  if(provider==='amap'){
    // Amap needs real coordinates; without them only the endpoints can be searched.
    if(!points.every(hasLocation))return [{stops:[...stops],href:amapSearch(points.at(-1).name,city),exact:false}];
    const out=[];
    for(let offset=0;offset<points.length-1;offset+=4)out.push({stops:stops.slice(offset,offset+5),href:amapNavigation(points.slice(offset,offset+5),mode),exact:true});
    return out;
  }
  const max=mode==='transit'?2:5,out=[];
  let offset=0;
  while(offset<points.length-1){
    let size=Math.min(max,points.length-offset),href='';
    while(size>=2){
      href=googleDirections(points.slice(offset,offset+size),mode);
      if(href.length<=2048)break;
      size--;
    }
    if(size<2)throw Error('Addresses exceed Google Maps URL limit; open each point separately');
    out.push({stops:stops.slice(offset,offset+size),href,exact:true});
    offset+=size-1;
  }
  return out;
}

export function restoreDraft(raw, fingerprint, validIds) {
  try{
    const saved=JSON.parse(raw);
    if(saved.fingerprint!==fingerprint||!Array.isArray(saved.stops)||saved.stops.length>100||
      !saved.stops.every(id=>typeof id==='string'&&validIds.includes(id)))return null;
    return saved.stops;
  }catch{return null;}
}
