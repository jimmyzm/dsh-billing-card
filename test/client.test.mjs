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

// There is one load: the card draws its own hover bubble, so the harness has no
// platform primitive to supply and no second module instance to mount.

// ---------------------------------------------------------------- fake context
function makeContext({ balance = undefined, catalog = undefined, services = {}, activeLocale = 'zh' } = {}) {
  const registered = { slot: null, component: null, options: null, dictionaries: null, timers: [], events: [] };
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
      // The provider surface publishes through these; the card subscribes to them.
      $on(event, listener) {
        registered.events.push({ event, listener });
        return () => {
          const at = registered.events.findIndex((entry) => entry.listener === listener);
          if (at >= 0) registered.events.splice(at, 1);
        };
      },
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
async function mount({ now, balance, catalog, services = liveServices().services, props = {}, data = null, onApply, onTimer, locale = 'zh', route = 'json', api = installed }) {
  // The card asks the Host route on mount; `data` is its answer (or a failure).
  // `route` names the transport state instead: an absent `fetch` global, or a
  // route that answers 404.
  const realFetch = globalThis.fetch;
  const realSetTimeout = globalThis.setTimeout;
  const delays = [];
  /** Every URL the card asked the Host for, in order. */
  const requests = [];
  globalThis.fetch =
    route === 'absent'
      ? undefined
      : async (url) => {
          requests.push(String(url));
          if (route === 'http-404') return { ok: false, status: 404, json: async () => null };
          if (data === null) throw new Error('no route');
          return { ok: true, json: async () => (typeof data === 'function' ? data() : data) };
        };
  globalThis.setTimeout = (fn, delay, ...rest) => {
    delays.push(delay);
    // Run the Host-poll cadence immediately so a loading answer cannot stall the run.
    return realSetTimeout(fn, delay === 3000 ? 0 : delay, ...rest);
  };
  const { ctx, registered } = makeContext({ balance, catalog, services, activeLocale: locale });
  api.apply(ctx);
  if (typeof onApply === 'function') onApply(registered.dictionaries);
  if (typeof onTimer === 'function') onTimer(registered.timers);

  {
    const mountCtx = { cursor: 0, state: {}, refs: {}, effects: {}, pending: [], dirty: false };
    const injected = registered.options.inject();
    const allProps = { ...injected, wide: true, t: (key) => (registered.dictionaries?.zh?.[key] ?? key), ...props };

    // One React-like render pass, including the effects queued by it.
    let latest = null;
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
      latest = tree;
      return tree;
    };
    const tree = await pump();
    globalThis.setTimeout = realSetTimeout;
    // `fetch` stays stubbed: a card that keeps re-reading its route (the 30 s
    // tick) would otherwise hit the real global once the mount returned.
    const dispose = () => {
      globalThis.fetch = realFetch;
    };
    // The hover helpers below read the trigger from the newest tree: hook state
    // survives a pump, so a bubble opened after a repaint must come from that
    // repaint's handlers, not the first render's.
    return {
      get tree() {
        return latest;
      },
      registered,
      props: allProps,
      pump,
      delays,
      requests,
      dispose,
    };
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
  // Mutating keeps `tree` a live getter, so a bubble opened after a repaint
  // still finds that repaint's trigger.
  handle.dictionaries = state.dictionaries;
  return handle;
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
// ------------------------------------------------------------- hover bubble
/** A stable rect for the trigger: the bubble only needs a box to measure from. */
const TRIGGER_BOX = { left: 40, right: 120, top: 300, bottom: 316 };
/**
 * Opens the bubble the card now draws itself and returns the tree it rendered
 * into plus the `span.dbc-tip` node. `handle.tree` is the newest render, so the
 * trigger carries the spec of the current state; the dwell timer is collapsed
 * here because only the "hover bubble" block asserts the real delay.
 */
const openTip = async (handle, className) => {
  const trigger = byClass(handle.tree, className);
  if (trigger === null || trigger === undefined) return { tree: handle.tree, bubble: null };
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, _delay, ...rest) => realSetTimeout(fn, 0, ...rest);
  try {
    trigger.props.onMouseEnter({
      currentTarget: { getBoundingClientRect: () => ({ ...TRIGGER_BOX }) },
    });
    const tree = await handle.pump();
    return { tree, bubble: byClass(tree, 'dbc-tip') };
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
};
/** The hover text of the trigger with `className`: one `label | value` line per
 * row, then the note. */
const tipOf = async (handle, className) => {
  const { bubble } = await openTip(handle, className);
  if (bubble === null) return undefined;
  const lines = tipRows(bubble).map(
    (row) => text(byClass(row, 'dbc-tip-label')) + ' | ' + text(byClass(row, 'dbc-tip-amount')),
  );
  const note = byClass(bubble, 'dbc-tip-note');
  if (note !== null) lines.push(text(note));
  return lines.join(' | ');
};

// ------------------------------------------------------- bubble body queries
/** The `.dbc-tip-row` elements of a bubble, in order. */
function tipRows(bubble) {
  return findAll(bubble, (node) => node.props.className === 'dbc-tip-row');
}
/** The class list of a row's dot, or null when the row carries none. */
function tipDotClass(row) {
  const dot = byClass(row, 'dbc-tip-dot');
  return dot === null ? null : dot.props.className;
}
/** Every `.dbc-tip-dot` in a bubble, whatever its tone. */
function tipDots(bubble) {
  return findAll(
    bubble,
    (node) => typeof node.props.className === 'string' && node.props.className.split(' ').includes('dbc-tip-dot'),
  );
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
  check(label + ' countdown', text(byClass(tree, 'dbc-clock')), expectedCountdown);
  check(label + ' balance', text(byClass(tree, 'dbc-amount')), '¥32.50');
  check(label + ' model', text(byClass(tree, 'dbc-model')), 'DeepSeek-Flash');
  const values = findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className === 'dbc-price-value').map(text);
  const expectedPrices =
    expectedPeriod === 'peak' ? ['2.00', '0.04', '8.00'] : ['1.00', '0.02', '4.00'];
  check(label + ' prices', JSON.stringify(values), JSON.stringify(expectedPrices));
}

console.log('head row');
{
  const { tree } = await mount({ now: Date.parse('2026-10-25T16:52:00Z'), balance: READY_BALANCE, catalog: CATALOG });
  const head = byClass(tree, 'dbc-head');
  // The countdown is the head's first child, before the chips: the pair is what
  // the row is for, and the amount never shares a line with the moving number.
  check('head opens with the countdown', head.children[0].props.className, 'dbc-clock dbc-clock-idle');
  check('head countdown text', text(head.children[0]), '距高峰 08:08:00');
  check('head closes with the chips', head.children[1].props.className, 'dbc-chips');
  check('head holds exactly two children', head.children.length, 2);
  // The provider row lost the countdown; it is the provider's line alone.
  const mrow = byClass(tree, 'dbc-mrow');
  check('provider row has one child', mrow.children.length, 1);
  check('provider row is the provider', mrow.children[0].props.className, 'dbc-provider');
  check('countdown left the provider row', byClass(mrow, 'dbc-clock'), null);
  // The balance label is gone; the word survives only as the amount's aria-label.
  check('no balance label in the tree', classes(tree).some((name) => name.split(' ').includes('dbc-title')), false);
}

console.log('data shapes');
for (const [label, balance, expected, expectedLabel, expectedTip] of [
  ['signed-out', { ok: true, value: null }, '未登录', undefined, undefined],
  ['failed-read', { ok: false, error: 'boom' }, '读取失败', undefined, undefined],
  ['platform-failed', { ok: true, value: { status: 'failed' } }, '读取失败', undefined, undefined],
  ['empty-wallets', { ok: true, value: { status: 'ready', value: [], bonusWallets: [] } }, '读取失败', undefined, undefined],
  ['tiny-amount', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '0.004' }], bonusWallets: [] } }, '¥不足 0.01', '余额', 'trigger'],
  ['usd-only', { ok: true, value: { status: 'ready', value: [{ currency: 'USD', balance: '7.5' }], bonusWallets: [] } }, '$7.50', '余额', 'trigger'],
  ['cents-exact', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '12.34' }], bonusWallets: [] } }, '¥12.34', '余额', 'trigger'],
  ['cents-truncated', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '0.999' }], bonusWallets: [] } }, '¥0.99', '余额', 'trigger'],
  ['large-amount', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '12345.678' }], bonusWallets: [] } }, '¥12,345.67', '余额', 'trigger'],
  ['negative-rounds-to-zero', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '-0.004' }], bonusWallets: [] } }, '¥0.00', '余额', 'trigger'],
  ['zero-balance', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '0' }], bonusWallets: [] } }, '¥0.00', '余额', 'trigger'],
  ['sub-cent-rounds-up-edge', { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '0.01' }], bonusWallets: [] } }, '¥0.01', '余额', 'trigger'],
]) {
  const { tree } = await mount({ now: Date.parse('2026-10-25T16:52:00Z'), balance });
  // The amount row always exists: an amount, or a single notice inside it.
  const amount = byClass(tree, 'dbc-amount');
  check(label + ' balance text', text(amount), expected);
  // The amount itself is the trigger. It gets the help cursor and the focus
  // ring (`dbc-tip-plain`), never the dashed underline a text link would take,
  // and a notice with nothing to explain does not even take the cursor.
  check(label + ' amount takes the plain affordance', amount.props.className.split(' ').includes('dbc-tip-plain'), expectedTip === 'trigger');
  check(label + ' amount is never dashed', amount.props.className.split(' ').includes('dbc-tip-trigger'), false);
  // A failed or empty read has nothing to explain, so its notice carries no
  // tooltip; every amount — including a sub-cent one, whose composition still
  // adds up — keeps the breakdown on the number itself.
  check(label + ' amount tooltip', amount.props['data-dbc-tip'], expectedTip);
  check(label + ' amount names itself', amount.props['aria-label'], expectedLabel);
  // A bare div is `generic`, which ARIA forbids naming from the author; the
  // group role is what makes the label legal, so it must track it exactly.
  check(label + ' amount carries the naming role', amount.props.role, expectedLabel === undefined ? undefined : 'group');
  const head = byClass(tree, 'dbc-head');
  check(label + ' row is not a trigger', head.props['data-dbc-tip'], undefined);
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
  const handle = await mountLocalized('en', {
    now: Date.parse('2026-10-25T16:52:00Z'),
    balance: READY_BALANCE,
    catalog: CATALOG,
  });
  const { tree } = handle;
  check('en chip', text(byClass(tree, 'dbc-chip')).trim(), 'Idle');
  check('en countdown', text(byClass(tree, 'dbc-clock')), 'Peak in 08:08:00');
  check('en title names the amount', byClass(tree, 'dbc-amount').props['aria-label'], 'Balance');
  check('en tooltip quotes USD', (await tipOf(handle, 'dbc-model')).includes('USD per 1M tokens'), true);
  const values = findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className === 'dbc-price-value').map(text);
  check('en prices come from the USD table', JSON.stringify(values), JSON.stringify(['0.15', '0.003', '0.60']));
  check('en price labels', JSON.stringify(findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className === 'dbc-price-label').map(text)), JSON.stringify(['Input', 'Cache read', 'Output']));
  // The unit is no longer a row of its own: it lives inside the model bubble.
  // Only text that has to advertise itself takes the dashed underline; the
  // amount is a plain trigger and the chip is its own affordance, so both carry
  // the handlers without it.
  const triggers = findAll(
    tree,
    (n) => typeof n.props.className === 'string' && n.props.className.split(' ').includes('dbc-tip-trigger'),
  ).map((n) => n.props.className);
  check('en keeps one dashed trigger per row', JSON.stringify(triggers), JSON.stringify(['dbc-model dbc-tip-trigger']));
  check('en amount is a plain trigger', byClass(tree, 'dbc-amount').props['data-dbc-tip'], 'trigger');
  check('en chip is its own trigger', byClass(tree, 'dbc-chip').props['data-dbc-tip'], 'trigger');
  check('en balance spells its currency code', text(byClass(tree, 'dbc-code')), 'CNY');
  // The code span has no trailing space; the row's flex gap separates the two.
  check('en amount follows the code', text(byClass(tree, 'dbc-amount')), 'CNY¥32.50');
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
  check('en weekend countdown', text(byClass(tree, 'dbc-clock')), 'Peak in 2d 15:00:00');
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
  let handle = await mount({
    now: IDLE_NOW,
    balance: wallets([{ currency: 'CNY', balance: '32.50' }], [{ currency: 'CNY', balance: '10.00' }]),
    catalog: CATALOG,
  });
  let { tree } = handle;
  check('total adds the bonus', text(byClass(tree, 'dbc-amount')), '¥42.50');
  check('the price block carries no tooltip', byClass(tree, 'dbc-prices').props['data-dbc-tip'], undefined);
  check(
    'bubble lists every wallet',
    await tipOf(handle, 'dbc-amount'),
    '充值 | CNY ¥32.50 | 赠送 | CNY ¥10.00 | DSH 账号余额（含赠金），每 30 秒刷新',
  );
  const accountTip = await tipOf(handle, 'dbc-amount');
  check('the bubble never repeats the total', accountTip.includes('合计') || accountTip.includes('42.50'), false);
  check('the row is not a trigger', byClass(tree, 'dbc-head').props['data-dbc-tip'], undefined);

  // 0.06 + 0.01 is 0.06999999999999999 in floats: truncation would drop a cent.
  handle = await mount({
    now: IDLE_NOW,
    balance: wallets([{ currency: 'CNY', balance: '0.06' }], [{ currency: 'CNY', balance: '0.01' }]),
    catalog: CATALOG,
  });
  tree = handle.tree;
  check('sum keeps every cent', text(byClass(tree, 'dbc-amount')), '¥0.07');

  // A bonus in another currency never renames the reported total.
  handle = await mount({
    now: IDLE_NOW,
    balance: wallets([{ currency: 'USD', balance: '5.00' }], [{ currency: 'CNY', balance: '1.00' }]),
    catalog: CATALOG,
  });
  tree = handle.tree;
  check('recharge currency wins', text(byClass(tree, 'dbc-amount')), '$5.00');
  check(
    'foreign bonus still listed',
    await tipOf(handle, 'dbc-amount'),
    '充值 | USD $5.00 | 赠送 | CNY ¥1.00 | DSH 账号余额，每 30 秒刷新',
  );

  // Bonus only: the total is the grant itself.
  handle = await mount({
    now: IDLE_NOW,
    balance: wallets([], [{ currency: 'CNY', balance: '3.00' }]),
    catalog: CATALOG,
  });
  tree = handle.tree;
  check('bonus-only account', text(byClass(tree, 'dbc-amount')), '¥3.00');

  // Sub-cent totals keep the existing "under 0.01" wording.
  handle = await mount({
    now: IDLE_NOW,
    balance: wallets([{ currency: 'CNY', balance: '0.001' }], [{ currency: 'CNY', balance: '0.002' }]),
    catalog: CATALOG,
  });
  tree = handle.tree;
  check('sub-cent total', text(byClass(tree, 'dbc-note')), '¥不足 0.01');
}

