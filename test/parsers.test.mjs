/**
 * Parser tests: the two official price pages and the iCloud holiday calendar,
 * checked against the pages captured in test/fixtures.
 *
 * Run with `node test/parsers.test.mjs`.
 */
import fs from 'node:fs';
import { parseDeepseekBalance, parseHolidayCalendar, parsePricingHtml, toBeijingDate } from '../parse.js';

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
check('Beijing date at 15:59:59Z is still the same day', toBeijingDate(Date.parse('2026-10-26T15:59:59Z')), '2026-10-26');
check('Beijing date at 16:00:00Z has rolled over', toBeijingDate(Date.parse('2026-10-26T16:00:00Z')), '2026-10-27');

// ------------------------------------------------ synthetic price tables
/**
 * One synthetic price table in the shape the documentation emits: a model
 * header, an optional version row, then one row per token class and tier. The
 * first price row also carries the "价格" cell that opens the block.
 */
function priceHtml({ models, version = null, rows }) {
  const header = '<tr><td>模型</td>' + models.map((id) => '<td>' + id + '</td>').join('') + '</tr>';
  const labels =
    version === null
      ? ''
      : '<tr><td>模型版本</td>' + version.map((label) => '<td>' + label + '</td>').join('') + '</tr>';
  const body = rows
    .map((cells) => '<tr>' + cells.map((text) => '<td>' + text + '</td>').join('') + '</tr>')
    .join('');
  return '<table>' + header + labels + body + '</table>';
}

/** The six tier rows for a per-model amount matrix, in the page's row order. */
function tierRows(amounts, peakFirst = false) {
  const block = (head, idle, peak) =>
    peakFirst
      ? [[head, '高峰时段'].concat(peak), ['空闲时段'].concat(idle)]
      : [[head, '空闲时段'].concat(idle), ['高峰时段'].concat(peak)];
  const rows = [].concat(
    block('输入（缓存命中）', amounts.cacheRead.idle, amounts.cacheRead.peak),
    block('输入（缓存未命中）', amounts.input.idle, amounts.input.peak),
    block('输出', amounts.output.idle, amounts.output.peak),
  );
  rows[0] = ['价格 (2)'].concat(rows[0]);
  return rows;
}

/** Tier rows for a single model whose unmet amount is given per call. */
function singleRows(idleInput) {
  const amount = (value) => String(value) + '元';
  return [
    ['价格 (2)', '输入（缓存命中）', '空闲时段', amount(0.02)],
    ['高峰时段', amount(0.04)],
    ['输入（缓存未命中）', '空闲时段', amount(idleInput)],
    ['高峰时段', amount(2)],
    ['输出', '空闲时段', amount(4)],
    ['高峰时段', amount(8)],
  ];
}

const CANONICAL = {
  cacheRead: { idle: ['0.02元', '0.15元'], peak: ['0.04元', '0.30元'] },
  input: { idle: ['1元', '4.5元'], peak: ['2元', '9.0元'] },
  output: { idle: ['4元', '13.5元'], peak: ['8元', '27.0元'] },
};
const TWO_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];
const TWO_LABELS = ['DeepSeek-V4.1-Flash-1017', 'DeepSeek-V4-Pro-0813'];
const synthetic = (rows, models = TWO_MODELS, version = TWO_LABELS) =>
  parsePricingHtml(priceHtml({ models, version, rows }), '2026-10-26', 'CNY');

{
  const baseline = synthetic(tierRows(CANONICAL));
  check('a synthetic table parses', baseline !== null, true);
  check('a synthetic table quotes CNY', baseline.currency, 'CNY');
  check('a synthetic table copies the read date', baseline.asOf, '2026-10-26');
  check('a synthetic table keeps the column order', Object.keys(baseline.models).join(','), 'deepseek-flash,deepseek-v4-pro');
  check(
    'a synthetic table reads both tiers',
    JSON.stringify(baseline.models['deepseek-v4-pro'].idle),
    '{"input":4.5,"cacheRead":0.15,"output":13.5}',
  );
  check('the version row labels the column', baseline.models['deepseek-flash'].label, 'DeepSeek-V4.1-Flash-1017');

  const swappedAmounts = {};
  for (const [klass, tiers] of Object.entries(CANONICAL)) {
    swappedAmounts[klass] = { idle: [tiers.idle[1], tiers.idle[0]], peak: [tiers.peak[1], tiers.peak[0]] };
  }
  const swapped = synthetic(
    tierRows(swappedAmounts),
    ['deepseek-v4-pro', 'deepseek-flash'],
    ['DeepSeek-V4-Pro-0813', 'DeepSeek-V4.1-Flash-1017'],
  );
  check('a swapped column order maps by column', swapped.models['deepseek-v4-pro'].idle.input, 4.5);
  check('the swapped first column keeps its peak output', swapped.models['deepseek-v4-pro'].peak.output, 27);
  check('the swapped second column maps to the other model', swapped.models['deepseek-flash'].idle.input, 1);
  check('the swapped version row follows its column', swapped.models['deepseek-flash'].label, 'DeepSeek-V4.1-Flash-1017');

  const peakFirst = synthetic(tierRows(CANONICAL, true));
  check('a peak row before the idle row parses alike', JSON.stringify(peakFirst.models), JSON.stringify(baseline.models));
}

