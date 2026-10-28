import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const read = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
const choices = (v, values, field) => { if (!values.includes(v)) fail(`invalid_${field}`); return v; };
function fields(value, names, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`invalid_${label}`);
  if (Object.keys(value).some(k => !names.includes(k))) fail(`unknown_${label}_field`);
}
function boolean(value, label) { if (typeof value !== 'boolean') fail(`invalid_${label}`); return value; }

// Read-only integrity check: no imports of the engines, network or installation.
export function health() {
  const lock = read('source-lock.json');
  const changed = Object.entries(lock.files).filter(([name, sha]) => {
    const full = path.resolve(root, name);
    return !full.startsWith(root + path.sep) || !fs.existsSync(full) || hash(fs.readFileSync(full)) !== sha;
  }).map(([name]) => name);
  const packageLock = hash(fs.readFileSync(path.join(root, 'package-lock.json')));
  if (packageLock !== lock.package_lock_sha256) changed.push('package-lock.json');
  return { status: changed.length ? 'error' : 'pass', engines: lock.engines,
    files_checked: Object.keys(lock.files).length, changed,
    engine_loaded: false, network: false, writes: false, accuracy_verified: false };
}

export const preset = Object.freeze({
  bazi: { dayBoundary: 'midnight', yunSect: 2 },
  ziwei: { dayDivide: 'forward', yearDivide: 'normal', horoscopeDivide: 'normal',
    ageDivide: 'normal', algorithm: 'default', fixLeap: true }
});

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(value)) fail('invalid_date_format');
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) fail('date_outside_supported_range');
  return [y, m, d];
}
function parseTime(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}(:\d{2})?$/.test(value)) fail('invalid_time_format');
  const [h, m, s = 0] = value.split(':').map(Number);
  if (h > 23 || m > 59 || s > 59) fail('invalid_time');
  return [h, m, s];
}
function validSolar([y, m, d]) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) fail('invalid_solar_day');
}

