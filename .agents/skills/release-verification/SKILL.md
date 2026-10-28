---
name: release-verification
description: Verify this package before a commit that moves the version or ships it, then validate the artifact that comes back — tarball contents, install path, provenance. Every step leaves one line for the report.
whenToUse: Bumping package.json (version, files, exports, dsh.*) or cordis.patch.yml; cutting a tag or GitHub release; or proving that a published npm artifact matches this tree and installs into DSH.
---

# Release verification

A release is verified when the numbers match the repo, not when the commands ran. A step you did not run is not a
step you may report as passed, and "should pass" is not "passed".

## Before you start

- **Authorization is not this skill's to grant.** `AGENTS.md` → **Git, release and publication** decides when a
  commit, tag, release or publish is allowed; nothing here overrides it.
- Clean tree on `main`, in sync with `origin/main`, CI green on the head commit:

  ```bash
  git status --short && git log --oneline -1
  gh run list --limit 3
  ```

- Nothing that exists only in `/tmp` is part of the release: anything worth keeping is already in `test/` or
  committed.

## Steps

1. Gate the code with the command in `AGENTS.md` → **Working rules**. Zero `FAIL`; note the assertion count and
   compare it with the previous release.
2. Freeze the artifact shape:

   ```bash
   npm pack --dry-run
   ```

   Expected: 13 files — the runtime surface listed in `AGENTS.md` → **Working rules** plus `package.json`. No `docs/`,
   no `test/`, no `.agents/`, no `AGENTS.md`, no `.github/`, no `.DS_Store`. Record the packed and unpacked sizes.
3. Prove the shipped Host half loads **as an installed package**, not as a folder copy: unpack the tarball into a temp
   directory, symlink it into a throwaway profile's `node_modules/@jimmyzm/dsh-billing-card`, then

   ```bash
   node -e "import('@jimmyzm/dsh-billing-card').then(m => console.log(Object.keys(m)))"
   ```

   It must expose `DATA_PATH` and `apply`, and `./parse.js` must resolve from the installed path.
4. Check the manifest tells the truth: `version` equals the tag you are about to cut; `repository` / `homepage` /
   `bugs` use the lowercase `jimmyzm/dsh-billing-card` path; `files` still matches step 2.
