/**
 * Host half tests: activation, the data route, and the payload it answers with.
 *
 * The two upstream pages and the calendar are served from test/fixtures by a
 * stubbed `fetch`, so the test never touches the network.
 *
 * Run with `node test/host.test.mjs`.
 */
import fs from 'node:fs';
import { apply, DATA_PATH } from '../index.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual));
}

// --------------------------------------------------------------- stub upstream
const fixture = (name) => fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const ZH_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/';
const EN_URL = 'https://api-docs.deepseek.com/quick_start/pricing/';
const CAL_URL = 'https://calendars.icloud.com/holidays/cn_zh.ics';
const upstream = {

  [ZH_URL]: fixture('zh-pricing.html'),
  [EN_URL]: fixture('en-pricing.html'),
  [CAL_URL]: fixture('cn_zh.ics'),
  'https://api.deepseek.com/user/balance': JSON.stringify({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
  }),
};
const requested = [];
const seen = [];
globalThis.fetch = async (url, init) => {
  const body = upstream[String(url)];
  requested.push(String(url));
  seen.push({ url: String(url), headers: (init === undefined ? {} : init.headers) ?? {} });
  if (body === undefined) throw new Error('unexpected fetch: ' + url);
  return { ok: true, status: 200, text: async () => body };
};

// --------------------------------------------------------------- fake Cordis
/**
 * A Cordis-shaped context: services live in a registry, `inject` runs its body
 * now when every dependency is present and otherwise waits for the service,
 * and losing the service disposes what the body created.
 */
function makeHost(present, sink = warnings) {
  const services = { logger: { warn: (message) => sink.push(String(message)) } };
  const active = [];
  const routes = [];
  const waiting = [];
  const server = {
    register(route) {
      routes.push(route);
      return () => {
        const index = routes.indexOf(route);
        if (index >= 0) routes.splice(index, 1);
      };
    },
  };
  if (present === true) services.webServer = server;
  const scope = (deps, disposers) => {
    const child = {
      get: (name) => services[name],
      effect: (callback) => {
        const dispose = callback();
        const release = typeof dispose === 'function' ? dispose : () => {};
        disposers.push(release);
        return release;
      },
      logger: services.logger,
    };
    for (const name of deps) child[name] = services[name];
    return child;
  };
  const ctx = {
    get: (name) => services[name],
    effect: (callback) => {
      const dispose = callback();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    logger: services.logger,
    inject(deps, callback) {
      const run = () => {
        const disposers = [];
        active.push({ deps, disposers });
        return callback(scope(deps, disposers));
      };
      if (deps.every((name) => services[name] !== undefined)) return run();
      waiting.push({ deps, run });
      return undefined;
    },
  };
  return {
    ctx,
    routes,
    server,
    provide(name, value) {
      services[name] = value;
      for (const item of waiting.splice(0)) {
        if (item.deps.every((dep) => services[dep] !== undefined)) item.run();
        else waiting.push(item);
      }
    },
    withdraw(name) {
      delete services[name];
      for (const entry of active.splice(0)) {
        if (!entry.deps.includes(name)) {
          active.push(entry);
          continue;
        }
        for (const release of entry.disposers) release();
      }
    },
  };
}

function answer(route, method) {
  return new Promise((resolve) => {
    const response = {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        resolve({ status: this.status, headers: this.headers, body });
      },
    };
    route.handler({ method }, response);
  });
}

// ------------------------------------------------------------------- wiring
const warnings = [];
const host = makeHost();
apply(host.ctx);
check('the card loads without a web server', host.routes.length, 0);
check('no warnings on the first request', warnings.length, 0);
host.provide('webServer', host.server);
check('the route appears with the web server', host.routes.length, 1);
check('route path', host.routes[0].path, DATA_PATH);
check('route kind', host.routes[0].kind, 'exact');

const early = makeHost(true);
apply(early.ctx);
check('an existing web server registers at once', early.routes.length, 1);
early.withdraw('webServer');
check('the route leaves with the web server', early.routes.length, 0);

