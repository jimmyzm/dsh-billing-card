/**
 * Offline test for client.js: mini React runtime, fake services, committed
 * fixtures. Run with `node test/client.test.mjs`.
 *
 * Loads the real client module in Node with a miniature React runtime, a fake
 * slot/locale/remote context, and asserts the rendered card text for a set of
 * billing-window scenarios. No browser, no DSH runtime.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHolidayCalendar, parsePricingHtml } from '../parse.js';
import vm from 'node:vm';

const SOURCE = fileURLToPath(new URL('../client.js', import.meta.url));
const src = fs.readFileSync(SOURCE, 'utf8');

// ---------------------------------------------------------------- mini React
let renderCtx = null;

function createElement(tag, props, ...children) {
  return { tag, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) };
}

const ReactStub = {
  Fragment: 'Fragment',
  createElement,
  useState(initial) {
    const ctx = renderCtx;
    const slot = ctx.cursor++;
    if (!(slot in ctx.state)) ctx.state[slot] = typeof initial === 'function' ? initial() : initial;
    return [
      ctx.state[slot],
      (next) => {
        const value = typeof next === 'function' ? next(ctx.state[slot]) : next;
        if (Object.is(value, ctx.state[slot])) return;
        ctx.state[slot] = value;
        ctx.dirty = true;
      },
    ];
  },
  useRef(initial) {
    const ctx = renderCtx;
    const slot = ctx.cursor++;
    if (!(slot in ctx.refs)) ctx.refs[slot] = { current: initial };
    return ctx.refs[slot];
  },
  useMemo(factory) {
    renderCtx.cursor++;
    return factory();
  },
  useEffect(effect, deps) {
    const ctx = renderCtx;
    const slot = ctx.cursor++;
    const previous = ctx.effects[slot];
    const changed =
      previous === undefined ||
      deps === undefined ||
      previous.deps === undefined ||
      deps.length !== previous.deps.length ||
      deps.some((d, i) => !Object.is(d, previous.deps[i]));
    if (!changed) return;
    ctx.effects[slot] = { deps, cleanup: undefined };
    ctx.pending.push(() => {
      if (previous !== undefined && typeof previous.cleanup === 'function') previous.cleanup();
      ctx.effects[slot].cleanup = effect();
    });
  },
};

// ---------------------------------------------------------------- module load
let installed = null;
const sandboxWindow = {
  __ModuleLoader__: {
    load({ factory }) {
      installed = factory((name) => {
        if (name === 'react') return ReactStub;
        throw new Error('unexpected require: ' + name);
      });
    },
  },
  __DSH_BOOT__: { release: { version: '0.2.1-rc.3' } },
};
globalThis.window = sandboxWindow;
vm.runInThisContext(src, { filename: SOURCE });

// ---------------------------------------------------------------- fake context
function makeContext({ balance = undefined, catalog = undefined, services = {}, activeLocale = 'zh' } = {}) {
  const registered = { slot: null, component: null, options: null, dictionaries: null, timers: [] };
  const ctx = {
    // Cordis exposes services through ctx.get(); absent ones return undefined.
    get(name) {
      return Object.prototype.hasOwnProperty.call(services, name) ? services[name] : undefined;
    },
    effect(callback) {
      const dispose = callback();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    locale: {
      register(namespace, dictionaries) {
        registered.dictionaries = dictionaries;
        return () => {};
      },
      getSnapshot: () => ({ active: activeLocale, locales: [], revision: 1 }),
    },
    timer: {
      interval(callback, delay) {
        registered.timers.push({ callback, delay });
        return () => {};
      },
    },
    remote: {
      account: {
        async getBalance(metadata) {
          registered.metadata = metadata;
          return balance === undefined ? { ok: true, value: null } : balance;
        },
      },
      session: {
        async modelCatalog() {
          return catalog === undefined
            ? { ok: true, value: { default: { provider: 'deepseek-account', model: 'DeepSeek-Flash' }, routableProviders: [], groups: [] } }
            : catalog;
        },
      },
    },
    slots: {
      inject(name, factory) {
        registered.slot = name;
        return factory();
      },
      register(options, component) {
        registered.options = options;
        registered.component = component;
        return () => {};
      },
    },
  };
  return { ctx, registered };
}

// ---------------------------------------------------------------- mount helper
async function mount({ now, balance, catalog, services = liveServices().services, props = {}, data = null, onApply, onTimer, locale = 'zh', route = 'json' }) {
  // The card asks the Host route on mount; `data` is its answer (or a failure).
  // `route` names the transport state instead: an absent `fetch` global, or a
  // route that answers 404.
  const realFetch = globalThis.fetch;
  const realSetTimeout = globalThis.setTimeout;
  const delays = [];
  globalThis.fetch =
    route === 'absent'
      ? undefined
      : async () => {
          if (route === 'http-404') return { ok: false, status: 404, json: async () => null };
          if (data === null) throw new Error('no route');
          return { ok: true, json: async () => data };
        };
  globalThis.setTimeout = (fn, delay, ...rest) => {
    delays.push(delay);
    // Run the Host-poll cadence immediately so a loading answer cannot stall the run.
    return realSetTimeout(fn, delay === 3000 ? 0 : delay, ...rest);
  };
  const { ctx, registered } = makeContext({ balance, catalog, services, activeLocale: locale });
  installed.apply(ctx);
  if (typeof onApply === 'function') onApply(registered.dictionaries);
  if (typeof onTimer === 'function') onTimer(registered.timers);

  {
    const mountCtx = { cursor: 0, state: {}, refs: {}, effects: {}, pending: [], dirty: false };
    const injected = registered.options.inject();
    const allProps = { ...injected, wide: true, t: (key) => (registered.dictionaries?.zh?.[key] ?? key), ...props };

    // One React-like render pass, including the effects queued by it.
    const pump = async () => {
      const realNow = Date.now;
      Date.now = () => now;
      let tree;
      for (let pass = 0; pass < 12; pass += 1) {
        const previous = renderCtx;
        renderCtx = mountCtx;
        mountCtx.cursor = 0;
        mountCtx.dirty = false;
        try {
          tree = registered.component(allProps);
        } finally {
          renderCtx = previous;
        }
        const queued = mountCtx.pending;
        mountCtx.pending = [];
        for (const run of queued) run();
        // Let the injected async readers settle.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!mountCtx.dirty) break;
      }
      Date.now = realNow;
      return tree;
    };
    const tree = await pump();
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realSetTimeout;
    return { tree, registered, props: allProps, pump, delays };
  }
}

/**
 * Mounts the card in a given interface language, resolving `t` from the
 * dictionary the plugin registers for that language.
 * @returns the mount handle plus the registered dictionaries.
 */
async function mountLocalized(language, options = {}) {
  const state = { dictionaries: null };
  // The host falls back the same way: Chinese locales read the zh dictionary,
  // every other locale reads the english one.
  const bucket = language.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
  const handle = await mount({
    ...options,
    locale: language,
    onApply: (dictionaries) => {
      state.dictionaries = dictionaries;
    },
    props: { ...(options.props ?? {}), t: (key) => state.dictionaries?.[bucket]?.[key] ?? key },
  });
  return { ...handle, dictionaries: state.dictionaries };
}

