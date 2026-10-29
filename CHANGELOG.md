# Changelog

Notable changes to `@jimmyzm/dsh-billing-card`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The Chinese edition is [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md).

## Unreleased

### Changed

- The English cache-price label is `Cached` (was `Cache read`).

## 1.3.0 — 2026-10-28

### Added

- Redesigned card: the countdown — moved to the left, in the colour of the current window — with the period chip, then the amount, the provider, the model and the three price columns.
- Hover text is drawn by the card itself instead of borrowing the host tooltip: the bubble opens above the word, drops below when there is no room, and keeps clear of the side edges.
- The price bubble adds the snapshot date and whether those rates were read at startup or are the built-in copy; the period bubble lists peak, idle and the holiday source; a make-up workday says in one sentence that it bills like a weekend.

### Fixed

- The card disappeared after the sidebar was collapsed and reopened.
- Hovering the amount lit up the whole row; only the number opens the bubble now.
- The separator between the rows and the note was missing.

### Changed

- The note line's line height follows the type scale (`18px` → `16px`).
- The make-up screenshot — the one that showed `Peak` beside `调休`, which the card never draws because a make-up day is idle all day — is gone, along with the other extra screenshots: each README keeps one.

## 1.2.1 — 2026-10-27

### Added

- `package.json` declares `engines.dsh` (`>=0.2.0-rc.1 <0.3.0-0 || >=0.2.1-0 <0.3.0-0`), naming each prerelease line so later prereleases are not rejected.
- This changelog, in English and Chinese, backfilled to 1.0.0 and shipped in the package.

### Changed

- Release notes lead with Chinese and repeat the same sections in English.
- Both READMEs state the supported DSH range, plus the one difference on 0.2.0-rc.1: its tooltip primitive ignores `align`, so the bubble centres.

## 1.2.0 — 2026-10-27

### Added

- The headline balance follows the provider that pays for the selected model: the DSH account balance for every provider but the open platform, the DeepSeek open-platform balance for `deepseek-official` models, and the API balance when the DSH account is signed out.
- A provider switch — in the composer, in settings, by adding a provider or pasting a key — asks the Host for a fresh read instead of reusing the amount it already read, and follows up a second later while that read is pending.

### Changed

- Hover text was rebuilt on the DSH tooltip primitive: a 400 ms delay, a body that wraps inside 248 px, tone badges, emoji titles, and one trigger per row on its own label. (1.3.0 replaced it with the card's own bubble.)

### Fixed

- A failed open-platform read says `read failed, retrying` instead of claiming that no API key is configured.

## 1.1.0 — 2026-10-27

### Added

- The DeepSeek open-platform balance beside the DSH account balance, read with the `DEEPSEEK_API_KEY` the Models page stores, and refreshed every 30 s.
- The route is re-read on that same 30 s tick, and at once when the provider changes, so a card that loaded before a key was configured picks the balance up instead of freezing on 「未配置 API Key」.

### Fixed

- Every DeepSeek provider id is recognised (`deepseek-account`, `deepseek-official`, `deepseek`), and 「未配置 API Key」 is no longer confused with 「官方价目未收录该模型」.
- A DeepSeek model served by a foreign provider quotes no price instead of the official one.
- The 调休 chip no longer appears on a day that is already a holiday.
- Price amounts with digit groups (`1,000`) and full-width digits (`０.０２`) parse correctly.

## 1.0.1 — 2026-10-26

### Changed

- Publishing moved to GitHub OIDC trusted publishing with provenance, triggered by a published release; 1.0.1 exists to validate that path.

## 1.0.0 — 2026-10-26

### Added

- First release: a card in the sidebar footer with the DSH account balance (recharge plus bonus wallets), the unit prices of the selected model in the billing tier active right now, and the peak/idle window with a countdown to the next switch.
- Chinese statutory holidays come from the iCloud China holiday calendar; the Chinese UI also gets the holiday label and the gray 调休 chip.
- Prices are read from the official pricing pages at startup and follow the interface language (CNY in Chinese, USD elsewhere), with a built-in snapshot as the fallback.
- The card refreshes every 30 s and follows the application theme and DSH language.