// ------------------------------------------------------------------- payload
const routes = host.routes;
let payload = JSON.parse((await answer(routes[0], 'GET')).body);
for (let attempt = 0; attempt < 40 && payload.status === 'loading'; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  payload = JSON.parse((await answer(routes[0], 'GET')).body);
}
check('the host finished loading', payload.status, 'ready');
check('CNY source', payload.sources['pricing.CNY'], 'ready');
check('USD source', payload.sources['pricing.USD'], 'ready');
check('calendar source', payload.sources.calendar, 'ready');
check('all three sources were fetched', new Set(requested).size, 3);
check('live CNY prices', JSON.stringify(payload.prices.CNY.models['deepseek-flash'].idle), '{"input":1,"cacheRead":0.02,"output":4}');
check('live USD prices', JSON.stringify(payload.prices.USD.models['deepseek-flash'].idle), '{"input":0.15,"cacheRead":0.003,"output":0.6}');
check('each table carries its currency', payload.prices.CNY.currency + '/' + payload.prices.USD.currency, 'CNY/USD');
check('the read date is a date', /^\d{4}-\d{2}-\d{2}$/.test(payload.prices.CNY.asOf), true);
check('holiday days reach the client', payload.holidays.days.length > 80, true);
check('holiday names reach the client', Object.keys(payload.holidays.names).length > 80, true);
check('make-up days reach the client', payload.holidays.makeup.length > 15, true);
check('holiday years', payload.holidays.years.join(','), '2023,2024,2025,2026');
check('no API key means no open-platform balance', payload.sources.deepseek, 'unavailable');
check('the balance member is still present', payload.deepseek.status, 'unavailable');

// ------------------------------------------------------- with an API key
process.env.DEEPSEEK_API_KEY = 'sk-test-key';
const keyed = makeHost(true);
apply(keyed.ctx);
let withKey = JSON.parse((await answer(keyed.routes[0], 'GET')).body);
for (let attempt = 0; attempt < 40 && withKey.status === 'loading'; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  withKey = JSON.parse((await answer(keyed.routes[0], 'GET')).body);
}
check('the key unlocks the balance', withKey.sources.deepseek, 'ready');
check('balance amount', withKey.deepseek.total, '110.00');
check('balance currency', withKey.deepseek.currency, 'CNY');
check('balance split', withKey.deepseek.granted + '+' + withKey.deepseek.toppedUp, '10.00+100.00');
const balanceCall = seen.filter((call) => call.url === 'https://api.deepseek.com/user/balance').pop();
check('the key travels as a bearer token', balanceCall.headers.authorization, 'Bearer sk-test-key');
check('the balance request asks for JSON', balanceCall.headers.accept, 'application/json');

// A failing balance endpoint must not take the card down with it.
upstream['https://api.deepseek.com/user/balance'] = '{not json';
const broken = makeHost(true);
apply(broken.ctx);
let failed = JSON.parse((await answer(broken.routes[0], 'GET')).body);
for (let attempt = 0; attempt < 40 && failed.status === 'loading'; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  failed = JSON.parse((await answer(broken.routes[0], 'GET')).body);
}
check('a broken balance is reported per source', failed.sources.deepseek, 'failed');
check('and the rest of the payload still loaded', failed.status, 'ready');
check('the price tables survive it', failed.prices.CNY.models['deepseek-flash'].idle.input, 1);
delete process.env.DEEPSEEK_API_KEY;

const get = await answer(routes[0], 'GET');
check('content type', get.headers['content-type'], 'application/json; charset=utf-8');
check('not cached', get.headers['cache-control'], 'no-store');
check('POST is rejected', (await answer(routes[0], 'POST')).status, 405);
check('HEAD is allowed', (await answer(routes[0], 'HEAD')).status, 200);

// --------------------------------------------------------- upstream failures
/**
 * A fetch stub whose per-URL behaviour the caller overrides: a fixture by
 * default, or a thrown network error, a non-2xx status, an empty body, or a
 * request that only ends when its AbortSignal fires.
 */
