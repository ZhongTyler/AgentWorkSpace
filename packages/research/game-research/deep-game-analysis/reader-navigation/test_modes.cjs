// Production browser wiring with deterministic content geometry. Painting is separate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'navigation.js'),'utf8');
const {sectionAtProbe} = require('./navigation.js');
function boot(width, stored, search = '') {
 const elements = new Map(), media = [], storage = new Map(), windowEvents = {};
 let extraHeight = 0;
 if (stored) storage.set('fixture.reader.sidebar-mode',stored);
 const context = {URL,URLSearchParams,Option:class {constructor(text,value){this.text=text;this.value=value}},
  innerHeight:800,scrollY:0,location:{search,hash:'',href:'https://fixture.invalid/'+search},
  addEventListener(name,handler){windowEvents[name]=handler},requestAnimationFrame(handler){handler()},
  history:{state:null,replaceState(state){this.state=state},pushState(state){this.state=state}},
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
  matchMedia(query){const m={matches:width>=Number(query.match(/\d+/)[0]),addEventListener(name,handler){this.change=handler}};media.push(m);return m},
  scrollBy(x,y){context.scrollY+=y},scrollTo(x,y){context.scrollY=y}};
 const barHeight = () => element('rn-routebar').hidden ? 0 : (element('rn-route-return').hidden ? 120 : 190)+extraHeight;
 function element(id) {
  if (elements.has(id)) return elements.get(id);
  const e = {id,dataset:{},hidden:false,disabled:false,checked:false,childNodes:[],attrs:{},handlers:{},
   classList:{add(){},toggle(){}},removeAttribute(key){delete this.attrs[key]},setAttribute(key,value){this.attrs[key]=value},
   querySelectorAll(){return []},querySelector(selector){if(selector==='h2')return {textContent:id};return null},
   cloneNode(){return element(id+'-clone')},append(){},replaceChildren(){},add(){},
   closest(){return ['overview','loop','outside'].includes(id)?this:null},
   addEventListener(name,handler){this.handlers[name]=handler},focus(){},
   scrollIntoView(){context.scrollY+=this.getBoundingClientRect().top-220},
   getBoundingClientRect(){
    if(id==='rn-routebar')return {top:10,bottom:10+barHeight(),height:barHeight()};
    const positions={overview:140,loop:440,'rn-guide-loop':400,outside:1200};
    const top=(positions[id]||0)+barHeight()-context.scrollY;
    return {top,bottom:top+200,height:200};
   }};
  elements.set(id,e);return e;
 }
 const modes=['overlay','docked'].map(name=>{const e=element(name);e.dataset.mode=name;return e});
 const sections=['overview','loop','outside'].map(element);
 const card=element('rn-guide-loop');card.dataset.target='loop';card.hidden=true;
 card.querySelector=selector=>element('card-'+selector);
 element('rn-routebar').hidden=true;
 element('rn-routes').textContent=JSON.stringify([{id:'play',name:'玩法',steps:[{target:'loop',title:'完整过程',focus:'观察动作与后态'}]}]);
 element('rn-config').textContent='{"report_id":"fixture"}';
 const body=element('body');
 context.document={getElementById:element,body,documentElement:{style:{setProperty(){}}},
  querySelectorAll(selector){if(selector==='[data-mode]')return modes;if(selector.includes('section[data-scene]'))return sections;if(selector==='.rn-guide-card')return [card];return []},
  querySelector(){return null},addEventListener(){}};
 vm.runInNewContext(source,context);
 return {body,modes,storage,element,media,context,
  click(name){element(name).handlers.click()},sample(){windowEvents.scroll()},
  resizeBar(height){extraHeight=height},label(){return element('rn-route-label').textContent}};
}
let assertions=0;
for(const width of [375,900,1000,1199,1440]) {
 const page=boot(width);
 assert.equal(page.body.dataset.rnLayout,width>=840?'docked':'overlay');
 assert.equal(page.element('docked').disabled,false);
 page.click('docked');assert.equal(page.body.dataset.rnLayout,'docked');
 page.click('overlay');assert.equal(page.body.dataset.rnLayout,'overlay');
 assert.equal(page.storage.get('fixture.reader.sidebar-mode'),'overlay');
 page.click('docked');page.media[0].matches=false;page.media[0].change();
 assert.equal(page.body.dataset.rnLayout,'docked');
 page.click('rn-close');assert.equal(page.element('rn-panel').hidden,true);
 page.click('rn-toggle');assert.equal(page.element('rn-panel').hidden,false);
 assertions+=8;
}
assert.equal(boot(900,'overlay').body.dataset.rnLayout,'overlay');
assert.equal(boot(375,'docked').body.dataset.rnLayout,'docked');
assert.equal(boot(900,'overlay','?mode=docked').body.dataset.rnLayout,'docked');
// The old probe oscillates at an unmoving boundary. Independent expected result
// includes the guide in its following section, regardless of rendered bar height.
let inside=true;
const oldSequence=[];
for(let i=0;i<6;i++) {inside=180 <= (inside?130:200)+35;oldSequence.push(inside)}
assert.deepEqual(oldSequence,[false,true,false,true,false,true]);
for(const height of [120,190,260]) {
 assert.equal(sectionAtProbe([{id:'overview',top:-500},{id:'loop',top:200},{id:'outside',top:900}],280),'loop');
}
const geometry=[];
for(const width of [375,1000,1440]) {
 const boundary=boot(width,null,'?read=route&domain=play');
 boundary.context.scrollY=330;
 const trajectory=[];
 for(let i=0;i<120;i++) {
  boundary.sample();
  trajectory.push({scrollY:boundary.context.scrollY,label:boundary.label()});
 }
 assert(trajectory.every(sample=>sample.scrollY===260 && /第 1 节/.test(sample.label)),
  'The near-boundary probe must settle once, then remain inside without scroll feedback');
 geometry.push({width,samples:120,initialScrollY:330,settledScrollY:260,section:'loop',stableNearBoundary:true});
 const page=boot(width,null,'?read=route&domain=play');
 page.context.scrollY+=page.element('rn-guide-loop').getBoundingClientRect().top-220;
 page.sample();
 const insideScroll=page.context.scrollY;
 for(let i=0;i<120;i++)page.sample();
 assert.match(page.label(),/第 1 节/);
 assert.equal(page.context.scrollY,insideScroll);
 geometry.push({width,samples:120,section:'loop',inside:true,scrollY:page.context.scrollY});
 page.context.scrollY=1100;page.sample();
 const outsideScroll=page.context.scrollY;
 for(let i=0;i<120;i++)page.sample();
 assert.match(page.label(),/不在这条路线/);
 assert.equal(page.context.scrollY,outsideScroll);
 page.resizeBar(80);
 page.context.scrollY+=page.element('rn-guide-loop').getBoundingClientRect().top-220;
 page.sample();
 for(let i=0;i<120;i++)page.sample();
 assert.match(page.label(),/第 1 节/);
 geometry.push({width,samples:120,section:'outside',inside:false,stableAfterRender:true});
}
console.log(JSON.stringify({status:'pass',layoutAssertions:assertions+3,geometry,
 regression:'Old probe oscillates; production DOM wiring remains stable across stationary samples and internal layout changes.',
 scope:'Deterministic DOM geometry fixture, not a graphical browser or reader acceptance.'}));
