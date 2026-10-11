// A disposable route draft: never writes itinerary facts or computes road geometry/ETA.
export function splitDirections(stops, mode, places) {
  if (!['driving','walking','bicycling','transit'].includes(mode)) throw Error('Unsupported direction mode');
  if (stops.length<2) return [];
  const resolve=id=>{
    const p=places.find(p=>p.id===id);
    if(!p?.mapUrl||!p.address)throw Error('Missing exact registered destination: '+id);
    const original=new URL(p.mapUrl);
    if(original.protocol!=='https:'||!/(^|\.)google\.(com|no|se)$/.test(original.hostname))throw Error('Not a registered Google Maps point');
    return {text:p.address,placeId:original.searchParams.get('query_place_id')};
  };
  const points=stops.map(resolve),max=mode==='transit'?2:5,out=[];
  let offset=0;
  while(offset<points.length-1){
    let size=Math.min(max,points.length-offset),url;
    while(size>=2){
      const section=points.slice(offset,offset+size);
      url=new URL('https://www.google.com/maps/dir/');
      url.searchParams.set('api','1');url.searchParams.set('travelmode',mode);
      url.searchParams.set('origin',section[0].text);url.searchParams.set('destination',section.at(-1).text);
      if(section[0].placeId)url.searchParams.set('origin_place_id',section[0].placeId);
      if(section.at(-1).placeId)url.searchParams.set('destination_place_id',section.at(-1).placeId);
      if(size>2){url.searchParams.set('waypoints',section.slice(1,-1).map(p=>p.text).join('|'));
        if(section.slice(1,-1).every(p=>p.placeId))url.searchParams.set('waypoint_place_ids',section.slice(1,-1).map(p=>p.placeId).join('|'));}
      if(url.href.length<=2048)break;
      size--;
    }
    if(size<2)throw Error('Addresses exceed Google Maps URL limit; open each point separately');
    out.push({stops:stops.slice(offset,offset+size),href:url.href});offset+=size-1;
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
