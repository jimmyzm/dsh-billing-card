---
name: billing-regression-testing
description: Extend and keep green this repository's offline suite — billing windows, money precision, provider → balance selection, price and calendar parsing, currency selection, fallbacks, and card rendering.
whenToUse: Touching periodAt, nextSwitchAt, PEAK_WINDOWS, the holiday or make-up data, formatAmount, billsOnOpenPlatform, billsAtListPrice, parsePricingHtml, parseHolidayCalendar, currencyOf, priceFormatter, truncateCents, or a fixture; or a bug that needs a failing assertion before the fix.
---

# Billing regression testing

The suite is the executable form of the eight **Invariants** in `AGENTS.md`. A billing rule is never renegotiated in
a test: when a case and an invariant disagree, the case is wrong.

## Start

```bash
npm test
```

Three files, one `PASS`/`FAIL` line per assertion. Note the count — it is the baseline the change is measured
against, and a dropping count is a lost guarantee, not a simplification.

## Layout of the suite

| File | Covers | How |
| --- | --- | --- |
| `test/parsers.test.mjs` | `parsePricingHtml`, `parseHolidayCalendar`, `toBeijingDate` | captured fixtures, pure calls |
| `test/host.test.mjs` | route lifecycle, payload shape, state machine | fake Cordis ctx + stubbed `globalThis.fetch` |
| `test/client.test.mjs` | billing rule, chips, currency, fallbacks, model switching | miniature React; `mount()` with an injected `now` |

Case table for the billing rule: `CASES` in `test/client.test.mjs` — rows of
`[name, Date.parse(instant), expected period, expected countdown string]` feeding the mounted card, so
`periodAt`/`nextSwitchAt` and the rendered chip are checked together.

## Deterministic inputs

Normative. A test that reaches for the network, a timer or the wall clock is flaky in CI and unprovable on a
reviewer's machine.

- **Time is an argument, never a global.** `mount()` takes `now`; every billing case passes the instant it names, kept
  on a whole second.
- **Beijing days come from epoch arithmetic** (`toBeijingDate`, `BEIJING_OFFSET_MS`), never from local getters. A case
  that passes in one machine's timezone only is a bug in the code under test — fix the code, do not pin `TZ`.
- **Fetch is stubbed per URL.** `host.test.mjs` replaces `globalThis.fetch` and throws on any URL it did not stub, so a
  stray new upstream fails loudly instead of reaching the network.
- **No timing sleeps.** Where a state machine needs "slow but eventually ready", resolve a promise the test holds
  rather than waiting on a timer.

## Fixture refresh

`test/fixtures/*` are captured copies of the official documents — never retype or hand-edit them.

1. Capture from the live source: `zh-pricing.html` and `en-pricing.html` from the two official pricing pages,
   `cn_zh.ics` from `https://calendars.icloud.com/holidays/cn_zh.ics`.
2. Record the URL, the capture date, and what actually changed upstream (a new model row, a reordered table, a new year
   of holidays) in the change description.
3. Re-run `npm test` and read the failures as the diff: parsed day counts, holiday names and price rows are asserted,
   so a refresh announces itself rather than sliding in.
4. Update the assertions to the new numbers. Never weaken one to `> 0` and never delete a case to reach green.
5. If a fixture now parses to `null`, the parser is wrong for the new format: fix it against the captured file, never
   the reverse.

## Cases

1. **One row per boundary.** The rule itself is **Invariant 3**; what a table must cover is the boundaries:
   `09:00:00`, `11:59:59`, `12:00:00`, `13:59:59`, `14:00:00`, `17:59:59`, `18:00:00` on every weekday, a Saturday, a
   Sunday, a mid-holiday day, a holiday's last day, a holiday overlapping a weekend, a make-up workday, and a day with
   two occasions. The make-up row is the trap: billed by the weekday rule, it renders idle with the gray chip.
2. **Assert the visible result**, not internals: chip class (`dbc-chip-peak` / `dbc-chip-idle` / `dbc-chip-makeup` /
   `dbc-holiday`), rendered text, countdown string, and the bubble substring that names the source.
3. **Parsers from labels, never cell indexes.**
   - Price tables: the label is the identity (`空闲时段`/`OFF-PEAK`, `缓存命中`/`CACHE HIT`, …), so a reordered table must
     still parse. Include "an unrelated leading table is skipped" and "a page with no price rows returns `null`".
   - Calendar: a minimal ICS string with `（休）`, `（班）`, folded lines, missing or stale `DTEND`, a range spanning a
     weekend, and two occasions on one day (`国庆节、中秋节`).
   - Keep the real fixtures as the end-to-end case: the parsed day and name counts from `test/fixtures/cn_zh.ics` are
     asserted, so a fixture refresh stays a deliberate act.
4. **Fallbacks assert both halves**: the snapshot value *and* the snapshot-labelled bubble. A card that silently shows
   the snapshot looks identical otherwise.
5. **Bubble bodies** can be driven as DOM, since the card draws its own: the trigger (`dbc-tip-trigger`), the rows
   (`dbc-tip-row` with `dbc-tip-label` / `dbc-tip-amount`), the `dbc-tip-rule` between rows and note, and the note.
   Assert the row count, not a string blob — a lost row hides inside a passing substring check.
6. **Currency**: locale → table (`zh`, `zh-CN`, `en`, `ja`), `priceFormatter` keeps three decimals for `0.003`, and a
   balance keeps its wallet currency with the ISO prefix only in non-Chinese UI. No test may assert a converted amount.
7. **Money precision, exact decimals.** `0.999` renders `¥0.99` (truncated toward zero once, not rounded); a `0.06` +
   `0.01` wallet pair keeps the cent a float sum would drop; a positive sub-cent total renders `¥不足 0.01` /
   `CNY under 0.01`, never `¥0.00`. Wallets in different currencies stay separate rows — no case adds across currencies.
8. **Provider → headline.** All three list-price ids (`deepseek`, `deepseek-account`, `deepseek-official`, in any case)
   price from the official table, but only `deepseek-official` headlines the open-platform balance. Assert both
   branches, a signed-out account falling back to the API balance, and a notice that is never rendered as an amount.
9. **Host state machine** through the stubbed fetch: every upstream ok, one failing, all failing,
   slow-but-eventually-ready, and non-GET/HEAD on the route.
10. A new case raises the count; replacing rows may only hold it level.

## Verification

- [ ] Gate green (`AGENTS.md` → **Working rules**), count at or above the baseline.
- [ ] Every new rule has a positive **and** a negative assertion — a holiday proves peak is suppressed *and* that the
      neighbouring workday is still peak.
- [ ] Each boundary row names its instant and its expected countdown, so a failure line explains itself.

## Failure handling

- Countdown off by a second: compare against the exact next-window boundary in the row, and keep the instant on a
  whole second.
- A fixture refresh changes counts: state the file, its source URL and date, and the new numbers, then update the
  assertions — never weaken one to `> 0`.
- Something untestable because it reaches for a global: extract the pure part into `parse.js` or a helper and test
  that, rather than mocking more of React.

## Never

The no-framework, no-snapshot, no-network and no-clock rules and the fixture provenance rule are in `AGENTS.md` →
**Working rules**. These are the ones only this skill can state:

- Assert on internals (`Set` contents, private helper returns) instead of the rendered card or the route payload.
- Use a tautology (`x > 0`, `!== undefined`) in place of an expected value.
- Mark a bug "not reproducible" without a failing row in `CASES` or a parser case.
