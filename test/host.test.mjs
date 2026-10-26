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
const upstream = {
  'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/': fixture('zh-pricing.html'),
  'https://api-docs.deepseek.com/quick_start/pricing/': fixture('en-pricing.html'),
  'https://calendars.icloud.com/holidays/cn_zh.ics': fixture('cn_zh.ics'),
};
const requested = [];
globalThis.fetch = async (url) => {
  const body = upstream[String(url)];
  requested.push(String(url));
  if (body === undefined) throw new Error('unexpected fetch: ' + url);
  return { ok: true, status: 200, text: async () => body };
};

// --------------------------------------------------------------- fake Cordis
/**
 * A Cordis-shaped context: services live in a registry, `inject` runs its body
 * now when every dependency is present and otherwise waits for the service,
 * and losing the service disposes what the body created.
 */
function makeHost(present) {
  const services = { logger: { warn: (message) => warnings.push(String(message)) } };
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

const get = await answer(routes[0], 'GET');
check('content type', get.headers['content-type'], 'application/json; charset=utf-8');
check('not cached', get.headers['cache-control'], 'no-store');
check('POST is rejected', (await answer(routes[0], 'POST')).status, 405);
check('HEAD is allowed', (await answer(routes[0], 'HEAD')).status, 200);

console.log(failures === 0 ? '\nhost: ALL CHECKS PASSED' : '\nhost: ' + failures + ' CHECK(S) FAILED');
process.exitCode = failures === 0 ? 0 : 1;
