---
name: billing-regression-testing
description: Extend and keep green this repository's offline test suite — billing windows, price/calendar parsing, currency selection, fallbacks, and card rendering. Use when changing those rules or when fixing a bug that needs a failing case first.
whenToUse: Use when touching periodAt, nextSwitchAt, PEAK_WINDOWS, HOLIDAY/MAKEUP data, parsePricingHtml, parseHolidayCalendar, currencyOf, priceFormatter, truncate, or when a bug report needs a reproducible assertion before the fix.
---

# Billing regression testing

## When to use

Any change to how the card decides peak vs idle, which currency it quotes, how it parses the
official pricing pages or the iCloud holiday calendar, or how it renders when an upstream is
missing. Also use it as the first step of any bug fix: write the assertion that fails, then fix.

## Triggers

- A billing-rule change (windows, holiday handling, make-up workdays).
- A price-table or calendar format change upstream, or a refreshed `test/fixtures/*`.
- A bug report about a wrong chip, wrong price, wrong currency, wrong countdown.
- Removing or renaming anything in `parse.js` or in the Client's data-selection block.

## Preconditions

- Run the suite first and remember the number:
  ```bash
  npm test
  ```
  It is fully offline and deterministic: three files, one `PASS`/`FAIL` line per assertion.
- Read `AGENTS.md` invariants 1–6. The tests are the executable form of those invariants.

## Layout of the suite

| File | Covers | How |
| --- | --- | --- |
| `test/parsers.test.mjs` | `parsePricingHtml`, `parseHolidayCalendar`, `toBeijingDate` | captured fixtures, pure calls |
| `test/host.test.mjs` | route lifecycle, payload shape, state machine | fake Cordis ctx + stubbed `globalThis.fetch` |
| `test/client.test.mjs` | billing rule, badges, currency, fallbacks, model switching | miniature React; `mount()` with an injected `now` |

Case table for the billing rule: `CASES` in `test/client.test.mjs` (rows of
`[name, Date.parse(instant), expected period, expected countdown string]`) feeding the mounted
card, so `periodAt`/`nextSwitchAt` and the rendered chip are checked together.

## Steps

1. Add one row per decision boundary you care about. The rule is
   Beijing Mon–Fri 09:00–12:00 and 14:00–18:00, weekends and `（休）` days idle all day. The
   period test consults weekends and `（休）` days only: a `（班）` day is billed by the weekday
   rule, and every 2025–2026 make-up day falls on a weekend, so it renders idle with the gray
   chip. Boundaries to keep: `09:00:00`, `11:59:59`, `12:00:00`, `13:59:59`,
   `14:00:00`, `17:59:59`, `18:00:00`, a Sunday, a Saturday, a mid-holiday day, a holiday's last
   day, a holiday that overlaps a weekend, a make-up workday, and a day with two occasions.
2. Assert the externally visible result, not internals: chip class (`dbc-chip-peak` /
   `dbc-chip-idle` / `dbc-chip-makeup` / `dbc-holiday`), rendered text, countdown string, and the
   tooltip substring that names the source.
3. Parser cases: build them from rows and labels, never from a cell index.
   - Price tables: the label is the identity (`空闲时段`/`OFF-PEAK`, `缓存命中`/`CACHE HIT`, …), so
     a reordered table must still parse. Include "an unrelated leading table is skipped" and
     "a page with no price rows returns null".
   - Calendar: a minimal ICS string with `（休）`, `（班）`, folded lines, missing or stale `DTEND`,
     a range spanning a weekend, and two occasions on one day (`国庆节、中秋节`).
   - Keep the real fixtures as the end-to-end case: the parsed day/name counts from
     `test/fixtures/cn_zh.ics` are asserted, so a fixture refresh is a deliberate act.
4. Fallback cases must assert **both** halves: the snapshot value *and* the snapshot-labelled
   tooltip. A card that silently shows the snapshot looks identical otherwise.
5. Hover bodies: the card draws its own bubble, so a test can drive it as DOM — the trigger
   (`dbc-tip-trigger`), the rows (`dbc-tip-row` with `dbc-tip-label` / `dbc-tip-amount`), the
   `dbc-tip-rule` between rows and note, and the note itself. Assert the row count, not a string
   blob, or a lost row hides inside a passing substring check.
6. Currency cases: assert locale → table (`zh`, `zh-CN`, `en`, `ja`), that the price formatter
   keeps three decimals for `0.003`, and that the balance stays in its wallet currency with the
   ISO prefix only in non-Chinese UI. No test may assert a converted amount.
7. Host cases: drive the state machine through the stubbed fetch — every upstream ok, one
   failing, all failing, slow-but-eventually-ready, and non-GET/HEAD on the route.
8. Re-run `npm test`; the assertion count must go up (or stay equal if you only replaced rows),
   and `FAIL` must be zero.

## Verification

- `node --check index.js && node --check parse.js && node --check client.js && npm test` from a clean tree.
- Each new rule has at least one positive **and** one negative assertion (a holiday must prove
  peak is suppressed *and* that the neighbouring workday is still peak).
- Every boundary case names the instant and the expected countdown in the row, so a failure line
  is self-explanatory.
- The suite must not touch the network, sleep, or read the wall clock. `mount()` takes `now`;
  `host.test.mjs` replaces `globalThis.fetch` and throws on any URL it did not stub.

## Failure handling

- A case that passes only in one machine's timezone: the code under test must derive the Beijing
  day from epoch arithmetic (`toBeijingDate`, `BEIJING_OFFSET_MS`), not from local getters — fix
  the code, don't pin `TZ`.
- Countdown expectations off by a second: compare against the exact next-window boundary in the
  row, and keep the instant at a whole second.
- A fixture refresh that changes counts: state which file, its source URL and date, and the new
  numbers, then update assertions to match — never weaken the assertion to `> 0`.
- Something untestable because it reaches for a global: extract the pure part into `parse.js` or
  a helper and test that, rather than mocking more of React.

## Prohibited

- Adding a test framework, a runner, coverage tooling, or snapshot directories.
- Real network calls, `setTimeout`-based waits, or reading the current time in an assertion.
- Editing `test/fixtures/*` by hand, or deleting/loosening an assertion to get to green.
- Asserting on internals (`Set` contents, private helper returns) instead of the rendered card or
  the payload the route answers with.
- Tautological checks (`x > 0`, `!== undefined`) as a substitute for an expected value.
- Marking a bug "not reproducible" without a failing row in `CASES` or a parser case.
