/**
 * DeepSeek billing card — the Client half.
 *
 * Renders one card in the sidebar footer: the DSH account balance, the current
 * model's unit prices (input / cache read / output) taken from the official
 * price table the Host half refreshes at every start, and the live billing
 * period (idle or peak) with a countdown to the next switch. In the Chinese
 * interface a statutory holiday turns the card's top into a light blue banner
 * ("国庆节假期中 ..."), and a make-up workday gets a gray chip. Both the price
 * tables and the holiday calendar fall back to the copies built into this file
 * when the Host route is missing.
 *
 * Unit prices follow the interface language, the way the official documentation
 * splits them: a Chinese UI quotes the CNY page, every other language quotes the
 * USD page, and the two are never converted into each other. The balance is not
 * converted either — outside a Chinese card it spells its ISO code next to the
 * symbol, because the prices beside it are dollars.
 *
 * Billing window (official price table): peak is Beijing time Monday to Friday
 * 09:00-12:00 and 14:00-18:00, excluding Chinese statutory holidays; every
 * other instant is idle and is billed at half the peak price.
 */
window.__ModuleLoader__.load({
  id: '@jimmyzm/dsh-billing-card',
  factory(require) {
    const React = require('react');
    const { Fragment, createElement: h } = React;
    const { useEffect, useMemo, useRef, useState } = React;
    // The hover bubble is drawn by this card. Borrowing the host tooltip would tie
    // its surface to the shell's fixed dark chrome, and a card that owns its light
    // and dark palette cannot hand one element of it to somebody else.
    /** Reads layout before paint; the harness React stub only carries useEffect. */
    const useLayoutEffect = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : useEffect;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'dsh-billing-card';

    /** Balance and model catalog are re-read on this cadence. */
    const DATA_REFRESH_MS = 30000;
    /** The countdown repaints once a second. */
    const CLOCK_TICK_MS = 1000;
    /** Host route carrying the price tables and holiday calendar of this start. */
    const DATA_ENDPOINT = '/deepseek-billing-card/data';
    /** The providers that bill at DeepSeek's own list price. */
    const OFFICIAL_PROVIDERS = new Set(['deepseek-account', 'deepseek-official', 'deepseek']);
    /**
     * Whether a provider bills at DeepSeek's own list price.
     * @param provider - the composer's provider id, or `null` when unknown.
     * @returns `true` when the price table applies.
     */
    function billsAtListPrice(provider) {
      return provider === null || (typeof provider === 'string' && OFFICIAL_PROVIDERS.has(provider.toLowerCase()));
    }

    /**
     * Which balance the card headlines. Only the open platform bills the API key, so
     * every other provider -- an unknown one, and a composer with no model at all --
     * moves the account balance to the headline.
     */
    function billsOnOpenPlatform(provider) {
      return typeof provider === 'string' && provider.toLowerCase() === 'deepseek-official';
    }
    /** While the Host half is still fetching, the card asks again on this cadence. */
    const DATA_POLL_MS = 3000;
    /** How often a requested balance refresh is followed up, in milliseconds. */
    const BALANCE_ASK_MS = 1000;
    /** How many follow-ups a requested balance refresh gets. */
    const BALANCE_ASK_LIMIT = 2;
    /** Bounded so a Host that is still fetching stops being asked. */
    const DATA_POLL_LIMIT = 10;
    /** A route that is not there yet gets this many tries before the snapshot wins. */
    const DATA_FAIL_LIMIT = 3;
    /** Gap the card keeps under any action that precedes it in the footer row. */
    const ACTION_GAP_PX = 4;
    /** Hover dwell before the bubble appears; a focused control gets there faster. */
    const TIP_DELAY_MS = 240;
    const TIP_FOCUS_DELAY_MS = 90;
    /** Gap between trigger and bubble, and the least distance the bubble keeps from the
     * viewport edge. */
    const TIP_GAP_PX = 10;
    const TIP_EDGE_PX = 8;
    /** Half the arrow's 9 px box: the apex sits this far inside the box it is drawn in. */
    const TIP_ARROW_APEX_PX = 4;
    /** The arrow never gets closer than this to a rounded corner, where it would poke out. */
    const TIP_ARROW_EDGE_PX = 12;

    //#region dictionaries
    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'card.title': '余额',
      'card.balance.loading': '读取中',
      'card.balance.failed': '读取失败',
      'card.balance.tiny': '不足 0.01',
      'card.balance.signedOut': '未登录',
      'card.title.api': 'API 余额',
      'card.balance.hint': 'DSH 账号余额，每 30 秒刷新',
      'card.balance.hint.api': 'DeepSeek 开放平台余额，每 30 秒刷新',
      'card.balance.api.missing': '未配置 API Key',
      'card.balance.api.failed': '读取失败，稍后重试',
      'card.balance.granted': '赠金',
      'card.balance.toppedUp': '充值',
      'card.balance.total': '合计',
      'card.balance.signedOutMissing': '未登录，且未配置 API Key',
      'card.balance.signedOutFailed': '未登录，API 余额读取失败',
      'card.balance.hintBonus': 'DSH 账号余额（含赠金），每 30 秒刷新',
      'card.bonus': '赠送',
      'card.period.idle': '空闲',
      'card.period.peak': '高峰',
      'card.schedule': '高峰：北京时间周一至周五 9:00–12:00、14:00–18:00（不含法定节假日）；其余时段为空闲。',
      'card.countdown.toPeak': '距高峰',
      'card.countdown.toIdle': '距空闲',
      'card.countdown.day': '天',
      'card.unit.long.CNY': '人民币元 / 百万 tokens',
      'card.unit.long.USD': '美元 / 百万 tokens',
      'card.snapshot.live': '启动时校准',
      'card.snapshot.builtin': '内置快照',
      'card.tip.model': '模型 ID',
      'card.tip.unit': '计价单位',
      'card.tip.snapshot': '快照日期',
      'card.tip.sync': '校准方式',
      'card.tip.peakWindow': '周一至周五 09:00-12:00\n14:00-18:00',
      'card.tip.idleWindow': '其余所有时段',
      'card.tip.calendar': '数据来源',
      'card.tip.windowNote': '北京时间，不含法定节假日',
      'card.tip.makeup': '调休日按周末处理，全天不计高峰。',
      'card.tip.calendar.icloud': 'iCloud 中国大陆日历',
      'card.tip.calendar.builtin': '内置节假日表',
      'card.holiday.idle': '空闲全天',
      'card.makeup': '调休',
      'card.price.input': '输入',
      'card.price.cacheRead': '缓存',
      'card.price.output': '输出',
      'card.price.unknown': '官方价目未收录该模型',
      'card.price.otherProvider': '该渠道不走官方价目',
    };
    /** English dictionary, checked complete against the zh key set. */
    const en = {
      'card.title': 'Balance',
      'card.balance.loading': 'Reading',
      'card.balance.failed': 'Unavailable',
      'card.balance.tiny': 'under 0.01',
      'card.balance.signedOut': 'Signed out',
      'card.title.api': 'API balance',
      'card.balance.hint': 'DSH account balance, refreshed every 30 s',
      'card.balance.hint.api': 'DeepSeek platform balance, refreshed every 30 s',
      'card.balance.api.missing': 'No API key',
      'card.balance.api.failed': 'read failed, retrying',
      'card.balance.granted': 'Bonus',
      'card.balance.toppedUp': 'Topped up',
      'card.balance.total': 'Total',
      'card.balance.signedOutMissing': 'Not signed in, and no API key configured',
      'card.balance.signedOutFailed': 'Not signed in; the API balance could not be read',
      'card.balance.hintBonus': 'DSH account balance incl. bonus, refreshed every 30 s',
      'card.bonus': 'Bonus',
      'card.period.idle': 'Idle',
      'card.period.peak': 'Peak',
      'card.schedule': 'Peak: Beijing time Monday to Friday 9:00-12:00 and 14:00-18:00, excluding Chinese statutory holidays. Every other time is idle.',
      'card.countdown.toPeak': 'Peak in',
      'card.countdown.toIdle': 'Idle in',
      'card.countdown.day': 'd',
      'card.unit.long.CNY': 'CNY per 1M tokens',
      'card.unit.long.USD': 'USD per 1M tokens',
      'card.snapshot.live': 'startup',
      'card.snapshot.builtin': 'snapshot',
      'card.tip.model': 'Model ID',
      'card.tip.unit': 'Unit',
      'card.tip.snapshot': 'Snapshot',
      'card.tip.sync': 'Sync mode',
      'card.tip.peakWindow': 'Mon-Fri 09:00-12:00\n14:00-18:00',
      'card.tip.idleWindow': 'every other hour',
      'card.tip.calendar': 'Source',
      'card.tip.windowNote': 'Beijing time, statutory holidays excluded',
      'card.tip.makeup': 'A make-up workday is billed like a weekend: idle all day.',
      'card.tip.calendar.icloud': 'iCloud mainland-China calendar',
      'card.tip.calendar.builtin': 'built-in holiday table',
      'card.holiday.idle': 'off-peak all day',
      'card.makeup': 'Make-up',
      'card.price.input': 'Input',
      'card.price.cacheRead': 'Cache read',
      'card.price.output': 'Output',
      'card.price.unknown': 'No official price for this model',
      'card.price.otherProvider': 'This provider has no list price',
    };
    //#endregion

    //#region price snapshot
    /**
     * Official DeepSeek price tables, per one million tokens, one per currency.
     *
     * Sources: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ (CNY) and
     * https://api-docs.deepseek.com/quick_start/pricing/ (USD), both read on
     * 2026-10-26. `peak` is billed inside the peak window; `idle` is billed
     * everywhere else and is exactly half of `peak`, as both tables document.
     */
    const PRICE_SNAPSHOT = {
      /** Callable model ids the price table bills as a listed model. */
      aliases: {
        'deepseek-v4-flash': 'deepseek-flash',
        'deepseek-v4-flash-vision-exp': 'deepseek-flash',
      },
      CNY: {
        asOf: '2026-10-26',
        source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
        currency: 'CNY',
        unitTokens: 1000000,
        models: {
          'deepseek-flash': {
            label: 'DeepSeek-V4.1-Flash-1017',
            peak: { input: 2, cacheRead: 0.04, output: 8 },
            idle: { input: 1, cacheRead: 0.02, output: 4 },
          },
          'deepseek-v4-pro': {
            label: 'DeepSeek-V4-Pro-0813',
            peak: { input: 9, cacheRead: 0.3, output: 27 },
            idle: { input: 4.5, cacheRead: 0.15, output: 13.5 },
          },
        },
      },
      USD: {
        asOf: '2026-10-26',
        source: 'https://api-docs.deepseek.com/quick_start/pricing/',
        currency: 'USD',
        unitTokens: 1000000,
        models: {
          'deepseek-flash': {
            label: 'DeepSeek-V4.1-Flash-1017',
            peak: { input: 0.3, cacheRead: 0.006, output: 1.2 },
            idle: { input: 0.15, cacheRead: 0.003, output: 0.6 },
          },
          'deepseek-v4-pro': {
            label: 'DeepSeek-V4-Pro-0813',
            peak: { input: 1.32, cacheRead: 0.044, output: 3.96 },
            idle: { input: 0.66, cacheRead: 0.022, output: 1.98 },
          },
        },
      },
    };

    /**
     * Whether one locale id is a Chinese one. `zh`, `zh-CN` and `zh-Hans` all
     * count: the card has one Chinese dictionary, and every check that depends on
     * "is this a Chinese card" has to agree with the others.
     * @param locale - the active locale id.
     */
    function isChinese(locale) {
      return typeof locale === 'string' && locale.toLowerCase().indexOf('zh') === 0;
    }

    /**
     * Billing currency of one UI language: the Chinese pages quote CNY and every
     * other language takes the English documentation's USD prices. The two are
     * never converted into each other.
     * @param locale - the active locale id.
     * @returns `'CNY'` for a Chinese locale (`zh`, `zh-CN`, …), `'USD'` otherwise.
     */
    function currencyOf(locale) {
      return isChinese(locale) ? 'CNY' : 'USD';
    }

    /**
     * Whether the card writes the balance's currency as an ISO code next to the
     * symbol. A Chinese card quotes CNY prices, so `¥` is unambiguous there; any
     * other language shows the dollar prices, and a `¥` balance without the code
     * would read as a bug rather than as another currency.
     * @param locale - the active locale id.
     */
    function spellsCurrency(locale) {
      return currencyOf(locale) !== 'CNY';
    }
    //#endregion

    //#region billing window
    /** Beijing is UTC+8 all year: the country has no daylight saving time. */
    const BEIJING_OFFSET_MS = 8 * 3600000;
    const DAY_MS = 86400000;
    const HOUR_MS = 3600000;

    /** Billed peak windows in Beijing wall-clock hours, `[start, end)`. */
    const PEAK_WINDOWS = [
      [9, 12],
      [14, 18],
    ];

    /**
     * Statutory holidays by year, inclusive Beijing calendar days, each with the
     * occasion name the card labels the day with. A year absent from this table
     * simply has no known holidays, so its weekday peak windows still apply.
     */
    const HOLIDAY_RANGES = {
      2025: [
        ['2025-01-01', '2025-01-01', '元旦'],
        ['2025-01-28', '2025-02-04', '春节'],
        ['2025-04-04', '2025-04-06', '清明'],
        ['2025-05-01', '2025-05-05', '劳动节'],
        ['2025-05-31', '2025-06-02', '端午节'],
        ['2025-10-01', '2025-10-08', '国庆节'],
        ['2025-10-06', '2025-10-06', '中秋节'],
      ],
      2026: [
        ['2026-01-01', '2026-01-03', '元旦'],
        ['2026-02-15', '2026-02-23', '春节'],
        ['2026-04-04', '2026-04-06', '清明'],
        ['2026-05-01', '2026-05-05', '劳动节'],
        ['2026-06-19', '2026-06-21', '端午节'],
        ['2026-09-25', '2026-09-27', '中秋节'],
        ['2026-10-01', '2026-10-07', '国庆节'],
      ],
    };

    /** Make-up workdays (`（班）`) published alongside those holidays. */
    const MAKEUP_DAYS = [
      ['2025-01-26', '春节'],
      ['2025-02-08', '春节'],
      ['2025-04-27', '劳动节'],
      ['2025-09-28', '国庆节'],
      ['2025-10-11', '国庆节'],
      ['2026-01-04', '元旦'],
      ['2026-02-14', '春节'],
      ['2026-02-28', '春节'],
      ['2026-05-09', '劳动节'],
      ['2026-09-20', '国庆节'],
      ['2026-10-10', '国庆节'],
    ];

    /** Beijing calendar day number of one instant. */
    function beijingDay(instant) {
      return Math.floor((instant + BEIJING_OFFSET_MS) / DAY_MS);
    }

    /** Beijing calendar day number of a `YYYY-MM-DD` date. */
    function dayOfDate(text) {
      const parts = text.split('-');
      return Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])) / DAY_MS;
    }

    /**
     * The built-in calendar, in the shape the Host route answers with: day-off
     * numbers with their names, and make-up numbers with theirs. A day inside
     * two ranges keeps both names ("国庆节、中秋节"), as the two holidays overlap.
     */
    const BUILTIN_CALENDAR = (() => {
      const off = new Map();
      for (const ranges of Object.values(HOLIDAY_RANGES)) {
        for (const [from, to, name] of ranges) {
          for (let day = dayOfDate(from); day <= dayOfDate(to); day += 1) {
            const names = off.get(day);
            if (names === undefined) off.set(day, [name]);
            else if (names.indexOf(name) < 0) names.push(name);
          }
        }
      }
      const work = new Map();
      for (const [date, name] of MAKEUP_DAYS) {
        const day = dayOfDate(date);
        // A day off wins over a make-up entry for the same day.
        if (!off.has(day)) work.set(day, [name]);
      }
      const labels = (book) => {
        const object = {};
        for (const [day, names] of book) object[String(day)] = names.join('、');
        return object;
      };
      return {
        days: new Set(off.keys()),
        names: labels(off),
        makeup: new Set(work.keys()),
        makeupNames: labels(work),
      };
    })();

    /** Every built-in statutory holiday day. */
    const HOLIDAY_DAYS = BUILTIN_CALENDAR.days;

    /**
     * Billing period at one instant.
     * @param instant - epoch milliseconds.
     * @param holidays - statutory holiday days; the built-in table by default.
     * @returns `'peak'` inside a billed peak window, `'idle'` everywhere else.
     */
    function periodAt(instant, holidays = HOLIDAY_DAYS) {
      const day = beijingDay(instant);
      const minuteOfDay = Math.floor((instant + BEIJING_OFFSET_MS - day * DAY_MS) / 60000);
      const weekday = new Date(day * DAY_MS).getUTCDay();
      // Weekends are idle all day, holidays included.
      if (weekday === 0 || weekday === 6) return 'idle';
      if (holidays.has(day)) return 'idle';
      for (const window of PEAK_WINDOWS) {
        if (minuteOfDay >= window[0] * 60 && minuteOfDay < window[1] * 60) return 'peak';
      }
      return 'idle';
    }

    /**
     * First future instant at which the billed period changes, scanning the
     * 09:00 / 12:00 / 14:00 / 18:00 Beijing boundaries. Scanning boundaries
     * instead of adding fixed offsets makes weekends and holiday runs fall out
     * of the period test itself (Friday 18:00 counts down to Monday 09:00).
     * @param instant - epoch milliseconds.
     * @param holidays - statutory holiday days; the built-in table by default.
     * @returns the switch instant, or `null` when none is found within a year.
     */
    function nextSwitchAt(instant, holidays = HOLIDAY_DAYS) {
      const firstDay = beijingDay(instant);
      for (let day = firstDay; day <= firstDay + 400; day += 1) {
        for (const window of PEAK_WINDOWS) {
          for (const hour of window) {
            const boundary = day * DAY_MS + hour * HOUR_MS - BEIJING_OFFSET_MS;
            if (boundary <= instant) continue;
            if (periodAt(boundary, holidays) !== periodAt(boundary - 1, holidays)) return boundary;
          }
        }
      }
      return null;
    }
    //#endregion

    //#region formatting
    const CURRENCY_SYMBOL = { CNY: '¥', USD: '$' };
    const numberFormatters = new Map();

    /** Locale-aware fixed-decimal formatter, cached per locale. */
    function numberFormatter(locale, digits) {
      const key = locale + '|' + digits;
      let formatter = numberFormatters.get(key);
      if (formatter === undefined) {
        const options = { minimumFractionDigits: digits, maximumFractionDigits: digits };
        try {
          formatter = new Intl.NumberFormat(locale, options);
        } catch {
          formatter = new Intl.NumberFormat(undefined, options);
        }
        numberFormatters.set(key, formatter);
      }
      return formatter;
    }

    /**
     * Locale-aware formatter for unit prices: two decimals, with a third only
     * when the amount needs one. The USD table quotes its cache-read price to
     * thousandths ("$0.003"), so a fixed two digits would round it to nothing.
     */
    function priceFormatter(locale) {
      const key = locale + '|price';
      let formatter = numberFormatters.get(key);
      if (formatter === undefined) {
        const options = { minimumFractionDigits: 2, maximumFractionDigits: 3 };
        try {
          formatter = new Intl.NumberFormat(locale, options);
        } catch {
          formatter = new Intl.NumberFormat(undefined, options);
        }
        numberFormatters.set(key, formatter);
      }
      return formatter;
    }

    /**
     * Truncates a decimal string toward zero at two fraction digits.
     *
     * The wallet contract delivers a decimal string, so the digits are cut
     * directly: `value * 100` would render "12.34" as 1233.9999… and floor()
     * would silently drop a cent.
     * @returns the value, or `null` when the text is not a number.
     */
    function truncateCents(text) {
      const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(String(text).trim());
      if (match === null) {
        const fallback = Number(text);
        return Number.isFinite(fallback) ? Math.trunc(fallback * 100) / 100 : null;
      }
      const fraction = (match[3] === undefined ? '' : match[3]).slice(0, 2).padEnd(2, '0');
      const value = (match[1] === '-' ? -1 : 1) * Number(match[2] + '.' + fraction);
      return value === 0 ? 0 : value;
    }

    /**
     * Formats a wallet amount, truncating toward zero so the card never shows
     * more credit than the account holds.
     * @returns the formatted amount, or `null` for a positive amount below one cent.
     */
    function formatAmount(text, formatter) {
      const raw = Number(text);
      if (Number.isFinite(raw) && raw > 0 && raw < 0.01) return null;
      const value = truncateCents(text);
      if (value === null) return String(text);
      return formatter.format(value);
    }

    /** Zero-padded two-digit number. */
    function pad2(value) {
      return value < 10 ? '0' + value : String(value);
    }

    /** Splits a duration into whole days and an `HH:MM:SS` clock. */
    function splitDuration(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      return {
        days: Math.floor(total / 86400),
        clock:
          pad2(Math.floor((total % 86400) / 3600)) +
          ':' +
          pad2(Math.floor((total % 3600) / 60)) +
          ':' +
          pad2(total % 60),
      };
    }

    /** Normalizes a model id for snapshot lookup. */
    function normalizeModelId(value) {
      return typeof value === 'string' ? value.trim().toLowerCase() : '';
    }

    /**
     * Prices one model, by id and then by display name, following aliases.
     * @param ids - candidate ids / display names, best first.
     * @param table - the active price table; the built-in CNY table by default.
     * @returns `{ key, entry }` or `null` when the table has no row.
     */
    function lookupPrice(ids, table = PRICE_SNAPSHOT.CNY) {
      for (const id of ids) {
        const key = normalizeModelId(id);
        if (key === '') continue;
        const direct = table.models[key];
        if (direct !== undefined) return { key, entry: direct };
        const alias = PRICE_SNAPSHOT.aliases[key];
        const aliased = alias === undefined ? undefined : table.models[alias];
        if (aliased !== undefined) return { key: alias, entry: aliased };
      }
      return null;
    }

    /** The currency a wallet reports, or `''` when the entry is unusable. */
    function walletCurrency(wallet) {
      return wallet !== null && typeof wallet === 'object' && typeof wallet.currency === 'string'
        ? wallet.currency
        : '';
    }

    /**
     * Adds decimal strings exactly and returns a plain decimal string.
     *
     * Wallet amounts arrive as decimal text; adding them as floats would show
     * credit the account does not hold ("0.1 + 0.2" is the mild case, and a
     * grand total is exactly where such an error would be visible).
     * @returns the sum, or `null` when no amount parses.
     */
    function sumAmounts(texts) {
      const parts = [];
      let scale = 0;
      for (const text of texts) {
        const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(String(text).trim());
        if (match === null) continue;
        const fraction = match[3] === undefined ? '' : match[3];
        scale = Math.max(scale, fraction.length);
        parts.push({ negative: match[1] === '-', integer: match[2], fraction });
      }
      if (parts.length === 0) return null;
      let total = BigInt(0);
      for (const part of parts) {
        const digits = BigInt(part.integer + part.fraction.padEnd(scale, '0'));
        total += part.negative ? -digits : digits;
      }
      const negative = total < BigInt(0);
      const absolute = (negative ? -total : total).toString().padStart(scale + 1, '0');
      const integer = absolute.slice(0, absolute.length - scale);
      const fraction = absolute.slice(absolute.length - scale);
      return (negative ? '-' : '') + integer + (scale > 0 ? '.' + fraction : '');
    }

    /**
     * The account total for one currency: recharge wallets plus bonus wallets.
     * @returns `{ currency, text, includesBonus }`, or `null` for an empty account.
     */
    function totalBalance(wallets, bonus) {
      const recharge = Array.isArray(wallets) ? wallets.filter((wallet) => walletCurrency(wallet) !== '') : [];
      const grants = Array.isArray(bonus) ? bonus.filter((wallet) => walletCurrency(wallet) !== '') : [];
      const all = recharge.concat(grants);
      if (all.length === 0) return null;
      // The reported currency follows the recharge wallet, so a bonus in
      // another currency never renames the account total.
      const pool = recharge.length > 0 ? recharge : grants;
      const cny = pool.find((wallet) => wallet.currency === 'CNY');
      const currency = (cny === undefined ? pool[0] : cny).currency;
      const sameCurrency = all.filter((wallet) => wallet.currency === currency);
      const text = sumAmounts(sameCurrency.map((wallet) => wallet.balance));
      if (text === null) return null;
      return {
        currency,
        text,
        includesBonus: sameCurrency.some((wallet) => grants.indexOf(wallet) >= 0),
      };
    }
    //#endregion

    //#region card styles
    const CARD_CSS = [
      // The card owns its palette. `light-dark()` resolves against the
      // `color-scheme` the app writes on <html>, so no host token is read.
      '.dbc-root{box-sizing:border-box;display:flex;flex-direction:column;flex:0 0 100%;min-width:0;order:10;margin-bottom:8px;user-select:none;-webkit-user-select:none;' +
        '--dbc-surface:light-dark(#fff,#232324);--dbc-surface-2:light-dark(#f3f5f8,#2c2c2e);--dbc-surface-3:light-dark(#eceff4,#343538);' +
        '--dbc-line:light-dark(#e9ebef,#3a3b3f);' +
        '--dbc-ink-1:light-dark(#15181d,#f9fafb);--dbc-ink-2:light-dark(#52575e,#cfd3d6);--dbc-ink-3:light-dark(#686e77,#a8adb4);' +
        '--dbc-green:light-dark(#157f3c,#5fd48b);--dbc-green-bg:light-dark(#e9f9ef,#16321f);' +
        '--dbc-amber:light-dark(#a85b06,#f0b04a);--dbc-amber-bg:light-dark(#fdf3e4,#33270f);' +
        '--dbc-blue:light-dark(#1d4fd7,#9db8ff);' +
        '--dbc-r-card:14px;--dbc-r-inner:10px;--dbc-r-tag:6px;' +
        '--dbc-font:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Helvetica Neue",Arial,sans-serif}',
      '.dbc-card{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;min-width:0;padding:12px;border-radius:var(--dbc-r-card);background:var(--dbc-surface);color:var(--dbc-ink-1);border:1px solid color-mix(in srgb,var(--dbc-ink-1) 7%,transparent);box-shadow:0 1px 2px rgba(17,24,39,.06),0 8px 20px -10px rgba(17,24,39,.18);font:400 11px/14px var(--dbc-font);font-variant-numeric:tabular-nums}',
      // holiday strip, sitting on the card surface rather than as a band
      '.dbc-holiday{display:flex;align-items:center;gap:5px;min-width:0;margin:-4px -4px 0;padding:4px 6px;border-radius:8px;background:color-mix(in srgb,var(--dbc-blue) 9%,transparent);color:var(--dbc-blue);font:500 11px/14px var(--dbc-font)}',
      '.dbc-holiday-icon{flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round}',
      '.dbc-holiday-text{flex:0 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dbc-holiday-meta{flex:0 0 auto;margin-left:auto;font-weight:400;color:var(--dbc-ink-3)}',
      // label line: title on the left, state chips on the right
      '.dbc-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:2px 8px;min-width:0}',
      '.dbc-chips{display:flex;align-items:center;gap:4px;flex:0 0 auto;margin-left:auto}',
      '.dbc-chip{display:inline-flex;flex:0 0 auto;align-items:center;gap:4px;height:18px;padding:0 7px;border-radius:999px;font:500 11px/14px var(--dbc-font);white-space:nowrap;cursor:help}',
      '.dbc-chip-idle{background:var(--dbc-green-bg);color:var(--dbc-green)}',
      '.dbc-chip-peak{background:var(--dbc-amber-bg);color:var(--dbc-amber)}',
      '.dbc-chip-makeup{height:17px;padding:0 6px;border-radius:var(--dbc-r-tag);background:var(--dbc-surface-3);color:var(--dbc-ink-3)}',
      '.dbc-dot{width:5px;height:5px;border-radius:50%;background:currentColor}',
      // the amount owns a full-width line; long values shrink instead of clipping
      '.dbc-amount-row{display:flex;align-items:baseline;gap:3px;min-width:0}',
      '.dbc-amount{display:inline-flex;align-items:baseline;gap:3px;min-width:0;max-width:100%;font-size:20px;line-height:25px;font-weight:660;letter-spacing:-.02em;color:var(--dbc-ink-1);white-space:nowrap}',
      '.dbc-amount-small{font-size:17px;line-height:22px;letter-spacing:-.01em}',
      '.dbc-code{flex:0 0 auto;font:400 11px/14px var(--dbc-font);letter-spacing:0;color:var(--dbc-ink-3)}',
      '.dbc-note{font:400 13px/18px var(--dbc-font);letter-spacing:0;color:var(--dbc-ink-3)}',
      // provider line: provider on the left, countdown on the right, both on one line
      '.dbc-mrow{display:flex;align-items:baseline;flex-wrap:wrap;gap:0 6px;min-width:0}',
      '.dbc-provider{flex:0 0 auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 11px/14px var(--dbc-font);color:var(--dbc-ink-3)}',
      '.dbc-clock{flex:0 0 auto;font:500 11px/14px var(--dbc-font);white-space:nowrap}',
      '.dbc-clock-idle{color:var(--dbc-green)}',
      '.dbc-clock-peak{color:var(--dbc-amber)}',
      '.dbc-model{align-self:flex-start;max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 11px/14px var(--dbc-font);color:var(--dbc-ink-1)}',
      '.dbc-prices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:2px;padding:8px 10px;border-radius:var(--dbc-r-inner);background:var(--dbc-surface-2)}',
      '.dbc-price{display:flex;flex-direction:column;gap:1px;min-width:0}',
      '.dbc-price-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 11px/14px var(--dbc-font);color:var(--dbc-ink-3)}',
      '.dbc-price-value{white-space:nowrap;font:650 13px/16px var(--dbc-font);color:var(--dbc-ink-1)}',
      '.dbc-price-empty{grid-column:1 / -1;font:400 11px/14px var(--dbc-font);color:var(--dbc-ink-3)}',
      '.dbc-tip-trigger{cursor:help;border-bottom:1px dashed color-mix(in srgb,var(--dbc-ink-3) 35%,transparent)}',
      '.dbc-tip-plain{cursor:help}',
      '.dbc-tip-plain:focus-visible,.dbc-tip-trigger:focus-visible{outline:2px solid color-mix(in srgb,var(--dbc-blue) 55%,transparent);outline-offset:2px}',
      // The bubble is a fixed dark surface in both themes, so its accents are fixed
      // too: the theme-aware --dbc-* colours would land dark-on-dark in light mode.
      '.dbc-tip{position:fixed;z-index:2147483000;display:flex;flex-direction:column;max-width:248px;box-sizing:border-box;padding:8px 10px;border:1px solid var(--dbc-line);border-radius:10px;background:var(--dbc-surface);color:var(--dbc-ink-1);box-shadow:0 6px 24px -8px rgba(15,17,21,.28),0 1px 3px rgba(15,17,21,.08);font:400 11px/14px var(--dbc-font);font-variant-numeric:tabular-nums;text-align:left;white-space:normal;pointer-events:none}',
      '.dbc-tip-rule{height:1px;margin:6px 0 4px;background:var(--dbc-line-2)}',
      '.dbc-tip-row{display:flex;align-items:flex-start;gap:7px;min-width:0;padding:2px 0;font-size:11px;line-height:14px}',
      '.dbc-tip-dot{flex:0 0 auto;width:5px;height:5px;margin-top:4px;border-radius:50%;background:currentColor;opacity:.45}',
      '.dbc-tip-dot-ok{background:var(--dbc-green);opacity:1}',
      '.dbc-tip-dot-warn{background:var(--dbc-amber);opacity:1}',
      '.dbc-tip-label{flex:0 0 auto;color:var(--dbc-ink-3);white-space:nowrap}',
      '.dbc-tip-amount{flex:0 1 auto;min-width:0;margin-left:auto;font-weight:500;text-align:right;white-space:pre-line;overflow-wrap:anywhere}',
      '.dbc-tip-note{margin-top:2px;color:var(--dbc-ink-3);font-size:11px;line-height:14px;white-space:pre-line}',
      '.dbc-tip-arrow{position:absolute;top:auto;bottom:-4px;width:8px;height:8px;transform:rotate(225deg);background:var(--dbc-surface);border-left:1px solid color-mix(in srgb,var(--dbc-ink-1) 10%,transparent);border-top:1px solid color-mix(in srgb,var(--dbc-ink-1) 10%,transparent)}',
      '.dbc-tip-below .dbc-tip-arrow{top:-4px;bottom:auto;transform:rotate(45deg)}',
    ].join('');
    //#endregion

    /**
     * The calendar glyph the holiday banner leads with. Inline so it inherits the
     * banner's color, and drawn on the same 24-unit grid as the host icons.
     */
    function holidayIcon() {
      return h(
        'svg',
        {
          className: 'dbc-holiday-icon',
          viewBox: '0 0 24 24',
          width: 13,
          height: 13,
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('rect', { key: 'body', x: 3, y: 4, width: 18, height: 18, rx: 3 }),
        h('path', { key: 'marks', d: 'M8 2v4M16 2v4M3 10h18' }),
      );
    }

    /**
     * A Beijing calendar day number (days since the epoch, as `beijingDay` and the
     * calendar payload use it) as `M/D`, the form the holiday strip shows.
     * @param day - the numeric day number.
     */
    function monthDay(day) {
      const date = new Date(day * DAY_MS);
      return date.getUTCMonth() + 1 + '/' + date.getUTCDate();
    }

    /** Amounts longer than this many characters drop one size instead of clipping. */
    const AMOUNT_SMALL_AT = 12;

    //#region component
    /**
     * The sidebar footer card.
     * @param props - slot props plus the injected readers.
     */
    function BillingCard(props) {
      const tr = typeof props.t === 'function' ? props.t : (key) => key;
      const wide = props.wide !== false;
      const rootRef = useRef(null);
      const every = props.every;

      const [now, setNow] = useState(() => Date.now());
      const [account, setAccount] = useState({ kind: 'loading' });
      const [model, setModel] = useState({ kind: 'loading' });
      const [selection, setSelection] = useState(null);
      const [remote, setRemote] = useState({ status: 'loading', prices: null, holidays: null, deepseek: null });

      // Injected readers are re-read every render so the effects below only
      // depend on their own cadence, never on prop identity.
      const api = useRef({ every, readBalance: props.readBalance, readModel: props.readModel });
      api.current.every = every;
      api.current.readBalance = props.readBalance;
      api.current.readModel = props.readModel;
      api.current.watchSelection = props.watchSelection;
      api.current.watchUpstream = props.watchUpstream;

      useEffect(() => {
        if (!wide || typeof every !== 'function') return undefined;
        return every(() => setNow(Date.now()), CLOCK_TICK_MS);
      }, [every, wide]);

      // The visible session's model selection, followed live: switching the
      // model in the composer repaints the price line before the next poll.
      // A provider switch changes which balance pays for the session, so the
      // account reader and the Host route are both asked again right away —
      // waiting for the 30 s tick would show the wrong headline for half a minute.
      useEffect(() => {
        if (!wide) return undefined;
        const readers = api.current;
        if (typeof readers.watchSelection !== 'function') return undefined;
        let lastProvider = null;
        return readers.watchSelection((next) => {
          setSelection(next);
          if (typeof readers.readBalance === 'function') {
            readers.readBalance().then(
              (balance) => setAccount(balance),
              () => setAccount({ kind: 'failed' }),
            );
          }
          const refresh = api.current.refreshRoute;
          if (typeof refresh !== 'function') return;
          // A different provider may bill a different balance, and the Host only
          // re-reads that balance on its own timer: ask for a fresh amount now so
          // the switch lands at once instead of at the next minute boundary.
          const provider = next === null || typeof next.provider !== 'string' ? null : next.provider;
          refresh(provider !== lastProvider);
          lastProvider = provider;
        });
      }, [wide]);

      // A provider or credential change lands on the catalogue, not on the
      // session's selection, so it needs its own trigger: ask the Host for a fresh
      // open-platform amount the moment the provider surface moves.
      useEffect(() => {
        if (!wide) return undefined;
        const readers = api.current;
        if (typeof readers.watchUpstream !== 'function') return undefined;
        return readers.watchUpstream(() => {
          const refresh = api.current.refreshRoute;
          if (typeof refresh === 'function') refresh(true);
        });
      }, [wide]);

      // The price table and holiday calendar the Host refreshed at this start.
      // A `loading` answer means the Host is still fetching; a missing route
      // (an older Host, no web server) is worth a couple of retries because the
      // Host half registers it a moment after the server starts. After that the
      // built-in copies win and the card stops asking.
      useEffect(() => {
        if (!wide) return undefined;
        let live = true;
        let timer = null;
        let attempts = 0;
        const settle = (next) => {
          if (!live) return;
          setRemote(next);
          attempts += 1;
          const asking = next.status === 'loading' ? DATA_POLL_LIMIT : DATA_FAIL_LIMIT;
          if (next.status !== 'ready' && attempts < asking) timer = setTimeout(ask, DATA_POLL_MS);
        };
        let follow = null;
        let followed = 0;
        const ask = (fresh) => {
          if (typeof fetch !== 'function') return;
          const url = fresh === true ? DATA_ENDPOINT + '?balance=refresh' : DATA_ENDPOINT;
          fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
            .then((response) => (response.ok ? response.json() : null))
            .then((payload) => {
              const next = readRemote(payload);
              settle(next);
              // The Host answers before it finishes the requested re-read, so a
              // balance that is not ready yet gets a couple of quick follow-ups
              // rather than waiting for the next thirty-second tick.
              const pending = next.status === 'ready' && next.deepseek !== null && next.deepseek.status !== 'ready';
              if (fresh !== true || !pending || followed >= BALANCE_ASK_LIMIT) return;
              followed += 1;
              if (follow !== null) clearTimeout(follow);
              follow = setTimeout(() => ask(true), BALANCE_ASK_MS);
            })
            .catch(() => settle({ status: 'failed', prices: null, holidays: null }));
        };
        ask();
        // The Host re-reads the open-platform balance every thirty seconds, and that
        // balance is the only thing on this route that changes while the app
        // runs. The 30 s tick below therefore re-reads the route too, so a card
        // that loaded before a key was configured (or before the first balance
        // arrived) picks the amount up instead of freezing on "no API key".
        api.current.refreshRoute = (fresh) => {
          if (!live) return;
          if (fresh === true) followed = 0;
          ask(fresh === true);
        };
        return () => {
          live = false;
          api.current.refreshRoute = null;
          if (timer !== null) clearTimeout(timer);
          if (follow !== null) clearTimeout(follow);
        };
      }, [wide]);

      useEffect(() => {
        if (!wide) return undefined;
        const readers = api.current;
        if (typeof readers.every !== 'function') return undefined;
        if (typeof readers.readBalance !== 'function' || typeof readers.readModel !== 'function') {
          return undefined;
        }
        let live = true;
        const load = () => {
          readers.readBalance().then(
            (next) => {
              if (live) setAccount(next);
            },
            () => {
              if (live) setAccount({ kind: 'failed' });
            },
          );
          readers.readModel().then(
            (next) => {
              if (live) setModel(next);
            },
            () => {
              if (live) setModel({ kind: 'failed' });
            },
          );
          const refresh = api.current.refreshRoute;
          if (typeof refresh === 'function') refresh();
        };
        load();
        const stop = readers.every(load, DATA_REFRESH_MS);
        return () => {
          live = false;
          if (typeof stop === 'function') stop();
        };
      }, [wide]);

      //#region placement
      /* The footer action row is a single flex line whose actions are full-width
       * items, so a second action is pushed past the line end and clipped. The card
       * therefore measures the actions ahead of it and pulls itself back onto the
       * row start, reserving exactly the height they occupy. Nothing is assumed
       * about whether another action exists. */
      useLayoutEffect(() => {
        if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return undefined;
        const root = rootRef.current;
        if (root === null || root === undefined) return undefined;
        let container = root.parentElement;
        while (container !== null && container !== undefined) {
          const display = window.getComputedStyle(container).display;
          if (display === 'flex' || display === 'inline-flex') break;
          container = container.parentElement;
        }
        if (container === null || container === undefined) return undefined;
        const place = () => {
          const frame = container.getBoundingClientRect();
          let lead = 0;
          let head = 0;
          for (const child of container.children) {
            const items =
              window.getComputedStyle(child).display === 'contents' ? Array.from(child.children) : [child];
            for (const item of items) {
              if (item === root) continue;
              const box = item.getBoundingClientRect();
              if (box.width === 0 && box.height === 0) continue;
              lead = Math.max(lead, box.right - frame.left);
              head = Math.max(head, box.bottom - frame.top);
            }
          }
          const marginLeft = lead === 0 ? '0px' : Math.round(-lead) + 'px';
          const marginTop = head === 0 ? '0px' : Math.round(head + ACTION_GAP_PX) + 'px';
          if (root.style.marginLeft !== marginLeft) root.style.marginLeft = marginLeft;
          if (root.style.marginTop !== marginTop) root.style.marginTop = marginTop;
        };
        place();
        const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
        if (resized !== null) resized.observe(root);
        const mutated = typeof MutationObserver === 'function' ? new MutationObserver(place) : null;
        if (mutated !== null) mutated.observe(container, { childList: true, subtree: true });
        window.addEventListener('resize', place);
        return () => {
          if (resized !== null) resized.disconnect();
          if (mutated !== null) mutated.disconnect();
          window.removeEventListener('resize', place);
        };
      }, [wide]);
      //#endregion

      // Startup data outranks the copies in this file; identical shapes let the
      // rest of the render ignore which one it holds. The UI language picks the
      // currency, the way the two official pages split CNY and USD.
      const locale = typeof props.readLocale === 'function' ? props.readLocale() : 'zh';
      const currency = currencyOf(locale);
      const prices = remote.prices !== null ? remote.prices : PRICE_SNAPSHOT;
      const live = prices[currency] === undefined ? null : prices[currency];
      const rates = live === null ? PRICE_SNAPSHOT[currency] : live;
      const calendar = remote.holidays !== null ? remote.holidays : BUILTIN_CALENDAR;
      const holidaySource = tr(calendar === BUILTIN_CALENDAR ? 'card.tip.calendar.builtin' : 'card.tip.calendar.icloud');

      const period = periodAt(now, calendar.days);
      const peak = period === 'peak';
      const switchAt = nextSwitchAt(now, calendar.days);
      const remaining = switchAt === null ? null : Math.max(0, switchAt - now);

      // A live selection outranks the catalog default: the default is the
      // deployment's model, not the one this session has selected.
      const selectedModel =
        selection !== null && typeof selection.model === 'string' && selection.model !== '' ? selection.model : null;
      const selectedProvider =
        selection !== null && typeof selection.provider === 'string' && selection.provider !== ''
          ? selection.provider
          : null;
      const activeProvider =
        selectedProvider !== null ? selectedProvider : model.kind === 'ready' ? model.provider : null;
      const activeId = selectedModel !== null ? selectedModel : model.kind === 'ready' ? model.id : null;
      const activeName =
        activeId === null || model.kind !== 'ready'
          ? null
          : model.names !== null && typeof model.names === 'object' && typeof model.names[activeId] === 'string'
            ? model.names[activeId]
            : activeId === model.id && typeof model.name === 'string'
              ? model.name
              : null;

      // The price table is DeepSeek's own list. A DeepSeek model served by any
      // other provider is billed by that provider, so quoting a list price there
      // would be an invented number.
      const official = billsAtListPrice(activeProvider);
      const apiPreferred = billsOnOpenPlatform(activeProvider);
      const priced = useMemo(() => {
        if (activeId === null) return null;
        const found = lookupPrice([activeId, activeName], rates);
        if (found === null) return { key: null, entry: null };
        return found;
      }, [activeId, activeName, rates]);

      if (!wide) return null;

      const amount = numberFormatter(locale, 2);
      const price = priceFormatter(locale);
      const tier = peak ? 'peak' : 'idle';

      // Calendar labels. The calendar names its days in Chinese, so they stay in
      // the Chinese interface; an English card would otherwise mix languages.
      const chinese = isChinese(locale);
      const today = beijingDay(now);
      const named = (book, day) => {
        const name = book === null || book === undefined ? undefined : book[day];
        return typeof name === 'string' && name !== '' ? name : null;
      };
      const holidayName = chinese ? named(calendar.names, today) : null;
      // A hand-edited payload can list one day in both books. The off day wins:
      // a day that is a holiday cannot also be a day you work to make up for it.
      const makeupName =
        !calendar.days.has(today) && chinese ? named(calendar.makeupNames, today) : null;
      // The strip names the occasion, then the date and the all-day rate on the
      // right: "国庆节  10/1 · 空闲全天". Two occasions join with "、".
      const holidayBanner = holidayName;
      const holidayMeta =
        holidayName === null ? null : monthDay(today) + ' · ' + tr('card.holiday.idle');
      const makeupTip = makeupName === null ? null : { note: tr('card.tip.makeup') };

      // The billing window is a rule, so the bubble lists all three of its facts:
      // the peak window, everything the peak leaves idle, and who publishes the
      // calendar that decides which days are excepted.
      const periodTip = {
        rows: [
          { label: tr('card.period.peak'), text: tr('card.tip.peakWindow') },
          { label: tr('card.period.idle'), text: tr('card.tip.idleWindow') },
          { label: tr('card.tip.calendar'), text: holidaySource },
        ],
        note: tr('card.tip.windowNote'),
      };

      // Two balances, one headline. The provider decides which one is the truth:
      // DeepSeek's own provider bills the open platform, every other provider is
      // billed by the DSH account. A signed-out account has nothing to report, so
      // the API balance stands in — real money beats a notice. Only when neither
      // source can answer does the headline become that notice.
      let balanceMain = null;
      let balanceNote = null;
      let balanceHint = null;
      // The card no longer prints a balance label, but the number still needs a name
      // for screen readers, so the same word rides on the amount row as its aria-label.
      let titleKey = 'card.title';

      const apiBalance = remote.deepseek;
      const apiState = apiBalance === null || apiBalance === undefined ? 'absent' : apiBalance.status;
      // A non-Chinese card quotes dollar prices, so its balance carries the ISO
      // code next to the symbol: no reader mistakes `¥` for a rendering bug.
      const code = spellsCurrency(locale);
      /** One balance amount, unit included: `CNY ¥18.12`, `¥不足 0.01`. */
      const walletMoney = (currency, value) => {
        const symbol = CURRENCY_SYMBOL[currency] || '';
        const text = formatAmount(value, amount);
        return currency + ' ' + symbol + (text === null ? tr('card.balance.tiny') : text);
      };
      /** The headline keeps the symbol; a sub-cent amount has only its unit to show. */
      const headline = (currency, value) => {
        const symbol = CURRENCY_SYMBOL[currency] || '';
        const text = formatAmount(value, amount);
        if (text === null) {
          return { note: code ? currency + ' ' + tr('card.balance.tiny') : symbol + tr('card.balance.tiny') };
        }
        return { main: { code: code ? currency : null, text: symbol + text } };
      };
      /** Puts the open-platform balance on the headline, from whatever state it is in. */
      const showApi = () => {
        titleKey = 'card.title.api';
        if (apiState !== 'ready') return;
        // Composition, cadence, total — in that order, and nothing else: the tooltip
        // describes the balance that is actually on the headline.
        const granted = formatAmount(apiBalance.granted, amount);
        const toppedUp = formatAmount(apiBalance.toppedUp, amount);
        const rows = [];
        if (toppedUp !== null) {
          rows.push({
            tone: 'ok',
            label: tr('card.balance.toppedUp'),
            text: walletMoney(apiBalance.currency, apiBalance.toppedUp),
          });
        }
        if (granted !== null) {
          rows.push({
            tone: 'warn',
            label: tr('card.balance.granted'),
            text: walletMoney(apiBalance.currency, apiBalance.granted),
          });
        }
        balanceHint = { rows, note: tr('card.balance.hint.api') };
        const shaped = headline(apiBalance.currency, apiBalance.total);
        if (shaped.main !== undefined) balanceMain = shaped.main;
        else balanceNote = shaped.note;
      };

      /** Puts the account wallet total on the headline. */
      const showAccount = () => {
        titleKey = 'card.title';
        const total = totalBalance(account.wallets, account.bonus);
        if (total === null) {
          balanceNote = tr('card.balance.failed');
          return;
        }
        // Wallets, then the sum: the tooltip lists exactly what the headline adds up.
        const rows = [];
        for (const wallet of account.wallets) {
          rows.push({
            tone: 'ok',
            label: tr('card.balance.toppedUp'),
            text: walletMoney(wallet.currency, wallet.balance),
          });
        }
        for (const wallet of account.bonus) {
          rows.push({ tone: 'warn', label: tr('card.bonus'), text: walletMoney(wallet.currency, wallet.balance) });
        }
        balanceHint = { rows, note: tr(total.includesBonus ? 'card.balance.hintBonus' : 'card.balance.hint') };
        const shaped = headline(total.currency, total.text);
        if (shaped.main !== undefined) balanceMain = shaped.main;
        else balanceNote = shaped.note;
      };

      if (apiPreferred) {
        // This session is billed by the open platform, so that balance is the only
        // one that describes its spending.
        if (apiState === 'ready') {
          showApi();
        } else if (apiState === 'absent') {
          // An older Host has no balance route: fall back to what the card can see
          // rather than claiming a key is missing.
          if (account.kind === 'ready') showAccount();
          else if (account.kind === 'loading') balanceNote = tr('card.balance.loading');
          else balanceNote = tr(account.kind === 'signedOut' ? 'card.balance.signedOut' : 'card.balance.failed');
        } else if (apiState === 'loading') {
          // The route is still being asked; a missing key is not yet a fact.
          balanceNote = tr('card.balance.loading');
        } else {
          balanceNote = apiState === 'failed' ? tr('card.balance.api.failed') : tr('card.balance.api.missing');
        }
      } else if (account.kind === 'ready') {
        showAccount();
      } else if (account.kind === 'signedOut') {
        // No account session: the API balance is the only money the card can report.
        if (apiState === 'ready') showApi();
        else if (apiState === 'absent' || apiState === 'loading') balanceNote = tr('card.balance.signedOut');
        else if (apiState === 'failed') balanceNote = tr('card.balance.signedOutFailed');
        else balanceNote = tr('card.balance.signedOutMissing');
      } else if (account.kind === 'loading') {
        balanceNote = tr('card.balance.loading');
      } else {
        balanceNote = tr('card.balance.failed');
      }

      // Countdown to the next period switch.
      let countdown = null;
      if (remaining !== null) {
        const split = splitDuration(remaining);
        const prefix = tr(peak ? 'card.countdown.toIdle' : 'card.countdown.toPeak');
        const days = split.days > 0 ? split.days + tr('card.countdown.day') + ' ' : '';
        countdown = prefix + ' ' + days + split.clock;
      }

      const unknown = model.kind === 'failed' ? '—' : tr('card.balance.loading');
      const modelLabel = activeId !== null ? (activeName !== null ? activeName : activeId) : unknown;
      // The provider names the row above the model. Its display name comes from
      // the catalogue; an id the catalogue does not know stands in for it.
      const providerLabel =
        activeProvider === null
          ? unknown
          : model.kind === 'ready' && typeof model.providers[activeProvider] === 'string'
            ? model.providers[activeProvider]
            : activeProvider;
      // The bubble is the only place with room to say what the price block means, so
      // it states the four facts a quote needs: which id, in what unit, from which
      // snapshot date, and whether those numbers were fetched at startup or are the
      // built-in copy. The tier sits on the card, one line above, so it is not repeated.
      const modelTip = {
        rows: [
          { label: tr('card.tip.model'), text: activeId === null ? modelLabel : activeId },
          { label: tr('card.tip.unit'), text: tr('card.unit.long.' + currency) },
          { label: tr('card.tip.snapshot'), text: rates.asOf },
          {
            label: tr('card.tip.sync'),
            text: tr(rates === PRICE_SNAPSHOT[currency] ? 'card.snapshot.builtin' : 'card.snapshot.live'),
          },
        ],
      };
      const priceValues =
        official && priced !== null && priced.entry !== null
          ? [
              ['card.price.input', priced.entry[tier].input],
              ['card.price.cacheRead', priced.entry[tier].cacheRead],
              ['card.price.output', priced.entry[tier].output],
            ]
          : null;

      //#region hover bubble
      /* The bubble is a child of the card and fixed-positioned, so the sidebar's
       * overflow cannot clip it and no portal is needed. Placing it here instead of
       * borrowing the host tooltip keeps its surface in this card's palette: paper in
       * the light theme, charcoal in the dark one. */
      const [tipSpec, setTipSpec] = useState(null);
      const [tipAnchor, setTipAnchor] = useState(null);
      const [tipBox, setTipBox] = useState(null);
      const tipRef = useRef(null);
      const tipTimer = useRef(0);
      const tipArmed = useRef(false);

      const hideTip = () => {
        tipArmed.current = false;
        if (tipTimer.current !== 0) {
          clearTimeout(tipTimer.current);
          tipTimer.current = 0;
        }
        setTipSpec(null);
        setTipAnchor(null);
        setTipBox(null);
      };

      /** Arms the bubble after a dwell. The trigger rect is read when the pointer
       * lands, so a scrolling sidebar cannot make the bubble chase the word. */
      const showTip = (spec, target, delay) => {
        if (spec === null || spec === undefined || target === null || target === undefined) return;
        if (target === null || typeof target !== 'object' || typeof target.getBoundingClientRect !== 'function') {
          return;
        }
        if (typeof setTimeout !== 'function') return;
        const box = target.getBoundingClientRect();
        tipArmed.current = true;
        if (tipTimer.current !== 0) clearTimeout(tipTimer.current);
        tipTimer.current = setTimeout(
          () => {
            tipTimer.current = 0;
            if (!tipArmed.current) return;
            setTipAnchor({ left: box.left, right: box.right, top: box.top, bottom: box.bottom });
            setTipSpec(spec);
          },
          delay === undefined ? TIP_DELAY_MS : delay,
        );
      };

      /** Turns a node into a trigger: pointer, keyboard, and the dashed underline
       * that advertises both. */
      const tipTrigger = (spec) =>
        spec === null || spec === undefined
          ? {}
          : {
              'data-dbc-tip': 'trigger',
              tabIndex: 0,
              onMouseEnter: (event) => showTip(spec, event.currentTarget),
              onMouseLeave: hideTip,
              onFocus: (event) => showTip(spec, event.currentTarget, TIP_FOCUS_DELAY_MS),
              onBlur: hideTip,
              // Escape reaches the trigger when it holds focus; a pointer user who
              // never focused anything is caught by the window listener instead.
              onKeyDown: (event) => {
                if (event.key === 'Escape') hideTip();
              },
            };

      // Measured before paint: above the trigger when it fits, below when it does
      // not, clamped into the viewport, with the arrow still pointing at the word.
      useLayoutEffect(() => {
        if (tipSpec === null || tipAnchor === null) return;
        if (typeof window === 'undefined') return;
        const bubble = tipRef.current;
        if (bubble === null || bubble === undefined) return;
        const width = bubble.offsetWidth;
        const height = bubble.offsetHeight;
        if (!width || !height) return;
        const viewport = window.innerWidth || 0;
        // The bubble centres on the word it explains; the arrow then points at that
        // word's centre by construction, and only drifts when the bubble has to be
        // pushed back inside the viewport.
        const centre = (tipAnchor.left + tipAnchor.right) / 2;
        let left = centre - width / 2;
        if (left + width > viewport - TIP_EDGE_PX) left = viewport - TIP_EDGE_PX - width;
        if (left < TIP_EDGE_PX) left = TIP_EDGE_PX;
        let top = tipAnchor.top - height - TIP_GAP_PX;
        let below = false;
        if (top < TIP_EDGE_PX) {
          top = tipAnchor.bottom + TIP_GAP_PX;
          below = true;
        }
        // The diamond is 9 px wide, so its apex sits 4.5 px into its own box. When the
        // trigger's centre is so close to the viewport edge that the bubble had to be
        // pushed away, the apex can no longer reach the word; a pointer that lands
        // beside its anchor is worse than no pointer, so it is dropped instead.
        const reach = width - TIP_ARROW_EDGE_PX - TIP_ARROW_APEX_PX;
        const rawArrow = centre - left - TIP_ARROW_APEX_PX;
        const pointed = rawArrow >= -TIP_ARROW_APEX_PX + TIP_ARROW_EDGE_PX - TIP_ARROW_APEX_PX && rawArrow <= reach;
        const arrow = Math.min(Math.max(rawArrow, TIP_ARROW_EDGE_PX - TIP_ARROW_APEX_PX), reach);
        const next = {
          left: Math.round(left),
          top: Math.round(top),
          below,
          pointed,
          arrow: Math.round(arrow),
        };
        if (
          tipBox === null ||
          tipBox.left !== next.left ||
          tipBox.top !== next.top ||
          tipBox.below !== next.below ||
          tipBox.pointed !== next.pointed ||
          tipBox.arrow !== next.arrow
        ) {
          setTipBox(next);
        }
      });

      useEffect(() => {
        if (tipSpec === null || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
          return undefined;
        }
        const onKey = (event) => {
          if (event.key === 'Escape') hideTip();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [tipSpec]);

      // `position: fixed` resolves against the viewport only while no ancestor
      // establishes a containing block — a transform, a filter or `will-change`
      // anywhere above the card does. So the bubble is re-measured after paint and
      // shifted by whatever the browser actually did, and the pointer is recomputed
      // against the corrected box: the apex keeps pointing at the word either way.
      useLayoutEffect(() => {
        if (tipSpec === null || tipBox === null || tipAnchor === null) return;
        const bubble = tipRef.current;
        if (bubble === null || bubble === undefined) return;
        const rect = bubble.getBoundingClientRect();
        const dx = tipBox.left - rect.left;
        const dy = tipBox.top - rect.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        // A runaway offset means the card itself is moving under the bubble; leave
        // the placement alone rather than chase it.
        if (Math.abs(dx) > 200 || Math.abs(dy) > 200) return;
        const left = Math.round(tipBox.left + dx);
        const centre = (tipAnchor.left + tipAnchor.right) / 2;
        const width = bubble.offsetWidth;
        const reach = width - TIP_ARROW_EDGE_PX - TIP_ARROW_APEX_PX;
        const raw = centre - left - TIP_ARROW_APEX_PX;
        const pointed = raw >= -TIP_ARROW_APEX_PX + TIP_ARROW_EDGE_PX - TIP_ARROW_APEX_PX && raw <= reach;
        const arrow = Math.min(Math.max(raw, TIP_ARROW_EDGE_PX - TIP_ARROW_APEX_PX), reach);
        setTipBox({
          left,
          top: Math.round(tipBox.top + dy),
          below: tipBox.below,
          pointed,
          arrow: Math.round(arrow),
        });
      }, [tipSpec, tipAnchor, tipBox]);

      const tipNode =
        tipSpec === null
          ? null
          : h(
              'span',
              {
                key: 'dbc-tip',
                ref: tipRef,
                className: 'dbc-tip' + (tipBox !== null && tipBox.below ? ' dbc-tip-below' : ''),
                role: 'tooltip',
                style:
                  tipBox === null
                    ? { left: '0px', top: '0px', visibility: 'hidden' }
                    : { left: tipBox.left + 'px', top: tipBox.top + 'px' },
              },
              // Rendered in every state so the bubble's child order stays fixed; a
              // pointer that cannot reach its word is hidden rather than misplaced.
              h('span', {
                key: 'arrow',
                className: 'dbc-tip-arrow',
                style:
                  tipBox === null
                    ? { display: 'none' }
                    : { left: tipBox.arrow + 'px', display: tipBox.pointed ? undefined : 'none' },
              }),
              (tipSpec.rows || []).map((row, index) =>
                h(
                  'span',
                  { key: 'row' + index, className: 'dbc-tip-row' },
                  row.tone ? h('span', { className: 'dbc-tip-dot dbc-tip-dot-' + row.tone }) : null,
                  h('span', { className: 'dbc-tip-label' }, row.label),
                  h('span', { className: 'dbc-tip-amount' }, row.text),
                ),
              ),
              (tipSpec.rows || []).length > 0 && tipSpec.note !== undefined && tipSpec.note !== null
                ? h('span', { key: 'rule', className: 'dbc-tip-rule' })
                : null,
              tipSpec.note === undefined || tipSpec.note === null
                ? null
                : h('span', { key: 'note', className: 'dbc-tip-note' }, tipSpec.note),
            );
      //#endregion

      const pricedNode =
        priceValues === null
          ? h(
              'div',
              { className: 'dbc-note' },
              tr(official || priced === null || priced.entry === null ? 'card.price.unknown' : 'card.price.otherProvider'),
            )
          : h(
              'div',
              { className: 'dbc-prices' },
              priceValues.map((row) =>
                h(
                  'div',
                  { key: row[0], className: 'dbc-price' },
                  h('span', { className: 'dbc-price-label' }, tr(row[0])),
                  h('span', { className: 'dbc-price-value' }, price.format(row[1])),
                ),
              ),
            );

      // One visual row per fact: countdown + chips, amount, provider, model, price
      // block. The amount never shares a line with the countdown, so a six-digit
      // balance and a two-week countdown can both be complete.
      const amountText = balanceMain === null ? null : balanceMain.text;
      // The amount carries the balance's hover text. It is the thing being explained,
      // so it is the thing you point at; no dashed underline, because the number is
      // already the loudest element on the card and a second affordance reads as a link.
      // The row lays out; the amount itself is the trigger. Wrapping the whole row
      // would make the empty half of the card answer for the number, so the handlers
      // sit on the inline box that is exactly as wide as the money.
      const amountRow = h(
        'div',
        { className: 'dbc-amount-row' },
        h(
          'span',
          Object.assign(
            {
              // A notice has nothing to explain, so it takes no help cursor either. A
              // real balance does — including the sub-cent「不足 0.01」row, which is an
              // amount with a breakdown, not a notice.
              className:
                'dbc-amount' +
                (balanceHint === null ? '' : ' dbc-tip-plain') +
                (amountText !== null && amountText.length > AMOUNT_SMALL_AT ? ' dbc-amount-small' : ''),
              // The visible label is gone, so the number carries its name for assistive
              // tech. `role="group"` is what makes the name legal here: a bare `span` is
              // a generic element and ARIA forbids naming it from the author.
              role: balanceHint === null ? undefined : 'group',
              'aria-label': balanceHint === null ? undefined : tr(titleKey),
            },
            tipTrigger(balanceHint),
          ),
          amountText === null
            ? h('span', { className: 'dbc-note' }, balanceNote)
            : [
                balanceMain.code === null ? null : h('span', { key: 'code', className: 'dbc-code' }, balanceMain.code),
                amountText,
              ],
        ),
      );

      return h(
        Fragment,
        null,
        h('style', { key: 'dbc-style' }, CARD_CSS),
        h(
          'div',
          { key: 'dbc-card', ref: rootRef, className: 'dbc-root', 'data-dsh-plugin': 'dsh-billing-card' },
          h(
            'div',
            { className: 'dbc-card' },
            holidayBanner === null
              ? null
              : h(
                  'div',
                  { className: 'dbc-holiday' },
                  holidayIcon(),
                  h('span', { className: 'dbc-holiday-text', title: holidayBanner }, holidayBanner),
                  holidayMeta === null ? null : h('span', { className: 'dbc-holiday-meta' }, holidayMeta),
                ),
            // The countdown opens the card: it is the one number that changes every
            // second, so it belongs where the eye lands first, and the chips answer
            // the same question from the right.
            h(
              'div',
              { className: 'dbc-head' },
              countdown === null ? null : h('span', { className: 'dbc-clock dbc-clock-' + tier }, countdown),
              h(
                'span',
                { className: 'dbc-chips' },
                h(
                  'span',
                  Object.assign({ className: 'dbc-chip dbc-chip-' + tier }, tipTrigger(periodTip)),
                  h('span', { className: 'dbc-dot', 'aria-hidden': 'true' }),
                  tr(peak ? 'card.period.peak' : 'card.period.idle'),
                ),
                makeupName === null
                  ? null
                  : h(
                      'span',
                      Object.assign({ className: 'dbc-chip dbc-chip-makeup' }, tipTrigger(makeupTip)),
                      tr('card.makeup'),
                    ),
              ),
            ),
            amountRow,
            h('div', { className: 'dbc-mrow' }, h('span', { className: 'dbc-provider' }, providerLabel)),
            // Only an official provider is billed from the table, so only then is
            // there a price story to tell; another provider bills its own account and
            // the card shows its list prices as a reference, not as that provider's rates.
            h(
              'span',
              Object.assign(
                { className: 'dbc-model' + (official ? ' dbc-tip-trigger' : '') },
                tipTrigger(official ? modelTip : null),
              ),
              modelLabel,
            ),
            pricedNode,
            tipNode,
          ),
        ),
      );
    }
    //#endregion

    //#region wiring
    /** Services required by this plugin. */
    const inject = ['slots', 'locale', 'timer', 'remote', 'remote.account', 'remote.session'];

    /** DSH release version, carried by the boot graph. */
    function appVersion() {
      try {
        const release = window.__DSH_BOOT__ === undefined ? undefined : window.__DSH_BOOT__.release;
        if (release !== undefined && typeof release.version === 'string' && release.version !== '') {
          return release.version;
        }
      } catch {
        // A missing or frozen boot graph is not worth failing the card over.
      }
      return '0.0.0';
    }

    /** Client identity the account service forwards to Platform. */
    function clientMetadata(locale) {
      return {
        version: appVersion(),
        locale: typeof locale === 'string' && locale !== '' ? locale : 'zh',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      };
    }

    /** Reads the signed-in wallet balances through the account remote. */
    async function readBalance(ctx) {
      let result;
      try {
        result = await ctx.remote.account.getBalance(clientMetadata(ctx.locale.getSnapshot().active));
      } catch {
        return { kind: 'failed' };
      }
      if (result === undefined || result === null || result.ok !== true) return { kind: 'failed' };
      const value = result.value;
      // `null` means the account grant is absent or no longer valid.
      if (value === null || value === undefined) return { kind: 'signedOut' };
      if (value.status !== 'ready') return { kind: 'failed' };
      return {
        kind: 'ready',
        wallets: Array.isArray(value.value) ? value.value : [],
        bonus: Array.isArray(value.bonusWallets) ? value.bonusWallets : [],
      };
    }

    /** Reads the model catalog and resolves the current default selection. */
    async function readModel(ctx) {
      let result;
      try {
        result = await ctx.remote.session.modelCatalog();
      } catch {
        return { kind: 'failed' };
      }
      if (result === undefined || result === null || result.ok !== true) return { kind: 'failed' };
      const catalog = result.value;
      if (catalog === undefined || catalog === null || catalog.default === undefined) {
        return { kind: 'failed' };
      }
      const current = catalog.default;
      const groups = Array.isArray(catalog.groups) ? catalog.groups : [];
      const failures = Array.isArray(catalog.failures) ? catalog.failures : [];
      // Prototype-free so a model id can never collide with Object keys.
      const names = Object.create(null);
      // The card names the provider above the model, so the catalogue's display
      // name is read here as well; a failed provider still carries its name.
      const providers = Object.create(null);
      for (const group of groups) {
        if (typeof group.id === 'string' && group.id !== '' && typeof group.name === 'string' && group.name !== '') {
          providers[group.id] = group.name;
        }
        const models = Array.isArray(group.models) ? group.models : [];
        for (const candidate of models) {
          if (typeof candidate.id !== 'string' || candidate.id === '') continue;
          if (typeof candidate.name === 'string' && candidate.name !== '') names[candidate.id] = candidate.name;
        }
      }
      for (const failure of failures) {
        if (typeof failure.id === 'string' && failure.id !== '' && typeof failure.name === 'string' && failure.name !== '') {
          providers[failure.id] = failure.name;
        }
      }
      const id = typeof current.model === 'string' ? current.model : null;
      return {
        kind: 'ready',
        provider: typeof current.provider === 'string' ? current.provider : null,
        id,
        name: id !== null && names[id] !== undefined ? names[id] : null,
        names,
        providers,
      };
    }

    //#region startup refresh
    /**
     * A price number: finite and non-negative.
     * @returns the number, or `null` when the value is unusable.
     */
    function priceNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    }

    /**
     * One tier of prices from the Host payload.
     * @returns `{ input, cacheRead, output }`, or `null` when a class is missing.
     */
    function readTier(value) {
      if (value === null || typeof value !== 'object') return null;
      const input = priceNumber(value.input);
      const cacheRead = priceNumber(value.cacheRead);
      const output = priceNumber(value.output);
      if (input === null || cacheRead === null || output === null) return null;
      return { input, cacheRead, output };
    }

    /**
     * One currency's price table from the Host payload, keeping only complete
     * rows.
     * @param value - one table as the Host parsed it.
     * @param currency - the currency that table quotes.
     * @returns `{ asOf, currency, models }`, or `null` when nothing usable arrived.
     */
    function readPrices(value, currency) {
      if (value === null || typeof value !== 'object') return null;
      const models = value.models;
      if (models === null || typeof models !== 'object') return null;
      const kept = {};
      for (const id of Object.keys(models)) {
        const entry = models[id];
        if (entry === null || typeof entry !== 'object') continue;
        const peak = readTier(entry.peak);
        const idle = readTier(entry.idle);
        if (peak === null || idle === null) continue;
        kept[id] = { label: typeof entry.label === 'string' ? entry.label : id, peak, idle };
      }
      if (Object.keys(kept).length === 0) return null;
      return {
        asOf:
          typeof value.asOf === 'string' && value.asOf !== '' ? value.asOf : PRICE_SNAPSHOT[currency].asOf,
        currency,
        models: kept,
      };
    }

    /**
     * Every price table from the Host payload, per currency.
     * @param value - the payload's `prices` member.
     * @returns `{ CNY, USD }` with `null` where a table is missing, or `null`
     * when the payload carries no usable table at all.
     */
    function readPriceBook(value) {
      if (value === null || typeof value !== 'object') return null;
      const book = { CNY: readPrices(value.CNY, 'CNY'), USD: readPrices(value.USD, 'USD') };
      return book.CNY === null && book.USD === null ? null : book;
    }

    /**
     * One calendar day list into a day set, dropping wild values.
     * @returns the set, possibly empty.
     */
    function readDays(list) {
      const days = new Set();
      if (!Array.isArray(list)) return days;
      for (const day of list) {
        // Day numbers are days since the epoch; the bound keeps a wild value out
        // of the period test while covering every year the calendar publishes.
        if (typeof day === 'number' && Number.isInteger(day) && day > 0 && day < 60000) days.add(day);
      }
      return days;
    }

    /**
     * The calendar from the Host payload: holiday days and make-up workdays,
     * each with the occasion name the card labels the day with.
     * @returns `{ days, names, makeup, makeupNames }`, or `null` when nothing
     * usable arrived.
     */
    function readHolidays(value) {
      if (value === null || typeof value !== 'object') return null;
      const days = readDays(value.days);
      const makeup = readDays(value.makeup);
      if (days.size === 0 && makeup.size === 0) return null;
      const names = (book) => {
        const kept = {};
        if (book === null || typeof book !== 'object') return kept;
        for (const key of Object.keys(book)) {
          const name = book[key];
          if (typeof name === 'string' && name !== '' && /^\d+$/.test(key)) kept[key] = name;
        }
        return kept;
      };
      return { days, names: names(value.names), makeup, makeupNames: names(value.makeupNames) };
    }

    /**
     * The open-platform balance the Host read with the configured API key.
     * @param value - the payload's `deepseek` member.
     * @returns `{ status, currency, total, granted, toppedUp }` (amounts are
     * decimal strings), or `null` when the payload carries nothing usable.
     */
    function readDeepseek(value) {
      if (value === null || typeof value !== 'object') return null;
      const status = typeof value.status === 'string' ? value.status : 'failed';
      if (status !== 'ready') return { status: status === 'unavailable' ? 'unavailable' : 'failed' };
      const amount = (text) => (typeof text === 'string' && /^\d+(?:\.\d+)?$/.test(text) ? text : null);
      const total = amount(value.total);
      if (total === null) return { status: 'failed' };
      return {
        status: 'ready',
        currency: value.currency === 'USD' ? 'USD' : 'CNY',
        total,
        granted: amount(value.granted) ?? '0',
        toppedUp: amount(value.toppedUp) ?? '0',
      };
    }

    /**
     * Turns the Host route body into the card's remote state.
     * @param payload - the parsed JSON body, or `null` when the route did not answer JSON.
     * @returns `{ status, prices, holidays }`; a `loading` status means "ask again".
     */
    function readRemote(payload) {
      if (payload === null || typeof payload !== 'object') {
        return { status: 'failed', prices: null, holidays: null, deepseek: null };
      }
      const prices = readPriceBook(payload.prices);
      const holidays = readHolidays(payload.holidays);
      const deepseek = readDeepseek(payload.deepseek);
      if (prices === null && holidays === null && deepseek === null) {
        const status = payload.status === 'loading' ? 'loading' : 'failed';
        return { status, prices: null, holidays: null, deepseek: null };
      }
      return { status: 'ready', prices, holidays, deepseek };
    }
    //#endregion

    /** How many one-second attempts to wait for the selection services to appear. */
    const SELECTION_RETRY_LIMIT = 15;

    /**
     * Follows the visible session's model selection and reports every change.
     *
     * `modelCatalog().default` is the deployment default, not the session's
     * pick, so the price line needs the per-session selection the composer
     * reads: `uiSession` publishes the visible session binding and
     * `modelDirectories` owns that session's selectable state. Both are
     * optional client services; when either is absent the card falls back to
     * the thirty-second catalog poll instead of failing.
     * @param ctx - client root context.
     * @param onChange - called with `{ provider, model }`, or `null` when unknown.
     * @returns a disposer that stops every subscription.
     */
    function watchSelection(ctx, onChange) {
      let stopped = false;
      let release = null;
      let retry = null;
      let attempts = 0;

      const stopRetry = () => {
        if (retry !== null) {
          retry();
          retry = null;
        }
      };

      // Returns true once the services exist, so a retry can stop early.
      const attach = () => {
        if (stopped) return true;
        const uiSession = ctx.get('uiSession');
        const modelDirectories = ctx.get('modelDirectories');
        if (uiSession === undefined || uiSession === null) return false;
        if (modelDirectories === undefined || modelDirectories === null) return false;
        const adapter = uiSession.adapter;
        const source = adapter === undefined || adapter === null ? undefined : adapter.current;
        if (source === undefined || source === null || typeof source.getSnapshot !== 'function') return false;

        let stopSource = null;
        let stopStore = null;
        let boundId;

        const bindSession = () => {
          const snapshot = source.getSnapshot();
          const sessionId = snapshot === null || snapshot === undefined ? undefined : snapshot.key;
          if (sessionId === boundId) return;
          boundId = sessionId;
          if (stopStore !== null) {
            stopStore();
            stopStore = null;
          }
          if (typeof sessionId !== 'string' || sessionId === '') {
            onChange(null);
            return;
          }
          let directory;
          try {
            directory = modelDirectories.directoryFor(sessionId);
          } catch {
            // An unknown or already disposed session scope is not an error here.
            onChange(null);
            return;
          }
          if (directory === null || directory === undefined || directory.store === undefined) {
            onChange(null);
            return;
          }
          const store = directory.store;
          const publish = () => {
            const state = store.getSnapshot();
            const current = state === null || state === undefined ? null : state.current;
            if (current === null || current === undefined || typeof current.model !== 'string') {
              onChange(null);
              return;
            }
            onChange({
              provider: typeof current.provider === 'string' ? current.provider : null,
              model: current.model,
            });
          };
          // Populates an idle directory; addressed subagent sessions refuse.
          if (typeof directory.load === 'function') {
            Promise.resolve()
              .then(() => directory.load())
              .catch(() => {});
          }
          publish();
          stopStore = typeof store.subscribe === 'function' ? store.subscribe(publish) : null;
        };

        bindSession();
        stopSource = typeof source.subscribe === 'function' ? source.subscribe(bindSession) : null;
        release = () => {
          if (stopSource !== null) stopSource();
          if (stopStore !== null) stopStore();
          stopSource = null;
          stopStore = null;
        };
        return true;
      };

      if (!attach()) {
        retry = ctx.timer.interval(() => {
          attempts += 1;
          if (stopped || attach() || attempts >= SELECTION_RETRY_LIMIT) stopRetry();
        }, 1000);
      }

      return () => {
        stopped = true;
        stopRetry();
        if (release !== null) release();
        release = null;
      };
    }

    /**
     * Follows the provider catalogue and the credential records.
     *
     * Adding a provider, switching the default, or pasting a key all change which
     * balance pays for the next turn, and none of them touches the visible
     * session's model selection. The Host re-reads the open-platform balance on
     * its own timer, so without this the card would keep showing the previous
     * answer until the next tick; the handler asks for a fresh one instead.
     * @param ctx - client root context.
     * @param onChange - called whenever the provider surface changed.
     * @returns a disposer that stops every subscription.
     */
    function watchUpstream(ctx, onChange) {
      const remote = ctx.remote;
      if (remote === undefined || remote === null || typeof remote.$on !== 'function') return () => {};
      const events = [
        'llm/adapters-updated',
        'settings/document-updated',
        'credentials/record-updated',
        'credentials/reference-updated',
      ];
      const stops = [];
      for (const event of events) {
        try {
          const stop = remote.$on(event, () => onChange());
          if (typeof stop === 'function') stops.push(stop);
        } catch {
          // An event this build does not publish is simply not followed.
        }
      }
      return () => {
        for (const stop of stops) stop();
      };
    }

    /** Registers the card's dictionaries, readers and footer entry. */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-billing-card: dictionaries');

      const every = (callback, delay) => ctx.timer.interval(callback, delay);
      const readLocale = () => ctx.locale.getSnapshot().active;

      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'dsh-billing-card',
            order: 10,
            locale: NS,
            inject: () => ({
              every,
              readLocale,
              readBalance: () => readBalance(ctx),
              readModel: () => readModel(ctx),
              watchSelection: (handler) => watchSelection(ctx, handler),
              watchUpstream: (handler) => watchUpstream(ctx, handler),
            }),
          },
          BillingCard,
        ),
      );
    }
    //#endregion

    return { inject, apply };
  },
});
