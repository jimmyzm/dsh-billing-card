/**
 * Host-side parsers for the two upstream sources the billing card shows.
 *
 * The Client half cannot read either source itself: both are cross-origin, so
 * the Host half fetches them once per application start and serves the parsed
 * result on its own loopback route. Keeping the parsers free of I/O lets them
 * be checked against a saved page and calendar.
 */

/**
 * Official price tables, one per billing currency: the Chinese page quotes CNY
 * and the English page quotes USD. Both are the pages the built-in copies were
 * read from, so a failed fetch never changes the shape of the result.
 */
export const PRICING_URLS = {
  CNY: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  USD: 'https://api-docs.deepseek.com/quick_start/pricing/',
};
/** China mainland holiday calendar; `（休）` marks a day off, `（班）` a make-up workday. */
export const HOLIDAY_URL = 'https://calendars.icloud.com/holidays/cn_zh.ics';

/** Beijing has no daylight saving time, so the offset is a constant. */
const BEIJING_OFFSET_MS = 8 * 3600000;
const DAY_MS = 86400000;
/** Refuse absurd holiday runs so a malformed feed cannot fill the day set. */
const MAX_HOLIDAY_DAYS = 400;
/** A single calendar entry never spans more than a holiday period. */
const MAX_EVENT_DAYS = 31;

/**
 * Beijing calendar date of one instant.
 * @param instant - epoch milliseconds.
 * @returns the date as `YYYY-MM-DD`.
 */
export function toBeijingDate(instant) {
  const shifted = new Date(instant + BEIJING_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return (
    String(year) + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day
  );
}

//#region pricing table
/** Entities the documentation page emits. */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Visible text of one HTML fragment, with tags dropped and whitespace folded.
 * @param html - a page or one cell of it.
 * @returns the text, trimmed.
 */
function plainText(html) {
  const decoded = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
      if (body.charAt(0) === '#') {
        const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
        const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : whole;
      }
      const named = ENTITIES[body.toLowerCase()];
      return named === undefined ? whole : named;
    });
  return decoded.replace(/\s+/g, ' ').trim();
}

/**
 * Cell text of every row in one table.
 * @param table - the `<table>…</table>` markup.
 * @returns rows of cells.
 */
