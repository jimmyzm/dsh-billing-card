---
name: dsh-plugin-development
description: Build, modify, install, and debug this DSH sidebar plugin — its Host half (index.js, parse.js), its Client half (client.js), and its packaging. Use for any change to the card's behaviour, text, styling, data sources, or installation.
whenToUse: Use when editing client.js, index.js, parse.js, package.json, cordis.patch.yml, or locale/*.json in this repository, or when the task is to install, enable, disable, or debug the plugin in a running DSH app.
---

# DSH plugin development

## When to use

Any change to the card itself: the balance line, the holiday banner, the 调休 chip, the price
table, the billing-period countdown, tooltips, styling, wording, the Host route and its fetches,
the parsers, or the package manifest. Also use when installing or debugging the plugin inside a
running DSH profile.

## Triggers

- "Add / change / fix something on the card" (visual or textual).
- A new data source, or a refreshed upstream page/calendar format.
- A slot, mount point, or DOM question about the sidebar footer.
- "Install it", "why is nothing showing", "the card still shows the old price".

## Preconditions

1. Read `AGENTS.md` first — it holds the invariants (no invented money or calendar data, no FX
   conversion, fixed billing windows, exact decimal-string money math, per-source fallback,
   degrade-not-crash).
2. Read the `How it works` and `Limits` sections of `README.md` (or `README.zh-CN.md`).
3. Decide **which half** you are touching. That single decision determines the deploy path and
   the verification you can honestly claim:

   | Change | Half | Takes effect |
   | --- | --- | --- |
   | `client.js` | Client | page refresh |
   | `index.js`, `parse.js` | Host | full app restart |
   | `package.json`, `cordis.patch.yml` | manifest | re-add the bundle **and** restart |

4. `npm test` on a clean tree, so a later failure is yours.

## Steps

1. Change one behaviour at a time. Keep Host logic out of `client.js` and rendering out of
   `parse.js`.
2. Client half only:
   - `require('react')` is the only import; build with `createElement`, never JSX.
   - Use services already injected by `dsh.client.inject`: `slots`, `locale`, `timer`, `remote`
     (`remote.account`, `remote.session`), plus optional `ctx.get('uiSession')` and
     `ctx.get('modelDirectories')`. Confirm a service exists before using it — do not invent one.
   - Every visible string goes into **both** dictionaries in `client.js` (`//#region
     dictionaries`) under the same key. `locale/zh.json` and `locale/en.json` carry plugin `meta`
     only.
   - Style with `--dsw-alias-*` tokens only, scoped to the card's own subtree (`.dbc-*` classes).
     No hardcoded colours, no restyling host or sibling plugin DOM.
   - Money and date rendering must reuse the existing formatters (`numberFormatter`,
     `priceFormatter`, `truncate`) — no per-site `toFixed`.
3. Host half only:
   - Fetch upstream data once per process, behind `AbortSignal.timeout(FETCH_TIMEOUT_MS)`;
     never fetch on the route.
   - Register the route through nested `ctx.inject(['webServer'], …)` inside `ctx.effect`. Never
     add `webServer` to `dsh.client.inject`, never register at plugin top level.
   - Keep `DATA_PATH = '/deepseek-billing-card/data'` (frozen across the rename).
   - The handler must stay non-async and answer from in-memory state only (405 + `allow` for
     non-GET/HEAD, 200 + `cache-control: no-store` JSON otherwise).
4. Parser work: `parse.js` stays pure — no `fetch`, no `fs`, no globals. Add the shape you need
   to the returned object; never make the Client re-parse raw upstream text.
5. Gate every change before claiming anything:
   ```bash
   node --check index.js && node --check parse.js && node --check client.js && npm test
   ```
6. Live check (Client half): the GUI URL and module rev come from the running app.
   ```bash
   curl -s <gui>/plugins/events --max-time 3 | grep -o 'rev=[0-9a-f]*' | sort -u
   ```
   A changed `rev` plus the new string in the served bytes is the evidence that the Client half
   landed. `/deepseek-billing-card/data` answering `200` is the evidence for the Host half.

## Verification

- `npm test` prints one `PASS`/`FAIL` line per assertion: zero `FAIL`, and the total is not
  lower than before your change.
- `npm pack --dry-run` lists exactly the runtime files (`index.js`, `parse.js`, `client.js`,
  `cordis.patch.yml`, `locale/*.json`, `icon.svg`, both READMEs, `LICENSE`) — no `docs/`,
  `test/`, `.agents/`, `AGENTS.md`, `.github/`, `.DS_Store`.
- For any visual or layout change, render it offline and read the DOM text (not only the
  screenshot): the current model may not be able to open images, so assert the markup instead —
  element classes, text content, and the tooltip string. The bubble is the card's own element
  (`.dbc-tip*`), not the host primitive, so its markup is in the tree like any other node.
- Bilingual changes: assert both locales, and assert that the two key sets are identical (the
  suite already checks this).
- State plainly what is live and what is waiting for a restart. Never say "it works now" for a
  Host-half change.

## Failure handling

- Card missing, slot not registering: check the slot id and `order` in `client.js` against the
  live tree (`cordis_inspect_query`, platform `client`, Slot inspector) instead of guessing DOM.
- Prices or holidays look stale or wrong: read the tooltips — they say `启动时校准` versus
  `内置快照`, and `iCloud` versus the built-in table. A snapshot label means the Host route did
  not answer, which normally means no restart happened yet.
- `/deepseek-billing-card/data` returns 404: the running Host is older than the code on disk.
  Restart the app; do not "fix" it by changing the Client retry budget.
- A test that fails only offline: reproduce with the smallest fixture; never edit
  `test/fixtures/*` to make it pass.
- Parser returns `null` on a real page: dump the table rows (see `test/parsers.test.mjs`) and
  match on row labels, never on cell index.

## Prohibited

- Inventing, estimating, or converting any price, balance, or holiday date.
- Renaming `DATA_PATH`, or changing the peak/idle windows, without an explicit request.
- Adding `webServer` to `dsh.client.inject`; registering the route at plugin top level.
- Adding a build step, a bundler, a new npm dependency, or a second `fetch` path around an
  upstream.
- Hand-editing the profile's `package.json` or `cordis.patch.yml`; `plugin_manager` actions
  without the user's approval.
- Editing `client.js` and then describing a Host-half restart as done (or the reverse).
- Restyling anything outside the card, or using colours that are not theme tokens.
