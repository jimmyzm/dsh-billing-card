<!-- prettier-ignore -->
<div align="center">

<img src="docs/icon.svg" alt="" height="72" />

# dsh-billing-card

*DeepSeek balance, live unit prices and the billing window, in your DSH sidebar*

![Platform](https://img.shields.io/badge/platform-web-blueviolet?style=flat-square)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)](LICENSE)

**English** · [简体中文](README.zh-CN.md)

[Features](#features) • [Screenshots](#screenshots) • [Installation](#installation) • [How it works](#how-it-works) • [Limits](#limits) • [Development](#development)

</div>

A card for the bottom of the DSH (DeepSeek Harness) sidebar: how much credit is left, what the selected model costs right now, and whether this instant is billed at peak or off-peak — and for how long.

Prices come from the official DeepSeek documentation, the balance from the DSH account service. Nothing is guessed: whatever cannot be fetched falls back to a built-in copy.

> [!TIP]
> The card fetches once at startup and serves itself from memory afterwards, so nothing in the sidebar ever waits for the network.

<div align="center">
  <img src="docs/preview-holiday.png" alt="The card on a statutory holiday" width="320" />
</div>

## Features

- **Balance** — recharge plus bonus wallets, summed exactly and truncated to the cent, with the per-wallet detail in the tooltip.
- **Unit prices for the selected model** — input, cache read and output in the tier that is active right now; switching models in the composer repaints them immediately.
- **Billing period and countdown** — green `空闲` / yellow `高峰`, with the time until the next switch.
- **Holiday and make-up labels** — in the Chinese UI a holiday becomes a light blue banner at the top of the card (`国庆节假期中`), and a make-up workday gets a gray `调休` chip.
- **Currency follows the interface language** — CNY prices in Chinese, USD prices everywhere else; the balance keeps its own currency.
- **Follows the app** — light and dark themes, zh/en dictionaries, locale-aware numbers, and a quiet fallback to built-in data.

## Screenshots

Real renders, 256 px sidebar at 2× density.

| Holiday — `国庆节` | Make-up workday — `调休` |
| --- | --- |
| ![Holiday](docs/preview-holiday.png) | ![Make-up](docs/preview-makeup.png) |

| English UI, USD prices | Dark theme |
| --- | --- |
| ![English UI](docs/preview-usd.png) | ![Dark theme](docs/preview-holiday-dark.png) |

## Installation

The package is published on npm as a DSH bundle. Use the profile you actually run (`desktop` for the desktop app, `web` for `dsh web`):

```bash
dsh plugin --profile web add @jimmyzm/dsh-billing-card
```

The same as **Install from npm** on the DSH plugin page. Refresh the GUI afterwards — the card appears at the bottom of the sidebar and hides itself when the sidebar is collapsed to the icon rail.

> [!IMPORTANT]
> A plugin's Host half loads once per application start, so **restart the application after installing or upgrading**. Until then the card runs on its built-in data — same layout, only the tooltips say "built-in snapshot".

Requires a DSH build with the Web GUI, the sidebar footer slot and the account service. To uninstall:

```bash
dsh plugin --profile web remove @jimmyzm/dsh-billing-card
```

## How it works

**Host half** — once per application start it fetches both official price tables and the China mainland holiday calendar, then serves the parsed result on `GET /deepseek-billing-card/data`. **Client half** — a React component in `sidebar.footer.action` that reads that route, follows the composer's model picker live, and refreshes the balance every 30 s. There is no build step.

### Billing window

Peak is **Beijing time, Monday to Friday, 09:00–12:00 and 14:00–18:00, excluding Chinese statutory holidays**; everything else is off-peak and billed at half. Weekends are idle all day, which is why a make-up Saturday shows the gray `调休` chip instead of a peak price.

### Currency

A Chinese UI quotes the CNY page, every other language the USD page.

> [!WARNING]
> The two tables are fetched and fallen back independently, and nothing is converted — the card has no exchange rate and does not invent one.

### Data sources

| What | Source |
| --- | --- |
| Balance, model | DSH account service; the composer's model selection |
| Prices | <https://api-docs.deepseek.com/zh-cn/quick_start/pricing/> and <https://api-docs.deepseek.com/quick_start/pricing/> |
| Holidays | <https://calendars.icloud.com/holidays/cn_zh.ics> |

## Limits

- Prices and holidays are calibrated once per application start; a long-running app keeps what it started with.
- Nothing is converted between currencies, and the balance keeps its wallet currency.
- The card needs the same-origin HTTP GUI (`dsh web`); without a web server it runs on the built-in copies.
- Live model following needs the optional `uiSession` and `modelDirectories` services — without them the card prices the catalog default.

## Development

No build step: `client.js` is a hand-written browser module, `index.js` and `parse.js` are the Host half. The card renders only its own subtree and reads only `--dsw-alias-*` tokens, so it cannot restyle the host.

```
package.json        # dsh.bundle.patch + dsh.client
cordis.patch.yml    # inserts the dsh-billing-card entry
index.js parse.js   # Host half: startup fetch + the data route
client.js           # Client half: the card and its built-in fallbacks
locale/  icon.svg  docs/
```

To run a local checkout instead of the published package, add the folder — it is linked into the profile, so `client.js` edits show up on a page refresh:

```bash
dsh plugin --profile web add /path/to/dsh-billing-card
```

Released under the [MIT license](LICENSE).