// ---------------------------------------------------------------- tree queries
function text(node) {
  if (typeof node === 'string') return node;
  if (node === null || node === undefined || typeof node !== 'object') return '';
  return node.children.map(text).join('');
}
function findAll(node, predicate, out = []) {
  if (node === null || typeof node !== 'object') return out;
  if (predicate(node)) out.push(node);
  for (const child of node.children) findAll(child, predicate, out);
  return out;
}
function classes(tree) {
  return findAll(tree, (n) => typeof n.props.className === 'string').map((n) => n.props.className);
}
function byClass(tree, name) {
  const hit = findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className.split(' ').includes(name));
  return hit.length === 0 ? null : hit[0];
}

// ------------------------------------------------- selection service stubs
/**
 * Mirrors the client services the card follows for live model selection:
 * `uiSession.adapter.current` names the visible session, and
 * `modelDirectories.directoryFor(id).store` holds that session's selection.
 */
function liveServices(initial = {}) {
  const selections = new Map(Object.entries(initial));
  const sourceListeners = new Set();
  const directories = new Map();
  let activeId = 'session-1';
  const directoryFor = (id) => {
    let entry = directories.get(id);
    if (entry === undefined) {
      const listeners = new Set();
      entry = {
        listeners,
        store: {
          getSnapshot: () => ({ current: selections.get(id) ?? null }),
          subscribe: (fn) => {
            listeners.add(fn);
            return () => listeners.delete(fn);
          },
        },
        load: async () => {},
      };
      directories.set(id, entry);
    }
    return entry;
  };
  return {
    services: {
      uiSession: {
        adapter: {
          current: {
            getSnapshot: () => ({ key: activeId }),
            subscribe: (fn) => {
              sourceListeners.add(fn);
              return () => sourceListeners.delete(fn);
            },
          },
        },
      },
      modelDirectories: { directoryFor },
    },
    /** Changes one session's selection and notifies its subscribers. */
    select(sessionId, current) {
      selections.set(sessionId, current);
      const entry = directories.get(sessionId);
      if (entry !== undefined) for (const fn of [...entry.listeners]) fn();
    },
    /** Makes another session the one the main view shows. */
    activate(sessionId) {
      activeId = sessionId;
      for (const fn of [...sourceListeners]) fn();
    },
  };
}

// ---------------------------------------------------------------- assertions
let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual));
}

const READY_BALANCE = {
  ok: true,
  value: {
    status: 'ready',
    value: [{ currency: 'CNY', balance: '32.50' }],
    bonusWallets: [{ currency: 'CNY', balance: '0.00' }],
  },
};
const CATALOG = {
  ok: true,
  value: {
    default: { provider: 'deepseek-account', model: 'DeepSeek-Flash' },
    routableProviders: ['qoder'],
    groups: [{ id: 'qoder', name: 'Qoder', models: [{ id: 'DeepSeek-Flash', name: 'DeepSeek-Flash' }] }],
  },
};

const CASES = [
  ['monday-before-peak', Date.parse('2026-10-25T16:52:00Z'), 'idle', '距高峰 08:08:00'],
  ['sunday-noon', Date.parse('2026-10-25T04:00:00Z'), 'idle', '距高峰 21:00:00'],
  ['monday-morning-peak', Date.parse('2026-10-26T01:30:00Z'), 'peak', '距空闲 02:30:00'],
  ['monday-lunch-idle', Date.parse('2026-10-26T05:00:00Z'), 'idle', '距高峰 01:00:00'],
  ['friday-1800', Date.parse('2026-10-30T10:00:00Z'), 'idle', '距高峰 2天 15:00:00'],
  ['holiday-thursday', Date.parse('2026-10-01T02:00:00Z'), 'idle', '距高峰 6天 23:00:00'],
  ['holiday-end-boundary', Date.parse('2026-10-08T01:00:00Z'), 'peak', '距空闲 03:00:00'],
  ['holiday-last-day', Date.parse('2026-10-07T02:00:00Z'), 'idle', '距高峰 23:00:00'],
  ['monday-1159', Date.parse('2026-10-26T03:59:59Z'), 'peak', '距空闲 00:00:01'],
  ['monday-1200', Date.parse('2026-10-26T04:00:00Z'), 'idle', '距高峰 02:00:00'],
  ['friday-1759', Date.parse('2026-10-30T09:59:00Z'), 'peak', '距空闲 00:01:00'],
  ['saturday-1000', Date.parse('2026-10-31T02:00:00Z'), 'idle', '距高峰 1天 23:00:00'],
  ['sunday-1000', Date.parse('2026-11-01T02:00:00Z'), 'idle', '距高峰 23:00:00'],
  // A make-up Saturday is billed by the weekday rule, so it is idle all day,
  // and it still needs the 调休 chip — asserted in its own block below.
  ['makeup-saturday-1000', Date.parse('2026-10-10T02:00:00Z'), 'idle', '距高峰 1天 23:00:00'],
  // The first weekday of the Spring Festival is idle, and the countdown walks
  // the whole run to the day after it.
  ['spring-festival-weekday', Date.parse('2026-02-16T02:00:00Z'), 'idle', '距高峰 7天 23:00:00'],
  // Every boundary minute on every weekday: the rule treats Mon-Fri alike, so
  // a wrong weekday lookup has to surface on each of the five, not just Monday.
  ...['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].flatMap((date, position) => {
    const name = ['mon', 'tue', 'wed', 'thu', 'fri'][position];
    return [
      [name + '-0900', Date.parse(date + 'T01:00:00Z'), 'peak', '距空闲 03:00:00'],
      [name + '-1159', Date.parse(date + 'T03:59:59Z'), 'peak', '距空闲 00:00:01'],
      [name + '-1200', Date.parse(date + 'T04:00:00Z'), 'idle', '距高峰 02:00:00'],
      [name + '-1359', Date.parse(date + 'T05:59:59Z'), 'idle', '距高峰 00:00:01'],
      [name + '-1400', Date.parse(date + 'T06:00:00Z'), 'peak', '距空闲 04:00:00'],
      [name + '-1759', Date.parse(date + 'T09:59:59Z'), 'peak', '距空闲 00:00:01'],
      [name + '-1800', Date.parse(date + 'T10:00:00Z'), 'idle', name === 'fri' ? '距高峰 2天 15:00:00' : '距高峰 15:00:00'],
    ];
  }),
];

console.log('module wiring');
{
  const { ctx, registered } = makeContext({ balance: READY_BALANCE, catalog: CATALOG });
  installed.apply(ctx);
  check('client inject list', JSON.stringify(installed.inject), JSON.stringify(['slots', 'locale', 'timer', 'remote', 'remote.account', 'remote.session']));
  check('registered slot', registered.slot, 'sidebar.footer.action');
  check('entry id', registered.options.id, 'dsh-billing-card');
  check('entry locale namespace', registered.options.locale, 'dsh-billing-card');
  check('dictionary locales', JSON.stringify(Object.keys(registered.dictionaries)), JSON.stringify(['zh', 'en']));
  const keySet = (dict) => Object.keys(dict).sort().join(',');
  check('zh/en key sets match', keySet(registered.dictionaries.zh), keySet(registered.dictionaries.en));
  check('zh key count', Object.keys(registered.dictionaries.zh).length, Object.keys(registered.dictionaries.en).length);
}

