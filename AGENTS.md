# AGENTS.md — @jimmyzm/dsh-billing-card

DSH (DeepSeek Harness) sidebar plugin: a card in the sidebar footer showing the DeepSeek
account balance (or the open-platform balance behind your API key), the current model's unit
prices, and the live peak/idle billing window with a countdown. No build step, no runtime dependencies, no bundler — three plain ES modules.

Start here. Open the session with the repository root as the working directory: DSH discovers
`AGENTS.md` and `.agents/skills/` by walking up from the session `cwd` to the nearest `.git`,
so a session rooted at the parent folder loads neither.

## Non-negotiable invariants

1. **Never invent money or calendar data.** Prices come only from the official pricing pages
   (CNY: `api-docs.deepseek.com/zh-cn/quick_start/pricing/`, USD:
   `api-docs.deepseek.com/quick_start/pricing/`); holidays only from the iCloud China holiday
   calendar (`（休）` = day off, `（班）` = make-up workday). Everything else is the built-in
   snapshot in `client.js`, and the tooltip must label it as the snapshot.
2. **No currency conversion, ever.** There is no FX source. Chinese-family locales read the CNY
   table, every other locale reads the USD table; the balance keeps its wallet currency and a
   non-Chinese UI prefixes the ISO code (`CNY ¥32.50`).
3. **The billing rule is fixed.** Beijing time (UTC+8) Monday–Friday 09:00–12:00 and
   14:00–18:00 = peak; weekends and statutory holiday days (`（休）`) are idle all day. The period
   test consults weekends and `（休）` days only — a make-up workday (`（班）`) is billed by the
   weekday rule, and because every 2025–2026 make-up day in the official calendar falls on a
   weekend, it renders idle. The gray 调休 chip exists to explain that state. In the calendar data
   a `（休）` day always beats a `（班）` day: a day never appears in both sets.
4. **Money math is exact.** Wallet totals are summed as decimal strings and truncated toward
   zero exactly once; a positive sub-cent total renders 「不足 0.01」/「under 0.01」. Never use
   float addition, never truncate per wallet.
5. **A balance needs a billing provider, and the tooltip needs the balance.** The provider
   decides the headline: a `deepseek-official` model is billed by the open platform, so the API
   balance leads there (「未配置 API Key」/「读取失败，稍后重试」 when it cannot answer); every other
   provider leads with the DSH account balance, and a signed-out account falls back to the API
   balance instead of a blank. The balance test is `billsOnOpenPlatform` — exactly
   `deepseek-official` — and is deliberately narrower than the price test `billsAtListPrice`:
   `deepseek` and `deepseek-account` still bill like the official table but are not the open
   platform, so they headline the account balance. A notice is never dressed up as an amount.
6. **A list price needs a DeepSeek provider.** The table is DeepSeek's own, so the card quotes
   a price only while the provider bills at it — `OFFICIAL_PROVIDERS` in `client.js` is the
   explicit set `deepseek-account`, `deepseek-official`, `deepseek` (compared case-insensitively),
   and an unknown provider keeps pricing what it knows. Do not widen it to a substring match:
   a lookalike id such as `llm-deepseek` belongs to somebody else. A DeepSeek model served
   by any other provider shows 「该渠道不走官方价目」/「This provider has no list price」; a model the
   table simply lacks keeps 「官方价目未收录该模型」/「No official price for this model」.
7. **Fallbacks are per source.** If the USD page fails while the CNY page and the calendar
   succeed, the card still renders: live where it is live, snapshot where it is not. One failed
   upstream must not blank the others.
8. **A merely-wrong payload must degrade, not crash.** Every field that crosses the loopback
   route is re-validated by `readPriceBook` / `readHolidays` / `readRemote` on the Client side.

## Hover text

Hover text is the card's only place for the long explanation, so it follows the rows.

- One trigger per visual row, and the trigger is the thing the row is about. The amount explains
  the balance — a `dbc-tip-plain` trigger with cursor help and a focus ring but **no** dashed
  underline, because the number is already the loudest element and a second affordance reads as a
  link — and that trigger is the inline box around the money, never the row: `.dbc-amount-row`
  lays out and `.dbc-amount` answers, so a pointer 100 px right of `¥32.50` is not over the
  balance. The model name explains the unit and the snapshot, and each chip explains itself. A row-wide anchor
  makes the bubble hang off the card edge instead of the word it belongs to, and fires while the
  pointer is over a number, which reads as accidental. Text triggers that need advertising take
  `dbc-tip-trigger` (cursor + dashed underline); a chip is its own affordance and takes the
  handlers without a class. Never attach the same label to two nested nodes, and never put a
  tooltip on the price block or the holiday banner — their text already says what they are.
