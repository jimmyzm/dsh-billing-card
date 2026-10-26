/**
 * Host half of the DeepSeek billing card.
 *
 * Once per application start it reads the upstream sources the card shows — one
 * official price table per currency and the China mainland holiday calendar —
 * and serves the parsed result on a loopback route. The Client half fetches that
 * route on mount; when the route is absent (a Host without a web server, or an
 * older load of this plugin) the card keeps its built-in snapshot.
 *
 * Nothing here is on the request path: the fetch starts at activation, and the
 * route answers from memory, so the GUI never waits for the network.
 */
import {
  HOLIDAY_URL,
  PRICING_URLS,
  parseHolidayCalendar,
  parsePricingHtml,
  toBeijingDate,
} from './parse.js';

/**
 * Exact route the Client half reads. It keeps the product's name rather than the
 * package's so an in-place upgrade still talks to the route the running Host
 * already serves.
 */
export const DATA_PATH = '/deepseek-billing-card/data';
/** An upstream request may not hold the startup task longer than this. */
const FETCH_TIMEOUT_MS = 8000;
/** Currencies with an official price table, in the order the card prefers them. */
const CURRENCIES = ['CNY', 'USD'];

/**
 * Reads one upstream document as text.
 * @param url - the source.
 * @param accept - the Accept header to send.
 * @returns the body.
 * @throws when the request fails or answers a non-success status.
 */
async function readText(url, accept) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept },
  });
  if (!response.ok) throw new Error('HTTP ' + String(response.status));
  return response.text();
}

/**
 * Reports a failed source without failing activation.
 * @param ctx - the plugin context.
 * @param area - which source failed.
 * @param error - what went wrong.
 */
function warn(ctx, area, error) {
  const logger = ctx.logger;
  if (logger === undefined || logger === null || typeof logger.warn !== 'function') return;
  const reason = error instanceof Error ? error.message : String(error);
  logger.warn('[dsh-billing-card] ' + area + ' not refreshed: ' + reason);
}

/**
 * Answers the Client half with whatever this start found.
 * @param state - the shared startup result.
 * @returns the request handler.
 */
function dataHandler(state) {
  return (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const body = JSON.stringify(state);
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      'cache-control': 'no-store',
    });
    response.end(body);
  };
}

/**
 * Host half of the card: refresh every source once, then serve the result.
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
  const state = {
    status: 'loading',
    prices: { CNY: null, USD: null },
    holidays: null,
    sources: { 'pricing.CNY': 'pending', 'pricing.USD': 'pending', calendar: 'pending' },
    at: null,
  };

  /**
   * One official price table.
   * @param currency - the currency that page quotes.
   * @returns the parsed table, or `null` when the page could not be read.
   */
  async function loadPrices(currency) {
    try {
      const html = await readText(PRICING_URLS[currency], 'text/html');
      const table = parsePricingHtml(html, toBeijingDate(Date.now()), currency);
      if (table === null) throw new Error('the page did not carry the price table');
      return table;
    } catch (error) {
      warn(ctx, 'pricing (' + currency + ')', error);
      return null;
    }
  }

  async function loadHolidays() {
    try {
      const text = await readText(HOLIDAY_URL, 'text/calendar');
      const calendar = parseHolidayCalendar(text);
      if (calendar === null) throw new Error('the calendar carried no holiday entry');
      return calendar;
    } catch (error) {
      warn(ctx, 'calendar', error);
      return null;
    }
  }

  async function load() {
    const [tables, holidays] = await Promise.all([
      Promise.all(CURRENCIES.map((currency) => loadPrices(currency))),
      loadHolidays(),
    ]);
    let priced = 0;
    CURRENCIES.forEach((currency, at) => {
      state.prices[currency] = tables[at];
      state.sources['pricing.' + currency] = tables[at] === null ? 'failed' : 'ready';
      if (tables[at] !== null) priced += 1;
    });
    state.holidays = holidays;
    state.sources.calendar = holidays === null ? 'failed' : 'ready';
    state.status = priced === 0 && holidays === null ? 'failed' : 'ready';
    state.at = new Date().toISOString();
  }

  void load();

  // A nested injection, not an `inject` on this plugin: the web server may
  // activate after this half, or never exist in a deployment without one, and
  // either way the card itself must stay loaded. The route appears as soon as
  // a server is there and disappears with it.
  ctx.inject(['webServer'], (http) => {
    http.effect(
      () => http.webServer.register({ kind: 'exact', path: DATA_PATH, handler: dataHandler(state) }),
      'dsh-billing-card: data route',
    );
  });
}