for (const [label, now, expectedPeriod, expectedCountdown] of CASES) {
  const { tree } = await mount({ now, balance: READY_BALANCE, catalog: CATALOG });
  const chip = byClass(tree, 'dbc-chip');
  check(label + ' chip class', chip.props.className, 'dbc-chip dbc-chip-' + expectedPeriod);
  check(label + ' chip text', text(chip).trim(), expectedPeriod === 'peak' ? '高峰' : '空闲');
  check(label + ' countdown', text(byClass(tree, 'dbc-countdown')), expectedCountdown);
  check(label + ' balance', text(byClass(tree, 'dbc-balance')), '¥32.50');
  check(label + ' model', text(byClass(tree, 'dbc-model-name')), 'DeepSeek-Flash');
  const values = findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className === 'dbc-price-value').map(text);
  const expectedPrices =
    expectedPeriod === 'peak' ? ['2.00', '0.04', '8.00'] : ['1.00', '0.02', '4.00'];
  check(label + ' prices', JSON.stringify(values), JSON.stringify(expectedPrices));
}

console.log('data shapes');
for (const [label, balance, expected, expectedTitle] of [
  ['signed-out', { ok: true, value: null }, '未登录', 'DSH 账号余额，每 30 秒刷新'],
  ['failed-read', { ok: false, error: 'boom' }, '读取失败', 'DSH 账号余额，每 30 秒刷新'],
  ['platform-failed', { ok: true, value: { status: 'failed' } }, '读取失败', 'DSH 账号余额，每 30 秒刷新'],
  ['empty-wallets', { ok: true, value: { status: 'ready', value: [], bonusWallets: [] } }, '读取失败', 'DSH 账号余额，每 30 秒刷新'],
  ['tiny-amount', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '0.004' }], bonusWallets: [] } }, '¥不足 0.01', null],
  ['usd-only', { ok: true, value: { status: 'ready', value: [{ currency: 'USD', balance: '7.5' }], bonusWallets: [] } }, '$7.50', null],
  ['cents-exact', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '12.34' }], bonusWallets: [] } }, '¥12.34', null],
  ['cents-truncated', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '0.999' }], bonusWallets: [] } }, '¥0.99', null],
  ['large-amount', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '12345.678' }], bonusWallets: [] } }, '¥12,345.67', null],
  ['negative-rounds-to-zero', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '-0.004' }], bonusWallets: [] } }, '¥0.00', null],
  ['zero-balance', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '0' }], bonusWallets: [] } }, '¥0.00', null],
  ['sub-cent-rounds-up-edge', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '0.01' }], bonusWallets: [] } }, '¥0.01', null],
]) {
  const { tree } = await mount({ now: Date.parse('2026-10-25T16:52:00Z'), balance });
  const note = byClass(tree, 'dbc-balance') || byClass(tree, 'dbc-note');
  check(label + ' balance text', text(note), expected);
  if (expectedTitle !== null) check(label + ' tooltip', note.props.title, expectedTitle);
  const values = findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className === 'dbc-price-value').map(text);
  check(label + ' still prices model', values.length, 3);
}

for (const [label, catalog, expectedNote, expectedValues] of [
  ['unknown-model', { ok: true, value: { default: { provider: 'deepseek-account', model: 'gpt-5' }, groups: [] } }, '官方价目未收录该模型', []],
  ['alias-model', { ok: true, value: { default: { provider: 'deepseek-account', model: 'deepseek-v4-flash' }, groups: [] } }, null, ['1.00', '0.02', '4.00']],
  ['v4-pro-by-name', { ok: true, value: { default: { provider: 'deepseek-account', model: 'x' }, groups: [{ models: [{ id: 'x', name: 'DeepSeek-V4-Pro-0813' }] }] } }, '官方价目未收录该模型', []],
  ['failed-catalog', { ok: false }, '官方价目未收录该模型', []],
]) {
  const { tree } = await mount({ now: Date.parse('2026-10-25T16:52:00Z'), catalog });
  const notes = findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className === 'dbc-note').map(text);
  if (expectedNote !== null) check(label + ' note', notes.includes(expectedNote), true);
  const values = findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className === 'dbc-price-value').map(text);
  check(label + ' prices', JSON.stringify(values), JSON.stringify(expectedValues));
}

console.log('rail mode');
{
  const { tree } = await mount({ now: Date.parse('2026-10-25T16:52:00Z'), balance: READY_BALANCE, catalog: CATALOG, props: { wide: false } });
  check('rail renders nothing', tree, null);
}

console.log('english locale');
{
  const { tree } = await mountLocalized('en', {
    now: Date.parse('2026-10-25T16:52:00Z'),
    balance: READY_BALANCE,
    catalog: CATALOG,
  });
  check('en chip', text(byClass(tree, 'dbc-chip')).trim(), 'Idle');
  check('en countdown', text(byClass(tree, 'dbc-countdown')), 'Peak in 08:08:00');
  check('en title', text(byClass(tree, 'dbc-title')), 'DeepSeek balance');
  check('en tier quotes USD', text(byClass(tree, 'dbc-tier')), '$/M · Idle price');
  const values = findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className === 'dbc-price-value').map(text);
  check('en prices come from the USD table', JSON.stringify(values), JSON.stringify(['0.15', '0.003', '0.60']));
  check('en price labels', JSON.stringify(findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className === 'dbc-price-label').map(text)), JSON.stringify(['Input', 'Cache read', 'Output']));
  check('en unit tooltip names the currency', byClass(tree, 'dbc-tier').props.title.includes('USD per 1M tokens'), true);
  check('en balance spells its currency code', text(byClass(tree, 'dbc-balance')), 'CNY ¥32.50');
}

console.log('timer cadence');
{
  let timers = [];
  await mount({
    now: Date.parse('2026-10-25T16:52:00Z'),
    balance: READY_BALANCE,
    catalog: CATALOG,
    onTimer: (list) => { timers = list; },
  });
  check('clock + data intervals', JSON.stringify(timers.map((t) => t.delay).sort((a, b) => a - b)), JSON.stringify([1000, 30000]));
}

console.log('long countdown in english');
{
  const { tree } = await mountLocalized('en', {
    now: Date.parse('2026-10-30T10:00:00Z'),
    balance: READY_BALANCE,
    catalog: CATALOG,
  });
  check('en weekend countdown', text(byClass(tree, 'dbc-countdown')), 'Peak in 2d 15:00:00');
}

// ------------------------------------------------------------ new behaviour
const CATALOG_TWO = {
  ok: true,
  value: {
    default: { provider: 'deepseek-account', model: 'DeepSeek-Flash' },
    routableProviders: ['qoder'],
    groups: [
      {
        id: 'qoder',
        name: 'Qoder',
        models: [
          { id: 'DeepSeek-Flash', name: 'DeepSeek-Flash' },
          { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro-0813' },
        ],
      },
    ],
  },
};
const IDLE_NOW = Date.parse('2026-10-25T16:52:00Z');
const priced = (tree) =>
  findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className === 'dbc-price-value').map(text);
const wallets = (recharge, bonus) => ({ ok: true, value: { status: 'ready', value: recharge, bonusWallets: bonus } });

