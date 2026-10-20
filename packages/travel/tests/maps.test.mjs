import test from 'node:test';
import assert from 'node:assert/strict';
import {mapProvider,mapCity,placeUrl,routeLinks,primaryRouteHref,routePrecision,routePending,mapUrlMatches} from '../scripts/lib/maps.mjs';
import {splitDirections} from '../scripts/lib/temporary-route.mjs';

const trip=(extra={})=>({
  mapProvider:'amap',mapCity:'景德镇',days:[{date:'2026-11-13',timezone:'Asia/Shanghai',city:'景德镇'}],
  places:[
    {id:'a',name:'景德镇北站',address:'江西省景德镇市浮梁县景德镇北站',kind:'station',location:{lng:117.2,lat:29.3}},
    {id:'b',name:'陶溪川文创街区',address:'江西省景德镇市珠山区新厂西路150号',kind:'attraction'},
    {id:'c',name:'御窑博物馆',address:'江西省景德镇市珠山区珠山中路187号',kind:'attraction',location:{lng:117.21,lat:29.29}},
  ],
  ...extra,
});

test('provider follows the trip, not the developer machine',()=>{
  assert.equal(mapProvider({days:[{timezone:'Asia/Shanghai'}]}),'amap');
  assert.equal(mapProvider({days:[{timezone:'Europe/Oslo'}]}),'google');
  assert.equal(mapProvider({days:[{timezone:'Australia/Brisbane'}]}),'google');
  assert.equal(mapProvider({days:[{timezone:'Asia/Shanghai'}],mapProvider:'google'}),'google');
  assert.equal(mapCity({days:[{city:'景德镇'}]}),'景德镇');
  assert.equal(mapCity({days:[]},[{address:'江西省景德镇市珠山区某某路1号'}]),'景德镇市');
});

test('place entry uses coordinates when present and a city-limited search otherwise',()=>{
  const t=trip();
  const marker=new URL(placeUrl(t,t.places[0]));
  assert.equal(marker.hostname,'uri.amap.com');assert.equal(marker.pathname,'/marker');
  assert.equal(marker.searchParams.get('position'),'117.2,29.3');
  assert.equal(marker.searchParams.get('coordinate'),'gaode');
  const search=new URL(placeUrl(t,t.places[1]));
  assert.equal(search.pathname,'/search');assert.equal(search.searchParams.get('keyword'),'陶溪川文创街区');
  assert.equal(search.searchParams.get('city'),'景德镇');
  assert.equal(placeUrl({mapProvider:'google'},t.places[1]).startsWith('https://www.google.com/maps/search/?api=1'),true);
});

test('a registered mapUrl still wins over derivation',()=>{
  const t=trip();t.places[1]={...t.places[1],mapUrl:'https://uri.amap.com/marker?position=1,2'};
  assert.equal(placeUrl(t,t.places[1]),'https://uri.amap.com/marker?position=1,2');
});

test('amap routes navigate point-to-point only when every stop has coordinates',()=>{
  const t=trip();
  const exact=routeLinks(t,{id:'r1',mode:'driving',stops:['a','c']});
  assert.equal(exact.length,1);assert.equal(exact[0].exact,true);
  const u=new URL(exact[0].href);
  assert.equal(u.pathname,'/navigation');assert.equal(u.searchParams.get('mode'),'car');
  assert.equal(u.searchParams.get('from'),'117.2,29.3,景德镇北站');
  assert.equal(u.searchParams.get('to'),'117.21,29.29,御窑博物馆');
  assert.equal(routePrecision(t,{mode:'driving',stops:['a','c']}),true);

  const partial={id:'r2',mode:'walking',stops:['a','b']};
  const links=routeLinks(t,partial);
  assert.equal(links.every(l=>l.exact===false),true);
  assert.deepEqual(links.map(l=>new URL(l.href).searchParams.get('keyword')),['景德镇北站','陶溪川文创街区']);
  assert.equal(routePrecision(t,partial),false);
  assert.equal(new URL(primaryRouteHref(t,partial)).searchParams.get('keyword'),'陶溪川文创街区','primary link points at the destination');
});

test('google trips keep their place-id directions and amap trips never emit google links',()=>{
  const g={mapProvider:'google',days:[{timezone:'Europe/Oslo'}],places:[
    {id:'x',name:'A',address:'Street 1',mapUrl:'https://www.google.com/maps/search/?api=1&query_place_id=P1'},
    {id:'y',name:'B',address:'Street 2',mapUrl:'https://www.google.com/maps/search/?api=1&query_place_id=P2'}]};
  const href=routeLinks(g,{mode:'walking',stops:['x','y']})[0].href;
  assert.equal(new URL(href).searchParams.get('origin_place_id'),'P1');
  const t=trip();
  assert.equal(routeLinks(t,{mode:'driving',stops:['a','c']}).some(l=>/google/.test(l.href)),false);
  assert.equal(mapUrlMatches('https://uri.amap.com/marker?position=1,2','amap'),true);
  assert.equal(mapUrlMatches('https://www.google.com/maps/dir/','amap'),false);
  assert.equal(mapUrlMatches('https://www.google.com/maps/dir/','google'),true);
});

test('draft splits amap by coordinates and refuses to invent a route without them',()=>{
  const t=trip();
  const exact=splitDirections(['a','c'],'driving',t.places,'amap','景德镇');
  assert.equal(exact.length,1);assert.equal(exact[0].exact,true);
  const fallback=splitDirections(['a','b'],'walking',t.places,'amap','景德镇');
  assert.equal(fallback.length,1);assert.equal(fallback[0].exact,false);
  assert.equal(new URL(fallback[0].href).searchParams.get('keyword'),'陶溪川文创街区');
});

test('a pending leg exposes no navigation link and no point precision',()=>{
  const t=trip();
  const pending={id:'r9',mode:'driving',stops:['a','c'],status:'pending'};
  assert.deepEqual(routeLinks(t,pending),[]);
  assert.equal(primaryRouteHref(t,pending),null);
  assert.equal(routePrecision(t,pending),false,'even fully geocoded stops must not claim a settled route');
  assert.equal(routePending(pending),true);
  assert.equal(routePending({mode:'driving',stops:['a','c']}),false);
});
