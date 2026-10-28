---
name: dsh-plugin-development
description: Change this DSH sidebar plugin's Host half (index.js, parse.js), its Client half (client.js) or its packaging, and get the change live. Covers the loopback route, service injection, refresh and retry mechanics, install, and debugging.
whenToUse: Editing index.js, parse.js, client.js, cordis.patch.yml or locale/*.json; adding or replacing a data source; a card that shows nothing, a price that looks stale, or a 404 on the data route; installing or enabling the plugin in a DSH profile.
---

# DSH plugin development

The card is two halves that deploy differently, and that split decides what you may claim: `client.js` lands on a page
refresh, `index.js` / `parse.js` need the app restarted. This skill owns the wiring — route, services, refresh,
install, debug. Visual values belong to `dsh-card-design`; the invariants and compatibility guards belong to
`AGENTS.md`.

## Before you start

- Read **Invariants** and **Layout and compatibility guards** in `AGENTS.md`, plus **Billing and pricing**,
  **Balance and data sources** and **Limitations** in `README.md` (or `README.zh-CN.md`).
- Run the gate in `AGENTS.md` → **Working rules** on the untouched tree, so a later failure is yours.
- Name the half you are changing: **Architecture** in `AGENTS.md` says what each one needs to go live.

## Steps

1. One behaviour at a time. Host logic stays out of `client.js`; rendering stays out of `parse.js`.
2. Client half:
   - `require('react')` is the only import; build with `createElement`, never JSX.
   - Take services from the `inject` array `client.js` exports: `slots`, `locale`, `timer`, `remote` (the event bus,
     plus `remote.account` and `remote.session`); `ctx.get('uiSession')` and `ctx.get('modelDirectories')` are
     optional. Confirm a service exists before using it — do not invent one.
   - Every visible string goes into **both** dictionaries in `client.js` (`//#region dictionaries`) under the same
     key.
   - Reuse the existing formatters — `numberFormatter`, `priceFormatter`, `truncateCents` — instead of a per-site
     `toFixed`. Tokens come from `dsh-card-design` → **Token layer**.
3. Host half:
   - Snapshot the price tables and the calendar once per process, behind `AbortSignal.timeout(FETCH_TIMEOUT_MS)`; the
     open-platform balance is the one upstream that re-reads on a timer (**Route and refresh mechanics**). Never fetch
     on the route.
   - Register through a nested `ctx.inject(['webServer'], (http) => http.effect(…))`. Never add `webServer` to
     `dsh.client.inject` and never register at plugin top level: a deployment with no web server must still load the
     card.
   - The handler is not `async` and answers from memory only: `405` + `allow: GET, HEAD` for any other method,
     otherwise `200` + `cache-control: no-store`.
4. Parser work: `parse.js` stays pure — no `fetch`, no `fs`, no globals. Return the shape the Client needs; never make
   the Client re-parse raw upstream text.

## Live check

The GUI URL and the module `rev` come from the running app:

```bash
curl -s <gui>/plugins/events --max-time 3 | grep -o 'rev=[0-9a-f]*' | sort -u
```

A changed `rev` plus the new string in the served bytes is the evidence that a Client change landed;
`/deepseek-billing-card/data` answering `200` is the evidence for the Host half.

## Route and refresh mechanics

Constants below are code facts: change the code and this section together, so nobody has to re-derive a budget by
reading `index.js` and `client.js` side by side.

- **Host** (`index.js`): the balance re-reads every `BALANCE_REFRESH_MS = 30 s`, unref'd so it cannot hold the process
  open. Nothing sits on the request path.
- **Client budget** (`client.js`): on mount the Client asks the route and retries while the payload is loading or has
  failed — `DATA_POLL_MS = 3 s`, at most `DATA_POLL_LIMIT = 10` attempts while loading, `DATA_FAIL_LIMIT = 3` while
  failing. That budget is the only defence against a Host that registers its route late; never turn it into an
  unbounded fast poll.
- **Steady state**: `DATA_REFRESH_MS = 30 s` calls `api.current.refreshRoute`, matching the Host's cadence. Without
  that re-read a card loaded before a key was configured froze on 「未配置 API Key」 forever.
- **A provider switch asks at once, for a fresh amount**: `refreshRoute(true)` appends `?balance=refresh`; the Host
  begins a read before answering but still answers from memory — at most one read per `BALANCE_ASK_GAP_MS = 3 s`,
  one in flight. Not ready yet, and the Client follows up `BALANCE_ASK_LIMIT = 2` times at `BALANCE_ASK_MS = 1 s`.
- **Two triggers**, both required: a change of the session's selection store (`watchSelection`) and any
  provider-surface event (`watchUpstream`: `llm/adapters-updated`, `settings/document-updated`,
  `credentials/record-updated`, `credentials/reference-updated`). Adding a provider or pasting a key changes which
  balance pays without touching the selection. The periodic tick asks the plain route — a read, not a refresh.

## Install and enable

```bash
dsh plugin --profile <name> add @jimmyzm/dsh-billing-card@<version>
```

`dsh plugin` forwards its arguments to pnpm inside the profile directory, so `add`, `remove` and `why` behave as they
do there. A profile is initialised on first use.

Then restart the app: the Host half is cached per process, so a page refresh alone keeps serving the old route. After
the restart, `/deepseek-billing-card/data` answering `200` plus a changed module `rev` prove both halves are the ones
on disk. Proving a *published* artifact is `release-verification`'s job; this section only gets the plugin into a
profile.

## Verification

- Gate green (`AGENTS.md` → **Working rules**): zero `FAIL`, count not lower than before.
- A bilingual change asserts both locales **and** that the two key sets are identical.
- A visual change is not verified by a screenshot alone: render it offline and assert the markup — element classes,
  text content, the bubble string. The reviewer may not be able to open images.
- Say what is live and what waits for a restart.

## Failure handling

- Card missing, slot not registering: check the slot id and `order` against the live tree (`cordis_inspect_query`,
  platform `client`, Slot inspector) instead of guessing at DOM.
- Prices or holidays look stale: read the bubbles — they say `启动时校准` versus `内置快照`, and `iCloud` versus the
  built-in table. A snapshot label means the route did not answer, which normally means no restart.
- `/deepseek-billing-card/data` returns 404: the running Host is older than the code on disk. Restart; do not "fix" it
  by changing the Client retry budget.
- Parser returns `null` on a real page: dump the rows (`test/parsers.test.mjs`) and match on row labels, never on cell
  index.
- A test that fails only offline: reproduce with the smallest fixture; never edit `test/fixtures/*` to make it pass.

## Not allowed in this half

`AGENTS.md` already forbids inventing or converting data, renaming `DATA_PATH`, moving the billing windows and adding
a dependency. What it does not say, and this half must not do:

- Hand-edit a profile's `package.json` or `cordis.patch.yml`, or run `plugin_manager` actions without approval.
- Add a second `fetch` path around an upstream, or any fetch on the request path.
- Add a build step or a bundler.
