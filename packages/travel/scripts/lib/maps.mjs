// Map provider adapter. Domestic (CN) trips use Amap; other trips keep Google Maps.
// Pure module: no Node/file access, safe to inline into the offline page.
export const MAP_PROVIDERS = ['amap', 'google'];
export const MAP_LABEL = { amap: '高德地图', google: 'Google Maps' };
const CN_ZONES = /^Asia\/(Shanghai|Chongqing|Urumqi|Harbin|Kashgar|Taipei|Hong_Kong|Macau)$/;
const AMAP_MODE = { driving: 'car', walking: 'walk', bicycling: 'ride', transit: 'bus' };
const AMAP_VIA_MAX = 3;

export function mapProvider(trip) {
  if (MAP_PROVIDERS.includes(trip?.mapProvider)) return trip.mapProvider;
  const zones = (trip?.days || []).map(d => d.timezone).filter(Boolean);
  return zones.length && zones.every(z => CN_ZONES.test(z)) ? 'amap' : 'google';
}
export function mapLabel(trip) { return MAP_LABEL[mapProvider(trip)]; }

export function mapCity(trip, places = []) {
  if (trip?.mapCity) return trip.mapCity;
  const named = (trip?.days || []).find(d => d.city)?.city;
  if (named) return named;
  for (const p of places) {
    const hit = String(p?.address || '').match(/([\u4e00-\u9fa5]{2,12}?(?:市|自治州|地区|盟))/);
    if (hit) return hit[1].replace(/^.*?(?:省|自治区|特别行政区)/, '');
  }
  return '';
}

export function hasLocation(p) {
  return Number.isFinite(p?.location?.lng) && Number.isFinite(p?.location?.lat);
}
export function locationSource(p) { return p?.location?.source || null; }

export function amapSearch(keyword, city) {
  const u = new URL('https://uri.amap.com/search');
  u.searchParams.set('keyword', keyword);
  if (city) u.searchParams.set('city', city);
  u.searchParams.set('src', 'travel-workflow');
  u.searchParams.set('callnative', '1');
  return u.href;
}
export function amapMarker(p) {
  const u = new URL('https://uri.amap.com/marker');
  u.searchParams.set('position', p.location.lng + ',' + p.location.lat);
  u.searchParams.set('name', p.name);
  u.searchParams.set('src', 'travel-workflow');
  u.searchParams.set('coordinate', 'gaode');
  u.searchParams.set('callnative', '1');
  return u.href;
}
function amapPoint(p) { return [p.location.lng, p.location.lat, p.name].join(','); }
export function amapNavigation(points, mode) {
  const u = new URL('https://uri.amap.com/navigation');
  u.searchParams.set('from', amapPoint(points[0]));
  u.searchParams.set('to', amapPoint(points.at(-1)));
  const via = points.slice(1, -1);
  if (via.length) u.searchParams.set('via', via.map(amapPoint).join('|'));
  u.searchParams.set('mode', AMAP_MODE[mode] || 'car');
  if (mode === 'driving') u.searchParams.set('policy', '1');
  u.searchParams.set('src', 'travel-workflow');
  u.searchParams.set('coordinate', 'gaode');
  u.searchParams.set('callnative', '1');
  return u.href;
}
export function googlePointSearch(p) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.name + ' ' + (p.address || ''));
}
function googlePlaceId(p) {
  if (p.googlePlaceId) return p.googlePlaceId;
  try { return new URL(p.mapUrl).searchParams.get('query_place_id'); } catch { return null; }
}
export function googleDirections(places, mode) {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('travelmode', mode);
  u.searchParams.set('origin', places[0].address || places[0].name);
  u.searchParams.set('destination', places.at(-1).address || places.at(-1).name);
  if (places.length > 2) u.searchParams.set('waypoints', places.slice(1, -1).map(p => p.address || p.name).join('|'));
  const mid = places.slice(1, -1);
  const ids = places.map(googlePlaceId);
  if (ids[0]) u.searchParams.set('origin_place_id', ids[0]);
  if (ids.at(-1)) u.searchParams.set('destination_place_id', ids.at(-1));
  if (mid.length && mid.every((p, i) => ids[i + 1])) u.searchParams.set('waypoint_place_ids', ids.slice(1, -1).join('|'));
  return u.href;
}

// A registered mapUrl always wins. Otherwise derive one that opens the same provider.
export function placeUrl(trip, p) {
  if (p.mapUrl) return p.mapUrl;
  if (mapProvider(trip) === 'google') return googlePointSearch(p);
  return hasLocation(p) ? amapMarker(p) : amapSearch(p.name, mapCity(trip, [p]));
}

// A pending leg only records the order of the day. It has no settled mode, path or
// provider link, so nothing may be presented as a route until the trip owner decides one.
export function routePending(route) { return route?.status === 'pending'; }

// Returns every entry the reader needs. exact=true means a real point-to-point route;
// exact=false means the provider can only be opened at the endpoints (no coordinates registered).
export function routeLinks(trip, route) {
  if (routePending(route)) return [];
  if (route.mode === 'official') return route.officialUrl ? [{ href: route.officialUrl, label: '打开运营方指引', exact: true }] : [];
  const places = route.stops.map(id => trip.places.find(p => p.id === id));
  if (places.some(p => !p)) return [];
  if (mapProvider(trip) === 'google') return [{ href: googleDirections(places, route.mode), label: '在 Google Maps 规划', exact: true }];
  const city = mapCity(trip, places);
  if (places.every(hasLocation)) return [{ href: amapNavigation(places, route.mode), label: '在高德地图导航', exact: true }];
  const origin = places[0], destination = places.at(-1);
  const links = [];
  if (places.length > 2) for (const p of places.slice(1, -1)) links.push({ href: amapSearch(p.name, city), label: '高德搜索途经 · ' + p.name, exact: false });
  links.unshift({ href: amapSearch(origin.name, city), label: '高德搜索起点 · ' + origin.name, exact: false });
  links.push({ href: amapSearch(destination.name, city), label: '高德搜索终点 · ' + destination.name, exact: false });
  return links;
}
// Single entry used by generated tables and route cards: destination-oriented.
export function primaryRouteHref(trip, route) {
  if (routePending(route)) return null;
  if (route.mode === 'official') return route.officialUrl || null;
  const places = route.stops.map(id => trip.places.find(p => p.id === id));
  if (places.some(p => !p)) return null;
  if (mapProvider(trip) === 'google') return googleDirections(places, route.mode);
  if (places.every(hasLocation)) return amapNavigation(places, route.mode);
  return amapSearch(places.at(-1).name, mapCity(trip, places));
}
// True when the provider link is a real point-to-point route rather than an endpoint search.
export function routePrecision(trip, route) {
  if (routePending(route)) return false;
  if (route.mode === 'official') return true;
  if (mapProvider(trip) === 'google') return true;
  return route.stops.every(id => hasLocation(trip.places.find(p => p.id === id)));
}
export function mapUrlMatches(url, provider) {
  try {
    const host = new URL(url).hostname;
    return provider === 'amap' ? /(^|\.)(amap\.com|amap\.cn)$/.test(host) : /(^|\.)google\.(com|no|se)$/.test(host);
  } catch { return false; }
}