console.log('amount row');
{
  // A long amount drops one size instead of clipping; a short one keeps the
  // full size. The threshold is 12 characters (`AMOUNT_SMALL_AT`).
  const wide = await mount({
    now: IDLE_NOW,
    balance: wallets([{ currency: 'CNY', balance: '12345678.90' }], []),
    catalog: CATALOG,
  });
  check('a long amount shrinks', byClass(wide.tree, 'dbc-amount').props.className, 'dbc-amount dbc-tip-plain dbc-amount-small');
  check('a long amount keeps every digit', text(byClass(wide.tree, 'dbc-amount')), '¥12,345,678.90');
  const short = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG });
  check('a short amount keeps the full size', byClass(short.tree, 'dbc-amount').props.className, 'dbc-amount dbc-tip-plain');
}

console.log('provider line');
{
  // The provider row names the catalogue entry, falls back to the raw id, and
  // shows a dash when the catalogue could not be read at all.
  const labelled = {
    ok: true,
    value: {
      default: { provider: 'deepseek-account', model: 'DeepSeek-Flash' },
      groups: [{ id: 'deepseek-account', name: 'DeepSeek', models: [{ id: 'DeepSeek-Flash', name: 'DeepSeek-Flash' }] }],
    },
  };
  let { tree: named } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: labelled });
  check('the provider row prints the catalogue name', text(byClass(named, 'dbc-provider')), 'DeepSeek');
  check('the provider row is not a trigger', byClass(named, 'dbc-provider').props['data-dbc-tip'], undefined);

  const { tree: bare } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG });
  check('an id the catalogue does not name stands in', text(byClass(bare, 'dbc-provider')), 'deepseek-account');

  const { tree: failed } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: { ok: false } });
  check('a failed catalogue shows a dash', text(byClass(failed, 'dbc-provider')), '—');

  // A provider the catalogue lists as failed still carries its display name.
  const failedGroup = {
    ok: true,
    value: {
      default: { provider: 'deepseek-account', model: 'DeepSeek-Flash' },
      groups: [],
      failures: [{ id: 'deepseek-account', name: 'DeepSeek' }],
    },
  };
  const { tree: fallback } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: failedGroup });
  check('a failed provider still names itself', text(byClass(fallback, 'dbc-provider')), 'DeepSeek');
}

