(() => {
 'use strict';

 class ReadingState {
  constructor(routes, sectionIds) {
   this.routes = new Map(routes.map(route => [route.id, route]));
   this.sections = new Set(sectionIds);
   this.coverage = new Map(sectionIds.map(id => [id, routes.filter(route => route.steps.some(step => step.target === id))]));
   this.mode = 'plain';
   this.routeId = null;
   this.sectionId = sectionIds[0];
   this.lastRouteTarget = null;
   this.preferredDomain = null;
   this.perspectives = {};
  }
  covers(domain, target) {
   return this.routes.get(domain)?.steps.some(step => step.target === target) || false;
  }
  setSection(target) {
   if (!this.sections.has(target)) return false;
   this.sectionId = target;
   if (this.mode === 'route' && this.covers(this.routeId, target)) this.lastRouteTarget = target;
   return true;
  }
  assist(enabled) {
   if (!enabled) { this.mode = 'plain'; this.routeId = null; }
   else if (this.mode === 'plain') this.mode = 'assist';
  }
  enterRoute(domain, target) {
   if (!this.covers(domain, target)) return false;
   this.mode = 'route';
   this.routeId = domain;
   this.preferredDomain = domain;
   this.sectionId = target;
   this.lastRouteTarget = target;
   this.perspectives[target] = domain;
   return true;
  }
  choosePerspective(target, domain) {
   if (!this.covers(domain, target)) return false;
   if (this.mode === 'route') return this.enterRoute(domain, target);
   this.mode = 'assist';
   this.sectionId = target;
   this.preferredDomain = domain;
   this.perspectives[target] = domain;
   return true;
  }
  exit() {
   if (this.mode === 'route') { this.mode = 'assist'; this.routeId = null; }
   else this.assist(false);
  }
  perspective(target) {
   if (this.mode === 'plain') return null;
   if (this.mode === 'route') return this.covers(this.routeId, target) ? this.routeId : null;
   const remembered = this.perspectives[target];
   if (this.covers(remembered, target)) return remembered;
   if (this.covers(this.preferredDomain, target)) return this.preferredDomain;
   return this.coverage.get(target)?.[0]?.id || null;
  }
  snapshot() {
   return {mode:this.mode, routeId:this.routeId, sectionId:this.sectionId, lastRouteTarget:this.lastRouteTarget,
    preferredDomain:this.preferredDomain, perspectives:{...this.perspectives}};
  }
  restore(saved) {
   this.mode = ['plain','assist','route'].includes(saved?.mode) ? saved.mode : 'plain';
   this.routeId = this.routes.has(saved?.routeId) ? saved.routeId : null;
   this.preferredDomain = this.routes.has(saved?.preferredDomain) ? saved.preferredDomain : null;
   this.perspectives = {};
   for (const [target, domain] of Object.entries(saved?.perspectives || {})) {
    if (this.covers(domain, target)) this.perspectives[target] = domain;
   }
   this.setSection(this.sections.has(saved?.sectionId) ? saved.sectionId : [...this.sections][0]);
   if (this.mode === 'route' && !this.routeId) this.mode = 'assist';
   if (this.mode !== 'route') this.routeId = null;
   this.lastRouteTarget = this.covers(this.routeId, saved?.lastRouteTarget) ? saved.lastRouteTarget
    : this.routes.get(this.routeId)?.steps[0].target || null;
   if (this.mode === 'route' && this.covers(this.routeId, this.sectionId)) this.lastRouteTarget = this.sectionId;
  }
 }
 function sectionAtProbe(positions, probe) {
  let current = positions[0]?.id || null;
  for (const position of positions) {
   if (position.top > probe) break;
   current = position.id;
  }
  return current;
 }
 if (typeof module === 'object' && module.exports) { module.exports = {ReadingState, sectionAtProbe}; return; }

 const $ = id => document.getElementById(id);
 const routes = JSON.parse($('rn-routes').textContent);
 const routeMap = new Map(routes.map(route => [route.id, route]));
 const config = JSON.parse($('rn-config').textContent);
 const sections = [...document.querySelectorAll('#reader-canvas section[data-scene]')];
 const model = new ReadingState(routes, sections.map(section => section.id));
 const panel = $('rn-panel'), trigger = $('rn-toggle'), bar = $('rn-routebar');
 const cards = new Map([...document.querySelectorAll('.rn-guide-card')].map(card => [card.dataset.target, card]));
 const wide = matchMedia('(min-width:840px)');
 const modeKey = `${config.report_id}.reader.sidebar-mode`;
 const params = new URLSearchParams(location.search);
 let storedMode = null;
 try { storedMode = localStorage.getItem(modeKey); } catch {}
 let layoutMode = ['overlay','docked'].includes(params.get('mode')) ? params.get('mode')
  : ['overlay','docked'].includes(storedMode) ? storedMode : wide.matches ? 'docked' : 'overlay';
 let open = true, selectedTab = 'toc', scrollFrame = false;

 const toc = $('contents').cloneNode(true);
 toc.removeAttribute('id');
 toc.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
 $('rn-toc').append(...toc.childNodes);
 document.body.classList.add('rn-enhanced');
 $('rn-autoclose').checked = !wide.matches;

 function preservePosition(change) {
  const anchor = scrollY < 30 ? null : $(model.sectionId);
  const top = anchor?.getBoundingClientRect().top;
  change();
  if (anchor) scrollBy(0, anchor.getBoundingClientRect().top - top);
 }
 function measureBar() {
  document.documentElement.style.setProperty('--rn-route-offset', `${bar.hidden ? 24 : Math.ceil(bar.getBoundingClientRect().height) + 24}px`);
 }
 function layout() {
  document.body.dataset.rnLayout = layoutMode;
  document.body.classList.toggle('rn-open', open);
  panel.hidden = !open;
  trigger.hidden = open;
  trigger.setAttribute('aria-expanded', String(open));
  document.querySelectorAll('[data-mode]').forEach(button => {
   button.disabled = false;
   button.setAttribute('aria-pressed', String(button.dataset.mode === layoutMode));
  });
  measureBar();
 }
 function setOpen(value, focus = false) {
  preservePosition(() => { open = value; layout(); });
  if (focus) (value ? $('rn-tab-'+selectedTab) : trigger).focus({preventScroll:true});
 }
 function setTab(name, focus = false) {
  selectedTab = name;
  for (const tab of ['toc','domains']) {
   const selected = tab === name;
   $('rn-tab-'+tab).setAttribute('aria-selected', String(selected));
   $('rn-tab-'+tab).tabIndex = selected ? 0 : -1;
   $('rn-'+tab).hidden = !selected;
  }
  if (focus) $('rn-tab-'+name).focus({preventScroll:true});
 }
 function revealRoute(domain, scroll = false) {
  panel.querySelectorAll('.rn-domain').forEach(details => { details.open = details.dataset.domain === domain; });
  if (scroll) panel.querySelector(`.rn-domain[data-domain="${domain}"] a[data-target="${model.sectionId}"]`)?.scrollIntoView({block:'nearest'});
 }
 function jumpToSection(target) {
  const guide = cards.get(target);
  const element = guide && !guide.hidden ? guide : $(target);
  element?.scrollIntoView({block:'start',behavior:'instant'});
 }
 function saveHistory(replace = false) {
  const url = new URL(location.href);
  url.searchParams.set('read', model.mode);
  url.searchParams.set('view', selectedTab);
  if (model.mode === 'route') url.searchParams.set('domain', model.routeId);
  else url.searchParams.delete('domain');
  url.hash = model.sectionId;
  history[replace ? 'replaceState' : 'pushState']({reader:model.snapshot(), rnTab:selectedTab, researchScroll:scrollY},'',url);
 }
 function rememberPosition() {
  history.replaceState({reader:model.snapshot(),rnTab:selectedTab,researchScroll:scrollY},'');
 }
 function updateLinks() {
  panel.querySelectorAll('a[href^="#"]').forEach(link => {
   const target = link.dataset.target || decodeURIComponent(link.hash.slice(1));
   const current = target === model.sectionId && (!link.dataset.route || model.mode === 'route' && link.dataset.route === model.routeId);
   if (current) link.setAttribute('aria-current','location'); else link.removeAttribute('aria-current');
  });
 }
 function updateBar() {
  bar.hidden = model.mode !== 'route';
  if (bar.hidden) { measureBar(); return; }
  const route = routeMap.get(model.routeId);
  const index = route.steps.findIndex(step => step.target === model.lastRouteTarget);
  const inside = model.covers(model.routeId, model.sectionId);
  $('rn-route-label').textContent = inside ? `${route.name} · 第 ${index+1} 节 / 共 ${route.steps.length} 节` : `${route.name} · 当前小节不在这条路线内`;
  $('rn-route-title').textContent = inside ? route.steps[index].title : $(model.sectionId)?.querySelector('h2')?.textContent || '';
  $('rn-route-return').hidden = inside;
  $('rn-prev').disabled = index <= 0;
  $('rn-next').disabled = index >= route.steps.length-1;
  $('rn-prev-title').textContent = route.steps[index-1]?.short_title || route.steps[index-1]?.title || '路线起点';
  $('rn-next-title').textContent = route.steps[index+1]?.short_title || route.steps[index+1]?.title || '路线终点';
  $('rn-route-progress').max = route.steps.length;
  $('rn-route-progress').value = index+1;
  const alternatives = model.coverage.get(model.sectionId) || [];
  const select = $('rn-route-perspective');
  select.replaceChildren();
  if (!inside) select.add(new Option('切换本节领域', ''));
  for (const domain of alternatives) select.add(new Option(domain.name, domain.id));
  select.value = inside ? model.routeId : '';
  $('rn-route-perspective-label').hidden = (alternatives.length < 2 && inside) || alternatives.length === 0;
  measureBar();
 }
 function renderBar() {
  // Sticky content can change height. Keep the research content stationary so
  // that rendering progress never creates another chapter transition.
  preservePosition(updateBar);
 }
 function render() {
  document.body.dataset.rnReading = model.mode;
  $('rn-assist').checked = model.mode !== 'plain';
  $('rn-reading-status').textContent = {plain:'目录阅读',assist:'目录＋领域辅助',route:'领域路线阅读'}[model.mode];
  for (const [target, card] of cards) {
   const domain = model.perspective(target);
   card.hidden = !domain;
   if (!domain) continue;
   const route = routeMap.get(domain);
   card.querySelector('select').value = domain;
   card.querySelector('.rn-guide-focus').textContent = route.steps.find(step => step.target === target).focus;
   card.querySelector('[data-reader-action="exit"]').textContent = model.mode === 'route' ? '退出路线' : '关闭领域辅助';
  }
  renderBar();
  updateLinks();
 }
 function enterRoute(domain, target, showPanel = false, jump = false) {
  if (!model.covers(domain, target)) return;
  rememberPosition();
  preservePosition(() => { model.enterRoute(domain,target); setTab('domains'); render(); });
  revealRoute(domain, showPanel);
  if (showPanel) { setOpen(true); revealRoute(domain,true); }
  if (jump) jumpToSection(target);
  saveHistory();
 }
 function choosePerspective(target, domain) {
  rememberPosition();
  const wasRoute = model.mode === 'route';
  preservePosition(() => { model.choosePerspective(target,domain); if (wasRoute) setTab('domains'); render(); });
  if (wasRoute) revealRoute(domain, open);
  saveHistory();
 }
 function leaveReading() {
  rememberPosition();
  preservePosition(() => { model.exit(); setTab('toc'); render(); });
  saveHistory();
  if (model.mode === 'plain') (open ? $('rn-assist') : trigger).focus({preventScroll:true});
 }
 function goCatalog(target) {
  if (!model.sections.has(target)) { $(target)?.scrollIntoView({block:'start'}); return; }
  rememberPosition();
  preservePosition(() => { if (model.mode === 'route') model.exit(); model.setSection(target); setTab('toc'); render(); });
  if ($('rn-autoclose').checked) setOpen(false);
  jumpToSection(target);
  saveHistory();
 }

 trigger.addEventListener('click', () => setOpen(true,true));
 $('rn-close').addEventListener('click', () => setOpen(false,true));
 $('rn-assist').addEventListener('change', () => {
  rememberPosition();
  const enabled = $('rn-assist').checked;
  preservePosition(() => { model.assist(enabled); setTab('toc'); render(); });
  if (enabled) jumpToSection(model.sectionId);
  saveHistory();
 });
 for (const name of ['toc','domains']) {
  $('rn-tab-'+name).addEventListener('click', () => {
   if (name === 'toc' && model.mode === 'route') leaveReading();
   setTab(name); saveHistory(true);
  });
  $('rn-tab-'+name).addEventListener('keydown', event => {
   if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const next = name === 'toc' ? 'domains' : 'toc';
    if (next === 'toc' && model.mode === 'route') leaveReading();
    setTab(next,true); saveHistory(true);
   }
  });
 }
 document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => preservePosition(() => {
  layoutMode = button.dataset.mode;
  try { localStorage.setItem(modeKey,layoutMode); } catch {}
  layout();
 })));
 panel.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  event.preventDefault();
  const target = link.dataset.target || decodeURIComponent(link.hash.slice(1));
  if (link.dataset.route) {
   enterRoute(link.dataset.route,target,false,true);
   if ($('rn-autoclose').checked) setOpen(false);
  } else goCatalog(target);
 });
 document.addEventListener('change', event => {
  const select = event.target.closest('.rn-guide-perspective');
  if (select) choosePerspective(select.closest('.rn-guide-card').dataset.target,select.value);
 });
 document.addEventListener('click', event => {
  const action = event.target.closest('[data-reader-action]');
  if (action) {
   const card = action.closest('.rn-guide-card');
   if (action.dataset.readerAction === 'exit') leaveReading();
   else enterRoute(model.perspective(card.dataset.target),card.dataset.target,true,true);
   return;
  }
  const link = event.target.closest('#contents a[href^="#"]');
  if (link) { event.preventDefault(); goCatalog(decodeURIComponent(link.hash.slice(1))); }
 });
 $('rn-route-perspective').addEventListener('change', event => {
  if (event.target.value) choosePerspective(model.sectionId,event.target.value);
 });
 for (const [button, direction] of [['rn-prev',-1],['rn-next',1]]) {
  $(button).addEventListener('click', () => {
   const route = routeMap.get(model.routeId);
   const index = route.steps.findIndex(step => step.target === model.lastRouteTarget) + direction;
   if (index >= 0 && index < route.steps.length) enterRoute(route.id,route.steps[index].target,false,true);
  });
 }
 $('rn-route-return').addEventListener('click', () => enterRoute(model.routeId,model.lastRouteTarget,false,true));
 document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && open && !document.querySelector('dialog[open]')) { event.preventDefault(); setOpen(false,true); }
 });
 function sectionFromHash() {
  const element = $(decodeURIComponent(location.hash.slice(1)));
  return element?.closest('section[data-scene]')?.id || null;
 }
 function restore() {
  const query = new URLSearchParams(location.search);
  const target = sectionFromHash() || sections[0].id;
  const saved = history.state?.reader || {mode:query.get('read') || (routeMap.has(query.get('domain')) ? 'route' : 'plain'),
   routeId:query.get('domain'),sectionId:target,preferredDomain:query.get('domain')};
  model.restore(saved);
  setTab(model.mode === 'route' ? 'domains' : history.state?.rnTab || (query.get('view') === 'domains' ? 'domains' : 'toc'));
  render();
  if (model.mode === 'route') revealRoute(model.routeId);
 }
 addEventListener('popstate', () => {
  restore();
  if (Number.isFinite(history.state?.researchScroll)) scrollTo(0,history.state.researchScroll);
  else jumpToSection(model.sectionId);
 });
 addEventListener('hashchange', () => {
  const target = sectionFromHash();
  if (target && target !== model.sectionId) { model.setSection(target); render(); }
 });
 addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = true;
  requestAnimationFrame(() => {
   scrollFrame = false;
   // A guide belongs to its following section. Sample stable reading units at
   // a viewport-only line, independently of the progress bar's own geometry.
   const probe = Math.min(320, Math.max(120, innerHeight * 0.35));
   const positions = sections.map(section => {
    const guide = cards.get(section.id);
    const start = guide && !guide.hidden ? guide : section;
    return {id:section.id, top:start.getBoundingClientRect().top};
   });
   const target = sectionAtProbe(positions, probe);
   if (target && target !== model.sectionId) { model.setSection(target); renderBar(); updateLinks(); }
  });
 }, {passive:true});
 wide.addEventListener('change', () => preservePosition(layout));
 if (typeof ResizeObserver === 'function') new ResizeObserver(measureBar).observe(bar);
 else addEventListener('resize',measureBar);
 restore(); layout(); rememberPosition();
 if (location.hash) requestAnimationFrame(() => jumpToSection(model.sectionId));
})();