{
  const odd = synthetic(
    tierRows({
      cacheRead: { idle: ['$0.003', '0.15元'], peak: ['$0.006', '0.30元'] },
      input: { idle: [' 0.02 元 ', '4.5元'], peak: ['0.04元', '9.0元'] },
      output: { idle: [' 4 元 ', '13.5元'], peak: ['8元', '27.0元'] },
    }),
  );
  check('a leading dollar sign is skipped', odd.models['deepseek-flash'].idle.cacheRead, 0.003);
  check('whitespace inside the cell is folded', odd.models['deepseek-flash'].idle.input, 0.02);
  check('a padded amount keeps its value', odd.models['deepseek-flash'].idle.output, 4);
  check('the third decimal survives the parser', String(odd.models['deepseek-flash'].idle.cacheRead), '0.003');

  // A grouped amount is one number, not the first digit run.
  const thousands = synthetic(
    tierRows({
      cacheRead: CANONICAL.cacheRead,
      input: { idle: ['1,000', '4.5元'], peak: ['2元', '9.0元'] },
      output: CANONICAL.output,
    }),
  );
  check('a thousands separator is rejoined: 1,000 reads as 1000', thousands.models['deepseek-flash'].idle.input, 1000);

  const fullWidth = synthetic(
    tierRows({
      cacheRead: CANONICAL.cacheRead,
      input: { idle: ['０.０２', '4.5元'], peak: ['2元', '9.0元'] },
      output: CANONICAL.output,
    }),
  );
  check('a full-width amount reads as ASCII: ０.０２ is 0.02', fullWidth.models['deepseek-flash'].idle.input, 0.02);
  check('the complete column beside it still prices', fullWidth.models['deepseek-v4-pro'].idle.input, 4.5);

}

check(
  'a model missing a token class is not priced',
  parsePricingHtml(
    priceHtml({
      models: ['deepseek-flash'],
      version: ['x'],
      rows: [
        ['价格 (2)', '输入（缓存命中）', '空闲时段', '0.02元'],
        ['高峰时段', '0.04元'],
        ['输出', '空闲时段', '4元'],
        ['高峰时段', '8元'],
      ],
    }),
    '2026-10-26',
    'CNY',
  ),
  null,
);
check(
  'a model missing the peak tier is not priced',
  parsePricingHtml(
    priceHtml({
      models: ['deepseek-flash'],
      version: ['x'],
      rows: [
        ['价格 (2)', '输入（缓存命中）', '空闲时段', '0.02元'],
        ['输入（缓存未命中）', '空闲时段', '1元'],
        ['输出', '空闲时段', '4元'],
      ],
    }),
    '2026-10-26',
    'CNY',
  ),
  null,
);

{
  const first = priceHtml({ models: ['deepseek-flash'], version: ['first'], rows: singleRows(0.5) });
  const second = priceHtml({ models: ['deepseek-flash'], version: ['second'], rows: singleRows(0.9) });
  const two = parsePricingHtml(first + second, '2026-10-26', 'CNY');
  check('the first usable table wins', two.models['deepseek-flash'].idle.input, 0.5);
  check('the winning table keeps its version label', two.models['deepseek-flash'].label, 'first');

  const broken = priceHtml({ models: ['deepseek-flash'], version: ['broken'], rows: [['价格 (2)', '输入（缓存命中）', '空闲时段', '0.02元']] });
  const afterBroken = parsePricingHtml(broken + second, '2026-10-26', 'CNY');
  check('a broken leading table does not hide the next one', afterBroken.models['deepseek-flash'].idle.input, 0.9);
}