console.log('balance total');
{
  let { tree } = await mount({
    now: IDLE_NOW,
    balance: wallets([{ currency: 'CNY', balance: '32.50' }], [{ currency: 'CNY', balance: '10.00' }]),
    catalog: CATALOG,
  });
  check('total adds the bonus', text(byClass(tree, 'dbc-balance')), '¥42.50');
  check(
    'tooltip lists every wallet',
    byClass(tree, 'dbc-balance').props.title.split('\n').join(' | '),
    'DSH 账号余额（充值 + 赠金合计），每 30 秒刷新 | CNY ¥32.50 | 赠送 CNY ¥10.00',
  );
  check('heading hints the total', byClass(tree, 'dbc-title').props.title, 'DSH 账号余额（充值 + 赠金合计），每 30 秒刷新');

  // 0.06 + 0.01 is 0.06999999999999999 in floats: truncation would drop a cent.
  ({ tree } = await mount({
    now: IDLE_NOW,
    balance: wallets([{ currency: 'CNY', balance: '0.06' }], [{ currency: 'CNY', balance: '0.01' }]),
    catalog: CATALOG,
  }));
  check('sum keeps every cent', text(byClass(tree, 'dbc-balance')), '¥0.07');

  // A bonus in another currency never renames the reported total.
  ({ tree } = await mount({
    now: IDLE_NOW,
    balance: wallets([{ currency: 'USD', balance: '5.00' }], [{ currency: 'CNY', balance: '1.00' }]),
    catalog: CATALOG,
  }));
  check('recharge currency wins', text(byClass(tree, 'dbc-balance')), '$5.00');
  check(
    'foreign bonus still listed',
    byClass(tree, 'dbc-balance').props.title.split('\n').slice(1).join(' | '),
    'USD $5.00 | 赠送 CNY ¥1.00',
  );

  // Bonus only: the total is the grant itself.
  ({ tree } = await mount({
    now: IDLE_NOW,
    balance: wallets([], [{ currency: 'CNY', balance: '3.00' }]),
    catalog: CATALOG,
  }));
  check('bonus-only account', text(byClass(tree, 'dbc-balance')), '¥3.00');

  // Sub-cent totals keep the existing "under 0.01" wording.
  ({ tree } = await mount({
    now: IDLE_NOW,
    balance: wallets([{ currency: 'CNY', balance: '0.001' }], [{ currency: 'CNY', balance: '0.002' }]),
    catalog: CATALOG,
  }));
  check('sub-cent total', text(byClass(tree, 'dbc-note')), '¥不足 0.01');
}

console.log('live model switching');
{
  const live = liveServices();
  const { tree, pump } = await mount({
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG_TWO,
    services: live.services,
  });
  check('unselected session keeps the default', text(byClass(tree, 'dbc-model-name')), 'DeepSeek-Flash');

  live.select('session-1', { provider: 'deepseek-account', model: 'deepseek-v4-pro' });
  let next = await pump();
  check('switch repaints the model', text(byClass(next, 'dbc-model-name')), 'DeepSeek-V4-Pro-0813');
  check('switch repaints the prices', JSON.stringify(priced(next)), JSON.stringify(['4.50', '0.15', '13.50']));
  check('switch keeps the idle tier', text(byClass(next, 'dbc-tier')), '¥/百万 · 空闲价');

  // An alias resolves to the row it bills as.
  live.select('session-1', { provider: 'deepseek-account', model: 'deepseek-v4-flash' });
  next = await pump();
  check('alias repaints the prices', JSON.stringify(priced(next)), JSON.stringify(['1.00', '0.02', '4.00']));
  check('alias shows the selected id', text(byClass(next, 'dbc-model-name')), 'deepseek-v4-flash');

  // Each session carries its own selection.
  live.select('session-2', { provider: 'deepseek-account', model: 'deepseek-v4-pro' });
  live.activate('session-2');
  next = await pump();
  check('session switch follows its own selection', text(byClass(next, 'dbc-model-name')), 'DeepSeek-V4-Pro-0813');
  check('session switch prices', JSON.stringify(priced(next)), JSON.stringify(['4.50', '0.15', '13.50']));

  // A model outside the snapshot says so instead of showing stale prices.
  live.select('session-2', { provider: 'deepseek-account', model: 'gpt-x' });
  next = await pump();
  check('unpriced model note', text(byClass(next, 'dbc-note')), '官方价目未收录该模型');
}

console.log('prices need a DeepSeek provider');
{
  // The list is DeepSeek's own, so a DeepSeek model served by someone else is
  // billed by that provider and the card quotes nothing.
  const routed = {
    ok: true,
    value: { default: { provider: 'some-router', model: 'deepseek-v4-pro' }, groups: [] },
  };
  const { tree } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: routed });
  check('a foreign provider shows no price', priced(tree).length, 0);
  check('a foreign provider explains itself', text(byClass(tree, 'dbc-note')), '该渠道不走官方价目');

  const own = {
    ok: true,
    value: { default: { provider: 'deepseek-account', model: 'deepseek-v4-pro' }, groups: [] },
  };
  const { tree: kept } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: own });
  check('a DeepSeek provider still prices', JSON.stringify(priced(kept)), JSON.stringify(['4.50', '0.15', '13.50']));

  // Without a provider the card keeps the old behaviour: price what it knows.
  const unknown = { ok: true, value: { default: { model: 'deepseek-v4-pro' }, groups: [] } };
  const { tree: bare } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: unknown });
  check('an unknown provider still prices', priced(bare).length, 3);

  const { tree: english } = await mountLocalized('en', { now: IDLE_NOW, balance: READY_BALANCE, catalog: routed });
  check('the explanation is translated', text(byClass(english, 'dbc-note')), 'This provider has no list price');
}

console.log('selection services appear late');
{
  const live = liveServices({ 'session-1': { provider: 'deepseek-account', model: 'deepseek-v4-pro' } });
  const services = {};
  let timers = [];
  const { tree, pump } = await mount({
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG_TWO,
    services,
    onTimer: (list) => { timers = list; },
  });
  check('starts on the catalog default', text(byClass(tree, 'dbc-model-name')), 'DeepSeek-Flash');
  check('one-second retry while the services are absent', JSON.stringify(timers.map((t) => t.delay).sort((a, b) => a - b)), JSON.stringify([1000, 1000, 30000]));

  services.uiSession = live.services.uiSession;
  services.modelDirectories = live.services.modelDirectories;
  for (const timer of timers.filter((t) => t.delay === 1000)) timer.callback();
  const next = await pump();
  check('late services attach', text(byClass(next, 'dbc-model-name')), 'DeepSeek-V4-Pro-0813');
  check('late services price the selection', JSON.stringify(priced(next)), JSON.stringify(['4.50', '0.15', '13.50']));
}

// -------------------------------------------------------- startup refresh
const fixture = (name) => fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const hostPayload = {
  status: 'ready',
  at: '2026-10-26T02:00:00.000Z',
  sources: { 'pricing.CNY': 'ready', 'pricing.USD': 'ready', calendar: 'ready' },
  prices: {
    CNY: parsePricingHtml(fixture('zh-pricing.html'), '2026-10-26', 'CNY'),
    USD: parsePricingHtml(fixture('en-pricing.html'), '2026-10-26', 'USD'),
  },
  holidays: parseHolidayCalendar(fixture('cn_zh.ics')),
};
const PEAK_NOW = Date.parse('2026-10-26T02:30:00Z');
const dayOf = (year, month, day) => Date.UTC(year, month - 1, day) / 86400000;
const cnyTable = (idleInput = 0.99) => ({
  asOf: '2026-10-26',
  currency: 'CNY',
  models: {
    'deepseek-flash': {
      label: 'DeepSeek-V4.1-Flash-1017',
      peak: { input: 2, cacheRead: 0.04, output: 8 },
      idle: { input: idleInput, cacheRead: 0.02, output: 4 },
    },
  },
});
const usdTable = (idleInput = 0.15) => ({
  asOf: '2026-10-26',
  currency: 'USD',
  models: {
    'deepseek-flash': {
      label: 'DeepSeek-V4.1-Flash-1017',
      peak: { input: 0.3, cacheRead: 0.006, output: 1.2 },
      idle: { input: idleInput, cacheRead: 0.003, output: 0.6 },
    },
  },
});
const apiBalance = (total = '110.00') => ({
  status: 'ready',
  currency: 'CNY',
  total,
  granted: '10.00',
  toppedUp: '100.00',
});
const livePayload = ({ prices = { CNY: cnyTable(), USD: usdTable() }, holidays = null, deepseek = null } = {}) => ({
  status: 'ready',
  prices,
  holidays,
  deepseek,
  sources: { 'pricing.CNY': 'ready', 'pricing.USD': 'ready', calendar: 'ready', deepseek: 'ready' },
});
const chipOf = (tree, kind) =>
  findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className.split(' ').includes('dbc-chip-' + kind))[0] ?? null;