- Hover text states a fact about *this* card, so it must not outlive its truth: the model bubble
  belongs to an official provider only. Another provider bills its own account, and the card's
  numbers are then a list-price reference, not that provider's rates — so `.dbc-model` gets neither
  the class nor the handlers when `billsAtListPrice(provider)` is false.
- The card draws its own bubble. The host primitive was borrowed until 1.3: its surface is a fixed
  dark plate in both themes, which pins one element of a card that owns its light/dark palette to
  somebody else's chrome. Do not reintroduce `@deepseek-ai/dsh-client-ui-primitives`, and do not
  hand the bubble back to a native `title` either — the platform text is unstyleable and cannot
  hold a definition list.
- The body is a spec `{rows, note?}` rendered as a definition list, because a tooltip in this card
  always answers "what is this made of": one `label → value` row per fact (label 11 px in
  `--dbc-ink-3`, value right-aligned on a shared edge, both tabular), then a hairline plus an 11 px
  footnote in `--dbc-ink-3` for provenance. The hairline is `color-mix(ink-1 12%)`, not `--dbc-line`:
  at 12 % it reads as a separator on the bubble's own fill, and a token typo paints nothing at all
  (that is how the rule stayed invisible once — `--dbc-line-2` was never declared, so
  `test/client.test.mjs` now fails when the stylesheet reads a `--dbc-*` it does not declare).
  A note without rows (the make-up chip) draws no rule: it has nothing to separate it from. No head,
  no title, no total row: the card already shows
  the number, and the bubble only decomposes it. A value may carry `\n` (the peak window is two
  lines) — `.dbc-tip-amount` is `white-space:pre-line`, so a long value wraps right-aligned instead
  of pushing the label off the edge.
- Mechanics: `position:fixed` inside the card (no portal, so the sidebar cannot clip it), placed
  before paint above the trigger, flipped below when there is no room, clamped `8 px` from the
  viewport edge, with an 8 px diamond arrow on the edge **facing the trigger** — bottom edge and apex
  down while the bubble sits above the word, top edge and apex up once it has flipped below. The
  edge follows the placement; an arrow on the far side points away from what it explains. `z-index:2147483000` keeps it
  above the shell's own layers. `pointer-events:none` means the pointer can never enter the bubble,
  which is what makes leaving the trigger the only way it closes.
- The pointer points at the trigger's **centre**, and it is measured, not assumed: the bubble
  centres on that centre, and the arrow is placed at `centre - left - 4 px` because the apex of an
  8 px diamond sits 4 px into its own box. Two rules keep it honest — a second pass re-measures
  the painted bubble and shifts it by whatever the browser did (any ancestor with a `transform`,
  `filter` or `will-change` turns `fixed` into a local coordinate system), and the arrow is dropped
  rather than clamped when the trigger's centre ends up outside the bubble: a pointer that lands
  beside its word is worse than no pointer. The pointer is deliberately quiet: 8 px, the bubble's
  own fill, and a `10%` ink hairline on its two outer edges — no `--dbc-line-2`, no drop shadow.
  The bubble's shadow already separates it from the sidebar; adding another one to the notch turns
  a hint into a badge.
- Timing: `TIP_DELAY_MS = 240` on hover, `TIP_FOCUS_DELAY_MS = 90` on keyboard focus, cancelled by
  leave, blur, or `Escape` (listened for on the window, so the card does not need focus).
- A row may carry a tone **dot** (5 px, not a pill): `ok` green = recharge money, `warn` yellow =
  bonus money. A row without a dot is a plain fact. Pills were tried and dropped: at 11 px they read
  as cramped labels and their widths made the amounts miss the shared right edge.
- The bubble uses the card's own tokens (`--dbc-surface`, `--dbc-line`, `--dbc-ink-1/3`,
  `--dbc-green`, `--dbc-amber`), so it follows the theme like everything else. Never colour bubble
  text with `--dsw-alias-*`.
- The card and the bubble are not selectable (`user-select:none`): the numbers are read, not
  copied.
- A balance tooltip describes only the balance on the headline: its composition and refresh
  cadence. The account and API tooltips never mention each other. A notice is never followed by
  a tooltip.
- Provenance lives in one place: the calendar source belongs to the period chip, the price
  snapshot belongs to the model row.

## Layout and compatibility guards

- `engines.dsh` in `package.json` must list each prerelease line explicitly
  (`>=0.2.0-rc.1 <0.3.0-0 || >=0.2.1-0 <0.3.0-0`): a plain `>=0.2.0-rc.1` rejects every later
  prerelease under the semver rule that a prerelease only satisfies a range naming that exact
  `major.minor.patch` with a prerelease. Keep the range honest — it is what blocks a DSH build
  the card was never tested on.
- `DATA_PATH = '/deepseek-billing-card/data'` is frozen across the package rename. Do not
  rename it: an in-place upgrade depends on a still-running Host answering the old path.
