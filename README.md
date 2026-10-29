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

<img src="https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/banners/minimal-en-1200x320.png" alt="dsh-billing-card — balance, prices and the idle/peak countdown, in the DSH sidebar" width="880" />

</div>

## Features

- View the balance that pays for the selected model: your DSH account balance, or the DeepSeek Open Platform balance behind your API key.
- Check the input, cached and output prices per million tokens for the selected model, at the tier in effect now.
- See whether you are in a peak or idle period, with a countdown to the next switch.
- See whether today is a statutory holiday or a make-up workday in the Chinese UI.
- See prices in CNY in the Chinese UI and in USD in every other language.
- Follow the app's language and light/dark theme; built-in data covers a source that cannot be read.

## Screenshots

Real render, 256 px sidebar at 2× density.

<img src="https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/screenshots/english-usd.png" alt="English UI with model prices and the current billing period" width="576" />

## Installation

Install from npm:

```bash
dsh plugin --profile web add @jimmyzm/dsh-billing-card
```

Use the `desktop` profile for the desktop app, `web` for `dsh web`.

To upgrade to the latest release:

```bash
dsh plugin --profile web add @jimmyzm/dsh-billing-card@latest
```

Restart DSH after installing or upgrading. The card appears at the bottom of the sidebar and hides when the sidebar collapses to the icon rail.

Requires DSH 0.2.0-rc.1 or later, with the Web GUI, the sidebar footer slot, and the account and model-catalogue services. Tested end to end on DSH 0.2.1-rc.3.

To uninstall:

```bash
dsh plugin --profile web remove @jimmyzm/dsh-billing-card
```

## Billing and pricing

Peak hours are Beijing time, Monday to Friday, 09:00–12:00 and 14:00–18:00. Chinese statutory holidays are excluded from peak; all other times are idle.

Prices depend on the selected model and the period in effect. The Chinese UI quotes CNY prices, every other language USD prices, and the two are never converted into each other.

Models served by other providers are not given DeepSeek's official prices.

## Balance and data sources

The card follows the provider selected in the composer:

- DSH account balance, including recharge and bonus amounts.
- DeepSeek Open Platform balance, read with the configured `DEEPSEEK_API_KEY`.

Both are refreshed every 30 s; switching the provider re-reads both at once, and a credential change re-reads the Open Platform balance. Without an API key the card keeps showing the DSH account balance. If the selected provider bills the Open Platform, the balance area says `No API key` instead.

Data sources:

- Account balance and selected model: the DSH account service and the composer's model selection.
- Open Platform balance: `GET https://api.deepseek.com/user/balance`, with the `DEEPSEEK_API_KEY` stored on the Models page (the launch environment is the fallback).
- Model prices: [English pricing](https://api-docs.deepseek.com/quick_start/pricing/) · [Chinese pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/).
- Chinese holidays: [iCloud holiday calendar](https://calendars.icloud.com/holidays/cn_zh.ics).

Prices and holiday data are fetched at application startup. When a source cannot be read, its built-in copy stands in.

## Limitations

- Prices and holidays are not refreshed while the application runs; restart DSH to read them again.
- Models served by providers other than DeepSeek's own show no price; a model missing from the official table gets a note instead.
- Signed out of the DSH account, the card shows the Open Platform balance rather than a blank.
- Without a web server, prices and holidays come from the built-in snapshot; without the current session's model selection, the card prices the default model.

## Development

There is no build step and no npm runtime dependency. `client.js` is the client module; `index.js` and `parse.js` run on the Host side.

Run the tests:

```bash
npm test
```

The offline suite uses local fixtures and a simulated runtime; no network access is required.

To install a local checkout:

```bash
dsh plugin --profile web add /path/to/dsh-billing-card
```

Refresh the page to see client-side changes; restart DSH after changing Host-side code.

Development conventions are documented in `AGENTS.md`, with project-specific skills in `.agents/skills/`.

## License

[MIT](LICENSE)