console.log('startup refresh');
{
  const { tree } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data: livePayload() });
  check('host prices replace the snapshot', JSON.stringify(priced(tree)), JSON.stringify(['0.99', '0.02', '4.00']));
  check('unit tooltip marks the startup sync', byClass(tree, 'dbc-tier').props.title.includes('启动时校准'), true);
  check('unit tooltip keeps the price date', byClass(tree, 'dbc-tier').props.title.includes('2026-10-26'), true);
}

{
  const { tree } = await mount({
    now: PEAK_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload({ holidays: { days: [dayOf(2026, 10, 26)], years: [2026] } }),
  });
  check('calendar holiday turns the peak idle', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-idle');
  check('chip tooltip names the calendar', byClass(tree, 'dbc-chip').props.title.includes('iCloud'), true);
}

{
  const { tree, delays } = await mount({ now: PEAK_NOW, balance: READY_BALANCE, catalog: CATALOG, data: null });
  check('a missing route is asked a few times', delays.filter((delay) => delay === 3000).length, 2);
  check('no route keeps the snapshot prices', JSON.stringify(priced(tree)), JSON.stringify(['2.00', '0.04', '8.00']));
  check('no route keeps the built-in period', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-peak');
  check('unit tooltip marks the snapshot', byClass(tree, 'dbc-tier').props.title.includes('内置快照'), true);
  check('chip tooltip marks the built-in table', byClass(tree, 'dbc-chip').props.title.includes('节假日依据内置表'), true);
}

{
  const { tree } = await mount({
    now: PEAK_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: { status: 'ready', prices: { models: { 'deepseek-flash': { peak: {}, idle: {} } } }, holidays: { days: ['2026-10-26'] } },
  });
  check('malformed payload falls back to the snapshot', JSON.stringify(priced(tree)), JSON.stringify(['2.00', '0.04', '8.00']));
  check('malformed payload keeps the built-in period', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-peak');
}

{
  const { tree, delays } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data: { status: 'loading', prices: null, holidays: null } });
  check('loading keeps the snapshot prices', JSON.stringify(priced(tree)), JSON.stringify(['1.00', '0.02', '4.00']));
  check('loading asks the route again', delays.includes(3000), true);
}

{
  const aliasCatalog = { ok: true, value: { default: { provider: 'deepseek-account', model: 'deepseek-v4-flash' }, groups: [] } };
  const { tree } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: aliasCatalog, data: livePayload({ prices: { CNY: cnyTable(0.5), USD: usdTable() } }) });
  check('alias resolves against the host table', JSON.stringify(priced(tree)), JSON.stringify(['0.50', '0.02', '4.00']));
}

{
  const hiddenCatalog = { ok: true, value: { default: { provider: 'deepseek-account', model: 'deepseek-v4-pro' }, groups: [] } };
  const { tree } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: hiddenCatalog, data: livePayload() });
  const notes = findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className === 'dbc-note').map(text);
  check('a model the host table dropped is unpriced', notes.includes('官方价目未收录该模型'), true);
}

console.log('holiday banner');
{
  // 2026-10-01 is a statutory holiday: a light blue strip across the card top.
  const holidayDay = dayOf(2026, 10, 1);
  const { tree } = await mount({
    now: Date.parse('2026-10-01T02:30:00Z'),
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload({ holidays: { days: [holidayDay], names: { [holidayDay]: '国庆节' }, makeup: [], makeupNames: {} } }),
  });
  const banner = byClass(tree, 'dbc-holiday');
  check('banner renders', banner !== null, true);
  check('banner text', text(banner), '国庆节假期中');
  check('banner class', banner.props.className, 'dbc-holiday');
  check(
    'banner tooltip names the day and the source',
    banner.props.title,
    '法定节假日（休） · 国庆节 · 节假日依据 iCloud 中国大陆节假日日历，启动时更新',
  );
  check('banner leads the card', byClass(tree, 'dbc-card').children[0].props.className, 'dbc-holiday');
  check('banner draws an icon', byClass(tree, 'dbc-holiday-icon') !== null, true);
  check('the holiday left the chip row', JSON.stringify(byClass(tree, 'dbc-chips').children.map((n) => n.props.className)), JSON.stringify(['dbc-chip dbc-chip-idle']));
  check('no make-up chip on a holiday', chipOf(tree, 'makeup'), null);
}