- Never add `webServer` to `dsh.client.inject` in `package.json`, and never register the route
  at plugin top level. The Host half must nest `ctx.inject(['webServer'], …)` so the route activates when the
  web server appears and disappears with it.
- The Host half is cached per process: a change to `index.js` or `parse.js` needs a full app
  restart to take effect. `client.js` lands on a page refresh. Say which one you changed instead
  of claiming a change is live.
- The Client half may only `require('react')` (rendering, `createElement`, no JSX). No other
  module, no globals it does not guard — the hover bubble is drawn here, so there is no platform
  seed left to require.
- `wide` is a prop, not a mount gate. The component must ask for the same hooks whether or not
  the sidebar is expanded, so the `if (!wide) return null` sits **after** every hook (currently at
  the top of the returned tree). Returning earlier skips the bubble's hooks, and the next expand
  throws "Rendered more hooks than during the previous render" — React then tears the subtree
  down and the card is gone until the page reloads. The data effect is `[]` on purpose: a
  collapse must not blank the table for the frame it takes to re-ask the route.
- The card owns its palette. `CARD_CSS` declares `--dbc-*` tokens on `.dbc-root` with
  `light-dark(light, dark)` values; the app writes `color-scheme` on `<html>`
  (`document.documentElement.style.colorScheme`), so the tokens resolve without reading a host
  variable. Do not reintroduce `--dsw-alias-*` into the card: the one exception is the layout
  the slot gives us, which the card never styles.
- Style only inside the card's own subtree. Never restyle host or sibling plugin DOM, no iframe,
  no new npm dependency without an explicit OK.
- Every visible string needs a key in **both** dictionaries inside `client.js`
  (`//#region dictionaries`). `locale/zh.json` and `locale/en.json` carry plugin `meta` only
  (the name and description the plugin manager shows).

## Design scale

The card's CSS is a system, not a bag of values picked per element. Every value comes from
these lists; to make something bigger, move it one step instead of inventing a half step.

- **Token layer**: one palette on `.dbc-root` — `--dbc-surface` `-2` `-3`, `--dbc-line`,
  `--dbc-ink-1` `-2` `-3`, `--dbc-green` `-green-bg`, `--dbc-amber` `-amber-bg`, `--dbc-blue`,
  `--dbc-r-card` `-inner` `-tag`, `--dbc-font`. Every rule reads these, never a raw hex.
- **Type**: `11 / 13 / 17 / 20 px` with line heights `14 / 16 / 22 / 25`. 11 is labels, meta,
  provider, model and the countdown; 13 is a price value; 17 is the amount when it would
  otherwise overflow; 20 is the amount. No `10.5px`, no `em`/`rem`.
- **Weight**: `400` body, `500` for the two things a glance must catch (the model name and the
  period chip), `650`+ for numbers that carry money.
- **Spacing**: `12px` card padding, `8px 10px` for the price panel, `6px` flex gap, `5px`
  inside the holiday strip, `4px` between chips. Space around a group exceeds space within it.
- **Radius**: `14px` card, `10px` price panel, `8px` holiday strip, `6px` make-up tag, `999px`
  chips.
- **Layout is one row per fact**: countdown + chips, amount, provider, model, prices. The card
  prints no balance label — the amount is the loudest thing on it and names itself; the word
  survives as the amount row's `aria-label` (`card.title` / `card.title.api`) so a screen reader
  still hears what the number is. The amount never shares a line with the countdown — that pair is
  what clipped six-digit balances at 196 px — and the countdown sits top-left, opposite the chips,
  because it is the one value that moves every second.
- **Contrast floor**: 4.5:1 for every text colour on the surface it lands on, in both themes.
  Measured: `--dbc-ink-1` 17.8 / 15.0, `-ink-2` 7.3 / 10.4, `-ink-3` 5.1 / 7.0 (and 4.7 / 6.2 on
  `-surface-2`), chip text 4.7 green / 4.6 amber on its own tint (7.5 / 7.7 dark), blue 6.7 /
  8.0. Recompute before changing a hex; a prettier hue is not a reason to drop below 4.5.
- **The countdown takes the current period's colour** (`--dbc-green` when idle, `--dbc-amber`
  when peak), matching the chip it sits opposite, and it always carries its `距高峰` / `距空闲`
  wording. A bare clock next to the model reads as a duration; do not drop the label.
- **Truncation order**: the amount shrinks one step (`dbc-amount-small`) past
  `AMOUNT_SMALL_AT` characters, the holiday name ellipsizes while its `M/D · 空闲全天` meta
  stays, the model ellipsizes last. The countdown never truncates.

## Shape of the code

