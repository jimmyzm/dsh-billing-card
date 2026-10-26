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
5. **A list price needs a DeepSeek provider.** The table is DeepSeek's own, so the card quotes
   a price only while the selected provider is `deepseek-account` or `deepseek-official`
   (`OFFICIAL_PROVIDERS` in `client.js`). A DeepSeek model served by any other provider shows
   the 「该渠道不走官方价目」/「This provider has no list price」 note instead — its prices belong to
   that provider. An unknown provider (no selection, no catalog) keeps pricing what it knows.
6. **Fallbacks are per source.** If the USD page fails while the CNY page and the calendar
   succeed, the card still renders: live where it is live, snapshot where it is not. One failed
   upstream must not blank the others.
7. **A merely-wrong payload must degrade, not crash.** Every field that crosses the loopback
   route is re-validated by `readPriceBook` / `readHolidays` / `readRemote` on the Client side.

## Layout and compatibility guards

- `DATA_PATH = '/deepseek-billing-card/data'` is frozen across the package rename. Do not
  rename it: an in-place upgrade depends on a still-running Host answering the old path.
- Never add `webServer` to `dsh.client.inject` in `package.json`, and never register the route
  at plugin top level. The Host half must nest `ctx.inject(['webServer'], …)` so the route activates when the
  web server appears and disappears with it.
- The Host half is cached per process: a change to `index.js` or `parse.js` needs a full app
  restart to take effect. `client.js` lands on a page refresh. Say which one you changed instead
  of claiming a change is live.
- The Client half may only `require('react')` and use `createElement` — no JSX, no other
  modules, no globals it does not guard.
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

## Known limitation to leave alone unless asked

The Client reads the Host route at mount and retries it on a bounded budget
(`DATA_POLL_MS` × `DATA_POLL_LIMIT` while loading, × `DATA_FAIL_LIMIT` while failing), then
stops. A Host that finishes its fetch after that window is picked up on the next remount, not by
a slow re-poll. This is deliberate and currently unapproved to change.

## Pointers

- Behaviour, sources, and limits: `README.md` / `README.zh-CN.md`
- Skills: `.agents/skills/dsh-plugin-development`, `.agents/skills/billing-regression-testing`,
  `.agents/skills/release-verification`
