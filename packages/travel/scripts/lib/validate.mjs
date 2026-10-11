import fs from 'node:fs';
import { inside, uid, safeUrl, dateRange, routeHash, dayHash, hash, read } from './core.mjs';
import {inspectRouteAccess} from './route-access.mjs';
import {captureAudit} from './intake.mjs';
import {scheduleReport} from './operations.mjs';

export function validate(trip, project) {
  const errors = [], warnings = [];
  const fail = (where, message) => errors.push(where + ': ' + message);
  const warn = (where, message) => warnings.push(where + ': ' + message);
  try {
    if (trip.schemaVersion !== 1) fail('schemaVersion', 'unsupported version');
    if(!trip.title||!/^[A-Z]{3}$/.test(trip.referenceCurrency||'')||!trip.rates||!trip.preferences)fail('trip','title/referenceCurrency/rates/preferences required');
    const dates = dateRange(trip.start, trip.end);
    for (const key of ['places','catalog','orders','todos','routes','expenses','knowledge','shopping','guides','journal','researchCoverage','weatherLocations','days']) {
      if (!Array.isArray(trip[key])) throw Error(key + ' must be an array');
    }
    const timing=scheduleReport(trip);errors.push(...timing.errors);warnings.push(...timing.warnings);
    const ids = key => {
      const seen = new Set();
      for (const item of trip[key]) {
        try { uid(item.id); } catch (e) { fail(key, e.message); }
        if (seen.has(item.id)) fail(key, 'duplicate ID ' + item.id);
        seen.add(item.id);
      }
      return seen;
    };
    const placeIds = ids('places'), catIds = ids('catalog'), orderIds = ids('orders'), routeIds = ids('routes'), wikiIds = ids('knowledge');
    for (const key of ['todos','expenses','shopping','guides','journal','weatherLocations']) ids(key);
    const ref = (id, set, where) => { if (id && !set.has(id)) fail(where, 'unknown reference ' + id); };
    const url = (u, where) => { if (u && !safeUrl(u)) fail(where, 'unsafe URL or sensitive query'); };
    const file = (p, where) => { if (p && !fs.existsSync(inside(project, p))) fail(where, 'missing file ' + p); };
    const price = (v, where) => { if (v && (!/^[A-Z]{3}$/.test(v.currency || '') || !Number.isFinite(v.min) || !Number.isFinite(v.max) || v.min < 0 || v.max < v.min)) fail(where, 'invalid price interval/currency'); };
    const aliases = new Map();
    if(trip.presentation){
      if(typeof trip.presentation!=='object'||Array.isArray(trip.presentation))fail('presentation','must be an object');
      for(const key of ['kicker','headline','subtitle','journeyTitle'])if(trip.presentation[key]!=null&&typeof trip.presentation[key]!=='string')fail('presentation',key+' must be text');
    }
    for(const item of [...trip.places,...trip.catalog,...trip.journal]){
      if(item.wikiIds!=null){if(!Array.isArray(item.wikiIds))fail(item.id,'wikiIds must be an array');else for(const id of item.wikiIds)ref(id,wikiIds,item.id);}
      if(item.visit!=null){
        if(typeof item.visit!=='object'||Array.isArray(item.visit))fail(item.id,'visit must be an object');
        else {
          for(const key of ['duration','tip'])if(item.visit[key]!=null&&typeof item.visit[key]!=='string')fail(item.id,'visit '+key+' must be text');
          if(item.visit.steps!=null&&(!Array.isArray(item.visit.steps)||item.visit.steps.some(x=>typeof x!=='string')))fail(item.id,'visit steps must be text array');
        }
      }
      if(item.dishes!=null&&(!Array.isArray(item.dishes)||item.dishes.some(x=>typeof x!=='string')))fail(item.id,'dishes must be text array');
    }
    for(const day of trip.days)if(day.highlights!=null&&(!Array.isArray(day.highlights)||day.highlights.some(x=>typeof x!=='string')))fail(day.date,'highlights must be text array');
    for (const p of trip.places) {
      if (!p.name || !p.address) fail(p.id, 'exact name and address required');
      if (!['entrance','parking','restaurant','cafe','supermarket','hotel','attraction','station','airport','activity'].includes(p.kind)) fail(p.id, 'unknown place kind');
      for (const a of [p.name, ...(p.aliases || [])]) {
        const key = a.trim().toLocaleLowerCase();
        if (aliases.has(key) && aliases.get(key) !== p.id) fail(p.id, 'ambiguous alias ' + a);
        aliases.set(key, p.id);
      }
      url(p.mapUrl, p.id);
      if (!p.review?.by || !p.review?.at || !p.review?.evidence) warn(p.id, 'exact entity/entrance not reviewed');
      if (p.photo) {
        file(p.photo.file, p.id);
        url(p.photo.source, p.id);
        if (!p.photo.caption || !p.photo.license || !p.photo.source) fail(p.id, 'photo needs caption, license and source');
      }
    }
    for (const c of trip.catalog) {
      if(!c.name||!c.placeId||!c.city)fail(c.id,'catalog needs name/placeId/city');
      ref(c.placeId, placeIds, c.id);
      if (!['restaurant','cafe','supermarket','activity'].includes(c.kind)) fail(c.id, 'unknown catalog kind');
      price(c.price, c.id); url(c.url, c.id); url(c.bookingUrl, c.id);
      if (c.price && !['person','total'].includes(c.price.basis)) fail(c.id, 'price basis must be person or total');
      if (!c.verifiedAt) warn(c.id, 'hours/prices lack verification date');
    }
    const seenDays = new Set();
    for (const d of trip.days) {
      if (!dates.includes(d.date) || seenDays.has(d.date)) fail('days', 'duplicate/out-of-range date ' + d.date);
      seenDays.add(d.date);
      try { new Intl.DateTimeFormat('en', {timeZone:d.timezone}).format(); } catch { fail(d.date, 'invalid IANA timezone'); }
      if (!Number.isInteger(d.party) || d.party < 1) fail(d.date, 'party must be positive integer');
      if (!Array.isArray(d.timeline) || !Array.isArray(d.meals) || !Array.isArray(d.routeIds) || !Array.isArray(d.weatherIds)) throw Error('Day arrays missing');
      ref(d.stayId, placeIds, d.date);
      if (!d.timeline.length) warn(d.date, 'no timeline yet');
      let previousEnd = '';
      for (const t of d.timeline) {
        ref(t.placeId, placeIds, d.date); ref(t.routeId, routeIds, d.date);
        if (!/^\d\d:\d\d$/.test(t.start || '') || !/^\d\d:\d\d$/.test(t.end || '') || [t.start,t.end].some(x=>+x.slice(0,2)>23||+x.slice(3)>59) || t.end < t.start) fail(d.date, 'invalid same-day time window; split midnight');
        if ((!t.branch || t.branch === 'default') && t.start < previousEnd) fail(d.date, 'default timeline overlaps');
        if (!t.branch || t.branch === 'default') previousEnd = t.end;
      }
      const defaults = new Set();
      for (const m of d.meals) {
        if(!['breakfast','lunch','coffee','dinner','grocery'].includes(m.meal))fail(d.date,'unknown meal kind');
        if (!['default','alternative'].includes(m.role)) fail(d.date, 'invalid meal role');
        ref(m.catalogId, catIds, d.date); ref(m.orderId, orderIds, d.date); price(m.cost,d.date);
        if (m.role === 'default' && defaults.has(m.meal)) fail(d.date, 'two defaults for ' + m.meal);
        if (m.role === 'default') defaults.add(m.meal);
        const o = trip.orders.find(o=>o.id===m.orderId);
        if (o && (o.date !== d.date || o.status !== 'booked')) fail(d.date, 'meal links inactive or wrong-date booking');
      }
      for (const id of d.routeIds) {
        ref(id, routeIds, d.date);
        const r = trip.routes.find(r=>r.id===id);
        if (r && r.date !== d.date) fail(d.date, 'route date mismatch ' + id);
      }
      const stops = d.timeline.filter(t => t.placeId && (!t.branch || t.branch === 'default')).map(t=>t.placeId);
      for (let i=1;i<stops.length;i++) if(stops[i]!==stops[i-1] && !d.routeIds.some(id=>{
        const r=trip.routes.find(r=>r.id===id);
        return r?.stops[0]===stops[i-1] && r?.stops.at(-1)===stops[i] && (!r.branch||r.branch==='default');
      })) warn(d.date,'missing transfer: '+stops[i-1]+' -> '+stops[i]);
      for(const id of d.weatherIds) ref(id,new Set(trip.weatherLocations.map(w=>w.id)),d.date);
    }
    for (const date of dates) if(!seenDays.has(date)) fail('days','missing date '+date);
    if(trip.days.some((d,i)=>i && d.date<trip.days[i-1].date)) fail('days','dates must be chronological');
    for(const r of trip.routes) {
      if(!dates.includes(r.date)) fail(r.id,'route date outside trip');
      if(!Array.isArray(r.stops)||r.stops.length<2||r.stops.length>5) { fail(r.id,'use 2–5 exact stops'); continue; }
      for(const id of r.stops) ref(id,placeIds,r.id);
      const access=inspectRouteAccess(r,trip.places);
      for(const e of access.errors)fail(r.id,e);
      if(access.status==='needs-review')warn(r.id,'特殊转场待核通道：'+access.reasons.join('；'));
      if(r.mode==='transit' && r.stops.length!==2) fail(r.id,'transit requires two endpoints');
      if(!['driving','walking','bicycling','transit','official'].includes(r.mode)) fail(r.id,'choose explicit travel mode');
      if(r.mode==='official' && !safeUrl(r.officialUrl)) fail(r.id,'official transport needs operator URL');
      const day=trip.days.find(d=>d.date===r.date);
      if(day && !day.routeIds.includes(r.id)) warn(r.id,'route not selected by day');
      if(r.reviewedBasis && day && r.reviewedBasis!==dayHash(day)) fail(r.id,'day changed since route review');
      if(!r.reviewedBasis) warn(r.id,'day-route match needs semantic review');
      if(r.review?.routeHash&&r.review.routeHash!==routeHash(trip,r))fail(r.id,'place/mode changed since route review');
      if(r.capture){
        file(r.capture.file,r.id); url(r.capture.resolvedUrl,r.id);
        if(fs.existsSync(inside(project,r.capture.file))&&hash(fs.readFileSync(inside(project,r.capture.file)))!==r.capture.hash)fail(r.id,'screenshot content fingerprint mismatch');
        if(r.stops.every(x=>placeIds.has(x)) && r.capture.routeHash!==routeHash(trip,r)) fail(r.id,'stale route screenshot');
        if(r.capture.reviewed !== true) warn(r.id,'screenshot captured but not reviewed');
      } else if(r.mode!=='official') warn(r.id,'no current route screenshot');
    }
    for(const o of trip.orders) {
      if(!o.title||!o.category)fail(o.id,'order needs title/category');
      ref(o.placeId,placeIds,o.id); price(o.amount,o.id);
      if(!dates.includes(o.date)||!['booked','cancelled','pending'].includes(o.status)) fail(o.id,'invalid date/status');
      if(o.status==='booked' && (!o.evidence || !o.start || !o.party)) fail(o.id,'booked requires evidence, time and party');
      if(o.start&&(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(o.start)))fail(o.id,'invalid booking start time');
      if(o.end&&(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(o.end)))fail(o.id,'invalid booking end time');
      if(o.party!=null&&(!Number.isInteger(o.party)||o.party<1))fail(o.id,'invalid booking party');
      if(o.evidence) file(o.evidence,o.id);
      if(o.status==='booked'&&o.category==='restaurant'&&!trip.days.some(d=>d.meals.some(m=>m.orderId===o.id)))warn(o.id,'restaurant order not linked to a meal; check double-counted budget');
    }
    for(const t of trip.todos) {
      if(!Array.isArray(t.dates)||!t.dates.length||t.dates.some(d=>!dates.includes(d))) fail(t.id,'invalid todo dates');
      if(!['open','done'].includes(t.status)||!t.action||!t.when) fail(t.id,'todo needs action, when and status');
      ref(t.orderId,orderIds,t.id);
      if(t.kind==='booking' && t.status==='open' && trip.orders.some(o=>o.id===t.orderId&&o.status==='booked')) warn(t.id,'booking exists; close completed booking action after review');
    }
    for(const k of trip.knowledge) { file(k.path,k.id); if(!k.title||!k.summary) fail(k.id,'Wiki needs title and summary'); }
    for(const card of [...trip.guides,...trip.shopping]) { if(!card.region||!card.title||!card.summary)fail(card.id,'card needs region/title/summary');ref(card.wikiId,wikiIds,card.id); url(card.url,card.id); }
    for(const j of trip.journal) {
      if(j.kind!=null&&!['intro','experience'].includes(j.kind))fail(j.id,'journal kind must be intro or experience');
      if(!dates.includes(j.date)||!j.text) fail(j.id,'journal needs in-range date and text');
      for(const id of j.placeIds||[])ref(id,placeIds,j.id);
      if(j.reviewedBasis && j.reviewedBasis!==dayHash(trip.days.find(d=>d.date===j.date))) fail(j.id,'journal stale after day change');
      if(j.photo) { file(j.photo.file,j.id); url(j.photo.source,j.id); if(!j.photo.license) fail(j.id,'missing photo license'); }
    }
    for(const w of trip.weatherLocations) {
      if(!Number.isFinite(w.latitude)||Math.abs(w.latitude)>90||!Number.isFinite(w.longitude)||Math.abs(w.longitude)>180) fail(w.id,'invalid coordinates');
      try{new Intl.DateTimeFormat('en',{timeZone:w.timezone}).format();}catch{fail(w.id,'invalid timezone');}
    }
    for(const e of trip.expenses) price(e,e.id);
    for(const [currency,r] of Object.entries(trip.rates||{})) if(!/^[A-Z]{3}$/.test(currency)||!(r.rate>0)||!r.asOf)fail('rates','invalid rate/date');
    const serialized=JSON.stringify(trip);
    const secretKeys=(obj)=>{if(!obj||typeof obj!=='object')return;for(const [k,v]of Object.entries(obj)){if(/password|cookie|token|secret|authorization|cancelUrl/i.test(k))fail('trip','private field not permitted: '+k);secretKeys(v);}};
    secretKeys(trip);
    if(/(?:xsec_token|access_token|password|cookie|authorization)["=:\s]+[^,\s}]+/i.test(serialized)) fail('trip','possible secret in shared facts');
    const registryFile=inside(project,'research/registry.json');
    if(fs.existsSync(registryFile))for(const c of trip.researchCoverage){
      uid(c.id);
      if(!c.city||!c.topic||!Array.isArray(c.noteIds)||!Array.isArray(c.officialUrls)||!Array.isArray(c.gaps))fail(c.id,'coverage needs city/topic/noteIds/officialUrls/gaps');
      else {for(const id of c.noteIds)ref(id,new Set(read(registryFile).map(n=>n.id)),c.id);for(const u of c.officialUrls)url(u,c.id);}
    }
    if(fs.existsSync(registryFile)) for(const n of read(registryFile)){
      if(n.raw){
        const rawFile=inside(project,n.raw), raw=read(rawFile);
        if(hash(raw)!==n.rawHash)fail(n.id,'raw source modified');
        const coverage=captureAudit(raw.capture,raw.images);
        if(raw.capture&&coverage.status!=='complete')warn(n.id,'original capture coverage is '+coverage.status);
        if(raw.archive){const full=inside(project,raw.archive.file);if(!fs.existsSync(full)||hash(fs.readFileSync(full))!==raw.archive.hash)fail(n.id,'source archive missing or changed');}
        for(const image of raw.images) {
          const full=inside(project,image.file);
          if(!fs.existsSync(full)||hash(fs.readFileSync(full))!==image.hash)fail(n.id,'raw image missing or changed');
        }
      }
      if(n.review){
        const review=read(inside(project,n.review));
        if(review.rawHash!==n.rawHash)fail(n.id,'digest stale after raw revision');
        for(const o of review.outcomes||[]) if(o.file && hash(fs.readFileSync(inside(project,o.file)))!==o.hash) warn(n.id,'Wiki edited since digestion; audit retained coverage');
      }
    }
  } catch(e) { fail('structure',e.message); }
  return {valid:!errors.length,errors,warnings};
}