console.log('price labels');
{
  const { tree } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG });
  check(
    'zh price labels',
    JSON.stringify(findAll(tree, (n) => n.props.className === 'dbc-price-label').map(text)),
    JSON.stringify(['输入', '缓存', '输出']),
  );
}

console.log('live model switching');
{
  const live = liveServices();
  const handle = await mount({
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG_TWO,
    services: live.services,
  });
  const { tree, pump } = handle;
  check('unselected session keeps the default', text(byClass(tree, 'dbc-model')), 'DeepSeek-Flash');

  live.select('session-1', { provider: 'deepseek-account', model: 'deepseek-v4-pro' });
  let next = await pump();
  check('switch repaints the model', text(byClass(next, 'dbc-model')), 'DeepSeek-V4-Pro-0813');
  check('switch repaints the prices', JSON.stringify(priced(next)), JSON.stringify(['4.50', '0.15', '13.50']));
  check('switch keeps the unit in the tooltip', (await tipOf(handle, 'dbc-model')).includes('人民币元 / 百万 tokens'), true);

  // An alias resolves to the row it bills as.
  live.select('session-1', { provider: 'deepseek-account', model: 'deepseek-v4-flash' });
  next = await pump();
  check('alias repaints the prices', JSON.stringify(priced(next)), JSON.stringify(['1.00', '0.02', '4.00']));
  check('alias shows the selected id', text(byClass(next, 'dbc-model')), 'deepseek-v4-flash');

  // Each session carries its own selection.
  live.select('session-2', { provider: 'deepseek-account', model: 'deepseek-v4-pro' });
  live.activate('session-2');
  next = await pump();
  check('session switch follows its own selection', text(byClass(next, 'dbc-model')), 'DeepSeek-V4-Pro-0813');
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

  // A model the table never lists stays "not in the price list", whatever the
  // provider is: the card must not blame the provider for a model it cannot
  // price anyway.
  const foreignUnpriced = {
    ok: true,
    value: { default: { provider: 'some-router', model: 'gpt-5' }, groups: [] },
  };
  const { tree: missing } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: foreignUnpriced });
  check('a foreign provider still says "not in the list" for a foreign model', text(byClass(missing, 'dbc-note')), '官方价目未收录该模型');

  // A lookalike id is not DeepSeek's provider: the set is explicit.
  const lookalike = { ok: true, value: { default: { provider: 'llm-deepseek', model: 'deepseek-v4-pro' }, groups: [] } };
  const aliasHandle = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: lookalike });
  const alias = aliasHandle.tree;
  check('a lookalike provider id stays foreign', priced(alias).length, 0);
  // Its model bubble would claim rates the card is not quoting, so the model
  // line keeps neither the class nor the handlers. The rest of the card is
  // still interactive: the balance and the chip explain themselves.
  const aliasModel = byClass(alias, 'dbc-model');
  check('a foreign provider gets no model trigger class', aliasModel.props.className, 'dbc-model');
  check('a foreign provider gets no model bubble', aliasModel.props['data-dbc-tip'], undefined);
  check('a foreign provider model is not focusable', aliasModel.props.tabIndex, undefined);
  check('the amount still explains the balance', byClass(alias, 'dbc-amount').props['data-dbc-tip'], 'trigger');
  check('the amount bubble still opens', (await tipOf(aliasHandle, 'dbc-amount')).includes('DSH 账号余额'), true);
  check('the chip bubble still opens', (await tipOf(aliasHandle, 'dbc-chip')).includes('周一至周五'), true);

  // Every id in the official set prices at list; anything else does not.
  for (const provider of ['deepseek', 'deepseek-official', 'deepseek-account', 'DeepSeek-Official']) {
    const catalog = {
      ok: true,
      value: { default: { provider, model: 'deepseek-v4-pro' }, groups: [] },
    };
    const { tree } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog });
    check(provider + ' prices at list', JSON.stringify(priced(tree)), JSON.stringify(['4.50', '0.15', '13.50']));
  }
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
  check('starts on the catalog default', text(byClass(tree, 'dbc-model')), 'DeepSeek-Flash');
  check('one-second retry while the services are absent', JSON.stringify(timers.map((t) => t.delay).sort((a, b) => a - b)), JSON.stringify([1000, 1000, 30000]));

  services.uiSession = live.services.uiSession;
  services.modelDirectories = live.services.modelDirectories;
  for (const timer of timers.filter((t) => t.delay === 1000)) timer.callback();
  const next = await pump();
  check('late services attach', text(byClass(next, 'dbc-model')), 'DeepSeek-V4-Pro-0813');
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
  const handle = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data: livePayload() });
  const { tree } = handle;
  check('host prices replace the snapshot', JSON.stringify(priced(tree)), JSON.stringify(['0.99', '0.02', '4.00']));
  check('unit tooltip marks the startup sync', (await tipOf(handle, 'dbc-model')).includes('启动时校准'), true);
  check('unit tooltip keeps the price date', (await tipOf(handle, 'dbc-model')).includes('2026-10-26'), true);
}

