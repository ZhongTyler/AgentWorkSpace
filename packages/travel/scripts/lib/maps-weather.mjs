import fs from 'node:fs';
import path from 'node:path';
import { inside, loadTrip, write, read, uid, routeUrl, routeHash, dayHash, now, hash, safeUrl } from './core.mjs';

export function scaffoldRoutes(project, mode) {
  if(!['driving','walking','bicycling','transit','official'].includes(mode))throw Error('Choose --mode explicitly; script cannot infer safe travel mode');
  const trip=loadTrip(project), added=[];
  for(const day of trip.days) {
    const stops=day.timeline.filter(t=>t.placeId&&(!t.branch||t.branch==='default')).map(t=>t.placeId);
    for(let i=1;i<stops.length;i++){
      if(stops[i]===stops[i-1]||day.routeIds.some(id=>{const r=trip.routes.find(x=>x.id===id);return r?.stops[0]===stops[i-1]&&r?.stops.at(-1)===stops[i];}))continue;
      const id='leg-'+day.date+'-'+i;
      if(trip.routes.some(r=>r.id===id))throw Error('Generated ID collision; review '+id);
      trip.routes.push({id,date:day.date,mode,stops:[stops[i-1],stops[i]],branch:'default'});
      day.routeIds.push(id);added.push(id);
    }
  }
  write(inside(project,'trip.json'),trip);
  return {added,reviewRequired:true};
}
export function drivingOverviews(trip){
  const out=[];
  for(const day of trip.days){
    let stops=[], legs=[], n=0;
    const flush=()=>{if(stops.length>1){out.push({id:'overview-'+day.date+'-'+(++n),date:day.date,mode:'driving',stops:[...stops],legIds:[...legs],branch:'default'});}stops=[];legs=[];};
    for(const id of day.routeIds){
      const r=trip.routes.find(x=>x.id===id);
      if(!r||r.mode!=='driving'||(r.branch&&r.branch!=='default')){flush();continue;}
      if(stops.length && (stops.at(-1)!==r.stops[0]||stops.length+r.stops.length-1>5))flush();
      stops.push(...(stops.length?r.stops.slice(1):r.stops));legs.push(id);
    }
    flush();
  }
  return out;
}
export function routeReview(project,id,review){
  const trip=loadTrip(project),r=trip.routes.find(r=>r.id===uid(id))||drivingOverviews(trip).find(r=>r.id===id);if(!r)throw Error('Route not found');
  if(r.legIds){const f=inside(project,'assets/routes/'+r.id+'.json');if(fs.existsSync(f))r.capture=read(f);}
  const d=trip.days.find(d=>d.date===r.date);
  if(review.routeHash!==routeHash(trip,r)||review.dayHash!==dayHash(d)||!review.by||!review.at||!review.evidence||review.endpointsAndModeChecked!==true)throw Error('Review must bind current hashes and declare endpoint/mode checks');
  r.reviewedBasis=review.dayHash;r.review={by:review.by,at:review.at,evidence:review.evidence,routeHash:review.routeHash};
  if(review.observedMinutes!=null){
    if(!Number.isFinite(review.observedMinutes)||review.observedMinutes<0)throw Error('Invalid observed map duration');
    r.observedDuration={minutes:review.observedMinutes,source:review.evidence,checkedAt:review.at};
  }
  if(review.screenshotChecked){
    if(!r.capture||r.capture.routeHash!==review.routeHash||review.captureHash!==r.capture.hash)throw Error('Screenshot review must bind current capture');
    r.capture.reviewed=true;
  }
  if(r.legIds){if(!r.capture)throw Error('Capture overview before review');write(inside(project,'assets/routes/'+r.id+'.json'),r.capture);}else write(inside(project,'trip.json'),trip);
  return {id,dayHash:r.reviewedBasis};
}
export async function captureRoute(project,id,{allowPrivate=false,executablePath}={}){
  const trip=loadTrip(project),r=trip.routes.find(r=>r.id===id)||drivingOverviews(trip).find(r=>r.id===id);
  if(!r)throw Error('Unknown route');
  if(r.stops.some(id=>trip.places.find(p=>p.id===id)?.private)&&!allowPrivate)throw Error('Private addresses require --allow-private for this capture');
  const url=routeUrl(trip,r);if(!url||r.mode==='official')throw Error('Use operator guide, not a fabricated map');
  let chromium;try{({chromium}=await import('playwright'));}catch{throw Error('Optional dependency missing: install Playwright as described in setup');}
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(3500);
    const resolvedUrl=page.url();
    const bytes=await page.screenshot({fullPage:false});
    const capture={file:'assets/routes/'+r.id+'-'+routeHash(trip,r).slice(0,12)+'.png',requestedUrl:url,resolvedUrl,routeHash:routeHash(trip,r),capturedAt:now(),hash:hash(bytes),reviewed:false};
    write(inside(project,capture.file),bytes);
    if(r.legIds)write(inside(project,'assets/routes/'+r.id+'.json'),capture);
    else {r.capture=capture;write(inside(project,'trip.json'),trip);}
    return {...capture,warning:'Inspect screenshot; page load does not establish correct route or legal parking'};
  }finally{await browser.close();}
}
export function normalizeForecast(location,json,fetchedAt) {
  const d=json.daily;
  if(!d?.time||!Array.isArray(d.time)||json.timezone!==location.timezone)throw Error('Forecast shape/timezone mismatch');
  const units=json.daily_units||{};
  if(units.temperature_2m_max!=='°C'||units.temperature_2m_min!=='°C')throw Error('Unexpected temperature units');
  const field=(key,i)=>{const v=d[key]?.[i];return v===undefined?null:v;};
  return {id:location.id,name:location.name,timezone:json.timezone,fetchedAt,source:'https://open-meteo.com/en/docs',daily:d.time.map((date,i)=>({
    date,min:field('temperature_2m_min',i),max:field('temperature_2m_max',i),code:field('weather_code',i),
    feelsMin:field('apparent_temperature_min',i),feelsMax:field('apparent_temperature_max',i),
    rain:field('precipitation_sum',i),rainProbability:field('precipitation_probability_max',i),
    wind:field('wind_speed_10m_max',i),gust:field('wind_gusts_10m_max',i),
    sunrise:field('sunrise',i),sunset:field('sunset',i),daylightHours:field('daylight_duration',i)==null?null:+(field('daylight_duration',i)/3600).toFixed(2)
  })),coordinates:{latitude:location.latitude,longitude:location.longitude},requestKey:forecastRequestKey(location),units,forecastOnly:true};
}
export const forecastRequestKey=l=>hash({latitude:l.latitude,longitude:l.longitude,timezone:l.timezone,elevation:l.elevation??null,temperature_unit:'celsius',wind_speed_unit:'kmh',precipitation_unit:'mm'});
export function preservePastForecasts(trip,locations,previous,at) {
  const localDate=zone=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
  const same=(l,w)=>l.id===w.id&&l.timezone===w.timezone&&l.latitude===w.coordinates?.latitude&&l.longitude===w.coordinates?.longitude&&w.requestKey===forecastRequestKey(l);
  for(const l of trip.weatherLocations){
    const today=localDate(l.timezone);
    let current=locations.find(w=>same(l,w));
    if(current)current.daily=current.daily.filter(x=>x.date>=today);
    for(const d of trip.days.filter(d=>d.date<today&&d.weatherIds.includes(l.id))){
      if(current?.daily.some(x=>x.date===d.date))continue;
      const candidates=previous.flatMap(s=>(Array.isArray(s.locations)?s.locations:[]).filter(w=>same(l,w)&&Array.isArray(w.daily)).flatMap(w=>w.daily.filter(x=>{
        const timestamp=x.originalFetchedAt||w.fetchedAt, fetched=Date.parse(timestamp);
        return x.date===d.date && Number.isFinite(x.min)&&Number.isFinite(x.max)&&Number.isFinite(fetched)&&fetched<=Date.parse(at)&&localDate(l.timezone)>=d.date&&new Intl.DateTimeFormat('en-CA',{timeZone:l.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(fetched))<=d.date;
      }).map(x=>({w,x,file:s.file}))));
      candidates.sort((a,b)=>String(b.x.originalFetchedAt||b.w.fetchedAt).localeCompare(String(a.x.originalFetchedAt||a.w.fetchedAt)));
      const old=candidates[0];if(!old)continue;
      if(!current){current={...old.w,daily:[]};locations.push(current);}
      current.daily.push({...old.x,historical:true,originalFetchedAt:old.x.originalFetchedAt||old.w.fetchedAt,sourceSnapshot:old.x.sourceSnapshot||old.file});
    }
    current?.daily.sort((a,b)=>a.date.localeCompare(b.date));
  }
  return locations;
}
export async function refreshWeather(project,{fetcher=fetch,clock=now}={}) {
  const trip=loadTrip(project),locations=[],failures=[];
  for(const l of trip.weatherLocations){
    try{
      const url=new URL('https://api.open-meteo.com/v1/forecast');
      for(const [key,val]of Object.entries({latitude:l.latitude,longitude:l.longitude,timezone:l.timezone,forecast_days:16,temperature_unit:'celsius',wind_speed_unit:'kmh',precipitation_unit:'mm',daily:'temperature_2m_min,temperature_2m_max,weather_code,apparent_temperature_min,apparent_temperature_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset,daylight_duration'}))url.searchParams.set(key,val);
      if(l.elevation!=null)url.searchParams.set('elevation',l.elevation);
      const response=await fetcher(url,{signal:AbortSignal.timeout(30000),redirect:'error'});
      if(!response.ok)throw Error('HTTP '+response.status);
      locations.push(normalizeForecast(l,await response.json(),clock()));
    }catch(e){failures.push({id:l.id,error:e.message});}
  }
  if(!locations.length)throw Error('No forecast saved: '+JSON.stringify(failures));
  const dir=inside(project,'weather/snapshots'),previous=[];
  if(fs.existsSync(dir))for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.json'))){try{const file='weather/snapshots/'+name;previous.push({...read(inside(project,file)),file});}catch{ /* malformed old evidence is never a backfill source */ }}
  preservePastForecasts(trip,locations,previous,clock());
  const snapshot={fetchedAt:clock(),locations,failures},json=JSON.stringify(snapshot,null,2)+'\n';
  const file='weather/snapshots/'+clock().replace(/[:.]/g,'-')+'.json';
  write(inside(project,file),json,{exclusive:true});
  write(inside(project,'weather/latest.json'),{file,hash:hash(json)});
  return {file,locations:locations.length,failures};
}