export function calculate(input) {
  fields(input, ['system','date','time','calendar','leapMonth','gender','timezone','timeBasis',
    'preset','conventions','inputConfirmed','conventionsConfirmed','synthetic','transit'], 'input');
  const system = choices(input.system, ['bazi','ziwei','both'], 'system');
  const date = parseDate(input.date), clock = parseTime(input.time);
  choices(input.calendar, ['solar','lunar'], 'calendar');
  choices(input.gender, ['male','female'], 'gender');
  // Engines use naive wall-clock values and UTC+8 solar terms. No foreign/DST/solar-time guessing.
  if (input.timezone !== 'UTC+08:00' || input.timeBasis !== 'civil_standard') fail('unsupported_time_basis_resolve_timezone_dst_or_solar_time_first');
  const leap = input.leapMonth === undefined ? false : boolean(input.leapMonth, 'leapMonth');
  if (input.calendar === 'lunar' && input.leapMonth === undefined) fail('lunar_leapMonth_flag_required');
  if (input.calendar === 'solar' && leap) fail('leapMonth_requires_lunar');
  const synthetic = input.synthetic === undefined ? false : boolean(input.synthetic, 'synthetic');
  const inputConfirmed = input.inputConfirmed === undefined ? false : boolean(input.inputConfirmed, 'inputConfirmed');
  const conventionsConfirmed = input.conventionsConfirmed === undefined ? false : boolean(input.conventionsConfirmed, 'conventionsConfirmed');
  if (input.preset !== undefined && input.preset !== 'civil-cn-v1') fail('unknown_preset');
  if (input.preset === undefined && input.conventions === undefined) fail('explicit_preset_or_conventions_required');
  if (input.conventions !== undefined) fields(input.conventions, ['bazi','ziwei'], 'conventions');
  const cfg = structuredClone(input.preset ? preset : {});
  for (const key of ['bazi','ziwei']) if (input.conventions?.[key] !== undefined) {
    fields(input.conventions[key], Object.keys(preset[key]), key);
    cfg[key] = { ...cfg[key], ...input.conventions[key] };
  }
  if (system !== 'ziwei') {
    if (!cfg.bazi) fail('bazi_conventions_required');
    choices(cfg.bazi.dayBoundary, ['midnight','zi-start'], 'bazi_dayBoundary');
    choices(cfg.bazi.yunSect, [1,2], 'bazi_yunSect');
  }
  if (system !== 'bazi') {
    if (!cfg.ziwei) fail('ziwei_conventions_required');
    for (const key of ['yearDivide','horoscopeDivide']) choices(cfg.ziwei[key], ['normal','exact'], key);
    choices(cfg.ziwei.dayDivide, ['current','forward'], 'dayDivide');
    choices(cfg.ziwei.ageDivide, ['normal','birthday'], 'ageDivide');
    choices(cfg.ziwei.algorithm, ['default','zhongzhou'], 'algorithm');
    boolean(cfg.ziwei.fixLeap, 'fixLeap');
  }
  if (system === 'bazi' && input.transit !== undefined) fail('transit_requires_ziwei');
  if (input.calendar === 'solar') validSolar(date);
  const check = health();
  if (check.status !== 'pass') fail('engine_integrity_failed_restore_pinned_dependencies');
  // Only the CLI's isolated worker may calculate; importers must not mutate their own global TZ.
  if (process.env.TZ !== 'Asia/Shanghai') fail('use_chart_cli_for_isolated_timezone');
  const { Solar, Lunar } = require('lunar-javascript');
  let solar;
  try {
    solar = input.calendar === 'solar' ? Solar.fromYmdHms(...date, ...clock)
      : Lunar.fromYmdHms(date[0], leap ? -date[1] : date[1], date[2], ...clock).getSolar();
  } catch { fail('invalid_lunar_date_or_leap_month'); }
  const lunar = solar.getLunar();
  if (solar.getYear() < 1900 || solar.getYear() > 2100) fail('converted_date_outside_supported_range');
  if (input.calendar === 'lunar' && (lunar.getYear() !== date[0] || Math.abs(lunar.getMonth()) !== date[1]
    || lunar.getDay() !== date[2] || (lunar.getMonth() < 0) !== leap)) fail('invalid_lunar_date_or_leap_month');
  const warnings = [];
  if (!inputConfirmed) warnings.push('birth_input_not_confirmed');
  if (!conventionsConfirmed) warnings.push('conventions_are_explicit_calculation_assumptions_not_user_preferences');
  const result = {
    schema_id: 'tyler-metaphysics-calculation-v1', synthetic,
    status: inputConfirmed && conventionsConfirmed ? 'calculated_for_confirmed_input' : 'calculated_with_assumptions',
    request: structuredClone(input),
    calendar: { solar: solar.toYmdHms(), lunar: { year: lunar.getYear(), month: Math.abs(lunar.getMonth()),
      day: lunar.getDay(), leapMonth: lunar.getMonth() < 0, display: lunar.toString() },
      timezone: input.timezone, timeBasis: input.timeBasis, trueSolarCorrectionApplied: false, dstCorrectionApplied: false },
    conventions: cfg,
    provenance: { adapter_version: 1, engines: check.engines,
      package_lock_sha256: read('source-lock.json').package_lock_sha256,
      interpretation: 'none', independent_chart_validation: 'not_performed',
      output_kind: 'engine_calculation_not_external_screenshot_transcription' },
    charts: {}, warnings, persisted: false, network: false
  };
  if (system !== 'ziwei') {
    const e = lunar.getEightChar();
    e.setSect(cfg.bazi.dayBoundary === 'zi-start' ? 1 : 2);
    const pillars = {};
    for (const [key, prefix] of [['year','Year'],['month','Month'],['day','Day'],['hour','Time']]) {
      pillars[key] = { ganzhi: e[`get${prefix}`](), hiddenStems: e[`get${prefix}HideGan`](),
        fiveElements: e[`get${prefix}WuXing`](), nayin: e[`get${prefix}NaYin`](),
        stemTenGod: e[`get${prefix}ShiShenGan`](), branchTenGods: e[`get${prefix}ShiShenZhi`](),
        growthStage: e[`get${prefix}DiShi`](), voidBranches: e[`get${prefix}XunKong`]() };
    }
    const yun = e.getYun(input.gender === 'male' ? 1 : 0, cfg.bazi.yunSect);
    result.charts.bazi = { pillars, dayMaster: e.getDayGan(),
      yearBoundary: 'engine_lichun_instant_UTC+08', monthBoundary: 'engine_jie_instant_UTC+08',
      lateZiHourRule: 'upstream_time_stem_uses_advanced_day_even_when_dayBoundary_is_midnight',
      yun: { forward: yun.isForward(), startSolar: yun.getStartSolar().toYmdHms(),
        offset: { years: yun.getStartYear(), months: yun.getStartMonth(), days: yun.getStartDay(), hours: yun.getStartHour() },
        cycles: yun.getDaYun(11).filter(x => x.getIndex() > 0).map(x => ({ index: x.getIndex(), ganzhi: x.getGanZhi(),
          startYear: x.getStartYear(), endYear: x.getEndYear(), startNominalAge: x.getStartAge(), endNominalAge: x.getEndAge(),
          annuals: x.getLiuNian().map(n => ({ year: n.getYear(), nominalAge: n.getAge(), ganzhi: n.getGanZhi() })) })) }
    };
    if (clock[0] === 23) warnings.push('late_zi_bazi_day_and_hour_stem_conventions_must_be_read_together');
    const prev = lunar.getPrevJie(), next = lunar.getNextJie();
    result.charts.bazi.adjacentJie = { previous: { name: prev.getName(), solar: prev.getSolar().toYmdHms() },
      next: { name: next.getName(), solar: next.getSolar().toYmdHms() } };
    if ([prev,next].some(j => Math.abs(solar.getJulianDay()-j.getSolar().getJulianDay())*86400 <= 120)) {
      warnings.push('within_two_minutes_of_calculated_jie_boundary_verify_birth_time_precision');
    }
  }
  if (system !== 'bazi') {
    const { astro } = require('iztro');
    const { fixLeap, ...config } = cfg.ziwei;
    const timeIndex = Math.floor((clock[0] + 1) / 2);
    const a = astro.withOptions({ type: 'solar', dateStr: solar.toYmd(), timeIndex,
      gender: input.gender === 'male' ? '男' : '女', fixLeap, language: 'zh-CN', config });
    const native = a.toJSON();
    delete native.copyright; // Avoid a machine-current-year field in deterministic chart facts.
    result.charts.ziwei = { timeIndex,
      yearBoundaryImplementation: config.yearDivide === 'exact' ? 'upstream_lichun_calendar_date_not_exact_instant' : 'lunar_new_year',
      ganzhiClockResolution: 'upstream_representative_time_per_two_hour_bin_not_input_minutes', native };
    if (config.yearDivide === 'exact') warnings.push('iztro_exact_year_divide_uses_lichun_date_not_bazi_lichun_instant');
    if (native.rawDates.lunarDate.lunarYear !== lunar.getYear() || native.rawDates.lunarDate.lunarMonth !== Math.abs(lunar.getMonth())
      || native.rawDates.lunarDate.lunarDay !== lunar.getDay() || native.rawDates.lunarDate.isLeap !== (lunar.getMonth() < 0)) {
      warnings.push('engines_lunar_calendar_disagree_do_not_merge_charts');
    }
    if (input.transit !== undefined) {
      fields(input.transit, ['date','time'], 'transit');
      const td = parseDate(input.transit.date), tc = parseTime(input.transit.time);
      validSolar(td);
      if (Date.UTC(...[td[0],td[1]-1,td[2]],...tc) < Date.UTC(solar.getYear(),solar.getMonth()-1,solar.getDay(),...clock)) fail('transit_before_birth');
      result.charts.ziwei.transit = a.horoscope(td.join('-'), Math.floor((tc[0]+1)/2)).toJSON();
    }
    if (lunar.getMonth() < 0 && clock[0] === 23) warnings.push('iztro_leap_month_late_zi_exception_see_upstream_fixLunarMonthIndex');
  }
  return result;
}

export function main(args = process.argv.slice(2)) {
  try {
    const [action, ...rest] = args;
    if (action === 'health' && rest.length === 0) {
      const h = health(); console.log(JSON.stringify(h, null, 2)); if (h.status !== 'pass') process.exitCode = 1; return;
    }
    if (action !== 'calculate' || rest.length !== 2 || rest[0] !== '--input') fail('usage_chart_calculate_--input_path_or_dash_OR_health');
    const data = fs.readFileSync(rest[1] === '-' ? 0 : rest[1], 'utf8');
    if (Buffer.byteLength(data) > 65536) fail('input_too_large');
    let input;
    try { input = JSON.parse(data.replace(/^\uFEFF/, '')); } catch { fail('invalid_json'); }
    const result = calculate(input);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Do not echo input or a stack containing birth data on failure.
    const code = /^[a-zA-Z0-9_]+$/.test(error.message) ? error.message : 'calculation_failed_check_input_and_runtime';
    console.error(JSON.stringify({ status:'error', error: code, persisted:false }));
    process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.env.TZ = 'Asia/Shanghai';
  main();
}