{
  const handle = await mount({
    now: PEAK_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload({ holidays: { days: [dayOf(2026, 10, 26)], years: [2026] } }),
  });
  const { tree } = handle;
  check('calendar holiday turns the peak idle', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-idle');
  check('chip tooltip names the calendar', (await tipOf(handle, 'dbc-chip')).includes('iCloud'), true);
}

{
  const handle = await mount({ now: PEAK_NOW, balance: READY_BALANCE, catalog: CATALOG, data: null });
  const { tree, delays } = handle;
  check('a missing route is asked a few times', delays.filter((delay) => delay === 3000).length, 2);
  check('no route keeps the snapshot prices', JSON.stringify(priced(tree)), JSON.stringify(['2.00', '0.04', '8.00']));
  check('no route keeps the built-in period', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-peak');
  check('unit tooltip marks the snapshot', (await tipOf(handle, 'dbc-model')).includes('内置快照'), true);
  check('chip tooltip marks the built-in table', (await tipOf(handle, 'dbc-chip')).includes('内置节假日表'), true);
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
  // The strip names the occasion, not "in progress": the date and the all-day
  // rate moved into their own right-aligned meta span.
  check('banner text', text(byClass(tree, 'dbc-holiday-text')), '国庆节');
  check('banner meta reads the date and the rate', text(byClass(tree, 'dbc-holiday-meta')), '10/1 · 空闲全天');
  check('banner class', banner.props.className, 'dbc-holiday');
  check('banner carries no tooltip', banner.props['data-dbc-tip'], undefined);
  check('banner leads the card', byClass(tree, 'dbc-card').children[0].props.className, 'dbc-holiday');
  check('banner draws an icon', byClass(tree, 'dbc-holiday-icon') !== null, true);
  check('the holiday left the chip row', JSON.stringify(byClass(tree, 'dbc-chips').children.map((n) => n.props.className)), JSON.stringify(['dbc-chip dbc-chip-idle']));
  check('no make-up chip on a holiday', chipOf(tree, 'makeup'), null);
}

{
  // 2026-10-10 is a make-up workday: gray chip, still billed as off-peak.
  const makeupDay = dayOf(2026, 10, 10);
  const handle = await mount({
    now: Date.parse('2026-10-10T02:30:00Z'),
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload({ holidays: { days: [], names: {}, makeup: [makeupDay], makeupNames: { [makeupDay]: '国庆节' } } }),
  });
  const { tree } = handle;
  const badge = chipOf(tree, 'makeup');
  check('make-up chip renders', badge !== null, true);
  check('make-up chip label', text(badge), '调休');
  check('make-up chip class', badge.props.className, 'dbc-chip dbc-chip-makeup');
  check('make-up bubble explains the billing', await tipOf(handle, 'dbc-chip-makeup'), '调休日按周末处理，全天不计高峰。');
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
  check('the banner appears at Beijing midnight', text(byClass(after.tree, 'dbc-holiday-text')), '国庆节');
  check('and the holiday is already idle', byClass(after.tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-idle');
}

{
  // The built-in table carries names too, so the chip survives a missing route.
  const { tree } = await mount({ now: Date.parse('2025-10-01T02:30:00Z'), balance: READY_BALANCE, catalog: CATALOG, data: null });
  const banner = byClass(tree, 'dbc-holiday');
  check('built-in holiday banner', text(byClass(tree, 'dbc-holiday-text')), '国庆节');
  check('the holiday banner has no tooltip', banner.props['data-dbc-tip'], undefined);
}

{
  // Mid-Autumn falls inside National Day in 2025: one day, two names.
  const { tree } = await mount({ now: Date.parse('2025-10-06T02:30:00Z'), balance: READY_BALANCE, catalog: CATALOG, data: null });
  check('overlapping holidays keep both names', text(byClass(tree, 'dbc-holiday-text')), '国庆节、中秋节');
}

{
  // The built-in make-up table labels its own gray chip.
  const handle = await mount({ now: Date.parse('2026-10-10T02:30:00Z'), balance: READY_BALANCE, catalog: CATALOG, data: null });
  check('built-in make-up chip', text(chipOf(handle.tree, 'makeup')), '调休');
  check('built-in make-up bubble', await tipOf(handle, 'dbc-chip-makeup'), '调休日按周末处理，全天不计高峰。');
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
  check('a zh-CN card keeps the bare symbol', text(byClass(cny.tree, 'dbc-amount')), '¥32.50');
  check('a zh-CN card carries no currency code', byClass(cny.tree, 'dbc-code'), null);
  check('a zh-CN card names the unit in the tooltip', (await tipOf(cny, 'dbc-model')).includes('人民币元 / 百万 tokens'), true);

  for (const language of ['en', 'ja']) {
    const other = await mountLocalized(language, { now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG });
    check(language + ' quotes USD', JSON.stringify(priced(other.tree)), JSON.stringify(['0.15', '0.003', '0.60']));
    check(language + ' spells the balance currency', text(byClass(other.tree, 'dbc-code')), 'CNY');
    check(language + ' writes the amount after the code', text(byClass(other.tree, 'dbc-amount')), 'CNY¥32.50');
  }

  const japanese = await mountLocalized('ja', { now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG });
  check('a non-chinese tooltip names USD', (await tipOf(japanese, 'dbc-model')).includes('USD per 1M tokens'), true);
}

{
  // zh-CN is a Chinese card: CNY prices, and the Chinese calendar labels too.
  const holidayDay = dayOf(2026, 10, 1);
  const data = livePayload({ holidays: { days: [holidayDay], names: { [holidayDay]: '国庆节' }, makeup: [], makeupNames: {} } });
  const cny = await mountLocalized('zh-CN', { now: Date.parse('2026-10-01T02:30:00Z'), balance: READY_BALANCE, catalog: CATALOG, data });
  check('a zh-CN card shows the banner', text(byClass(cny.tree, 'dbc-holiday-text')), '国庆节');
  check('a zh-CN banner keeps its chinese meta', text(byClass(cny.tree, 'dbc-holiday-meta')), '10/1 · 空闲全天');

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
  const handle = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, services: live.services, data });
  const { pump } = handle;

  // deepseek-account bills at the official price table but is not the open
  // platform: the account balance leads, and the API balance is nowhere in its
  // tooltip.
  live.select('session-1', { provider: 'deepseek-account', model: 'deepseek-v4-pro' });
  let next = await pump();
  check('a non-official provider leads with the account balance', text(byClass(next, 'dbc-amount')), '¥32.50');
  check('and its label names the account', byClass(next, 'dbc-amount').props['aria-label'], '余额');
  check(
    'and its bubble describes only the account',
    await tipOf(handle, 'dbc-amount'),
    '充值 | CNY ¥32.50 | 赠送 | CNY ¥0.00 | DSH 账号余额（含赠金），每 30 秒刷新',
  );
  check('the account bubble never mentions the API', (await tipOf(handle, 'dbc-amount')).includes('开放平台'), false);

  // Selecting the API-key provider moves the headline to the open-platform balance.
  live.select('session-1', { provider: 'deepseek-official', model: 'deepseek-chat' });
  next = await pump();
  check('the API provider switches the amount', text(byClass(next, 'dbc-amount')), '¥110.00');
  // The headline states the total, so the bubble decomposes it and never repeats it
  // as a row: the rows are exactly the parts that add up to it.
  check('the API bubble never repeats the total as a row', (await tipOf(handle, 'dbc-amount')).includes('110.00'), false);
  check('and no row repeats the total', (await tipOf(handle, 'dbc-amount')).includes('合计'), false);
  check('and the label follows', byClass(next, 'dbc-amount').props['aria-label'], 'API 余额');
  check(
    'and the bubble is the API composition only',
    await tipOf(handle, 'dbc-amount'),
    '充值 | CNY ¥100.00 | 赠金 | CNY ¥10.00 | DeepSeek 开放平台余额，每 30 秒刷新',
  );
  check('the API bubble never mentions DSH', (await tipOf(handle, 'dbc-amount')).includes('DSH'), false);
  check('the API bubble never lists the account bonus', (await tipOf(handle, 'dbc-amount')).includes('赠送'), false);
  check('the API bubble never carries the account amount', (await tipOf(handle, 'dbc-amount')).includes('¥32.50'), false);

  // Switching back is the same, in the other direction.
  live.select('session-1', { provider: 'deepseek-account', model: 'DeepSeek-Flash' });
  next = await pump();
  check('switching back restores the account balance', text(byClass(next, 'dbc-amount')), '¥32.50');
  check('and the account label', byClass(next, 'dbc-amount').props['aria-label'], '余额');

  // The price gate is wider than the balance gate: `deepseek` still quotes the
  // official table while the account balance leads.
  live.select('session-1', { provider: 'deepseek', model: 'deepseek-v4-flash' });
  next = await pump();
  check('deepseek still headlines the account', text(byClass(next, 'dbc-amount')), '¥32.50');
  check('deepseek still shows the list price', priced(next).length, 3);
}

{
  // Switching the provider refreshes the balance immediately: waiting for the
  // 30 s tick would show the wrong headline for half a minute.
  const live = liveServices();
  let ready = false;
  const { tree, pump, requests, delays } = await mount({
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    services: live.services,
    data: () => livePayload({ deepseek: ready ? apiBalance() : { status: 'unavailable' } }),
  });
  check('the account balance leads before the switch', text(byClass(tree, 'dbc-amount')), '¥32.50');

  ready = true;
  live.select('session-1', { provider: 'deepseek-official', model: 'deepseek-chat' });
  const next = await pump();
  check('the switch fetches the balance without waiting for a tick', text(byClass(next, 'dbc-amount')), '¥110.00');
  check(
    'and it asks the Host for a fresh amount',
    requests.some((url) => url === '/deepseek-billing-card/data?balance=refresh'),
    true,
  );
  // The periodic tick stays on the plain route: it is a read, not a re-read.
  const before = requests.length;
  await pump();
  check('the periodic read is not forced', requests.slice(before).some((url) => url.includes('balance=refresh')), false);
}

{
  // The Host answers before its requested re-read finishes, so an amount that is
  // still missing gets a quick follow-up instead of waiting for the next minute.
  const live = liveServices({ 'session-1': { provider: 'deepseek-account', model: 'DeepSeek-Flash' } });
  const { pump, requests } = await mount({
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    services: live.services,
    data: livePayload({ deepseek: { status: 'unavailable' } }),
  });
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, delay, ...rest) => realSetTimeout(fn, delay === 1000 ? 0 : delay, ...rest);
  try {
    live.select('session-1', { provider: 'deepseek-official', model: 'deepseek-chat' });
    const afterSwitch = await pump();
    await new Promise((resolve) => realSetTimeout(resolve, 5));
    check('a switch to a not-ready API amount is a notice', text(byClass(afterSwitch, 'dbc-note')), '未配置 API Key');
    check(
      'and it is followed up a second later',
      requests.filter((url) => url.includes('balance=refresh')).length >= 2,
      true,
    );
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

{
  // A provider list or credential change in settings never touches the visible
  // session's selection, so it has its own trigger: the card asks the Host for a
  // fresh balance as soon as the provider surface moves.
  const live = liveServices({ 'session-1': { provider: 'deepseek-account', model: 'DeepSeek-Flash' } });
  const { registered, requests } = await mount({
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    services: live.services,
    data: livePayload({ deepseek: apiBalance() }),
  });
  const events = registered.events.map((entry) => entry.event);
  check(
    'the card follows the provider surface',
    ['llm/adapters-updated', 'settings/document-updated', 'credentials/record-updated'].every((name) => events.includes(name)),
    true,
  );
  const before = requests.length;
  for (const entry of registered.events.filter((e) => e.event === 'llm/adapters-updated')) entry.listener();
  check(
    'a provider change asks for a fresh balance',
    requests.slice(before).some((url) => url === '/deepseek-billing-card/data?balance=refresh'),
    true,
  );
}

{
  // No key configured: the open-platform provider has no amount to show, so the
  // headline is the notice — not the account balance.
  const live = liveServices({ 'session-1': { provider: 'deepseek-official', model: 'deepseek-chat' } });
  const data = livePayload({ deepseek: { status: 'unavailable' } });
  const { tree } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, services: live.services, data });
  const note = byClass(tree, 'dbc-note');
  check('an unavailable API balance is a notice', text(note), '未配置 API Key');
  // The notice owns the amount row and nothing dresses it up as money.
  check('and is not dressed up as an amount', JSON.stringify(byClass(tree, 'dbc-amount').children.map((n) => n.props.className)), JSON.stringify(['dbc-note']));
  check('and the notice carries no currency code', byClass(tree, 'dbc-code'), null);
  // The row is a notice, not an amount, so it names no amount and explains none.
  check('and the notice names no amount', byClass(tree, 'dbc-amount').props['aria-label'], undefined);
  check('the notice carries no tooltip', note.props['data-dbc-tip'], undefined);
  check('and the amount row carries none either', byClass(tree, 'dbc-amount').props['data-dbc-tip'], undefined);
}

{
  // A key that is configured but unreadable: the open-platform provider still has
  // no amount, and "no key yet" and "key broken" must not look the same.
  const live = liveServices({ 'session-1': { provider: 'deepseek-official', model: 'deepseek-chat' } });
  const data = livePayload({ deepseek: { status: 'failed' } });
  const { tree } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, services: live.services, data });
  const note = byClass(tree, 'dbc-note');
  check('a failed API read is its own notice', text(note), '读取失败，稍后重试');
  check('a failed API read names no amount', byClass(tree, 'dbc-amount').props['aria-label'], undefined);
  check('the failed notice carries no tooltip', note.props['data-dbc-tip'], undefined);
  check('and the amount row carries none either', byClass(tree, 'dbc-amount').props['data-dbc-tip'], undefined);
  check('and does not claim the key is missing', text(note).includes('未配置 API Key'), false);

  const en = await mountLocalized('en', {
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    services: liveServices({ 'session-1': { provider: 'deepseek-official', model: 'deepseek-chat' } }).services,
    data,
  });
  check('english reports the failed read too', text(byClass(en.tree, 'dbc-note')), 'read failed, retrying');
  check('english failed notice has no tooltip', byClass(en.tree, 'dbc-note').props['data-dbc-tip'], undefined);
}

