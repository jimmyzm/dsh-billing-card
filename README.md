<!-- prettier-ignore -->
<div align="center">

<img src="https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/icon.svg" alt="" height="72" />

# dsh-billing-card

*DeepSeek balance, live unit prices and the billing window, in your DSH sidebar*

![Platform](https://img.shields.io/badge/platform-web-blueviolet?style=flat-square)
[![npm](https://img.shields.io/npm/v/@jimmyzm/dsh-billing-card?style=flat-square)](https://npmx.dev/package/@jimmyzm/dsh-billing-card)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)](LICENSE)
[![](https://img.shields.io/npm/unpacked-size/@jimmyzm/dsh-billing-card?style=flat-square)](https://npmx.dev/package/@jimmyzm/dsh-billing-card)
[![](https://img.shields.io/github/actions/workflow/status/jimmyzm/dsh-billing-card/ci.yml?style=flat-square&label=tests)](https://github.com/jimmyzm/dsh-billing-card/actions/workflows/ci.yml)
[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

**English** · [简体中文](README.zh-CN.md)

[Features](#features) • [Screenshots](#screenshots) • [Installation](#installation) • [How it works](#how-it-works) • [Limits](#limits) • [Development](#development)

</div>

A card in the DSH sidebar footer: the balance, the selected model's unit prices, and the current billing period with a countdown to the next switch.

<div align="center">
  <img src="https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/screenshots/holiday-banner.png" alt="The card on a statutory holiday" width="320" />
</div>

## Features

- **Balance** — the DSH account balance (recharge + bonus) or the DeepSeek open-platform balance behind your API key, whichever the selected provider bills; it follows the provider in the composer.
- **Unit prices** — input, cache read and output for the selected model, in the tier active now; no price when another provider serves the model.
- **Billing period** — green `Idle` / yellow `Peak`, with a countdown to the switch.
- **Holidays** (Chinese UI) — a blue banner with the holiday's name, and a gray `调休` chip on a make-up workday.
- **Currency by language** — CNY prices in Chinese, USD everywhere else.
- **Theme and locale** — light and dark themes, zh/en dictionaries, built-in data when an upstream cannot be fetched.

## Screenshots

Real renders, 256 px sidebar at 2× density.

| Holiday — `国庆节` | Make-up workday — `调休` |
| --- | --- |
| ![Holiday](https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/screenshots/holiday-banner.png) | ![Make-up](https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/screenshots/makeup-chip.png) |

| English UI, USD prices | Dark theme |
| --- | --- |
| ![English UI](https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/screenshots/english-usd.png) | ![Dark theme](https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/screenshots/dark-theme.png) |

## Installation

The package is published on npm ([`@jimmyzm/dsh-billing-card`](https://npmx.dev/package/@jimmyzm/dsh-billing-card)) as a DSH bundle. Use the profile you actually run (`desktop` for the desktop app, `web` for `dsh web`):

Requires DSH 0.2.0-rc.1 or newer — `package.json` declares the range in `engines.dsh`, and the
manifest fields, the footer slot, the `locale` and `webServer` services, and the tooltip primitive
it uses all exist in that release.

```bash
dsh plugin --profile web add @jimmyzm/dsh-billing-card
```

The same as **Install from npm** on the DSH plugin page. Refresh the GUI afterwards — the card appears at the bottom of the sidebar and hides itself when the sidebar is collapsed to the icon rail.

> [!IMPORTANT]
> A plugin's Host half loads once per application start, so **restart the application after installing or upgrading**. Until then the card runs on its built-in data.

Requires a DSH build with the Web GUI, the sidebar footer slot and the account service. To uninstall:

```bash
dsh plugin --profile web remove @jimmyzm/dsh-billing-card
```

## How it works

The Host half fetches both price tables and the China mainland holiday calendar once per application start and serves them on `GET /deepseek-billing-card/data`; the Client half is a React component in `sidebar.footer.action` that reads that route, follows the composer's model picker, and refreshes the balance every 30 s.

Switching to the provider that bills the open platform asks the Host for a fresh balance at once, so the amount follows the switch instead of the next tick.

### Billing window

Peak is Beijing time, Monday to Friday, 09:00–12:00 and 14:00–18:00, excluding Chinese statutory holidays; everything else is idle.

### Currency

A Chinese UI quotes the CNY page, every other language the USD page. Nothing is converted; the balance keeps its wallet currency.

### Hover text

A dotted underline marks the trigger: the balance label, the model name, and each chip.

- **Balance** — the amount on screen, one line per wallet, the total last, and how often it refreshes.
- **Model** — the unit and whether the prices are live or the built-in snapshot.
- **Period** — the billing window and where the calendar came from; `调休` explains a make-up workday.

The price block has no hover text — its labels are on screen.

### Data sources

| What | Source |
| --- | --- |
| Account balance, model | DSH account service; the composer's model selection |
| Open-platform balance | `GET https://api.deepseek.com/user/balance`, authorised with the `DEEPSEEK_API_KEY` credential the Models page stores (the launch environment is the fallback) |
| Prices | <https://api-docs.deepseek.com/zh-cn/quick_start/pricing/> and <https://api-docs.deepseek.com/quick_start/pricing/> |
| Holidays | <https://calendars.icloud.com/holidays/cn_zh.ics> |

## Limits

- Prices and holidays are read once per application start; the open-platform balance is re-read every 30 s. A provider switch re-reads it right away.
- Without a `DEEPSEEK_API_KEY` the card shows the account balance.
- A model served by a provider other than DeepSeek's own shows no price.
- Verified end to end on DSH 0.2.1-rc.3. Against 0.2.0-rc.1 the source surface is the same, but that
  build's tooltip ignores `align: 'start'` (the bubble centres) and does not read `engines.dsh` yet.
- The card needs the HTTP GUI (`dsh web`); without a web server it runs on the built-in copies, and without the `uiSession` / `modelDirectories` services it prices the catalog default.

## Development

No build step: `client.js` is a hand-written browser module, `index.js` and `parse.js` are the Host half. The card renders only its own subtree and reads only `--dsw-alias-*` tokens.

```
package.json        # dsh.bundle.patch + dsh.client
cordis.patch.yml    # inserts the dsh-billing-card entry
index.js parse.js   # Host half: startup fetch + the data route
client.js           # Client half: the card and its built-in fallbacks
locale/             # zh/en dictionaries for the plugin manager
icon.svg            # plugin icon
CHANGELOG.md        # release notes, English and Chinese, newest first
CHANGELOG.zh-CN.md
docs/               # README logo and screenshots (repository only, not shipped)
test/               # offline suite: parsers, host route, client render
AGENTS.md           # working spec for agents on this repo (repository only, not shipped)
.agents/skills/     # project skills for agents on this repo (repository only, not shipped)
.github/workflows/  # ci (tests) and publish (npm with provenance)
```

To run a local checkout instead of the published package, add the folder — it is linked into the profile, so `client.js` edits show up on a page refresh:

```bash
dsh plugin --profile web add /path/to/dsh-billing-card
```

`npm test` runs the offline suite: the parsers against the pages captured in `test/fixtures`, the Host route with a stubbed upstream, and the Client half in a miniature React runtime. No dependencies, no network. `AGENTS.md` holds the working spec and the three project skills for agents.

Released under the [MIT license](LICENSE).