function tableRows(table) {
  const rows = [];
  for (const chunk of table.split(/<tr\b[^>]*>/i).slice(1)) {
    const cells = [];
    for (const cell of chunk.split(/<t[dh]\b[^>]*>/i).slice(1)) {
      cells.push(plainText(cell.split(/<\/t[dh]>/i)[0]));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * A price cell ("4.5元", "0.02 元") as a number.
 * @param text - the cell text.
 * @returns the amount, or `null` when the cell carries no number.
 */
function amountOf(text) {
  const match = /\d+(?:\.\d+)?/.exec(text);
  if (match === null) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * One tier in the canonical order the Client half expects.
 * @param tier - the partially filled tier.
 * @returns `{ input, cacheRead, output }`.
 */
function orderedTier(tier) {
  return { input: tier.input, cacheRead: tier.cacheRead, output: tier.output };
}

/** Whether a parsed tier carries every billed token class. */
function completeTier(tier) {
  return (
    typeof tier.input === 'number' &&
    typeof tier.cacheRead === 'number' &&
    typeof tier.output === 'number'
  );
}

//#region price vocabulary
// The Chinese and the English page carry the same rows under different labels.
// Matching on both keeps one walk for either page instead of a parser per locale.
/** Row head with case and repeated spacing folded, for label matching. */
function headKey(text) {
  return text.toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Whether a row head names the model column ("模型" / "MODEL"). */
function isModelHeader(text) {
  return text === '模型' || headKey(text) === 'MODEL';
}

/** Whether a row head names the model-version column ("模型版本" / "MODEL VERSION"). */
function isVersionHeader(text) {
  return text === '模型版本' || headKey(text) === 'MODEL VERSION';
}

/** Whether a row head opens the price block ("价格 (2)" / "PRICING (2)"). */
function isPriceHeader(text) {
  return text.indexOf('价格') === 0 || headKey(text).indexOf('PRICING') === 0;
}

/** Billing tier named by a row head, keyed by the folded label. */
const TIER_HEADS = { 空闲时段: 'idle', 高峰时段: 'peak', 'OFF-PEAK': 'idle', PEAK: 'peak' };

/** Tier named by a row head, or `null` when the head opens another section. */
function tierOf(text) {
  const tier = TIER_HEADS[headKey(text)];
  return tier === undefined ? null : tier;
}

/**
 * Billed token class named by a row head, in either language.
 * @returns `'input'` for cache-miss input, `'cacheRead'` for cache-hit input,
 * `'output'` for output, or `null` when the head names no class.
 */
function classOf(text) {
  const folded = headKey(text);
  if (text.indexOf('输入') >= 0 || folded.indexOf('INPUT') >= 0) {
    if (text.indexOf('缓存未命中') >= 0 || folded.indexOf('CACHE MISS') >= 0) return 'input';
    if (text.indexOf('缓存命中') >= 0 || folded.indexOf('CACHE HIT') >= 0) return 'cacheRead';
    return null;
  }
  if (text.indexOf('输出') >= 0 || folded.indexOf('OUTPUT') >= 0) return 'output';
  return null;
}
//#endregion

/**
 * Reads one table as the price table.
 *
 * The table gives one column per model and repeats each token class once per
 * billing tier, so the walk keeps the current class and reads the tier from
 * whichever cell carries it ("空闲时段" / "OFF-PEAK" and their peak rows).
 * @param rows - the table's rows of cell text.
 * @param asOf - Beijing date the page was read, copied into the result.
 * @param currency - billing currency of the page, copied into the result.
 * @returns `{ asOf, currency, models }`, or `null` when the rows are not a price table.
 */
function readPriceTable(rows, asOf, currency) {
  /** Model columns, in table order, as lower-case callable ids. */
  let ids = null;
  const labels = {};
  let cursor = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const head = rows[index][0];
    if (ids === null && isModelHeader(head)) {
      ids = rows[index]
        .slice(1)
        .map((cell) => cell.replace(/\s*\(\d+\)\s*$/, '').trim().toLowerCase())
        .filter((cell) => cell !== '');
    } else if (ids !== null && isVersionHeader(head)) {
      rows[index].slice(1).forEach((cell, at) => {
        if (ids[at] !== undefined && cell !== '') labels[ids[at]] = cell;
      });
    } else if (ids !== null && isPriceHeader(head)) {
      // The price row itself names the first token class and tier.
      cursor = index;
      break;
    }
  }
  if (ids === null || ids.length === 0 || cursor < 0) return null;

  const models = {};
  let category = null;
  for (let index = cursor; index < rows.length; index += 1) {
    // The "价格" / "PRICING" row carries the label first; every later row
    // starts with the token class or the tier, so both kinds share one walk.
    const row = index === cursor && isPriceHeader(rows[index][0]) ? rows[index].slice(1) : rows[index];
    const head = row[0];
    const kind = classOf(head);

    let tier = null;
    let values = null;
    if (kind !== null) {
      category = kind;
      if (tierOf(row[1]) !== null) {
        tier = tierOf(row[1]);
        values = row.slice(2);
      }
    } else if (tierOf(head) !== null) {
      tier = tierOf(head);
      values = row.slice(1);
    } else {
      // The next section (concurrency limits) ends the price block.
      break;
    }
    if (tier === null || values === null) continue;
    if (category === null) break;

    values.forEach((cell, at) => {
      const amount = amountOf(cell);
      if (amount === null || ids[at] === undefined) return;
      if (models[ids[at]] === undefined) models[ids[at]] = { peak: {}, idle: {} };
      models[ids[at]][tier][category] = amount;
    });
  }

  const result = {};
  for (const id of ids) {
    const entry = models[id];
    if (entry === undefined) continue;
    if (!completeTier(entry.peak) || !completeTier(entry.idle)) continue;
    result[id] = {
      label: labels[id] === undefined ? id : labels[id],
      peak: orderedTier(entry.peak),
      idle: orderedTier(entry.idle),
    };
  }
  if (Object.keys(result).length === 0) return null;
  return {
    asOf: typeof asOf === 'string' ? asOf : '',
    currency: currency === 'USD' ? 'USD' : 'CNY',
    models: result,
  };
}

/**
 * Prices from the official page, read from whichever table carries them.
 * @param html - the pricing page.
 * @param asOf - Beijing date the page was read, copied into the result.
 * @param currency - billing currency of that page (`'CNY'` or `'USD'`).
 * @returns `{ asOf, currency, models }`, or `null` when no table carries the price rows.
 */
export function parsePricingHtml(html, asOf, currency) {
  const page = typeof html === 'string' ? html : '';
  for (const table of page.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const parsed = readPriceTable(tableRows(table), asOf, currency);
    if (parsed !== null) return parsed;
  }
  return null;
}
//#endregion

//#region holiday calendar
/**
 * A `YYYYMMDD` value as a Beijing day number.
 * @param value - the calendar value.
 * @returns days since the epoch, or `null` when the value is not a date.
 */
function dayNumber(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/**
 * Statutory holiday days and make-up workdays from the iCloud China mainland
 * calendar.
 *
 * Entries whose summary carries `（休）` are days off; `（班）` entries are
 * make-up workdays. The official price table bills Monday to Friday inside the
 * peak windows and calls weekends idle, so a make-up Saturday stays idle — the
 * make-up list is informational, not a billing input.
 * @param text - the `.ics` document.
 * @returns `{ days, names, makeup, makeupNames, years }`: day numbers in order,
 * day number to holiday name(s), and the same pair for make-up workdays, or
 * `null` without marked entries.
 */
export function parseHolidayCalendar(text) {
  if (typeof text !== 'string' || text === '') return null;

  const lines = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if ((line.charAt(0) === ' ' || line.charAt(0) === '\t') && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  // Day off and make-up workday names, in feed order and without duplicates:
  // a day inside two ranges (National Day around Mid-Autumn) keeps both names.
  const off = new Map();
  const work = new Map();
  const record = (book, name, start, end) => {
    const limit = Math.min(end, start + MAX_EVENT_DAYS);
    for (let day = start; day < limit && book.size < MAX_HOLIDAY_DAYS; day += 1) {
      const names = book.get(day);
      if (names === undefined) book.set(day, [name]);
      else if (names.indexOf(name) < 0) names.push(name);
    }
  };
  const commit = (fields) => {
    const summary = fields.SUMMARY === undefined ? '' : fields.SUMMARY;
    const marked =
      summary.indexOf('（休）') >= 0 || summary.indexOf('(休)') >= 0
        ? off
        : summary.indexOf('（班）') >= 0 || summary.indexOf('(班)') >= 0
          ? work
          : null;
    if (marked === null) return;
    const name = summary.replace(/[（(][休班][）)]/g, '').trim();
    const start = dayNumber(fields.DTSTART);
    if (start === null) return;
    // `DTEND` is exclusive; the feed also writes a stale end on single days.
    const declared = dayNumber(fields.DTEND);
    const end = declared === null || declared <= start ? start + 1 : declared;
    record(marked, name === '' ? '节假日' : name, start, end);
  };

  let event = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      event = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (event !== null) commit(event);
      event = null;
      continue;
    }
    if (event === null) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(';')[0].toUpperCase();
    if (name !== 'DTSTART' && name !== 'DTEND' && name !== 'SUMMARY') continue;
    event[name] = line.slice(colon + 1).trim();
  }

  // A day off wins over a make-up entry for the same day: the day is still a
  // day off, and one day cannot be both.
  for (const day of work.keys()) if (off.has(day)) work.delete(day);
  if (off.size === 0 && work.size === 0) return null;

  const toObject = (book) => {
    const object = {};
    for (const [day, names] of [...book.entries()].sort((left, right) => left[0] - right[0])) {
      object[String(day)] = names.join('、');
    }
    return object;
  };
  const days = [...off.keys()].sort((left, right) => left - right);
  const years = [...new Set([...off.keys(), ...work.keys()].map((day) => new Date(day * DAY_MS).getUTCFullYear()))].sort();
  return {
    days,
    names: toObject(off),
    makeup: [...work.keys()].sort((left, right) => left - right),
    makeupNames: toObject(work),
    years,
  };
}
//#endregion