{
  const unknown = synthetic(singleRows(3), ['DeepSeek-V9-Ultra (3)'], null);
  check('an unlisted model id still parses', Object.keys(unknown.models).join(','), 'deepseek-v9-ultra');
  check('without a version row the id is the label', unknown.models['deepseek-v9-ultra'].label, 'deepseek-v9-ultra');
  check('an unlisted model keeps its prices', JSON.stringify(unknown.models['deepseek-v9-ultra'].idle), '{"input":3,"cacheRead":0.02,"output":4}');

  const usdPage = parsePricingHtml(priceHtml({ models: ['deepseek-flash'], version: ['x'], rows: singleRows(0.15) }), '2026-10-26', 'USD');
  check('a synthetic USD page quotes USD', usdPage.currency, 'USD');
}

// ------------------------------------------------ synthetic holiday calendar
function vevent(summary, start, end) {
  const lines = ['BEGIN:VEVENT', 'SUMMARY:' + summary, 'DTSTART;VALUE=DATE:' + start];
  if (end !== undefined) lines.push('DTEND;VALUE=DATE:' + end);
  lines.push('END:VEVENT');
  return lines;
}

function calendarText(events, eol = '\n') {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
  for (const event of events) lines.push(...event);
  lines.push('END:VCALENDAR', '');
  return lines.join(eol);
}

{
  const folded = calendarText([
    ['BEGIN:VEVENT', 'SUMMARY:国庆', ' 节（休）', 'DTSTART;VALUE=DATE:20261001', 'DTEND;VALUE=DATE:20261002', 'END:VEVENT'],
  ]);
  const parsed = parseHolidayCalendar(folded);
  check('a folded summary line is rejoined before parsing', parsed.names[String(day(2026, 10, 1))], '国庆节');
  check('the folded event covers its one day', parsed.days.length, 1);
}

{
  const lf = calendarText([vevent('元旦（休）', '20260101', '20260102')]);
  const crlf = lf.replace(/\n/g, '\r\n');
  check('a CRLF feed parses like an LF feed', JSON.stringify(parseHolidayCalendar(crlf)), JSON.stringify(parseHolidayCalendar(lf)));
  check('the CRLF day is the expected day', parseHolidayCalendar(crlf).days[0], day(2026, 1, 1));
}

check('an empty calendar is null', parseHolidayCalendar(''), null);
check('a whitespace-only calendar is null', parseHolidayCalendar('   \n\t'), null);
check('garbage is null', parseHolidayCalendar('not an ics document'), null);
check('an event-less document is null', parseHolidayCalendar(calendarText([])), null);
check('a feed with no marked event is null', parseHolidayCalendar(calendarText([vevent('立春', '20260204')])), null);

{
  const workOnly = parseHolidayCalendar(calendarText([vevent('春节（班）', '20260214')]));
  check('a make-up-only feed keeps days empty', workOnly.days.length, 0);
  check('a make-up-only feed records the make-up day', JSON.stringify(workOnly.makeup), JSON.stringify([day(2026, 2, 14)]));
  check('a make-up-only feed keeps its name', workOnly.makeupNames[String(day(2026, 2, 14))], '春节');
  check('a make-up-only feed has no day-off name', Object.keys(workOnly.names).length, 0);
  check('a make-up-only year is still listed', workOnly.years.join(','), '2026');
}

{
  const ascii = parseHolidayCalendar(calendarText([vevent('元旦(休)', '20260101'), vevent('春节(班)', '20260214')]));
  check('an ASCII (休) marker is a day off', JSON.stringify(ascii.days), JSON.stringify([day(2026, 1, 1)]));
  check('an ASCII (班) marker is a make-up day', JSON.stringify(ascii.makeup), JSON.stringify([day(2026, 2, 14)]));
  check('an ASCII marker is stripped from the name', ascii.names[String(day(2026, 1, 1))], '元旦');
}

{
  const mixed = parseHolidayCalendar(calendarText([vevent('立春', '20260204'), vevent('元旦（休）', '20260101')]));
  check('an unmarked solar term is ignored', mixed.days.includes(day(2026, 2, 4)), false);
  check('the marked event beside it still parses', mixed.days.includes(day(2026, 1, 1)), true);
  check('an unmarked term has no name entry', mixed.names[String(day(2026, 2, 4))], undefined);
}

{
  const missingEnd = parseHolidayCalendar(calendarText([vevent('元旦（休）', '20260101')]));
  check('a missing DTEND covers one day', JSON.stringify(missingEnd.days), JSON.stringify([day(2026, 1, 1)]));
  const equalEnd = parseHolidayCalendar(calendarText([vevent('元旦（休）', '20260101', '20260101')]));
  check('DTEND equal to DTSTART covers one day', JSON.stringify(equalEnd.days), JSON.stringify([day(2026, 1, 1)]));
  const backwardEnd = parseHolidayCalendar(calendarText([vevent('元旦（休）', '20260105', '20260101')]));
  check('DTEND before DTSTART is treated as one day', JSON.stringify(backwardEnd.days), JSON.stringify([day(2026, 1, 5)]));
}

