// Execute the real navigation controller with a small DOM fixture.
// This verifies state transitions, not browser layout or reader acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'navigation.js'), 'utf8');
function boot(width, stored, search = '') {
 const elements = new Map(), media = [], storage = new Map();
 if (stored) storage.set('fixture.reader.sidebar-mode', stored);
 function element(id) {
  if (elements.has(id)) return elements.get(id);
  const e = {id, dataset:{}, hidden:false, disabled:false, checked:false, childNodes:[], attrs:{}, handlers:{},
   classList:{add(){},toggle(){}}, removeAttribute(k){delete this.attrs[k]},
   setAttribute(k,v){this.attrs[k]=v}, querySelectorAll(){return []},
   cloneNode(){return element(id+'-clone')}, append(){},
   getBoundingClientRect(){return {top:150,bottom:300,height:60}},
   addEventListener(k,f){this.handlers[k]=f}, focus(){}};
  elements.set(id,e);return e;
 }
 const modes=['overlay','docked'].map(name=>{const e=element(name);e.dataset.mode=name;return e});
 element('rn-routes').textContent='[]';element('rn-config').textContent='{"report_id":"fixture"}';
 const body=element('body');
 const document={getElementById:element,body,documentElement:{style:{setProperty(){}}},
  querySelectorAll(q){return q==='[data-mode]'?modes:[]},querySelector(){return null},addEventListener(){}};
 vm.runInNewContext(source,{document,URLSearchParams,location:{search,hash:''},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  matchMedia(query){const m={matches:width>=Number(query.match(/\d+/)[0]),addEventListener(k,f){this.change=f}};media.push(m);return m},
  scrollY:0,scrollBy(){throw Error('top-of-page layout must not force scrolling')},
  addEventListener(){},history:{replaceState(){throw Error('layout must not change history')},pushState(){throw Error('layout must not navigate')}},
  ResizeObserver:undefined});
 return {body,modes,storage,element,media,click(name){element(name).handlers.click()}};
}
// Regression: split desktop panes below 1200px must still offer a working choice.
for (const width of [375,900,1000,1199,1440]) {
 const page=boot(width);
 assert.equal(page.body.dataset.rnLayout,width>=840?'docked':'overlay');
 assert.equal(page.element('docked').disabled,false);
 page.click('docked');assert.equal(page.body.dataset.rnLayout,'docked');
 assert.equal(page.element('docked').attrs['aria-pressed'],'true');
 page.click('overlay');assert.equal(page.body.dataset.rnLayout,'overlay');
 assert.equal(page.element('overlay').attrs['aria-pressed'],'true');
 assert.equal(page.storage.get('fixture.reader.sidebar-mode'),'overlay');
 page.click('docked');page.media[0].matches=false;page.media[0].change();
 assert.equal(page.body.dataset.rnLayout,'docked');
 page.element('rn-close').handlers.click();assert.equal(page.element('rn-panel').hidden,true);
 page.element('rn-toggle').handlers.click();assert.equal(page.element('rn-panel').hidden,false);
 assert.equal(page.body.dataset.rnLayout,'docked');
}
assert.equal(boot(900,'overlay').body.dataset.rnLayout,'overlay');
assert.equal(boot(375,'docked').body.dataset.rnLayout,'docked');
assert.equal(boot(900,'overlay','?mode=docked').body.dataset.rnLayout,'docked');
console.log('PASS: real controller state at 5 viewport widths; switch, preference, resize, close/reopen; no browser-layout claim.');