function stub(overrides = {}) {
  return async (url, init) => {
    const spec = overrides[String(url)] === undefined ? {} : overrides[String(url)];
    if (spec.network === true) throw new Error('upstream unreachable');
    if (spec.status !== undefined) return { ok: false, status: spec.status, text: async () => '' };
    if (spec.hang === true) {
      return new Promise((resolve, reject) => {
        const signal = init === undefined ? undefined : init.signal;
        if (signal === undefined) return;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    const body = spec.body !== undefined ? spec.body : upstream[String(url)];
    if (body === undefined) throw new Error('unexpected fetch: ' + url);
    return { ok: true, status: 200, text: async () => body };
  };
}

/** Apply the host against a stubbed upstream and wait for a settled payload. */
async function loadWith(overrides) {
  const sink = [];
  const instance = makeHost(true, sink);
  const realFetch = globalThis.fetch;
  globalThis.fetch = stub(overrides);
  try {
    apply(instance.ctx);
    let current = await answer(instance.routes[0], 'GET');
    let body = JSON.parse(current.body);
    for (let attempt = 0; attempt < 100 && body.status === 'loading'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      current = await answer(instance.routes[0], 'GET');
      body = JSON.parse(current.body);
    }
    return { payload: body, sink, response: current };
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('\n-- one upstream down at a time');
{
  const { payload: deadCny, sink } = await loadWith({ [ZH_URL]: { network: true } });
  check('a dead CNY page: status is ready', deadCny.status, 'ready');
  check('a dead CNY page: that source failed', deadCny.sources['pricing.CNY'], 'failed');
  check('a dead CNY page: the USD source is live', deadCny.sources['pricing.USD'], 'ready');
  check('a dead CNY page: the calendar is live', deadCny.sources.calendar, 'ready');
  check('a dead CNY page: no CNY table', deadCny.prices.CNY, null);
  check('a dead CNY page: the USD table survives', deadCny.prices.USD.models['deepseek-flash'].idle.input, 0.15);
  check('a dead CNY page: one warning', sink.length, 1);
  check(
    'a dead CNY page: the warning names that source only',
    sink[0].slice(0, '[dsh-billing-card] pricing (CNY) not refreshed:'.length),
    '[dsh-billing-card] pricing (CNY) not refreshed:',
  );
}
{
  const { payload: deadUsd, sink } = await loadWith({ [EN_URL]: { status: 503 } });
  check('a 503 USD page: status is ready', deadUsd.status, 'ready');
  check('a 503 USD page: that source failed', deadUsd.sources['pricing.USD'], 'failed');
  check('a 503 USD page: the CNY source is live', deadUsd.sources['pricing.CNY'], 'ready');
  check('a 503 USD page: the calendar is live', deadUsd.sources.calendar, 'ready');
  check('a 503 USD page: no USD table', deadUsd.prices.USD, null);
  check('a 503 USD page: the CNY table survives', deadUsd.prices.CNY.models['deepseek-flash'].idle.input, 1);
  check('a 503 USD page: one warning', sink.length, 1);
  check('a 503 USD page: the warning reports the status', sink[0].includes('HTTP 503'), true);
  check('a 503 USD page: the warning names the USD source', sink[0].includes('pricing (USD)'), true);
}
{
  const { payload: deadCalendar, sink } = await loadWith({ [CAL_URL]: { network: true } });
  check('a dead calendar: status is ready', deadCalendar.status, 'ready');
  check('a dead calendar: that source failed', deadCalendar.sources.calendar, 'failed');
  check('a dead calendar: both price sources are live', deadCalendar.sources['pricing.CNY'] + '/' + deadCalendar.sources['pricing.USD'], 'ready/ready');
  check('a dead calendar: no holidays', deadCalendar.holidays, null);
  check('a dead calendar: both tables survive', deadCalendar.prices.CNY.currency + '/' + deadCalendar.prices.USD.currency, 'CNY/USD');
  check('a dead calendar: one warning', sink.length, 1);
  check('a dead calendar: the warning names the calendar', sink[0].slice(0, '[dsh-billing-card] calendar not refreshed:'.length), '[dsh-billing-card] calendar not refreshed:');
}

console.log('\n-- every upstream down');
{
  const { payload: allDown, sink, response } = await loadWith({
    [ZH_URL]: { network: true },
    [EN_URL]: { network: true },
    [CAL_URL]: { network: true },
  });
  check('all down: status is failed', allDown.status, 'failed');
  check('all down: CNY failed', allDown.sources['pricing.CNY'], 'failed');
  check('all down: USD failed', allDown.sources['pricing.USD'], 'failed');
  check('all down: calendar failed', allDown.sources.calendar, 'failed');
  check('all down: no CNY table', allDown.prices.CNY, null);
  check('all down: no USD table', allDown.prices.USD, null);
  check('all down: no holidays', allDown.holidays, null);
  check('all down: the payload is timestamped', /^\d{4}-\d{2}-\d{2}T/.test(allDown.at), true);
  check('all down: three warnings', sink.length, 3);
  check('all down: the route still answers 200', response.status, 200);
  check('all down: the route still answers JSON', response.headers['content-type'], 'application/json; charset=utf-8');
  check('all down: the shape is unchanged', Object.keys(allDown).sort().join(','), 'at,deepseek,holidays,prices,sources,status');
}

console.log('\n-- empty and unparsable bodies');
{
  const { payload: empty, sink } = await loadWith({ [ZH_URL]: { body: '' }, [EN_URL]: { body: '' }, [CAL_URL]: { body: '' } });
  check('empty bodies: status is failed', empty.status, 'failed');
  check('empty bodies: all sources failed', Object.values(empty.sources).join(','), 'failed,failed,failed,unavailable');
  check('empty bodies: three warnings', sink.length, 3);
  check('empty bodies: two pages carried no price table', sink.filter((line) => line.includes('did not carry the price table')).length, 2);
  check('empty bodies: the calendar carried no entry', sink.filter((line) => line.includes('carried no holiday entry')).length, 1);
}
{
  const { payload: unparsable, sink } = await loadWith({
    [ZH_URL]: { body: '<html><body><p>maintenance</p></body></html>' },
    [EN_URL]: { body: '<table><tr><td>API</td><td>rate limit</td></tr></table>' },
    [CAL_URL]: { body: 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:立春\nDTSTART;VALUE=DATE:20260204\nEND:VEVENT\nEND:VCALENDAR\n' },
  });
  check('unparsable bodies: status is failed', unparsable.status, 'failed');
  check('unparsable bodies: the HTML page is a failed source', unparsable.sources['pricing.CNY'], 'failed');
  check('unparsable bodies: the table without prices is a failed source', unparsable.sources['pricing.USD'], 'failed');
  check('unparsable bodies: the calendar without a marker is a failed source', unparsable.sources.calendar, 'failed');
  check('unparsable bodies: three warnings', sink.length, 3);
}

console.log('\n-- a hanging upstream');
{
  const realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => realTimeout.call(AbortSignal, Math.min(ms, 25));
  try {
    const { payload: hanging, sink } = await loadWith({ [ZH_URL]: { hang: true } });
    check('a hanging page: that source failed', hanging.sources['pricing.CNY'], 'failed');
    check('a hanging page: the payload is still ready', hanging.status, 'ready');
    check('a hanging page: the USD source is live', hanging.sources['pricing.USD'], 'ready');
    check('a hanging page: the calendar is live', hanging.sources.calendar, 'ready');
    check('a hanging page: no CNY table', hanging.prices.CNY, null);
    check('a hanging page: one warning', sink.length, 1);
    check(
      'a hanging page: the warning names that source',
      sink[0].slice(0, '[dsh-billing-card] pricing (CNY) not refreshed:'.length),
      '[dsh-billing-card] pricing (CNY) not refreshed:',
    );
  } finally {
    AbortSignal.timeout = realTimeout;
  }
}

console.log(failures === 0 ? '\nhost: ALL CHECKS PASSED' : '\nhost: ' + failures + ' CHECK(S) FAILED');
process.exitCode = failures === 0 ? 0 : 1;