{
  const long = parseHolidayCalendar(calendarText([vevent('国庆节（休）', '20260101', '20260301')]));
  check('a long run is clamped to MAX_EVENT_DAYS', long.days.length, 31);
  check('the clamp starts at DTSTART', long.days[0], day(2026, 1, 1));
  check('the clamp ends 31 days later', long.days[30], day(2026, 1, 31));
  check('the day past the clamp is not a holiday', long.days.includes(day(2026, 2, 1)), false);
}

{
  const stripped = parseHolidayCalendar(calendarText([vevent('春节（休）', '20260217')]));
  check('the marker is removed from the name', stripped.names[String(day(2026, 2, 17))], '春节');
  const joined = parseHolidayCalendar(calendarText([vevent('国庆节（休）', '20261001'), vevent('中秋节（休）', '20261001')]));
  check('two occasions on one day join with 、', joined.names[String(day(2026, 10, 1))], '国庆节、中秋节');
  const duplicated = parseHolidayCalendar(calendarText([vevent('国庆节（休）', '20261001'), vevent('国庆节（休）', '20261001')]));
  check('a repeated occasion is named once', duplicated.names[String(day(2026, 10, 1))], '国庆节');
  const markOnly = parseHolidayCalendar(calendarText([vevent('（休）', '20261001')]));
  check('a mark-only event gets the fallback name', markOnly.names[String(day(2026, 10, 1))], '节假日');
}

{
  const overlap = parseHolidayCalendar(
    calendarText([vevent('国庆节（休）', '20261001', '20261004'), vevent('国庆节（班）', '20261002')]),
  );
  check('a （班） inside a （休） run stays a day off', overlap.days.includes(day(2026, 10, 2)), true);
  check('and never becomes a make-up day', overlap.makeup.includes(day(2026, 10, 2)), false);
  check('and has no make-up name', overlap.makeupNames[String(day(2026, 10, 2))], undefined);
  check('the day-off name is kept', overlap.names[String(day(2026, 10, 2))], '国庆节');
}

{
  const years = parseHolidayCalendar(calendarText([vevent('元旦（休）', '20261231'), vevent('元旦（班）', '20270109')]));
  check('years are the sorted union of both books', years.years.join(','), '2026,2027');
  check('a year with only make-up days is listed', years.years.includes(2027), true);
  check('days come out sorted', JSON.stringify(overlappingOrder()), JSON.stringify([day(2026, 1, 1), day(2026, 1, 3)]));
}

/** Days of a feed written newest-first, to prove the output is sorted. */
function overlappingOrder() {
  return parseHolidayCalendar(calendarText([vevent('元旦（休）', '20260103'), vevent('元旦（休）', '20260101')])).days;
}

// ------------------------------------------------------- open-platform balance
const balance = parseDeepseekBalance({
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
});
check('the balance parses', JSON.stringify(balance), '{"available":true,"currency":"CNY","total":"110.00","granted":"10.00","toppedUp":"100.00"}');
check('it also accepts the raw body', parseDeepseekBalance('{"is_available":false,"balance_infos":[{"currency":"USD","total_balance":"7.50"}]}').total, '7.50');
check('a USD account keeps USD', parseDeepseekBalance({ balance_infos: [{ currency: 'USD', total_balance: '7.50' }] }).currency, 'USD');
check('CNY wins when both are listed', parseDeepseekBalance({ balance_infos: [{ currency: 'USD', total_balance: '7.50' }, { currency: 'CNY', total_balance: '50' }] }).currency, 'CNY');
check('an unusable amount is null', parseDeepseekBalance({ balance_infos: [{ currency: 'CNY', total_balance: 'n/a' }] }), null);
check('an unknown currency is dropped, not relabelled', parseDeepseekBalance({ balance_infos: [{ currency: 'EUR', total_balance: '5' }] }), null);
check('an unavailable account still reports its amount', parseDeepseekBalance({ is_available: false, balance_infos: [{ currency: 'CNY', total_balance: '0' }] }).available, false);
check('an empty body is null', parseDeepseekBalance({}), null);
check('broken JSON is null', parseDeepseekBalance('not json'), null);

console.log(failures === 0 ? '\nparsers: ALL CHECKS PASSED' : '\nparsers: ' + failures + ' CHECK(S) FAILED');
process.exitCode = failures === 0 ? 0 : 1;
