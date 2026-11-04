(() => {
 'use strict';
 const $ = id => document.getElementById(id);
 const panel = $('rn-panel'), trigger = $('rn-toggle');
 const routes = JSON.parse($('rn-routes').textContent);
 const routeMap = new Map(routes.map(r => [r.id,r]));
 const reportId = JSON.parse($('rn-config').textContent).report_id;
 const modeKey = `${reportId}.reader.sidebar-mode`;
 const params = new URLSearchParams(location.search);
 const wide = matchMedia('(min-width:840px)');
 let storedMode = null;
 try {storedMode = localStorage.getItem(modeKey);} catch {}
 let mode = ['overlay','docked'].includes(params.get('mode')) ? params.get('mode') : ['overlay','docked'].includes(storedMode) ? storedMode : wide.matches ? 'docked' : 'overlay';
 let activeRoute = null, stepIndex = 0, open = false;
 let selectedTab = params.get('view') === 'domains' ? 'domains' : 'toc';
 const toc = $('contents').cloneNode(true);
 toc.removeAttribute('id');
 // The copied navigation must not duplicate any original document identities.
 toc.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));
 $('rn-toc').append(...toc.childNodes);
 document.body.classList.add('rn-enhanced');
 trigger.hidden = false;
 $('rn-autoclose').checked = !wide.matches;

 function anchorNow() {
  return [...document.querySelectorAll('#reader-canvas [data-scene],#reader-canvas .appendix-document h2[id],#reader-canvas .appendix-document h3[id]')]
   .filter(e => e.getBoundingClientRect().bottom > 120)
   .sort((a,b) => Math.abs(a.getBoundingClientRect().top - 150)-Math.abs(b.getBoundingClientRect().top - 150))[0];
 }
 function preservePosition(change) {
  const atTop = scrollY < 30;
  const anchor = atTop ? null : anchorNow();
  const y = anchor?.getBoundingClientRect().top;
  change();
  if (anchor) scrollBy(0, anchor.getBoundingClientRect().top - y);
 }
 function layout() {
  document.body.dataset.rnLayout = mode;
  document.body.classList.toggle('rn-open', open);
  document.querySelectorAll('[data-mode]').forEach(b => {
   b.setAttribute('aria-pressed', String(b.dataset.mode === document.body.dataset.rnLayout));
   b.disabled = false;
  });
  measureRoute();
 }
 function measureRoute() {
  const height = activeRoute ? $('rn-routebar').getBoundingClientRect().height : 0;
  document.documentElement.style.setProperty('--rn-route-offset', `${Math.ceil(height)+24}px`);
 }
 function setOpen(value, focus = true) {
  preservePosition(() => {open = value; panel.hidden = !value; trigger.hidden = value; trigger.setAttribute('aria-expanded', String(value)); layout();});
  if (focus) (value ? $('rn-tab-'+selectedTab) : trigger).focus({preventScroll:true});
 }
 function setTab(name, focus = false) {
  selectedTab = name;
  for (const t of ['toc','domains']) {
   const tab = $('rn-tab-'+t), selected = t === name;
   tab.setAttribute('aria-selected',String(selected)); tab.tabIndex = selected ? 0 : -1;
   $('rn-'+t).hidden = !selected;
  }
  if (focus) $('rn-tab-'+name).focus();
 }
 function showRoute(id) {
  const details = panel.querySelector(`.rn-domain[data-domain="${id}"]`);
  if (!details) return;
  panel.querySelectorAll('.rn-domain').forEach(d => d.open = d === details);
  details.scrollIntoView({block:'nearest'});
 }
 function updateRoute() {
  $('rn-routebar').hidden = !activeRoute;
  if (!activeRoute) {measureRoute();return;}
  const r = routeMap.get(activeRoute), s = r.steps[stepIndex];
  $('rn-route-label').textContent = `${r.name} · 阅读路线 ${stepIndex+1} / ${r.steps.length}`;
  $('rn-route-title').textContent = s.title;
  $('rn-route-focus').textContent = s.focus;
  $('rn-route-detail').href = '#'+s.source.detail_target;
  $('rn-prev').disabled = stepIndex === 0;
  $('rn-next').disabled = stepIndex === r.steps.length-1;
  measureRoute();
  updateLinks();
 }
 function updateLinks() {
  const target = decodeURIComponent(location.hash.slice(1));
  panel.querySelectorAll('a[href^="#"]').forEach(a => {
   const current = a.dataset.route ? a.dataset.route === activeRoute && Number(a.dataset.step) === stepIndex && a.hash === location.hash : a.hash === '#'+target;
   if (current) a.setAttribute('aria-current','location'); else a.removeAttribute('aria-current');
  });
 }
 function goRoute(id, index) {
  const r = routeMap.get(id); if (!r || index < 0 || index >= r.steps.length) return;
  activeRoute = id; stepIndex = index; updateRoute();
  if ($('rn-autoclose').checked) setOpen(false, false);
  const target = $(r.steps[index].target);
  for(let parent=target.parentElement;parent;parent=parent.parentElement) {
   if(parent.tagName === 'DETAILS')parent.open=true;
  }
  history.replaceState({...history.state,researchScroll:scrollY},'');
  history.pushState({rnRoute:id,rnStep:index},'','#'+target.id);
  target.tabIndex = -1;
  target.scrollIntoView({block:'start'});
  target.focus({preventScroll:true});
  if(typeof updateReadingReturn === 'function')updateReadingReturn();
  updateLinks();
 }
 trigger.addEventListener('click',()=>setOpen(true));
 $('rn-close').addEventListener('click',()=>setOpen(false));
 for (const t of ['toc','domains']) {
  $('rn-tab-'+t).addEventListener('click',()=>setTab(t));
  $('rn-tab-'+t).addEventListener('keydown',e=>{
   if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) {
    e.preventDefault(); setTab(e.key === 'Home' ? 'toc' : e.key === 'End' ? 'domains' : t === 'toc' ? 'domains' : 'toc',true);
   }
  });
 }
 document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>preservePosition(()=>{
  mode=b.dataset.mode;
  try {localStorage.setItem(modeKey,mode);} catch {}
  layout();
 })));
 panel.addEventListener('click',e=>{
  const a=e.target.closest('a[href^="#"]');if(!a)return;
  if (a.dataset.route) {e.preventDefault();goRoute(a.dataset.route,Number(a.dataset.step));}
  else {
   activeRoute=null;updateRoute();
   if($('rn-autoclose').checked)setOpen(false,false);
  }
 });
 panel.querySelectorAll('.rn-domain').forEach(d=>d.addEventListener('toggle',()=>{
  if(d.open)panel.querySelectorAll('.rn-domain').forEach(other=>{if(other!==d)other.open=false;});
 }));
 $('rn-prev').addEventListener('click',()=>goRoute(activeRoute,stepIndex-1));
 $('rn-next').addEventListener('click',()=>goRoute(activeRoute,stepIndex+1));
 $('rn-show-route').addEventListener('click',()=>{setTab('domains');setOpen(true);showRoute(activeRoute);});
 $('rn-exit-route').addEventListener('click',()=>{
  preservePosition(()=>{activeRoute=null;updateRoute();});
  setTab('domains');setOpen(true); // Keep a live focus target after removing the route controls.
 });
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape' && open && !document.querySelector('dialog[open]')){e.preventDefault();setOpen(false);}
 });
 addEventListener('hashchange',()=>{
  if(activeRoute){const i=routeMap.get(activeRoute).steps.findIndex(s=>'#'+s.target===location.hash);if(i>=0)stepIndex=i;else activeRoute=null;updateRoute();}
  updateLinks();
 });
 addEventListener('popstate',e=>{
  if(e.state?.rnRoute && routeMap.has(e.state.rnRoute) && Number.isInteger(e.state.rnStep) && e.state.rnStep >= 0 && e.state.rnStep < routeMap.get(e.state.rnRoute).steps.length){activeRoute=e.state.rnRoute;stepIndex=e.state.rnStep;}
  else activeRoute=null;
  updateRoute();updateLinks();
 });
 wide.addEventListener('change',()=>preservePosition(layout));
 if(typeof ResizeObserver === 'function')new ResizeObserver(measureRoute).observe($('rn-routebar'));
 else addEventListener('resize',measureRoute);
 setTab(selectedTab);setOpen(true,false);
 const startingDomain=params.get('domain');
 if(routeMap.has(startingDomain)) {
  setTab('domains');showRoute(startingDomain);
  const r=routeMap.get(startingDomain),i=r.steps.findIndex(s=>'#'+s.target===location.hash);
  if(i>=0){activeRoute=startingDomain;stepIndex=i;updateRoute();}
 }
 if(location.hash)requestAnimationFrame(()=>$(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({block:'start'}));
 updateLinks();
})();
