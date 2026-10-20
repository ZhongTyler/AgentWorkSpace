// Pure, adapter-driven checks. Does not fetch, edit sources, bless hashes or deploy.
import { mapProvider, mapUrlMatches } from './maps.mjs';
export function websiteHealth(data, { today, now = new Date().toISOString(), assetExists = () => true, sourceText = {}, regressions = [] } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? '')) throw Error('Explicit local today required');
  const provider = data.mapProvider || data.map?.provider || mapProvider({ days: data.days, mapProvider: data.mapProvider });
  const errors = [], warnings = [];
  const add = (level, code, target, detail) => (level === 'error' ? errors : warnings).push({ code, target, detail });
  const dates = new Set(data.days.map(d => d.date));
  const places = new Map(data.locations.map(p => [p.id, p]));
  const routes = new Map([...data.routes, ...data.overviews].map(r => [r.id, r]));
  const catalog = new Set(data.restaurantCatalog.entries.map(p => p.name));
  const sources = new Set(Object.keys(data.sources));
  if (dates.size !== data.days.length) add('error', 'duplicate-date', 'days', '每日日期重复');
  if (places.size !== data.locations.length || routes.size !== data.routes.length + data.overviews.length) add('error', 'duplicate-id', 'navigation', '地点或路线ID重复');
  for (const r of routes.values()) {
    if (!dates.has(r.date)) add('error', 'route-date', r.id, r.date);
    for (const id of r.stops) if (!places.has(id)) add('error', 'route-place', r.id, id);
    if (!/^https:\/\//.test(r.href ?? '')) add('error', 'route-url', r.id, '缺少HTTPS导航/运营方指引');
    if (r.mode !== 'official' && !r.screenshot) add(r.date >= today ? 'error' : 'warning', 'route-screenshot', r.id, r.screenshotStatus ?? '缺少与当前路线绑定的可用截图');
  }
  for (const day of data.days) {
    for (const id of day.routeIds) if (routes.get(id)?.date !== day.date) add('error', 'day-route', day.date, id);
    const expected = data.routes.filter(r => r.date === day.date).map(r => r.id).sort();
    if (JSON.stringify([...day.routeIds].sort()) !== JSON.stringify(expected)) add('error', 'route-projection', day.date, '每日与地图路线集合不一致');
    if (day.overviewId && routes.get(day.overviewId)?.date !== day.date) add('error', 'day-overview', day.date, day.overviewId);
    for (const m of day.mealPlan) if (m.name && !['住宿自炊', '自带泡面'].includes(m.name) && !catalog.has(m.name)) add('error', 'meal-catalog', day.date, m.name);
    if (data.journal.chapters.filter(c => c.date === day.date).length !== 1) add('error', 'journal-date', day.date, '手册缺失或重复');
  }
  for (const p of places.values()) {
    if (p.navigation !== false && !mapUrlMatches(p.mapUrl, provider)) add('error', 'place-map', p.id, '地点卡无有效地图点入口');
  }
  const todoIds = new Set();
  for (const t of data.todos) {
    if (todoIds.has(t.id)) add('error', 'todo-id', t.id, '待办ID重复');
    todoIds.add(t.id);
    for (const date of t.dates) if (!dates.has(date)) add('error', 'todo-date', t.id, date);
    if (!t.origin) add('error', 'todo-origin', t.id, '待办无权威来源');
  }
  for (const w of data.wikiLibrary) {
    if (!sources.has(w.source)) add('error', 'wiki-source', w.name, w.source);
    const due = sourceText[w.source]?.match(/^review_by:\s*["']?(\d{4}-\d{2}-\d{2})/m)?.[1];
    if (due && due < today) add('warning', w.dates.some(d => d >= today) ? 'active-source-review-due' : 'historical-source-review-due', w.source, `复查期限${due}；只核验部分字段不能批量更新全页期限`);
  }
  const weatherDates = new Set(data.weather.days.map(w => w.date));
  if (weatherDates.size !== data.weather.days.length) add('error', 'weather-duplicate-date', 'weather', '天气日期重复');
  for (const date of dates) if (!weatherDates.has(date)) add('error', 'weather-day-missing', date, '没有逐日天气记录；缺测也须显式保留该日');
  for (const w of data.weather.days) {
    if (!dates.has(w.date)) add('error', 'weather-date', w.date, '不在行程日期内');
    const placeIds = new Set();
    for (const p of w.places) {
      if (placeIds.has(p.id)) add('error', 'weather-place', w.date, p.id);
      placeIds.add(p.id);
      if (w.date >= today && p.historicalForecast) add('error', 'future-weather-history', `${w.date}/${p.id}`, '当前/未来不得用历史快照补值');
      const min = p.daily?.temperature_2m_min, max = p.daily?.temperature_2m_max;
      if (!Number.isFinite(min) || !Number.isFinite(max)) add('warning', 'weather-missing', `${w.date}/${p.id}`, '缺测保持空值，不伪装为0°C');
      else if (min > max) add('error', 'weather-range', `${w.date}/${p.id}`, '最低温高于最高温');
      if (w.date >= today && (!p.daily?.sunrise || !p.daily?.sunset)) add('warning', 'weather-sun', `${w.date}/${p.id}`, '日出日落缺测');
      if (w.date >= today && Date.parse(now) - Date.parse(p.sourceFetchedAt) > 864e5) add('warning', 'weather-age', `${w.date}/${p.id}`, '当前/未来预报已超过24小时');
      if (!Number.isFinite(Date.parse(p.sourceFetchedAt))) add('error', 'weather-provenance', `${w.date}/${p.id}`, '缺少原始查询时刻');
    }
  }
  const scan = (value, target = 'site') => {
    if (typeof value === 'string') {
      for (const m of value.matchAll(/#source=([^"'<>\s]+)/g)) {
        let name; try { name = decodeURIComponent(m[1]); } catch { name = m[1]; }
        if (!sources.has(name)) add('error', 'source-link', target, name);
      }
      for (const m of value.matchAll(/#place=([a-z0-9-]+)/g)) if (!places.has(m[1])) add('error', 'place-link', target, m[1]);
      const assets=[...value.matchAll(/(?:src|href)=["']((?:\.\/)?generated\/(?:assets|sources)\/[^"']+)["']/g)].map(m=>m[1]);
      if (/^(?:\.\/)?generated\/(?:assets|sources)\//.test(value)) assets.push(value);
      for (const ref of assets) if (!assetExists(ref.replace(/^\.\//, ''))) add('error', 'asset-link', target, ref);
    } else if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${target}[${i}]`));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (!['manifest', 'searchText'].includes(k)) scan(v, `${target}.${k}`);
  };
  scan(data);
  // Known regression patterns are project-local evidence, not a second itinerary.
  for (const r of regressions) for (const file of r.files) {
    if (sourceText[file] === undefined) add('error', 'regression-source', r.id, file);
    else if (new RegExp(r.pattern, 'm').test(sourceText[file])) add('error', 'content-regression', file, `${r.id}: ${r.reason}`);
  }
  const unique = rows => [...new Map(rows.map(r => [JSON.stringify(r), r])).values()];
  return { schemaVersion: 1, today, at: now, passed: errors.length === 0, inventory: { days: dates.size, routes: data.routes.length, overviews: data.overviews.length, places: places.size, sources: sources.size, wiki: data.wikiLibrary.length, todos: data.todos.length }, errors: unique(errors), warnings: unique(warnings), boundary: '结构、来源及已知漂移检查；不证明全部文案、实时营业、现场通道、合法停车或用户体验' };
}
