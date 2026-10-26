/**
 * Parser tests: the two official price pages and the iCloud holiday calendar,
 * checked against the pages captured in test/fixtures.
 *
 * Run with `node test/parsers.test.mjs`.
 */
import fs from 'node:fs';
import { parseHolidayCalendar, parsePricingHtml, toBeijingDate } from '../parse.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual));
}

const fixture = (name) => fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');

// ------------------------------------------------------------------ CNY page
const cnyHtml = fixture('zh-pricing.html');
const cny = parsePricingHtml(cnyHtml, '2026-10-26', 'CNY');
check('the Chinese page parses', cny !== null, true);
check('it quotes CNY', cny.currency, 'CNY');
check('the read date is copied', cny.asOf, '2026-10-26');
check('model columns', Object.keys(cny.models).join(','), 'deepseek-flash,deepseek-v4-pro');
check('flash peak', JSON.stringify(cny.models['deepseek-flash'].peak), '{"input":2,"cacheRead":0.04,"output":8}');
check('flash idle', JSON.stringify(cny.models['deepseek-flash'].idle), '{"input":1,"cacheRead":0.02,"output":4}');
check('pro peak', JSON.stringify(cny.models['deepseek-v4-pro'].peak), '{"input":9,"cacheRead":0.3,"output":27}');
check('pro idle', JSON.stringify(cny.models['deepseek-v4-pro'].idle), '{"input":4.5,"cacheRead":0.15,"output":13.5}');
check('label comes from the version row', cny.models['deepseek-flash'].label, 'DeepSeek-V4.1-Flash-1017');
check(
  'an unrelated leading table is skipped',
  parsePricingHtml('<table><tr><td>导航</td><td>x</td></tr></table>' + /<table[\s\S]*?<\/table>/i.exec(cnyHtml)[0], '2026-10-26', 'CNY').models['deepseek-flash'].idle.input,
  1,
);
check('a page without tables is null', parsePricingHtml('<p>maintenance</p>', '2026-10-26', 'CNY'), null);
check('a table without prices is null', parsePricingHtml('<table><tr><td>模型</td><td>a</td></tr></table>', '2026-10-26', 'CNY'), null);
check('non-string html is null', parsePricingHtml(null, '2026-10-26', 'CNY'), null);

// ------------------------------------------------------------------ USD page
const usd = parsePricingHtml(fixture('en-pricing.html'), '2026-10-26', 'USD');
check('the English page parses', usd !== null, true);
check('it quotes USD', usd.currency, 'USD');
check('the same model columns', Object.keys(usd.models).join(','), 'deepseek-flash,deepseek-v4-pro');
check('USD flash idle', JSON.stringify(usd.models['deepseek-flash'].idle), '{"input":0.15,"cacheRead":0.003,"output":0.6}');
check('USD flash peak', JSON.stringify(usd.models['deepseek-flash'].peak), '{"input":0.3,"cacheRead":0.006,"output":1.2}');
check('USD pro idle', JSON.stringify(usd.models['deepseek-v4-pro'].idle), '{"input":0.66,"cacheRead":0.022,"output":1.98}');
check('a third decimal survives', String(usd.models['deepseek-flash'].idle.cacheRead), '0.003');
check('an English page without price rows is null', parsePricingHtml('<table><tr><td>MODEL</td><td>a</td></tr></table>', '2026-10-26', 'USD'), null);

// ------------------------------------------------------------------ calendar
const calendar = parseHolidayCalendar(fixture('cn_zh.ics'));
const day = (year, month, date) => Date.UTC(year, month - 1, date) / 86400000;
const has = (year, month, date) => calendar.days.includes(day(year, month, date));
const nameOf = (book, year, month, date) => book[String(day(year, month, date))];

check('the calendar parses', calendar !== null, true);
check('national day starts', has(2026, 10, 1), true);
check('national day ends', has(2026, 10, 7), true);
check('back to work the day after', has(2026, 10, 8), false);
check('spring festival starts', has(2026, 2, 15), true);
check('spring festival ends', has(2026, 2, 23), true);
check('the day after spring festival is a workday', has(2026, 2, 24), false);
check('new year day', has(2026, 1, 1), true);
check('a make-up day is not a day off', has(2026, 1, 4), false);
check('years covered', calendar.years.join(','), '2023,2024,2025,2026');
check('days off counted', calendar.days.length > 80, true);
check('no 2027 holidays published yet', calendar.years.includes(2027), false);
check('empty calendar is null', parseHolidayCalendar('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'), null);
check('non-string calendar is null', parseHolidayCalendar(undefined), null);

check('national day name', nameOf(calendar.names, 2026, 10, 1), '国庆节');
check('two occasions on one day keep both names', nameOf(calendar.names, 2025, 10, 6), '国庆节、中秋节');
check('spring festival name', nameOf(calendar.names, 2026, 2, 16), '春节');
check('a workday has no holiday name', nameOf(calendar.names, 2026, 10, 8), undefined);
check('make-up days counted', calendar.makeup.length > 15, true);
check('make-up day name', nameOf(calendar.makeupNames, 2026, 10, 10), '国庆节');
check('make-up new year day', nameOf(calendar.makeupNames, 2026, 1, 4), '元旦');
check('a day off is never a make-up day', calendar.makeup.some((d) => calendar.days.includes(d)), false);

check('Beijing date of a UTC evening', toBeijingDate(Date.parse('2026-10-25T17:00:00Z')), '2026-10-26');

console.log(failures === 0 ? '\nparsers: ALL CHECKS PASSED' : '\nparsers: ' + failures + ' CHECK(S) FAILED');
process.exitCode = failures === 0 ? 0 : 1;