{
  // The Host re-reads the balance once a minute; the card must re-ask too, or it
  // stays on whatever the first answer said — including "no API key" from
  // before the key was configured.
  const live = liveServices({ 'session-1': { provider: 'deepseek-official', model: 'deepseek-chat' } });
  let ready = false;
  const handle = await mount({
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    services: live.services,
    data: () => livePayload({ deepseek: ready ? apiBalance() : { status: 'unavailable' } }),
  });
  const { tree, pump, registered } = handle;
  const note = byClass(tree, 'dbc-note');
  check('the first answer has no key', text(note), '未配置 API Key');
  check('the missing-key notice has no tooltip', note.props['data-dbc-tip'], undefined);

  ready = true;
  const tick = registered.timers.find((entry) => entry.delay === 30000);
  check('the card ticks every 30 s', typeof tick, 'object');
  tick.callback();
  const next = await pump();
  check('the next tick picks the balance up', text(byClass(next, 'dbc-amount')), '¥110.00');
  check('and drops the missing-key line', (await tipOf(handle, 'dbc-amount')).includes('未配置 API Key'), false);
}

{
  // A signed-out DSH account leaves the API balance as the only money the card
  // can report, even for a provider that is not the open platform.
  const live = liveServices({ 'session-1': { provider: 'deepseek-account', model: 'deepseek-v4-pro' } });
  const data = livePayload({ deepseek: apiBalance() });
  const handle = await mount({
    now: IDLE_NOW,
    balance: { ok: true, value: null },
    catalog: CATALOG,
    services: live.services,
    data,
  });
  const { tree } = handle;
  check('a signed-out account falls back to the API balance', text(byClass(tree, 'dbc-amount')), '¥110.00');
  check('and the label follows the API balance', byClass(tree, 'dbc-amount').props['aria-label'], 'API 余额');
  check(
    'and the API bubble describes the API only',
    await tipOf(handle, 'dbc-amount'),
    '充值 | CNY ¥100.00 | 赠金 | CNY ¥10.00 | DeepSeek 开放平台余额，每 30 秒刷新',
  );
}

