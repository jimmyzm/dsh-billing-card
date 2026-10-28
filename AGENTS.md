# AGENTS.md — @jimmyzm/dsh-billing-card

DSH (DeepSeek Harness) sidebar plugin: a card in the sidebar footer shows the DeepSeek account balance (or the
open-platform balance behind an API key), the current model's unit prices, and the live peak/idle billing window
with a countdown. Three plain ES modules, no build step, no runtime dependencies, no bundler.

Open the session with the repository root as `cwd`: DSH discovers `AGENTS.md` and `.agents/skills/` by walking up to
the nearest `.git`, so a session rooted at the parent folder loads neither.

This file holds what every task must obey — the business invariants, the compatibility guards, the test and packaging
rules, the documentation rules, the Git authorization boundary — and the router for the skills. Procedure lives in
the skill a task loads; where a skill states a procedural rule, that skill is authoritative.

## Architecture

| File | Role | Takes effect on |
| --- | --- | --- |
| `index.js` | Host half: snapshots the price tables and the calendar at activation (8 s timeout each), re-reads the open-platform balance every 30 s, serves the loopback route | full app restart |
| `parse.js` | Host half: pure parsers — `parsePricingHtml`, `parseHolidayCalendar`, `parseDeepseekBalance`, `toBeijingDate`; no I/O, no deps | full app restart |
| `client.js` | Client half: the card, its dictionaries, its CSS, the built-in snapshot | page refresh |
| `package.json`, `cordis.patch.yml` | Manifest, `engines.dsh`, the bundle patch | re-add the bundle **and** restart |
| `test/` | Offline suite (`npm test`): parsers on captured fixtures, Host against a stubbed `fetch`, Client in a miniature React | — |
| `.agents/skills/`, `docs/` | Skills and design records; repository-only, never shipped. `docs/design-skill-audit.md` is provenance and history — never a second source of values, and its open items are questions, not rules | — |

Prices and the calendar are startup snapshots. On this route the open-platform balance is the only value that moves
while the app runs; the account balance beside it is not cached here but re-read from the account service on the same
30 s tick. Always say which half you changed and what it needs; never claim a Host change is live.

## Invariants

Every task, every file. Breaking one is a bug, not a design choice.

1. **Never invent money or calendar data.** Prices come only from the official pages (CNY
   `api-docs.deepseek.com/zh-cn/quick_start/pricing/`, USD `api-docs.deepseek.com/quick_start/pricing/`); holidays
   only from the iCloud China calendar (`（休）` = day off, `（班）` = make-up workday). The only other source is the
   built-in snapshot in `client.js`, and its bubble must say it is the snapshot.
2. **No currency conversion, ever.** There is no FX source. Chinese-family locales read the CNY table, every other
   locale the USD table; a balance keeps its wallet currency, and a non-Chinese UI prefixes the ISO code
   (`CNY ¥32.50`).
3. **The billing rule is fixed.** Beijing time (UTC+8): Mon–Fri 09:00–12:00 and 14:00–18:00 is peak; weekends and
   `（休）` days are idle all day. Only weekends and `（休）` suppress peak — a `（班）` day is billed by the weekday
   rule, and because every 2025–2026 make-up day falls on a weekend it renders idle, which is what the gray 调休 chip
   explains. A day is never in both sets: `（休）` wins.
4. **Money math is exact.** Wallet totals are summed as decimal strings and truncated toward zero exactly once. A
   positive sub-cent total renders 「不足 0.01」/「under 0.01」. Never add floats, never truncate per wallet.
5. **The provider decides which balance headlines.** `billsOnOpenPlatform` is exactly `deepseek-official`, and is
   deliberately narrower than `billsAtListPrice`: `deepseek` and `deepseek-account` bill like the official table but
   are not the open platform, so they headline the DSH account balance. A signed-out account falls back to the API
   balance rather than a blank, and a notice (「未配置 API Key」/「读取失败，稍后重试」) is never dressed up as an amount.
6. **A list price needs a DeepSeek provider.** `OFFICIAL_PROVIDERS` in `client.js` is the explicit set
   `deepseek-account`, `deepseek-official`, `deepseek`, matched case-insensitively; an unknown provider keeps pricing
   what it knows. Never widen it to a substring match — a lookalike id such as `llm-deepseek` belongs to somebody
   else. A DeepSeek model on another provider shows 「该渠道不走官方价目」/「This provider has no list price」; a model
   the table lacks keeps 「官方价目未收录该模型」/「No official price for this model」.
7. **Fallbacks are per source.** A failed USD page must not blank a live CNY table or calendar: render live where it
   is live, snapshot where it is not.
8. **A wrong payload degrades, it never crashes.** Every field crossing the loopback route is re-validated on the
   Client by `readPriceBook` / `readHolidays` / `readRemote`.

## Layout and compatibility guards

- **The route is frozen.** `DATA_PATH = '/deepseek-billing-card/data'` keeps the product name across the package
  rename, because an in-place upgrade depends on a still-running Host answering the old path. Register it through a
  nested `ctx.inject(['webServer'], …)` — never in `dsh.client.inject`, never at plugin top level.
- **The Client may only `require('react')`** — no other module, no unguarded global. Use the injected services, and
  confirm one exists before using it.
