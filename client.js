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
    // The DSH tooltip primitive lives in the platform seed, so a real shell always
    // has it; the offline harness has no module table, and the card falls back to
    // the native title attribute there so the suite keeps running unchanged.
    let Tooltip = null;
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
      // A component may be a plain function or a forwardRef/memo object.
      const candidate = primitives === null || typeof primitives !== 'object' ? null : primitives.Tooltip;
      if (typeof candidate === 'function' || (candidate !== null && typeof candidate === 'object')) {
        Tooltip = candidate;
      }
    } catch {
      Tooltip = null;
    }
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
    /** Hover dwell before a tooltip appears; a focused control gets there faster. */
    const TOOLTIP_DELAY_MS = 400;
    const TOOLTIP_FOCUS_DELAY_MS = 150;
    /** Widest the hover bubble gets, so a long sentence wraps instead of running across. */
    const TOOLTIP_MAX_WIDTH = 248;

    //#region dictionaries
    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'card.title': 'DeepSeek 余额',
      'card.balance.loading': '读取中',
      'card.balance.failed': '读取失败',
      'card.balance.tiny': '不足 0.01',
      'card.balance.signedOut': '未登录',
      'card.title.api': 'DeepSeek API 余额',
      'card.balance.hint': 'DSH 账号余额，每 30 秒刷新',
      'card.balance.hint.api': 'DeepSeek 开放平台余额（API Key），每 30 秒刷新',
      'card.balance.api.missing': '未配置 API Key',
      'card.balance.api.failed': '读取失败，稍后重试',
      'card.balance.granted': '赠金',
      'card.balance.toppedUp': '充值',
      'card.balance.total': '合计',
      'card.balance.signedOutMissing': '未登录，且未配置 API Key',
      'card.balance.signedOutFailed': '未登录，API 余额读取失败',
      'card.balance.hintBonus': 'DSH 账号余额（充值 + 赠金合计），每 30 秒刷新',
      'card.bonus': '赠送',
      'card.period.idle': '空闲',
      'card.period.peak': '高峰',
      'card.schedule': '高峰：北京时间周一至周五 9:00–12:00、14:00–18:00（不含法定节假日）；其余时段为空闲。',
      'card.countdown.toPeak': '距高峰',
      'card.countdown.toIdle': '距空闲',
      'card.countdown.day': '天',
      'card.tier.idle': '空闲价',
      'card.tier.peak': '高峰价',
      'card.unit.short.CNY': '¥/百万',
      'card.unit.short.USD': '$/百万',
      'card.unit.long.CNY': '人民币元 / 百万 tokens',
      'card.unit.long.USD': '美元 / 百万 tokens',
      'card.snapshot': '价目快照',
      'card.snapshot.live': '启动时校准',
      'card.snapshot.builtin': '内置快照',
      'card.schedule.source': '节假日依据 iCloud 中国大陆节假日日历，启动时更新',
      'card.schedule.builtin': '节假日依据内置表',
      'card.holiday.banner': '假期中',
      'card.makeup': '调休',
      'card.makeup.tooltip': '调休工作日（班）',
      'card.makeup.billing': '仍按空闲时段计费',
      'card.price.input': '输入',
      'card.price.cacheRead': '缓存读取',
      'card.price.output': '输出',
      'card.price.unknown': '官方价目未收录该模型',
      'card.price.otherProvider': '该渠道不走官方价目',
    };
    /** English dictionary, checked complete against the zh key set. */
    const en = {
      'card.title': 'DeepSeek balance',
      'card.balance.loading': 'Reading',
      'card.balance.failed': 'Unavailable',
      'card.balance.tiny': 'under 0.01',
      'card.balance.signedOut': 'Signed out',
      'card.title.api': 'DeepSeek API balance',
      'card.balance.hint': 'DSH account balance, refreshed every 30 seconds',
      'card.balance.hint.api': 'DeepSeek platform balance for the API key, refreshed every 30 s',
      'card.balance.api.missing': 'No API key',
      'card.balance.api.failed': 'read failed, retrying',
      'card.balance.granted': 'Bonus',
      'card.balance.toppedUp': 'Topped up',
      'card.balance.total': 'Total',
      'card.balance.signedOutMissing': 'Not signed in, and no API key configured',
      'card.balance.signedOutFailed': 'Not signed in; the API balance could not be read',
      'card.balance.hintBonus': 'DSH account balance, recharge plus bonus, refreshed every 30 seconds',
      'card.bonus': 'Bonus',
      'card.period.idle': 'Idle',
      'card.period.peak': 'Peak',
      'card.schedule': 'Peak: Beijing time Monday to Friday 9:00-12:00 and 14:00-18:00, excluding Chinese statutory holidays. Every other time is idle.',
      'card.countdown.toPeak': 'Peak in',
      'card.countdown.toIdle': 'Idle in',
      'card.countdown.day': 'd',
      'card.tier.idle': 'Idle price',
      'card.tier.peak': 'Peak price',
      'card.unit.short.CNY': '¥/M',
      'card.unit.short.USD': '$/M',
      'card.unit.long.CNY': 'CNY per 1M tokens',
      'card.unit.long.USD': 'USD per 1M tokens',
      'card.snapshot': 'price snapshot',
      'card.snapshot.live': 'synced at startup',
      'card.snapshot.builtin': 'built-in snapshot',
      'card.schedule.source': 'holidays from the iCloud China mainland calendar, synced at startup',
      'card.schedule.builtin': 'holidays from the built-in table',
      'card.holiday.banner': ' holiday in progress',
      'card.makeup': 'Make-up',
      'card.makeup.tooltip': 'Make-up workday',
      'card.makeup.billing': 'still billed as off-peak',
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
      '.dbc-root{box-sizing:border-box;display:flex;flex-direction:column;flex:0 0 100%;min-width:0;order:10;margin-bottom:6px;user-select:none;-webkit-user-select:none}',
      '.dbc-card{box-sizing:border-box;display:flex;flex-direction:column;gap:5px;min-width:0;padding:8px 10px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;font-variant-numeric:tabular-nums}',
      '.dbc-head,.dbc-status,.dbc-model{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}',
      '.dbc-status{align-items:center;flex-wrap:wrap;justify-content:flex-start;row-gap:2px}',
      '.dbc-chips{display:flex;align-items:center;gap:4px;min-width:0}',
      '.dbc-title{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary)}',
      '.dbc-balance{flex:0 0 auto;font-size:15px;line-height:18px;font-weight:600;white-space:nowrap}',
      '.dbc-code{font-size:10px;font-weight:500;color:var(--dsw-alias-label-secondary)}',
      '.dbc-note{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary)}',
      '.dbc-chip{display:inline-flex;flex:0 0 auto;align-items:center;gap:4px;padding:1px 6px 1px 5px;border-radius:999px;font-size:11px;line-height:14px;white-space:nowrap;background:var(--dsw-alias-bg-layer-2)}',
      '.dbc-chip-idle{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}',
      '.dbc-chip-peak{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}',
      '.dbc-holiday{display:flex;align-items:center;gap:4px;margin:-8px -10px 0;padding:3px 10px 4px;border-radius:9px 9px 0 0;background:color-mix(in srgb,var(--dsw-alias-button-info-fill,var(--dsw-alias-label-secondary)) 10%,transparent);color:var(--dsw-alias-button-info-fill,var(--dsw-alias-label-secondary));font-size:11px;line-height:15px;overflow:hidden}',
      '.dbc-holiday-icon{flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
      '.dbc-holiday-text{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dbc-chip-makeup{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 12%,transparent)}',
      '.dbc-dot{width:5px;height:5px;border-radius:50%;background:currentColor}',
      '.dbc-countdown{flex:0 1 auto;min-width:0;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:14px;color:var(--dsw-alias-label-secondary)}',
      '.dbc-sep{height:1px;background:var(--dsw-alias-border-l1);margin:1px 0 0}',
      '.dbc-model-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:14px;color:var(--dsw-alias-label-secondary)}',
      '.dbc-tier{flex:0 0 auto;font-size:10px;line-height:13px;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.dbc-prices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}',
      '.dbc-price{display:flex;flex-direction:column;min-width:0}',
      '.dbc-price-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:12px;color:var(--dsw-alias-label-secondary)}',
      '.dbc-price-value{white-space:nowrap;font-size:12px;line-height:15px;font-weight:600}',
      '.dbc-tip-trigger{cursor:help;text-decoration:underline dotted;text-decoration-color:color-mix(in srgb,currentColor 42%,transparent);text-underline-offset:2px}',
      '.dbc-tip{display:flex;flex-direction:column;gap:4px;max-width:232px;padding:4px 6px;white-space:normal;text-align:left;color:inherit;user-select:none;-webkit-user-select:none}',
      '.dbc-tip-title{font-size:12.5px;line-height:17px;font-weight:600}',
      '.dbc-tip-row{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dbc-tip-badge{flex:0 0 auto;padding:0 5px;border-radius:4px;font-size:10.5px;line-height:15px;font-weight:600;color:inherit}',
      '.dbc-tip-badge-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 36%,transparent)}',
      '.dbc-tip-badge-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 38%,transparent)}',
      '.dbc-tip-badge-total{background:color-mix(in srgb,currentColor 20%,transparent)}',
      '.dbc-tip-amount{margin-left:auto;font-size:11.5px;line-height:16px;font-weight:500;font-variant-numeric:tabular-nums}',
      '.dbc-tip-line{font-size:11.5px;line-height:16px;opacity:.88;white-space:pre-line}',
      '.dbc-tip-note{font-size:11px;line-height:16px;opacity:.72;white-space:pre-line}',
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
      const holidaySource = tr(calendar === BUILTIN_CALENDAR ? 'card.schedule.builtin' : 'card.schedule.source');

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
      const unit =
        tr('card.unit.short.' + currency) + ' · ' + tr(tier === 'peak' ? 'card.tier.peak' : 'card.tier.idle');
      const unitTitle =
        tr('card.unit.long.' + currency) +
        ' · ' +
        tr('card.snapshot') +
        ' ' +
        rates.asOf +
        ' · ' +
        tr(rates === PRICE_SNAPSHOT[currency] ? 'card.snapshot.builtin' : 'card.snapshot.live');

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
      // The banner reads "国庆节假期中", and joins two occasions with a spaced "&".
      const holidayBanner =
        holidayName === null ? null : holidayName.split('、').join(' & ') + tr('card.holiday.banner');
      const makeupTitle =
        makeupName === null
          ? undefined
          : {
              title: '🔁 ' + tr('card.makeup') + ' · ' + makeupName,
              rows: [],
              note: tr('card.makeup.tooltip') + ' ' + tr('card.makeup.billing'),
            };

      // Two balances, one headline. The provider decides which one is the truth:
      // DeepSeek's own provider bills the open platform, every other provider is
      // billed by the DSH account. A signed-out account has nothing to report, so
      // the API balance stands in — real money beats a notice. Only when neither
      // source can answer does the headline become that notice.
      let balanceMain = null;
      let balanceNote = null;
      let balanceHint = null;
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
            badge: tr('card.balance.toppedUp'),
            text: walletMoney(apiBalance.currency, apiBalance.toppedUp),
          });
        }
        if (granted !== null) {
          rows.push({
            tone: 'warn',
            badge: tr('card.balance.granted'),
            text: walletMoney(apiBalance.currency, apiBalance.granted),
          });
        }
        rows.push({ tone: 'total', badge: tr('card.balance.total'), text: walletMoney(apiBalance.currency, apiBalance.total) });
        balanceHint = { title: '💰 ' + tr('card.title.api'), rows, note: tr('card.balance.hint.api') };
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
            badge: tr('card.balance.toppedUp'),
            text: walletMoney(wallet.currency, wallet.balance),
          });
        }
        for (const wallet of account.bonus) {
          rows.push({ tone: 'warn', badge: tr('card.bonus'), text: walletMoney(wallet.currency, wallet.balance) });
        }
        rows.push({ tone: 'total', badge: tr('card.balance.total'), text: walletMoney(total.currency, total.text) });
        balanceHint = {
          title: '💰 ' + tr('card.title'),
          rows,
          note: tr(total.includesBonus ? 'card.balance.hintBonus' : 'card.balance.hint'),
        };
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

      const modelLabel =
        activeId !== null ? (activeName !== null ? activeName : activeId) : model.kind === 'failed' ? '—' : tr('card.balance.loading');
      const modelTitle = {
        title: '🏷️ ' + modelLabel,
        rows: [],
        note: activeId === null ? unitTitle : activeId + ' · ' + unitTitle,
      };
      const priceValues =
        official && priced !== null && priced.entry !== null
          ? [
              ['card.price.input', priced.entry[tier].input],
              ['card.price.cacheRead', priced.entry[tier].cacheRead],
              ['card.price.output', priced.entry[tier].output],
            ]
          : null;

      /**
       * Builds the hover body: a title line, one line per fact, and a footnote.
       * Wallet lines carry a colored badge, so a glance says which kind of money
       * a number is; the bubble is capped so long sentences wrap.
       */
      const tipBody = (spec) => {
        const body = typeof spec === 'string' ? { title: spec, rows: [], note: null } : spec;
        const rows = body.rows || [];
        return h(
          'span',
          { className: 'dbc-tip' },
          h('span', { key: 'title', className: 'dbc-tip-title' }, body.title),
          rows.map((row, index) =>
            h(
              'span',
              { key: 'row' + index, className: 'dbc-tip-row' },
              row.badge ? h('span', { className: 'dbc-tip-badge dbc-tip-badge-' + row.tone }, row.badge) : null,
              h('span', { className: row.badge ? 'dbc-tip-amount' : 'dbc-tip-line' }, row.text),
            ),
          ),
          body.note ? h('span', { key: 'note', className: 'dbc-tip-note' }, body.note) : null,
        );
      };

      /**
       * Wraps a node in the DSH tooltip after a short hover delay; without the
       * primitive -- the offline harness -- the native title attribute stays.
       */
      const tip = (node, spec) => {
        const title = spec === null || spec === undefined ? '' : typeof spec === 'string' ? spec : spec.title;
        if (title === '') return node;
        if (Tooltip === null) {
          const text =
            typeof spec === 'string'
              ? spec
              : [spec.title]
                  .concat((spec.rows || []).map((row) => (row.badge ? row.badge + ' ' + row.text : row.text)))
                  .concat(spec.note ? [spec.note] : [])
                  .join('\n');
          return h(node.tag, Object.assign({}, node.props, { title: text }), node.children);
        }
        return h(Tooltip, {
          label: tipBody(spec),
          side: 'top',
          align: 'start',
          maxWidth: TOOLTIP_MAX_WIDTH,
          delayMs: TOOLTIP_DELAY_MS,
          focusDelayMs: TOOLTIP_FOCUS_DELAY_MS,
        }, node);
      };

      const balanceBody =
        balanceMain === null
          ? h('span', { className: 'dbc-note' }, balanceNote)
          : h(
              'span',
              { className: 'dbc-balance' },
              balanceMain.code === null ? null : h('span', { className: 'dbc-code' }, balanceMain.code + ' '),
              balanceMain.text,
            );
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
                  h('span', { className: 'dbc-holiday-text' }, holidayBanner),
                ),
            // The trigger is the label, not the row: hovering a number should never
            // open an explanation, and a row-wide anchor makes the bubble sit flat
            // against the card edge instead of hanging off the word it explains.
            h(
              'div',
              { className: 'dbc-head' },
              tip(h('span', { className: 'dbc-title dbc-tip-trigger' }, tr(titleKey)), balanceHint),
              balanceBody,
            ),
            h(
              'div',
              { className: 'dbc-status' },
              h(
                'span',
                { className: 'dbc-chips' },
                tip(
                  h(
                    'span',
                    { className: 'dbc-chip dbc-chip-' + tier },
                    h('span', { className: 'dbc-dot', 'aria-hidden': 'true' }),
                    tr(peak ? 'card.period.peak' : 'card.period.idle'),
                  ),
                  {
                    title: '⏱️ ' + tr(peak ? 'card.period.peak' : 'card.period.idle'),
                    rows: [],
                    note: tr('card.schedule') + ' · ' + holidaySource,
                  },
                ),
                makeupName === null
                  ? null
                  : tip(h('span', { className: 'dbc-chip dbc-chip-makeup' }, tr('card.makeup')), makeupTitle),
              ),
              countdown === null ? null : h('span', { className: 'dbc-countdown' }, countdown),
            ),
            h('div', { className: 'dbc-sep', 'aria-hidden': 'true' }),
            h(
              'div',
              { className: 'dbc-model' },
              tip(h('span', { className: 'dbc-model-name dbc-tip-trigger' }, modelLabel), modelTitle),
              h('span', { className: 'dbc-tier' }, unit),
            ),
            pricedNode,
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
      // Prototype-free so a model id can never collide with Object keys.
      const names = Object.create(null);
      for (const group of groups) {
        const models = Array.isArray(group.models) ? group.models : [];
        for (const candidate of models) {
          if (typeof candidate.id !== 'string' || candidate.id === '') continue;
          if (typeof candidate.name === 'string' && candidate.name !== '') names[candidate.id] = candidate.name;
        }
      }
      const id = typeof current.model === 'string' ? current.model : null;
      return {
        kind: 'ready',
        provider: typeof current.provider === 'string' ? current.provider : null,
        id,
        name: id !== null && names[id] !== undefined ? names[id] : null,
        names,
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