{
  // 2026-10-10 is a make-up workday: gray chip, still billed as off-peak.
  const makeupDay = dayOf(2026, 10, 10);
  const { tree } = await mount({
    now: Date.parse('2026-10-10T02:30:00Z'),
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload({ holidays: { days: [], names: {}, makeup: [makeupDay], makeupNames: { [makeupDay]: '国庆节' } } }),
  });
  const badge = chipOf(tree, 'makeup');
  check('make-up chip renders', badge !== null, true);
  check('make-up chip label', text(badge), '调休');
  check('make-up chip class', badge.props.className, 'dbc-chip dbc-chip-makeup');
  check(
    'make-up tooltip explains the billing',
    badge.props.title,
    '调休工作日（班） · 国庆节 · 仍按空闲时段计费 · 节假日依据 iCloud 中国大陆节假日日历，启动时更新',
  );
  check('a make-up day stays idle', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-idle');
  check('no banner on a make-up day', byClass(tree, 'dbc-holiday'), null);
}

{
  // An ordinary Monday: both chips stay away.
  const { tree } = await mount({ now: PEAK_NOW, balance: READY_BALANCE, catalog: CATALOG, data: null });
  check('no banner on an ordinary day', byClass(tree, 'dbc-holiday'), null);
  check('no make-up chip on an ordinary day', chipOf(tree, 'makeup'), null);
  check('an ordinary day keeps one chip', JSON.stringify(byClass(tree, 'dbc-chips').children.map((n) => n.props.className)), JSON.stringify(['dbc-chip dbc-chip-peak']));
}

{
  // The banner turns over at Beijing midnight, not at the local midnight.
  const before = await mount({ now: Date.parse('2025-09-30T15:59:59Z'), balance: READY_BALANCE, catalog: CATALOG, data: null });
  check('no banner a second before the holiday', byClass(before.tree, 'dbc-holiday'), null);
  const after = await mount({ now: Date.parse('2025-09-30T16:00:00Z'), balance: READY_BALANCE, catalog: CATALOG, data: null });
  check('the banner appears at Beijing midnight', text(byClass(after.tree, 'dbc-holiday')), '国庆节假期中');
  check('and the holiday is already idle', byClass(after.tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-idle');
}

{
  // The built-in table carries names too, so the chip survives a missing route.
  const { tree } = await mount({ now: Date.parse('2025-10-01T02:30:00Z'), balance: READY_BALANCE, catalog: CATALOG, data: null });
  const banner = byClass(tree, 'dbc-holiday');
  check('built-in holiday banner', text(banner), '国庆节假期中');
  check('built-in holiday tooltip', banner.props.title, '法定节假日（休） · 国庆节 · 节假日依据内置表');
}

{
  // Mid-Autumn falls inside National Day in 2025: one day, two names.
  const { tree } = await mount({ now: Date.parse('2025-10-06T02:30:00Z'), balance: READY_BALANCE, catalog: CATALOG, data: null });
  check('overlapping holidays join with an ampersand', text(byClass(tree, 'dbc-holiday')), '国庆节 & 中秋节假期中');
}

{
  // The built-in make-up table labels its own gray chip.
  const { tree } = await mount({ now: Date.parse('2026-10-10T02:30:00Z'), balance: READY_BALANCE, catalog: CATALOG, data: null });
  check('built-in make-up chip', text(chipOf(tree, 'makeup')), '调休');
  check('built-in make-up tooltip', chipOf(tree, 'makeup').props.title.includes('节假日依据内置表'), true);
}

{
  // The calendar names days in Chinese, so the English card shows neither chip.
  const holidayDay = dayOf(2026, 10, 1);
  const { tree } = await mountLocalized('en', {
    now: Date.parse('2026-10-01T02:30:00Z'),
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload({ holidays: { days: [holidayDay], names: { [holidayDay]: '国庆节' }, makeup: [], makeupNames: {} } }),
  });
  check('en card hides the holiday banner', byClass(tree, 'dbc-holiday'), null);
  check('en card still reads the calendar', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-idle');
}

console.log('currency default');
{
  // Chinese locales read the CNY page; every other language reads the USD one.
  const cny = await mountLocalized('zh-CN', { now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG });
  check('a zh-CN card quotes CNY', JSON.stringify(priced(cny.tree)), JSON.stringify(['1.00', '0.02', '4.00']));
  check('a zh-CN card keeps the bare symbol', text(byClass(cny.tree, 'dbc-balance')), '¥32.50');
  check('a zh-CN card labels the unit', text(byClass(cny.tree, 'dbc-tier')), '¥/百万 · 空闲价');

  for (const language of ['en', 'ja']) {
    const other = await mountLocalized(language, { now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG });
    check(language + ' quotes USD', JSON.stringify(priced(other.tree)), JSON.stringify(['0.15', '0.003', '0.60']));
    check(language + ' spells the balance currency', text(byClass(other.tree, 'dbc-balance')), 'CNY ¥32.50');
  }

  const japanese = await mountLocalized('ja', { now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG });
  check('a non-chinese tooltip names USD', byClass(japanese.tree, 'dbc-tier').props.title.includes('USD per 1M tokens'), true);
}

{
  // zh-CN is a Chinese card: CNY prices, and the Chinese calendar labels too.
  const holidayDay = dayOf(2026, 10, 1);
  const data = livePayload({ holidays: { days: [holidayDay], names: { [holidayDay]: '国庆节' }, makeup: [], makeupNames: {} } });
  const cny = await mountLocalized('zh-CN', { now: Date.parse('2026-10-01T02:30:00Z'), balance: READY_BALANCE, catalog: CATALOG, data });
  check('a zh-CN card shows the banner', text(byClass(cny.tree, 'dbc-holiday')), '国庆节假期中');
  check('a zh-CN banner keeps the chinese tooltip', byClass(cny.tree, 'dbc-holiday').props.title.startsWith('法定节假日（休）'), true);

  const makeupDay = dayOf(2026, 10, 10);
  const makeupData = livePayload({ holidays: { days: [], names: {}, makeup: [makeupDay], makeupNames: { [makeupDay]: '国庆节' } } });
  const zhMakeup = await mountLocalized('zh-CN', { now: Date.parse('2026-10-10T02:30:00Z'), balance: READY_BALANCE, catalog: CATALOG, data: makeupData });
  check('a zh-CN card shows the make-up chip', text(chipOf(zhMakeup.tree, 'makeup')), '调休');

  const en = await mountLocalized('en', { now: Date.parse('2026-10-10T02:30:00Z'), balance: READY_BALANCE, catalog: CATALOG, data: makeupData });
  check('an english card hides the make-up chip', chipOf(en.tree, 'makeup'), null);
}

{
  // A sub-cent balance has no amount to show, only its unit.
  const tiny = wallets([{ currency: 'CNY', balance: '0.004' }], []);
  const zh = await mount({ now: IDLE_NOW, balance: tiny, catalog: CATALOG });
  check('zh sub-cent balance', text(byClass(zh.tree, 'dbc-note')), '¥不足 0.01');
  const en = await mountLocalized('en', { now: IDLE_NOW, balance: tiny, catalog: CATALOG });
  check('en sub-cent balance spells the code', text(byClass(en.tree, 'dbc-note')), 'CNY under 0.01');
}

console.log('balance follows the provider');
{
  const live = liveServices();
  const data = livePayload({ deepseek: apiBalance() });
  const { tree, pump } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, services: live.services, data });

  // The account balance is the default, and the API balance only rides along in
  // the tooltip while an account model is selected.
  check('the account balance leads by default', text(byClass(tree, 'dbc-balance')), '¥32.50');
  check('the default title names the account', text(byClass(tree, 'dbc-title')), 'DeepSeek 余额');
  check(
    'the tooltip carries the API balance too',
    byClass(tree, 'dbc-balance').props.title.includes('DeepSeek API: CNY ¥110.00 (10.00 + 100.00)'),
    true,
  );

  // Selecting the API-key provider moves the headline to the open-platform balance.
  live.select('session-1', { provider: 'deepseek-official', model: 'deepseek-chat' });
  let next = await pump();
  check('the API provider switches the amount', text(byClass(next, 'dbc-balance')), '¥110.00');
  check('and the title follows', text(byClass(next, 'dbc-title')), 'DeepSeek API 余额');
  check(
    'and the hint says how it refreshes',
    byClass(next, 'dbc-balance').props.title.split(String.fromCharCode(10))[0],
    'DeepSeek 开放平台余额（API Key），每分钟刷新',
  );

  // Switching back is the same, in the other direction.
  live.select('session-1', { provider: 'deepseek-account', model: 'DeepSeek-Flash' });
  next = await pump();
  check('switching back restores the account balance', text(byClass(next, 'dbc-balance')), '¥32.50');
  check('and the account title', text(byClass(next, 'dbc-title')), 'DeepSeek 余额');
}

{
  // No key configured: the card keeps the account balance, and says why.
  const live = liveServices({ 'session-1': { provider: 'deepseek-official', model: 'deepseek-chat' } });
  const data = livePayload({ deepseek: { status: 'unavailable' } });
  const { tree } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, services: live.services, data });
  check('an unavailable API balance falls back', text(byClass(tree, 'dbc-balance')), '¥32.50');
  check('and the title stays the account one', text(byClass(tree, 'dbc-title')), 'DeepSeek 余额');
  check('the tooltip explains the missing key', byClass(tree, 'dbc-balance').props.title.includes('未配置 API Key'), true);
}

{
  // Outside a Chinese card the API amount carries its ISO code, like every other
  // balance on the card.
  const live = liveServices({ 'session-1': { provider: 'deepseek-official', model: 'deepseek-chat' } });
  const data = livePayload({ deepseek: apiBalance('110.00') });
  const { tree } = await mountLocalized('en', {
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    services: live.services,
    data,
  });
  check('english spells the API currency code', text(byClass(tree, 'dbc-balance')), 'CNY ¥110.00');
  check('english title', text(byClass(tree, 'dbc-title')), 'DeepSeek API balance');
}

