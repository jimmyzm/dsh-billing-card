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

- One trigger per visual row, and the trigger is that row's **label**, not the row: the balance
  label explains the balance, the model name explains the unit and the snapshot, and each chip
  explains itself. A row-wide anchor makes the bubble hang off the card edge instead of the word it
  belongs to, and fires while the pointer is over a number, which reads as accidental. Give the
  trigger `dbc-tip-trigger` (cursor + dotted underline) so the affordance is visible. Never attach
  the same label to two nested nodes, and never put a tooltip on the price block or the holiday
  banner — their text already says what they are.
- The body is a spec `{title, rows, note}` rendered as a titled list: a title line, one line per
  fact, and a footnote. Hover text appears after `delayMs: 400` (`focusDelayMs: 150` for
  keyboard focus) in a bubble capped at `maxWidth: 248`, left-aligned with the row it explains
  (`side: 'top'`, `align: 'start'`); the body caps at 232 px with 4/6 px of its own padding, so
  long sentences wrap instead of running across the sidebar. Emoji lead the title (`💰` balance,
  `⏱️` period, `🔁` make-up, `🏷️` model) — one per title, never inside a line.
- A row may carry a tone badge: `ok` green = recharge money, `warn` yellow = bonus money, `total`
  neutral = the sum. Every balance ends with `total`, including the open-platform balance — the
  card never invents a separate kind for it. No badge means a plain sentence, not a wallet. Never
  badge a row whose kind cannot be named.
- The bubble is dark in **both** themes (its text colour comes from the primitive, not the
  surface), so never colour text inside it with `--dsw-alias-label-*`: those tokens read as
  muddy grey on the dark fill. Keep `color: inherit` and de-emphasise with `opacity` (lines
  0.88, footnote 0.72); a badge is a translucent tint of its tone token with inherited text.
- The card and the bubble are not selectable (`user-select:none`): the numbers are read, not
  copied.
- A balance tooltip describes only the balance on the headline: its composition and refresh
  cadence. The account and API tooltips never mention each other. A notice is never followed by
  a tooltip.
- Provenance lives in one place: the calendar source belongs to the period chip, the price
  snapshot belongs to the model row.
- Use the DSH primitive, `require('@deepseek-ai/dsh-client-ui-primitives').Tooltip`
  (`label`, `side`, `align`, `maxWidth`), a platform seed module. The native `title` attribute is
  only the fallback for the offline harness. Never hand-roll a hover bubble.

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
- The Client half may only `require('react')` (rendering, `createElement`, no JSX) and the one
  platform seed it needs for hover text, `@deepseek-ai/dsh-client-ui-primitives`. No other
  module, no globals it does not guard.
- Style only with `--dsw-alias-*` theme tokens, and only inside the card's own subtree. Never
  restyle host or sibling plugin DOM, no iframe, no new npm dependency without an explicit OK.
- Every visible string needs a key in **both** dictionaries inside `client.js`
  (`//#region dictionaries`). `locale/zh.json` and `locale/en.json` carry plugin `meta` only
  (the name and description the plugin manager shows).

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
- **Ask the user before every `git commit`, `git push`, release, or npm publish.** This is a
  standing instruction, not a per-task one.
- Undo a pushed commit with `git revert`, never with a force-push.
- Keep `README.md` (English, default) and `README.zh-CN.md` in step: same sections, same table
  rows, cross-linked.
- Release notes lead with Chinese and then repeat the same sections in English; each language uses one
  emoji per section (`## ✨ 新增`, `## 🐛 修复`, `## 📦 打包` / `## ✨ New`, `## 🐛 Fixed`,
  `## 📦 Package`). They mirror the commits of that tag.
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