for (const [label, deepseek, expected] of [
  ['unavailable', { status: 'unavailable' }, '未登录，且未配置 API Key'],
  ['failed', { status: 'failed' }, '未登录，API 余额读取失败'],
  ['absent', null, '未登录'],
]) {
  const live = liveServices({ 'session-1': { provider: 'deepseek-account', model: 'deepseek-v4-pro' } });
  const data = livePayload({ deepseek });
  const { tree } = await mount({
    now: IDLE_NOW,
    balance: { ok: true, value: null },
    catalog: CATALOG,
    services: live.services,
    data,
  });
  const note = byClass(tree, 'dbc-note');
  check('a signed-out account with API ' + label, text(note), expected);
  check('and no tooltip when the API is ' + label, note.props['data-dbc-tip'], undefined);
}

{
  // An older Host has no balance route: the open-platform provider falls back to
  // what the card can still see instead of claiming a key is missing.
  const live = liveServices({ 'session-1': { provider: 'deepseek-official', model: 'deepseek-chat' } });
  const data = livePayload();
  const { tree } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, services: live.services, data });
  check('an absent API route falls back to the account balance', text(byClass(tree, 'dbc-amount')), '¥32.50');
  check('with the account label', byClass(tree, 'dbc-amount').props['aria-label'], '余额');

  const signedOut = await mount({
    now: IDLE_NOW,
    balance: { ok: true, value: null },
    catalog: CATALOG,
    services: liveServices({ 'session-1': { provider: 'deepseek-official', model: 'deepseek-chat' } }).services,
    data,
  });
  check('an absent API route with no account says signed out', text(byClass(signedOut.tree, 'dbc-note')), '未登录');
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
  check('english spells the API currency code', text(byClass(tree, 'dbc-code')), 'CNY');
  check('english API amount follows the code', text(byClass(tree, 'dbc-amount')), 'CNY¥110.00');
  check('english label', byClass(tree, 'dbc-amount').props['aria-label'], 'API balance');
}

console.log('currency per language');
{
  const { tree } = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data: livePayload({ prices: { CNY: cnyTable(0.5), USD: usdTable(0.11) } }) });
  check('zh takes the CNY table', JSON.stringify(priced(tree)), JSON.stringify(['0.50', '0.02', '4.00']));
}
{
  const handle = await mountLocalized('en', {
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload({ prices: { CNY: cnyTable(0.5), USD: usdTable(0.11) } }),
  });
  check('en takes the USD table', JSON.stringify(priced(handle.tree)), JSON.stringify(['0.11', '0.003', '0.60']));
  check('en tooltip marks the startup sync', (await tipOf(handle, 'dbc-model')).includes(' | startup'), true);
}
{
  const handle = await mountLocalized('en', {
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload({ prices: { CNY: cnyTable(0.5), USD: null } }),
  });
  check('a missing USD table keeps the built-in USD prices', JSON.stringify(priced(handle.tree)), JSON.stringify(['0.15', '0.003', '0.60']));
  check('and the tooltip says built in', (await tipOf(handle, 'dbc-model')).includes(' | snapshot'), true);
}
{
  const handle = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data: livePayload({ prices: { CNY: null, USD: usdTable() } }) });
  check('a missing CNY table keeps the built-in CNY prices', JSON.stringify(priced(handle.tree)), JSON.stringify(['1.00', '0.02', '4.00']));
  check('and the zh tooltip says built in', (await tipOf(handle, 'dbc-model')).includes('内置快照'), true);
}
{
  // USD prices need a third decimal; CNY keeps two.
  const { tree } = await mountLocalized('en', {
    now: Date.parse('2026-10-26T01:30:00Z'),
    balance: READY_BALANCE,
    catalog: CATALOG,
  });
  check('peak USD prices', JSON.stringify(priced(tree)), JSON.stringify(['0.30', '0.006', '1.20']));
  check('peak USD card names the peak', text(byClass(tree, 'dbc-chip')).trim(), 'Peak');
}