| File | Role | Changes need |
| --- | --- | --- |
| `index.js` | Host half: one fetch per upstream per process (8 s timeout), in-memory state, the loopback route | app restart |
| `parse.js` | Pure parsers: `parsePricingHtml`, `parseHolidayCalendar`, `toBeijingDate` — no I/O, no deps | app restart |
| `client.js` | Client half: the card, its dictionaries, its CSS, and the built-in fallbacks | page refresh |
| `test/` | Offline suite (`npm test`): parsers on captured fixtures, Host with a stubbed `fetch`, Client in a miniature React | none |
| `.agents/skills/` | Project skills for agents working on this repo | none |
| `docs/` | README logo and screenshots — repository only, never shipped | none |
| `CHANGELOG.md` / `CHANGELOG.zh-CN.md` | Release notes in both languages, newest first; shipped | none |

## Working rules

- Run `npm test` before proposing any change. It is offline, deterministic, and prints one
  `PASS`/`FAIL` line per assertion; the count must not drop.
- Do not add a test framework, a linter, a formatter, or a snapshot directory.
- Never edit `test/fixtures/*` by hand: they are captured copies of the official pages, and a
  refresh must state the URL, the date, and what changed.
- Keep `package.json` `files[]` to the runtime surface: `index.js`, `parse.js`, `client.js`,
  `cordis.patch.yml`, `locale/*.json`, `icon.svg`, the two READMEs, `LICENSE`. `test/`, `docs/`,
  `.agents/`, `AGENTS.md` and `.github/` stay out of the tarball.
- Commit style: `feat: …` / `fix: …` / `docs: …` / `test: …` / `ci: …` / `chore: …`, one
  behaviour per commit.
- **Keep the skills current on your own initiative.** When a task teaches something the next agent
  would otherwise repeat — a trap, the check that would have caught it, a new command, a new file —
  fold it into the matching skill under `.agents/skills/` in the same change instead of waiting to
  be asked. If it fits none of them, say so rather than inventing a fifth skill. These doc edits are
  the one exception to the next rule: commit and push them once `npm test` is green and nothing else
  is staged.
- **Ask the user before every `git commit`, `git push`, release, or npm publish** (except the skill
  documentation above). This is a standing instruction, not a per-task one.
- Undo a pushed commit with `git revert`, never with a force-push.
- Keep `README.md` (English, default) and `README.zh-CN.md` in step: same sections, same table
  rows, cross-linked.
- A release title is the bare tag in English (`v1.2.1`). Only a major feature update earns a headline
  after it, also in English (`v1.1.0 — ☁️ open-platform balance, provider-aware pricing`). The body,
  unlike the title, is always bilingual.
- Release notes lead with Chinese and then repeat the same sections in English; each language uses one
  emoji per section (`## ✨ 新增`, `## 🐛 修复`, and `## 📦 打包` or `## 📦 调整` when the section is
  changes rather than the package; English mirrors it with `## ✨ New`, `## 🐛 Fixed`,
  `## 📦 Package` / `## 📦 Changed`). They mirror the commits of that tag.
- Every release updates `CHANGELOG.md` and `CHANGELOG.zh-CN.md` together, adding the new version at
  the top with the same content as the release notes. The two files never drift.

## Route re-read cadence

The Client asks the Host route at mount and retries on a bounded budget
(`DATA_POLL_MS` × `DATA_POLL_LIMIT` while loading, × `DATA_FAIL_LIMIT` while failing). After
that it re-reads the route on the existing 30 s tick (`api.current.refreshRoute`), because the
Host re-reads the open-platform balance every 30 s (`BALANCE_REFRESH_MS`): without the re-read a card
loaded before a key was configured froze on 「未配置 API Key」 forever.

A provider switch asks at once, and asks for a *fresh* amount: `refreshRoute(true)` appends
`?balance=refresh`, which makes the Host start `loadDeepseekBalance()` before answering (at most one
read per `BALANCE_ASK_GAP_MS = 3000`, one in flight). The route still answers from memory, so the
GUI never waits on the network; when the amount is not ready yet the Client follows up
`BALANCE_ASK_LIMIT = 2` times at `BALANCE_ASK_MS = 1000`. Two things trigger that: a change of the
session's selection store (`watchSelection`, the composer), and any provider-surface event
(`watchUpstream` — `llm/adapters-updated`, `settings/document-updated`, `credentials/record-updated`,
`credentials/reference-updated`), because adding a provider or pasting a key changes which balance
pays without touching the selection. The periodic tick keeps asking the plain route — a read, not a
refresh. The fast bounded retries are still the only defence against a Host that registers its route
late; do not turn them into an unbounded fast poll.

## Pointers

- Behaviour, sources, and limits: `README.md` / `README.zh-CN.md`
- Skills: `.agents/skills/dsh-plugin-development`, `.agents/skills/billing-regression-testing`,
  `.agents/skills/release-verification`