5. Write the release notes **from the changelog**, not by hand. Start by listing everything the tag will contain and
   checking that each commit is claimed by the new section:

   ```bash
   git log --oneline $(git describe --tags --abbrev=0)..HEAD
   ```

   Anything under `## 未发布` / `## Unreleased` that actually shipped belongs in the version being cut — fold it up
   instead of letting the section accumulate. A commit in the range that is in no section is a missing changelog
   entry, not "housekeeping nobody needs".

   The title is the bare English tag (`v1.3.0`); only a major feature update earns an English headline after a dash
   (`v1.1.0 — ☁️ open-platform balance, provider-aware pricing`). The body is Chinese first, then the same sections in
   English, whatever the title says, with **one emoji per section**: Chinese `## ✨ 新进展`, `## 🐛 已修复`,
   `## 🧩 兼容性`, `## ⬆️ 升级`; English `## ✨ What's New`, `## 🐛 Fixed`, `## 🧩 Compatibility`,
   `## ⬆️ Upgrade`. Keep only the sections that carry a line — an absent section beats an empty one — and the
   upgrade snippet names the version being released (`add @jimmyzm/dsh-billing-card@<version>`), so the command
   reproduces the notes rather than whatever is newest. Every bullet names a commit in the range; that is what makes
   the notes auditable rather than promotional.

   Compatibility is the one section a version does not earn on its own. Open it only when upgrading costs the user
   something — a migration step, a changed behaviour, a dropped Host version. Reassurance ("no new dependency, the
   data route is unchanged") does not qualify: it is the normal state, not a compatibility change. Once a real note
   appears, repeat it verbatim in the two minor releases that follow the one it was born in, then drop it: a note
   from `1.3.0` also runs in `1.4.0` and `1.5.0`, and `1.6.0` is the first release free of it. A repeat carries
   its origin — `(first noted in 1.3.0)` / 「（首次出现于 1.3.0）」 — while the release that birthed the note
   stays bare, so the last version in the chain still separates new entries from carried-forward ones. A user
   who skips two releases still reads what will break. The changelog's `### Compatibility` follows the same
   rule, because the two files are diffed against each other below.
6. Cut the tag and the release; publishing runs from `.github/workflows/publish.yml` on the release event, using npm
   trusted publishing (OIDC).

   ```bash
   git tag v<version> && git push origin v<version>
   gh release create v<version> --title "v<version>" --notes-file /tmp/rel-<version>.md
   gh release view v<version> --json name,tagName --jq '.name + " " + .tagName'   # name == tag
   gh run watch   # on the publish run
   ```

   Fold the changelog section into the notes file rather than retyping it, then prove they agree:

   ```bash
   diff <(sed -n '/^## <version>/,/^## /p' CHANGELOG.zh-CN.md | grep '^- ') \
        <(gh release view v<version> --json body --jq .body | grep '^- ')
   ```

   `<version>` is the changelog's own heading (`## 1.3.0`), which carries no `v` even though the tag does. Passing
   `v1.3.0` there matches no heading and yields an empty diff, which reads as agreement — check that the left side
   actually lists the bullets before trusting the result.

   The workflow refuses a tag whose name is neither `v<version>` nor `<version>`, so a mismatch fails before anything
   is published. **Never run `npm publish` locally** — provenance only exists when the workflow signs it. The job is
   idempotent: it asks the registry's version document first and prints `already on the registry; skipping publish`
   when the version exists, so a re-run is green instead of `E403 cannot publish over the previously published
   versions`. Do not read that skip as a failure, and do not bump the version just to re-run. Editing a release
   afterwards does **not** re-publish — the workflow reacts to `published` (plus a manual dispatch) — so a wrong title
   or a missing bullet is cheap to fix.
7. Validate the artifact that came back:

   ```bash
   npm view @jimmyzm/dsh-billing-card version dist-tags time --json
   npm view @jimmyzm/dsh-billing-card dist.shasum dist.integrity --json
   npm audit signatures   # provenance/attestation check
   ```

   `dist-tags.latest` must be the new version and the attestation must point at this repository and this tag. For the
   artifact itself, `shasum` equality only means something when every file has the same **mode** as the tagged tree:
   npm packs the working tree's modes, and a `0600` file becomes `0644` on a fresh CI checkout, which changes the
   shasum while the bytes stay identical. Normalise first, then compare:

   ```bash
   chmod 644 $(git ls-files)
   git archive <tag> | tar x -C /tmp/tag
   mkdir -p /tmp/reg /tmp/regx && npm pack --pack-destination /tmp/reg && tar xzf /tmp/reg/*.tgz -C /tmp/regx
   cd /tmp/regx/package && find . -type f | while read -r f; do cmp -s "$f" "/tmp/tag/$f" || echo "DIFF $f"; done
   ```

   With the modes normalised the local pack reproduces the registry tarball byte for byte (equal `shasum`); when it
   does not, compare the extracted trees and report a content diff — never a "mismatch" that is only a file mode.
8. Install acceptance, in a real profile:

   ```bash
   dsh plugin --profile <name> add @jimmyzm/dsh-billing-card@<version>
   ```

   The command is documented in `dsh-plugin-development` → **Install and enable** as well, because that skill has to
   get the plugin into a profile on its own; keep the two in step if the syntax ever changes. Then tell the user a
   restart is required (the Host half is cached per process). After the restart,
   `curl -s -o /dev/null -w '%{http_code}' <gui>/deepseek-billing-card/data` must be `200`, and the payload must carry
   both currency tables plus the calendar.

## Verification

Every step leaves a one-line answer: the assertion count, the file list and sizes, the loaded `Object.keys`, the
**commit range and the section that claims each commit**, the release title against the tag, the notes-vs-changelog
diff (empty), the version/shasum/integrity, the run URL and conclusion, the install result and the route status.

## Failure handling

- Publish workflow red on OIDC: check the package's trusted-publisher configuration on npm, and that the workflow's
  `id-token: write` permission and the release event are intact. Do not work around it with `NPM_TOKEN` or a local
  publish.
- The publish job refuses the tag: its name is neither `v<version>` nor `<version>`. Fix the tag or the version, never
  the check.
- `npm view` says the package is not found or too new: the publish run had not finished; re-check the run before
  concluding anything.
- Shasum mismatch: first rule out file modes (`0600` vs `0644` in the tar header). If the members still differ, the
  published tarball came from a different tree — compare the extracted files against `git archive <tag>` and fix the
  tree, never the published tag.
- The release title is the product name plus the version (`DSH 计费卡片 v1.3.0`): that is not the rule.
  `gh release edit <tag> --title <tag>`.
- `## 未发布` / `## Unreleased` has entries that are months old: they shipped in some earlier version and nobody claimed
  them. Fold them into that version — changelog bugs, not a backlog — and leave the forward section for what is
  genuinely after the newest tag.
- Card unchanged after install: the app was not restarted (Host half) or the page was not reloaded (Client half).
  Verify the served module `rev` before believing the install landed.
- Extra files in the tarball: fix `files[]` or `.npmignore`; do not publish "as is" and warn.

## Never

- A local `npm publish`, `npm unpublish`, `npm deprecate`, or an `npm owner` change as a shortcut.
- Adding `docs/`, `test/`, `.agents/` or `AGENTS.md` back to `files[]` to "make the README work".
- A version bump that is not matched by a tag and a changelog-worthy README line.
- Reporting "published" from a workflow that has not finished, or "installed" without the restart note.