if (hostPayload !== null) {
  console.log('host payload from the real sources');
  {
    // 2024-01-01 is a Monday holiday in the calendar but outside the built-in
    // table (2025-2026), so the period proves which holiday set is in use.
    const handle = await mount({
      now: Date.parse('2024-01-01T02:30:00Z'),
      balance: READY_BALANCE,
      catalog: CATALOG,
      data: hostPayload,
    });
    const { tree } = handle;
    check('real payload prices the model', JSON.stringify(priced(tree)), JSON.stringify(['1.00', '0.02', '4.00']));
    check('real payload date in the tooltip', (await tipOf(handle, 'dbc-model')).includes(hostPayload.prices.CNY.asOf), true);
    check('real payload counts as a startup sync', (await tipOf(handle, 'dbc-model')).includes('启动时校准'), true);
    check('real calendar makes a 2024 holiday idle', byClass(tree, 'dbc-chip').props.className, 'dbc-chip dbc-chip-idle');
    check('real calendar names the 2024 holiday', text(byClass(tree, 'dbc-holiday-text')), '元旦');
    check('real calendar dates the 2024 holiday', text(byClass(tree, 'dbc-holiday-meta')), '1/1 · 空闲全天');
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
  const handle = await mount({ now: PEAK_NOW, balance: READY_BALANCE, catalog: CATALOG, data });
  const { tree } = handle;
  check(label + ': the card still renders', byClass(tree, 'dbc-card') !== null, true);
  check(label + ': it keeps the snapshot prices', JSON.stringify(priced(tree)), expectedPrices);
  check(label + ': the tooltip marks the snapshot', (await tipOf(handle, 'dbc-model')).includes('内置快照'), true);
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
  check('an overlapping day keeps its banner', text(byClass(tree, 'dbc-holiday-text')), '国庆节');
  check('an overlapping day shows no 调休 chip', chipOf(tree, 'makeup'), null);
}

console.log('route failures');
{
  const handle = await mount({
    now: PEAK_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload(),
    route: 'http-404',
  });
  const { tree, delays } = handle;
  check('a 404 route keeps the snapshot prices', JSON.stringify(priced(tree)), SNAPSHOT_ZH_PEAK);
  check('a 404 route marks the snapshot in the tooltip', (await tipOf(handle, 'dbc-model')).includes('内置快照'), true);
  check('a 404 route retries twice more', delays.filter((delay) => delay === 3000).length, 2);
  check('a 404 route still renders the card', byClass(tree, 'dbc-card') !== null, true);
}
{
  const handle = await mount({
    now: PEAK_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload(),
    route: 'absent',
  });
  const { tree, delays } = handle;
  check('an absent fetch keeps the snapshot prices', JSON.stringify(priced(tree)), SNAPSHOT_ZH_PEAK);
  check('an absent fetch marks the snapshot in the tooltip', (await tipOf(handle, 'dbc-model')).includes('内置快照'), true);
  check('an absent fetch never polls the route', delays.filter((delay) => delay === 3000).length, 0);
  check('an absent fetch still renders the card', byClass(tree, 'dbc-card') !== null, true);
}

console.log('live CNY without a USD table');
{
  const data = livePayload({ prices: { CNY: cnyTable(0.5), USD: null } });
  const zh = await mount({ now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data });
  check('zh keeps the live CNY table', JSON.stringify(priced(zh.tree)), JSON.stringify(['0.50', '0.02', '4.00']));
  check('zh marks it as a startup sync', (await tipOf(zh, 'dbc-model')).includes('启动时校准'), true);
  const en = await mountLocalized('en', { now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data });
  check('en falls back to the built-in USD table', JSON.stringify(priced(en.tree)), JSON.stringify(['0.15', '0.003', '0.60']));
  check('en marks the built-in snapshot', (await tipOf(en, 'dbc-model')).includes(' | snapshot'), true);
}

console.log('locale currency matrix');
{
  const data = livePayload({ prices: { CNY: cnyTable(0.5), USD: usdTable(0.11) } });
  for (const language of ['zh', 'zh-CN', 'zh-TW']) {
    const { tree } = await mountLocalized(language, { now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data });
    check(language + ' reads the CNY table', JSON.stringify(priced(tree)), JSON.stringify(['0.50', '0.02', '4.00']));
    check(language + ' keeps the bare ¥ balance', text(byClass(tree, 'dbc-amount')), '¥32.50');
  }
  for (const language of ['en', 'ja', 'xx']) {
    const handle = await mountLocalized(language, { now: IDLE_NOW, balance: READY_BALANCE, catalog: CATALOG, data });
    const { tree } = handle;
    check(language + ' reads the USD table', JSON.stringify(priced(tree)), JSON.stringify(['0.11', '0.003', '0.60']));
    check(language + ' keeps the third decimal', priced(tree)[1], '0.003');
    check(language + ' prefixes the ISO code', text(byClass(tree, 'dbc-code')) + '|' + text(byClass(tree, 'dbc-amount')), 'CNY|CNY¥32.50');
    check(language + ' names USD in the tooltip', (await tipOf(handle, 'dbc-model')).includes('USD per 1M tokens'), true);
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
        check(zone + ' ' + label + ' keeps the countdown', text(byClass(tree, 'dbc-clock')), countdown);
      }
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

// --------------------------------------------------------------- bubble bodies
// The card draws its own bubble now, so each assertion reads the node a trigger
// produced: labelled rows, tone dots, a hairline and a footnote. The head, the
// title and the total row are gone — the card already shows the number.
console.log('bubble bodies');

{
  const handle = await mount({
    now: IDLE_NOW,
    balance: wallets([{ currency: 'CNY', balance: '32.50' }], [{ currency: 'CNY', balance: '10.00' }]),
    catalog: CATALOG,
  });
  const { bubble } = await openTip(handle, 'dbc-amount');
  check('account bubble is a .dbc-tip', bubble === null ? null : bubble.props.className, 'dbc-tip');
  // The bubble is the only hover text: the trigger carries no native title.
  check('account trigger is marked', byClass(handle.tree, 'dbc-amount').props['data-dbc-tip'], 'trigger');
  check('account trigger carries no native title', byClass(handle.tree, 'dbc-amount').props.title, undefined);

  const rows = tipRows(bubble);
  check('account row count', rows.length, 2);
  check('account first row label', text(byClass(rows[0], 'dbc-tip-label')), '充值');
  check('account first row amount', text(byClass(rows[0], 'dbc-tip-amount')), 'CNY ¥32.50');
  check('account first row dot', tipDotClass(rows[0]), 'dbc-tip-dot dbc-tip-dot-ok');
  check('account second row label', text(byClass(rows[1], 'dbc-tip-label')), '赠送');
  check('account second row amount', text(byClass(rows[1], 'dbc-tip-amount')), 'CNY ¥10.00');
  check('account second row dot', tipDotClass(rows[1]), 'dbc-tip-dot dbc-tip-dot-warn');

  check('account bubble has no head', byClass(bubble, 'dbc-tip-head'), null);
  check('account rule count', findAll(bubble, (node) => node.props.className === 'dbc-tip-rule').length, 1);
  check('account note', text(byClass(bubble, 'dbc-tip-note')), 'DSH 账号余额（含赠金），每 30 秒刷新');
  check('account rows never repeat the total', rows.map(text).join(' ').includes('合计'), false);
  check(
    'account child order',
    bubble === null ? null : JSON.stringify(bubble.children.map((child) => child.props.className)),
    JSON.stringify(['dbc-tip-arrow', 'dbc-tip-row', 'dbc-tip-row', 'dbc-tip-rule', 'dbc-tip-note']),
  );
}

{
  // The same bubble for the open-platform balance: the rows are only the two
  // contributors the headline adds up.
  const live = liveServices();
  const handle = await mount({
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    services: live.services,
    data: livePayload({ deepseek: apiBalance() }),
  });
  live.select('session-1', { provider: 'deepseek-official', model: 'deepseek-chat' });
  const tree = await handle.pump();
  check('the API bubble explains the headline', text(byClass(tree, 'dbc-amount')), '¥110.00');
  const { bubble } = await openTip(handle, 'dbc-amount');

  const rows = tipRows(bubble);
  check('API row count', rows.length, 2);
  check(
    'API row labels',
    JSON.stringify(rows.map((row) => text(byClass(row, 'dbc-tip-label')))),
    JSON.stringify(['充值', '赠金']),
  );
  check(
    'API row amounts',
    JSON.stringify(rows.map((row) => text(byClass(row, 'dbc-tip-amount')))),
    JSON.stringify(['CNY ¥100.00', 'CNY ¥10.00']),
  );
  check('API first row dot', tipDotClass(rows[0]), 'dbc-tip-dot dbc-tip-dot-ok');
  check('API second row dot', tipDotClass(rows[1]), 'dbc-tip-dot dbc-tip-dot-warn');
  check('API note names the open platform', text(byClass(bubble, 'dbc-tip-note')).includes('开放平台'), true);
  check('API rows never repeat the total', rows.map(text).join(' ').includes('合计'), false);
}

{
  // The model bubble is a four-row definition list: no footnote, no tone dot, and
  // therefore no hairline either — the hairline only separates rows from a note.
  const lowercase = {
    ok: true,
    value: {
      default: { provider: 'deepseek-account', model: 'deepseek-flash' },
      groups: [{ id: 'deepseek-account', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'DeepSeek-Flash' }] }],
    },
  };
  const handle = await mount({
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: lowercase,
    data: livePayload(),
  });
  const { bubble } = await openTip(handle, 'dbc-model');
  const rows = tipRows(bubble);
  check('model row count', rows.length, 4);
  check('model bubble has no head', byClass(bubble, 'dbc-tip-head'), null);
  check('model bubble has no note', byClass(bubble, 'dbc-tip-note'), null);
  check(
    'model row labels',
    JSON.stringify(rows.map((row) => text(byClass(row, 'dbc-tip-label')))),
    JSON.stringify(['模型 ID', '计价单位', '快照日期', '校准方式']),
  );
  check(
    'model row values',
    JSON.stringify(rows.map((row) => text(byClass(row, 'dbc-tip-amount')))),
    JSON.stringify(['deepseek-flash', '人民币元 / 百万 tokens', '2026-10-26', '启动时校准']),
  );
  check('model bubble has no dots', tipDots(bubble).length, 0);
  check('model bubble has no rule', findAll(bubble, (node) => node.props.className === 'dbc-tip-rule').length, 0);
}