console.log('currency per language');
{
  const { tree } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data: livePayload({ prices: { CNY: cnyTable(0.5), USD: usdTable(0.11) } }) });
  check('zh takes the CNY table', JSON.stringify(priced(tree)), JSON.stringify(['0.50', '0.02', '4.00']));
}
{
  const { tree } = await mountLocalized('en', {
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload({ prices: { CNY: cnyTable(0.5), USD: usdTable(0.11) } }),
  });
  check('en takes the USD table', JSON.stringify(priced(tree)), JSON.stringify(['0.11', '0.003', '0.60']));
  check('en tooltip marks the startup sync', byClass(tree, 'dbc-tier').props.title.includes('synced at startup'), true);
}
{
  const { tree } = await mountLocalized('en', {
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload({ prices: { CNY: cnyTable(0.5), USD: null } }),
  });
  check('a missing USD table keeps the built-in USD prices', JSON.stringify(priced(tree)), JSON.stringify(['0.15', '0.003', '0.60']));
  check('and the tooltip says built in', byClass(tree, 'dbc-tier').props.title.includes('built-in snapshot'), true);
}
{
  const { tree } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data: livePayload({ prices: { CNY: null, USD: usdTable() } }) });
  check('a missing CNY table keeps the built-in CNY prices', JSON.stringify(priced(tree)), JSON.stringify(['1.00', '0.02', '4.00']));
  check('and the zh tooltip says built in', byClass(tree, 'dbc-tier').props.title.includes('内置快照'), true);
}
{
  // USD prices need a third decimal; CNY keeps two.
  const { tree } = await mountLocalized('en', {
    now: Date.parse('2026-10-26T01:30:00Z'),
    balance: READY_BALANCE,
    catalog: CATALOG,
  });
  check('peak USD prices', JSON.stringify(priced(tree)), JSON.stringify(['0.30', '0.006', '1.20']));
  check('peak USD label', text(byClass(tree, 'dbc-tier')), '$/M · Peak price');
}

