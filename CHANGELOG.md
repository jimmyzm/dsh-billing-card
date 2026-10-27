# Changelog

Notable changes to `@jimmyzm/dsh-billing-card`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The Chinese edition is [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md).

## 1.3.0 — 2026-10-28

### Added

- Redesigned card: one row per fact (countdown and state chips, amount, provider, model, three price columns), with every colour resolved from the card's own `--dbc-*` layer through `light-dark()` instead of host theme variables.
- The hover bubble is now drawn in-house: no host tooltip primitive, flip and edge clamping, an arrow pointing at the trigger, a 240 ms delay and `Esc` to close; its body is a two-column label/value list.
- The countdown moved to the top-left and takes the colour of the current window (green idle, amber peak), matching the chip on the right.
- The price source split into a snapshot date and a sync mode; the period bubble lists peak, idle and source; the make-up day explains itself in one sentence.
- Both READMEs open with a 1200×320 banner (Chinese and English); the screenshots were trimmed to one each and now show the live tariffs and a real holiday countdown.

### Fixed

- The card disappeared after collapsing and reopening the sidebar: `if (!wide) return null` sat above the hover hooks, so collapsing dropped the hook count from 23 to 14 and React tore the subtree down.
- Hovering the amount no longer lights up the whole row — only the number itself triggers.
- The separator between the rows and the note was missing because the rule referenced an undeclared `--dbc-line-2` token, so nothing was painted.
- The UI no longer shows an impossible 「peak + make-up」 combination.

### Changed

- `.dbc-note` now sits on the type scale (`18px` → `16px`), and the unused CSS rule, two dictionary keys and two stale comments are gone.
- New project skill `dsh-card-design` plus `docs/design-skill-audit.md` (provenance and method audit of the third-party skills); `banner-design` is no longer vendored and is installed on demand.
- The publish job is idempotent: it reads the registry's version document first and skips a version that is already published, and the tarball check uses `npm pack --dry-run`, so a re-run no longer fails on `E403 cannot publish over the previously published versions`.
- The release-title rule is written down in `AGENTS.md`: the bare tag by default (`v1.2.1`), with an English headline after a dash only for a major feature update.
- Every release note from 1.0.0 on leads with Chinese and repeats the English version below a rule.
- The syntax check in all three skills now matches `ci.yml` (one `node --check` per file, then `npm test`).


## Unreleased

### Changed

- The `release-verification` skill now compares the published tarball by content: npm records the working tree's file modes in the tar header, so `0600` and `0644` give the same bytes two different shasums. Normalise with `chmod 644`, then `cmp` the files instead of distrusting the build.

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