{
  // Peak, English, live table: every label switches language and the sync row
  // reads the startup sync, not the built-in snapshot.
  const live = liveServices({ 'session-1': { provider: 'deepseek-account', model: 'deepseek-v4-pro' } });
  const handle = await mountLocalized('en', {
    now: PEAK_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG_TWO,
    services: live.services,
    data: livePayload(),
  });
  live.select('session-1', { provider: 'deepseek-account', model: 'deepseek-flash' });
  await handle.pump();
  const { bubble } = await openTip(handle, 'dbc-model');
  const rows = tipRows(bubble);
  check(
    'en model row labels',
    JSON.stringify(rows.map((row) => text(byClass(row, 'dbc-tip-label')))),
    JSON.stringify(['Model ID', 'Unit', 'Snapshot', 'Sync mode']),
  );
  check(
    'en model row values',
    JSON.stringify(rows.map((row) => text(byClass(row, 'dbc-tip-amount')))),
    JSON.stringify(['deepseek-flash', 'USD per 1M tokens', '2026-10-26', 'startup']),
  );
}

{
  // A missing USD table falls back to the built-in snapshot: same shape, and the
  // sync row ends with the built-in wording.
  const handle = await mountLocalized('en', {
    now: PEAK_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload({ prices: { CNY: cnyTable(0.5), USD: null } }),
  });
  const rows = tipRows((await openTip(handle, 'dbc-model')).bubble);
  check('en built-in source keeps the snapshot date', text(byClass(rows[2], 'dbc-tip-amount')), '2026-10-26');
  check('en built-in source names the built-in snapshot', text(byClass(rows[3], 'dbc-tip-amount')), 'snapshot');
}

// ---------------------------------------------------------- bubble mechanics
console.log('hover bubble');
{
  const handle = await mount({
    now: IDLE_NOW,
    balance: READY_BALANCE,
    catalog: CATALOG,
    data: livePayload({ holidays: { days: [dayOf(2026, 10, 1)], years: [2026] } }),
  });
  const trigger = () => byClass(handle.tree, 'dbc-amount');
  const event = () => ({ currentTarget: { getBoundingClientRect: () => ({ ...TRIGGER_BOX }) } });
  /** Arms a dwell with a captured timer, so the test never waits for it. */
  const arm = (invoke) => {
    const realSetTimeout = globalThis.setTimeout;
    let timer = null;
    let delay = -1;
    globalThis.setTimeout = (fn, ms) => {
      timer = fn;
      delay = ms;
      return 1;
    };
    try {
      invoke();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    return { delay, fire: timer };
  };

  check('a settled card draws no bubble', byClass(handle.tree, 'dbc-tip'), null);
  check('the balance trigger is keyboard reachable', trigger().props.tabIndex, 0);
  check('the balance trigger takes hover handlers', typeof trigger().props.onMouseEnter, 'function');

  // Hover arms the dwell instead of opening at once.
  const hover = arm(() => trigger().props.onMouseEnter(event()));
  await handle.pump();
  check('a hover only arms the bubble', byClass(handle.tree, 'dbc-tip'), null);
  check('the hover dwell is 240 ms', hover.delay, 240);
  check('the hover armed one timer', typeof hover.fire, 'function');
  hover.fire();
  const opened = await handle.pump();
  check('the armed hover draws the bubble', byClass(opened, 'dbc-tip') !== null, true);

  // Leaving the trigger is the only way out: the bubble takes no pointer events.
  trigger().props.onMouseLeave();
  const left = await handle.pump();
  check('a mouse leave closes the bubble', byClass(left, 'dbc-tip'), null);

  // Focus dwells shorter than the pointer does.
  const focus = arm(() => trigger().props.onFocus(event()));
  await handle.pump();
  check('a focus only arms the bubble', byClass(handle.tree, 'dbc-tip'), null);
  check('the focus dwell is 90 ms', focus.delay, 90);
  focus.fire();
  const focused = await handle.pump();
  check('the armed focus draws the bubble', byClass(focused, 'dbc-tip') !== null, true);

  trigger().props.onKeyDown({ key: 'Escape' });
  const escaped = await handle.pump();
  check('escape closes the bubble', byClass(escaped, 'dbc-tip'), null);

  // Blur closes it too, so tabbing away never leaves it behind.
  const again = arm(() => trigger().props.onFocus(event()));
  again.fire();
  await handle.pump();
  trigger().props.onBlur();
  const blurred = await handle.pump();
  check('blur closes the bubble', byClass(blurred, 'dbc-tip'), null);

  // A chip owns its bubble even though it is not a text trigger.
  const chip = byClass(handle.tree, 'dbc-chip');
  check('a chip is not a text trigger', chip.props.className.split(' ').includes('dbc-tip-trigger'), false);
  check('a chip still carries the handlers', typeof chip.props.onMouseEnter, 'function');
  check(
    'the period bubble spells out the window',
    await tipOf(handle, 'dbc-chip'),
    '高峰 | 周一至周五 09:00-12:00\n14:00-18:00 | 空闲 | 其余所有时段 | 数据来源 | iCloud 中国大陆日历 | 北京时间，不含法定节假日',
  );

  // One bubble for the whole model line, not one per row.
  const modelTip = await openTip(handle, 'dbc-model');
  check(
    'the model line draws a single bubble',
    findAll(modelTip.tree, (node) => typeof node.props.className === 'string' && node.props.className.split(' ').includes('dbc-tip')).length,
    1,
  );
}

{
  // The make-up chip's bubble is a single sentence: no rows, so no hairline.
  const handle = await mount({ now: Date.parse('2026-10-10T02:30:00Z'), balance: READY_BALANCE, catalog: CATALOG, data: null });
  const { bubble } = await openTip(handle, 'dbc-chip-makeup');
  check('the make-up bubble has no rows', tipRows(bubble).length, 0);
  check('the make-up bubble has no rule', findAll(bubble, (node) => node.props.className === 'dbc-tip-rule').length, 0);
  check('the make-up bubble is its note', text(byClass(bubble, 'dbc-tip-note')), '调休日按周末处理，全天不计高峰。');
}

console.log(failures === 0 ? '\nclient: ALL CHECKS PASSED' : '\nclient: ' + failures + ' CHECK(S) FAILED');
process.exitCode = failures === 0 ? 0 : 1;