- **`wide` is a prop, not a mount gate.** Every hook runs in both states, so the `if (!wide)` bail-out sits after the
  last hook; returning earlier throws "Rendered more hooks than during the previous render" and React tears the card
  down until the page reloads. The route-reading effect keeps `[]` deps on purpose: a collapse must not blank the
  table for the frame it takes to re-ask.
- **The card owns its palette and stays inside its subtree.** `--dbc-*` on `.dbc-root`, resolved by the
  `color-scheme` the app writes on `<html>`; never read a host token (`--dsw-alias-*`), never restyle host or sibling
  plugin DOM, no iframe, and no new npm dependency without an explicit OK.
- **`engines.dsh` lists each prerelease line explicitly** (`>=0.2.0-rc.1 <0.3.0-0 || >=0.2.1-0 <0.3.0-0`): a plain
  `>=0.2.0-rc.1` rejects every later prerelease under semver, and this range blocks a DSH build never tested here.
- **Every visible string has the same key in both dictionaries** in `client.js` (`//#region dictionaries`).
  `locale/zh.json` and `locale/en.json` carry plugin `meta` only.

## Working rules

- **Run the gate before proposing a change.** It is offline and deterministic and prints one `PASS`/`FAIL` line per
  assertion: zero `FAIL`, and the count must not drop.

  ```bash
  node --check index.js && node --check parse.js && node --check client.js && npm test
  ```
- **No test framework, linter, formatter, snapshot directory or coverage tool.** A test never touches the network,
  sleeps, or reads the wall clock.
- **Never hand-edit `test/fixtures/*`** — they are captured copies of the official pages. Refreshing one is a
  deliberate act with recorded provenance (`billing-regression-testing`).
- **`files[]` is the runtime surface only**: `index.js`, `parse.js`, `client.js`, `cordis.patch.yml`, `locale/*.json`,
  `icon.svg`, both READMEs, both CHANGELOGs, `LICENSE`. `test/`, `docs/`, `.agents/`, `AGENTS.md` and `.github/` stay
  out of the tarball.
- **Keep `README.md` (English, default) and `README.zh-CN.md` in step**: same sections, same facts, cross-linked.
  Every release updates `CHANGELOG.md` and `CHANGELOG.zh-CN.md` together, newest first.
- **A release's notes and its two changelog sections describe one release.** They agree on the version, on which
  features, fixes, compatibility changes and limits shipped, and on what upgrading costs — not on wording, entry
  order or count. The notes may merge entries, reword them or cut detail; they may not drop a key change or claim
  one the changelogs do not record. A change that shipped without an entry is a gap in both changelogs, filled
  there first — a commit is proof it happened, not a substitute for the record. `release-verification` → **step 6**
  owns the check.
- **Commit messages** are Conventional Commits with no scope: `feat:` `fix:` `docs:` `test:` `ci:` `chore:`
  `refactor:`, then a lowercase imperative summary of one purpose, 72 characters at most —
  `fix: keep the card mounted when the sidebar collapses`. Two purposes are two commits, however small the diff.
- **A body carries only what the title cannot**: the cause, the behaviour or compatibility change it makes, or a
  restart requirement. Never a file-by-file recap, test output or a checklist.
- **Keep the skills current.** When a task teaches something the next agent would otherwise repeat — a trap, the
  check that catches it, a new command — fold it into the matching skill in the same change. If it fits none of
  them, say so rather than inventing a new skill.

## Git, release and publication

- **Nothing is committed, pushed or published on your own initiative.** No `git commit`, `git push`, tag, release,
  version bump or publish without the user authorizing that exact action in the current task. Finishing a task, a
  green suite or a clean diff is not authorization, and permission to edit a file is not permission to commit it.
- Before any of them, state what is staged and what it contains, then wait for the answer.
- Editing this file or a skill follows the same rule — there is no documentation exception.
- Undo a pushed commit with `git revert`; never force-push `main`, and never move or rewrite a published tag or
  version. Never run `npm publish` locally: provenance only exists when the release workflow signs the artifact.

## Skills

Load the skill the task's *subject* belongs to. The skill owns the procedure; this file owns the outcome.

| Skill | Owns | Load it when |
| --- | --- | --- |
| `dsh-plugin-development` | The Host/Client split, route registration, refresh and retry mechanics, install and debug | Any change to `index.js`, `parse.js`, `client.js`, the manifest or the locale files; a new data source; "nothing shows", "the price is stale" |
| `dsh-card-design` | The values: tokens, type and spacing scale, contrast, row order, truncation, the bubble and its timing | Anything visual or textual: a row, chip, state or notice, a token or theme change, bubble structure or copy, screenshots and banners |
| `billing-regression-testing` | Test-case design, the period boundary table, deterministic time, fixture refreshes | The billing rule, the parsers, money precision, provider or currency selection, fallbacks — and any bug that needs a failing case first |
| `release-verification` | The release procedure: pre-flight, notes, their reconciliation with both changelogs, tag, artifact and provenance checks | A version bump, tag, release or publish, or proving a published artifact matches the tree |

If a skill and this file disagree, this file wins and the skill is stale. User-facing behaviour, sources and limits
are in `README.md` / `README.zh-CN.md`.
