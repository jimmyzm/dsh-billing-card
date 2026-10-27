# Changelog

Notable changes to `@jimmyzm/dsh-billing-card`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The Chinese edition is [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md).

## Unreleased

### Changed

- Every release note from 1.0.0 on now leads with Chinese and repeats the English version below a rule.
- The publish job is idempotent: it reads the registry's version document first and skips a version that is already published, and the tarball check uses `npm pack --dry-run` so a re-run no longer fails on `E403 cannot publish over the previously published versions`.

## 1.2.1 — 2026-10-27

### Added

- `package.json` declares `engines.dsh` (`>=0.2.0-rc.1 <0.3.0-0 || >=0.2.1-0 <0.3.0-0`). Each prerelease line is named because a plain `>=0.2.0-rc.1` rejects every later prerelease under the semver rule.
- This changelog, in English and Chinese, backfilled to 1.0.0 and shipped in the package.

### Changed

- Release notes lead with Chinese and repeat the same sections in English; the publish template and `AGENTS.md` follow the same rule.
- Both READMEs state the supported DSH range and the one difference on 0.2.0-rc.1: its tooltip primitive ignores `align`, so the bubble centres.

## 1.2.0 — 2026-10-27

### Added

- The headline balance follows the provider that pays for the selected model: the DSH account balance for every provider but the open platform, the DeepSeek open-platform balance for `deepseek-official` models, and the API balance when the DSH account is signed out.
- A provider switch — in the composer, in settings, or by adding a provider or pasting a key — asks the Host for a fresh open-platform balance at once (`?balance=refresh`), with two one-second follow-ups while it is being read, instead of waiting for the next refresh.
- Hover text is rebuilt on the DSH tooltip primitive: a 400 ms delay, a body that wraps inside 248 px, tone badges on the rows, emoji titles, and one trigger per row on that row's label.

### Fixed

- A failed open-platform read says 「读取失败，稍后重试」 / `read failed, retrying` instead of claiming that no API key is configured.

### Changed

- Both READMEs rewritten around what the card shows, with a section on hover text and the refresh rules.
- The publish workflow pins npm 11 for the provenance build.

## 1.1.0 — 2026-10-27

### Added

- The DeepSeek open-platform balance beside the DSH account balance, read with the `DEEPSEEK_API_KEY` the Models page stores, and refreshed every 30 s.
- The route is re-read on the 30 s tick, so a card that loaded before a key was configured picks the balance up instead of freezing on 「未配置 API Key」.
- `AGENTS.md` with the working spec and three project skills under `.agents/skills/`.

### Fixed

- Every DeepSeek provider id is recognised (`deepseek-account`, `deepseek-official`, `deepseek`), and 「未配置 API Key」 is no longer confused with 「官方价目未收录该模型」.
- A DeepSeek model served by a foreign provider quotes no price instead of the official one.
- The gray 调休 chip no longer appears on a day that is already a holiday.
- Price amounts with digit groups (`1,000`) and full-width digits (`０.０２`) parse correctly.

### Changed

- The publish workflow runs the suite, checks the tag against the version, and checks the tarball before publishing.
- CI moved to `checkout@v5` / `setup-node@v5`, and the offline suite runs in the repository.

## 1.0.1 — 2026-10-26

### Changed

- Publishing moved to GitHub OIDC trusted publishing with provenance, triggered by a published release; 1.0.1 exists to validate that path.

## 1.0.0 — 2026-10-26

### Added

- First release: a card in the sidebar footer with the DSH account balance (recharge plus bonus wallets), the unit prices of the selected model in the billing tier that is active right now, and the peak/idle window with a countdown to the next switch.
- Chinese statutory holidays come from the iCloud China holiday calendar; the Chinese UI also gets the holiday label and the gray 调休 chip.
- Prices are read from the official pricing pages at startup and follow the interface language (CNY in Chinese, USD elsewhere), with a built-in snapshot as the fallback.
- The card refreshes every 30 s and follows the application theme and DSH language.