if (hostPayload !== null) {
  console.log('host payload from the real sources');
  {
    // 2024-01-01 is a Monday holiday in the calendar but outside the built-in
    // table (2025-2026), so the period proves which holiday set is in use.
    const { tree } = await mount({
      now: Date.parse('2024-01-01T02:30:00Z'),
      balance: READY_BALANCE,
      catalog: CATALOG,
      data: hostPayload,
    });
    check('real payload prices the model', JSON.stringify(priced(tree)), JSON.stringify(['1.00', '0.02', '4.00']));
    check('real payload date in the tooltip', byClass(tree, 'dbc-tier').props.title.includes(hostPayload.prices.CNY.asOf), true);
    check('real payload counts as a startup sync', byClass(tree, 'dbc-tier').props.title.includes('启动时校准'), true);
    check('real calendar makes a 2024 holiday idle', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-idle');
    check('real calendar names the 2024 holiday', text(byClass(tree, 'dbc-holiday')), '元旦假期中');
  }
  {
    const { tree } = await mountLocalized('en', {
      now: Date.parse('2024-01-01T02:30:00Z'),
      balance: READY_BALANCE,
      catalog: CATALOG,
      data: hostPayload,
    });
    check('real payload quotes USD in english', JSON.stringify(priced(tree)), JSON.stringify(['0.15', '0.003', '0.60']));
    check('real payload hides the chinese banner in english', byClass(tree, 'dbc-holiday'), null);
  }
  {
    const { tree } = await mount({
      now: Date.parse('2024-01-01T02:30:00Z'),
      balance: READY_BALANCE,
      catalog: CATALOG,
      data: null,
    });
    check('the built-in table does not cover 2024', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-peak');
  }
} else {
  console.log('SKIP host payload cases (run /tmp/host-test.mjs first)');
}

console.log('make-up weekend');
{
  // The rule bills a （班） day by its weekday, and every 2026 make-up day is a
  // weekend day, so it stays idle; the gray chip is what explains the state.
  const { tree } = await mount({ now: Date.parse('2026-10-10T02:00:00Z'), balance: READY_BALANCE, catalog: CATALOG, data: null });
  check('a make-up Saturday is idle', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-idle');
  check('a make-up Saturday draws the 调休 chip', text(chipOf(tree, 'makeup')), '调休');
  check('a make-up Saturday has no holiday banner', byClass(tree, 'dbc-holiday'), null);
}

console.log('malformed payloads');
const SNAPSHOT_ZH_PEAK = JSON.stringify(['2.00', '0.04', '8.00']);
const MALFORMED = [
  [
    'a partial tier',
    {
      status: 'ready',
      prices: {
        CNY: {
          asOf: '2026-10-26',
          models: {
            'deepseek-flash': { label: 'x', peak: { input: 2, cacheRead: 0.04, output: 8 }, idle: { input: 1, cacheRead: 0.02 } },
          },
        },
        USD: null,
      },
      holidays: null,
    },
  ],
  [
    'string amounts',
    {
      status: 'ready',
      prices: {
        CNY: {
          models: {
            'deepseek-flash': {
              peak: { input: '2', cacheRead: 0.04, output: 8 },
              idle: { input: '1', cacheRead: '0.02', output: '4' },
            },
          },
        },
        USD: null,
      },
      holidays: null,
    },
  ],
  [
    'a negative amount',
    {
      status: 'ready',
      prices: {
        CNY: {
          models: {
            'deepseek-flash': {
              peak: { input: 2, cacheRead: 0.04, output: 8 },
              idle: { input: -1, cacheRead: 0.02, output: 4 },
            },
          },
        },
        USD: null,
      },
      holidays: null,
    },
  ],
  [
    'out-of-range days',
    { status: 'ready', prices: { CNY: null, USD: null }, holidays: { days: [0, -3, 60000, 999999], names: {}, makeup: [] } },
  ],
  [
    'non-numeric days',
    {
      status: 'ready',
      prices: { CNY: null, USD: null },
      holidays: { days: ['2026-10-26', null, 1.5, {}, true], names: {}, makeup: [] },
    },
  ],
  [
    'non-numeric name keys',
    {
      status: 'ready',
      prices: { CNY: null, USD: null },
      holidays: { days: [dayOf(2026, 10, 26)], names: { abc: '国庆节', '12x': '零', 7: '数字' }, makeup: [] },
    },
    JSON.stringify(['1.00', '0.02', '4.00']),
  ],
  [
    'a make-up day overlapping a holiday',
    {
      status: 'ready',
      prices: { CNY: null, USD: null },
      holidays: {
        days: [dayOf(2026, 10, 26)],
        names: { [dayOf(2026, 10, 26)]: '国庆节' },
        makeup: [dayOf(2026, 10, 26)],
        makeupNames: { [dayOf(2026, 10, 26)]: '国庆节' },
      },
    },
    JSON.stringify(['1.00', '0.02', '4.00']),
  ],
  [
    'holidays without names',
    { status: 'ready', prices: { CNY: null, USD: null }, holidays: { days: [dayOf(2026, 10, 26)], makeup: [] } },
    JSON.stringify(['1.00', '0.02', '4.00']),
  ],
  [
    'an old-Host payload',
    {
      status: 'ready',
      prices: {
        asOf: '2026-10-26',
        models: {
          'deepseek-flash': { peak: { input: 2, cacheRead: 0.04, output: 8 }, idle: { input: 0.5, cacheRead: 0.02, output: 4 } },
        },
      },
      holidays: null,
    },
  ],
];
for (const [label, data, expectedPrices = SNAPSHOT_ZH_PEAK] of MALFORMED) {
  const { tree } = await mount({ now: PEAK_NOW, balance: READY_BALANCE, catalog: CATALOG, data });
  check(label + ': the card still renders', byClass(tree, 'dbc-card') !== null, true);
  check(label + ': it keeps the snapshot prices', JSON.stringify(priced(tree)), expectedPrices);
  check(label + ': the tooltip marks the snapshot', byClass(tree, 'dbc-tier').props.title.includes('内置快照'), true);
  check(label + ': the chip still renders', byClass(tree, 'dbc-chip').props.className.startsWith('dbc-chip dbc-chip-'), true);
}

{
  // A name that is not keyed by a day number cannot label a day, so the day
  // keeps its idle billing but loses its banner.
  const { tree } = await mount({
    now: PEAK_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: {
      status: 'ready',
      prices: { CNY: null, USD: null },
      holidays: { days: [dayOf(2026, 10, 26)], names: { abc: '国庆节', '12x': '零' }, makeup: [] },
    },
  });
  check('a non-numeric name key is dropped', byClass(tree, 'dbc-holiday'), null);
  check('its day still bills as a holiday', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-idle');
}

{
  const { tree } = await mount({
    now: PEAK_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: { status: 'ready', prices: { CNY: null, USD: null }, holidays: { days: [dayOf(2026, 10, 26)], makeup: [] } },
  });
  check('a nameless holiday keeps its day', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-idle');
  check('a nameless holiday has no banner', byClass(tree, 'dbc-holiday'), null);
}

{
  // A hand-edited payload can name one day in both books. The off day wins, so
  // the banner appears and the gray chip stays away.
  const day = dayOf(2026, 10, 26);
  const { tree } = await mount({
    now: PEAK_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: {
      status: 'ready',
      prices: { CNY: null, USD: null },
      holidays: { days: [day], names: { [day]: '国庆节' }, makeup: [day], makeupNames: { [day]: '国庆节' } },
    },
  });
  check('an overlapping （休） day is still idle', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-idle');
  check('an overlapping day keeps its banner', text(byClass(tree, 'dbc-holiday')), '国庆节假期中');
  check('an overlapping day shows no 调休 chip', chipOf(tree, 'makeup'), null);
}

console.log('route failures');
{
  const { tree, delays } = await mount({
    now: PEAK_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload(),
    route: 'http-404',
  });
  check('a 404 route keeps the snapshot prices', JSON.stringify(priced(tree)), SNAPSHOT_ZH_PEAK);
  check('a 404 route marks the snapshot in the tooltip', byClass(tree, 'dbc-tier').props.title.includes('内置快照'), true);
  check('a 404 route retries twice more', delays.filter((delay) => delay === 3000).length, 2);
  check('a 404 route still renders the card', byClass(tree, 'dbc-card') !== null, true);
}
{
  const { tree, delays } = await mount({
    now: PEAK_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload(),
    route: 'absent',
  });
  check('an absent fetch keeps the snapshot prices', JSON.stringify(priced(tree)), SNAPSHOT_ZH_PEAK);
  check('an absent fetch marks the snapshot in the tooltip', byClass(tree, 'dbc-tier').props.title.includes('内置快照'), true);
  check('an absent fetch never polls the route', delays.filter((delay) => delay === 3000).length, 0);
  check('an absent fetch still renders the card', byClass(tree, 'dbc-card') !== null, true);
}

console.log('live CNY without a USD table');
{
  const data = livePayload({ prices: { CNY: cnyTable(0.5), USD: null } });
  const zh = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data });
  check('zh keeps the live CNY table', JSON.stringify(priced(zh.tree)), JSON.stringify(['0.50', '0.02', '4.00']));
  check('zh marks it as a startup sync', byClass(zh.tree, 'dbc-tier').props.title.includes('启动时校准'), true);
  const en = await mountLocalized('en', { now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data });
  check('en falls back to the built-in USD table', JSON.stringify(priced(en.tree)), JSON.stringify(['0.15', '0.003', '0.60']));
  check('en marks the built-in snapshot', byClass(en.tree, 'dbc-tier').props.title.includes('built-in snapshot'), true);
}

console.log('locale currency matrix');
{
  const data = livePayload({ prices: { CNY: cnyTable(0.5), USD: usdTable(0.11) } });
  for (const language of ['zh', 'zh-CN', 'zh-TW']) {
    const { tree } = await mountLocalized(language, { now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data });
    check(language + ' reads the CNY table', JSON.stringify(priced(tree)), JSON.stringify(['0.50', '0.02', '4.00']));
    check(language + ' keeps the bare ¥ balance', text(byClass(tree, 'dbc-balance')), '¥32.50');
  }
  for (const language of ['en', 'ja', 'xx']) {
    const { tree } = await mountLocalized(language, { now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data });
    check(language + ' reads the USD table', JSON.stringify(priced(tree)), JSON.stringify(['0.11', '0.003', '0.60']));
    check(language + ' keeps the third decimal', priced(tree)[1], '0.003');
    check(language + ' prefixes the ISO code', text(byClass(tree, 'dbc-balance')), 'CNY ¥32.50');
    check(language + ' names USD in the tooltip', byClass(tree, 'dbc-tier').props.title.includes('USD per 1M tokens'), true);
  }
}

console.log('timezone independence');
{
  // The billing rule is Beijing time, so the machine's zone must not move a
  // single boundary: every row below is a Beijing-local minute.
  const rows = [
    ['mon-0900', Date.parse('2026-10-26T01:00:00Z'), 'dbc-chip dbc-chip-peak', '距空闲 03:00:00'],
    ['mon-1159', Date.parse('2026-10-26T03:59:59Z'), 'dbc-chip dbc-chip-peak', '距空闲 00:00:01'],
    ['mon-1200', Date.parse('2026-10-26T04:00:00Z'), 'dbc-chip dbc-chip-idle', '距高峰 02:00:00'],
    ['mon-1359', Date.parse('2026-10-26T05:59:59Z'), 'dbc-chip dbc-chip-idle', '距高峰 00:00:01'],
    ['mon-1400', Date.parse('2026-10-26T06:00:00Z'), 'dbc-chip dbc-chip-peak', '距空闲 04:00:00'],
    ['mon-1759', Date.parse('2026-10-26T09:59:59Z'), 'dbc-chip dbc-chip-peak', '距空闲 00:00:01'],
    ['fri-1800', Date.parse('2026-10-30T10:00:00Z'), 'dbc-chip dbc-chip-idle', '距高峰 2天 15:00:00'],
    ['holiday', Date.parse('2026-10-01T02:00:00Z'), 'dbc-chip dbc-chip-idle', '距高峰 6天 23:00:00'],
  ];
  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const newYorkHour = new Date(rows[0][1]).getHours();
    process.env.TZ = 'Pacific/Kiritimati';
    const kiritimatiHour = new Date(rows[0][1]).getHours();
    check('the two zones read the same instant differently', newYorkHour !== kiritimatiHour, true);
    for (const zone of ['America/New_York', 'Pacific/Kiritimati']) {
      process.env.TZ = zone;
      for (const [label, now, chipClass, countdown] of rows) {
        const { tree } = await mount({ now, balance: READY_BALANCE, catalog: CATALOG, data: null });
        check(zone + ' ' + label + ' keeps the chip', byClass(tree, 'dbc-chip').props.className, chipClass);
        check(zone + ' ' + label + ' keeps the countdown', text(byClass(tree, 'dbc-countdown')), countdown);
      }
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

console.log(failures === 0 ? '\nclient: ALL CHECKS PASSED' : '\nclient: ' + failures + ' CHECK(S) FAILED');
process.exitCode = failures === 0 ? 0 : 1;
