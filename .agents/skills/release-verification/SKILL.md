---
name: release-verification
description: Verify this package before a commit, tag, GitHub release, or npm publish, and validate the artifact that comes back out — tarball contents, install path, provenance. Use whenever a version changes or an artifact is published or installed.
whenToUse: Use when bumping package.json version, cutting a GitHub release, checking whether an npm-published package is correct and installable, or validating provenance and file lists after a publish.
---

# Release verification

## When to use

Before any commit that changes `package.json`, before tagging, before a GitHub release, and any
time you need to prove that what is on npm matches what is in the repo and installs into DSH.

## Triggers

- "Publish", "release", "bump the version", "cut a tag".
- A change to `package.json` (`version`, `files`, `exports`, `dsh.*`) or `cordis.patch.yml`.
- A question about provenance, npm status, or whether a user's install picked up a change.
- Preparing a commit or push at all — this repository requires asking the user first.

## Preconditions

- **Ask the user before `git commit`, `git push`, creating a release, or publishing.** That is a
  standing instruction in `AGENTS.md`, not a per-task courtesy.
- Working tree clean, branch `main`, `origin/main` in sync, CI green on the head commit:
  ```bash
  git status --short && git log --oneline -1
  gh ci status   # or: gh run list --limit 3
  ```
- Nothing that only exists in `/tmp` is part of the release: anything worth keeping is already
  in `test/` or committed.

## Steps

1. Gate the code:
   ```bash
   node --check index.js && node --check parse.js && node --check client.js && npm test
   ```
   Zero `FAIL`; note the assertion count and compare it with the previous release.
2. Freeze the artifact shape:
   ```bash
   npm pack --dry-run
   ```
   Expected: 13 files — `index.js`, `parse.js`, `client.js`, `cordis.patch.yml`, `icon.svg`,
   `locale/en.json`, `locale/zh.json`, `README.md`, `README.zh-CN.md`, `CHANGELOG.md`,
   `CHANGELOG.zh-CN.md`, `LICENSE`, `package.json`. No `docs/`, no `test/`, no `.agents/`, no
   `AGENTS.md`, no `.github/`, no `.DS_Store`. Record the packed and unpacked sizes.
3. Prove the shipped Host half actually loads **as an installed package**, not as a folder copy:
   unpack the tarball into a temp directory, symlink it into a throwaway profile's
   `node_modules/@jimmyzm/dsh-billing-card`, then
   ```bash
   node -e "import('@jimmyzm/dsh-billing-card').then(m => console.log(Object.keys(m)))"
   ```
   It must expose `DATA_PATH` and `apply`, and `./parse.js` must resolve from the installed path.
4. Check the manifest tells the truth: `version` equals the tag you are about to cut;
   `repository`/`homepage`/`bugs` use the lowercase `jimmyzm/dsh-billing-card` path; `files`
   still matches step 2.
5. Release: push the commit, then create the tag and release. Publishing runs from
   Title the release with the bare English tag (`v1.2.1`); add a short English headline only for a
   major feature update (`v1.1.0 — ☁️ open-platform balance, provider-aware pricing`). The body is
   Chinese first, then the same sections in English, regardless.
   `.github/workflows/publish.yml` on the release, using npm trusted publishing (OIDC).
   **Never run `npm publish` locally** — provenance only exists when the workflow signs it.
   The job is idempotent: it asks the registry's version document first and prints
   `already on the registry; skipping publish` when the version exists, so a re-run
   is green instead of `E403 cannot publish over the previously published versions`.
   Do not read that skip as a failure, and do not bump the version just to re-run.
   ```bash
   gh release view v<version>
   gh run watch   # on the publish run
   ```
6. Validate the artifact that came back:
   ```bash
   npm view @jimmyzm/dsh-billing-card version dist-tags time --json
   npm view @jimmyzm/dsh-billing-card dist.shasum dist.integrity --json
   npm audit signatures   # provenance/attestation check
   ```
   `dist-tags.latest` must be the new version and the attestation must point at this repository and
   this tag. For the artifact itself, `shasum` equality only means something when every file has the
   same **mode** as the tagged tree: npm packs the working tree's modes, and a `0600` file becomes
   `0644` on a fresh CI checkout, which changes the shasum while the bytes stay identical. Normalise
   first, then compare:
   ```bash
   chmod 644 $(git ls-files)
   git archive <tag> | tar x -C /tmp/tag
   mkdir -p /tmp/reg /tmp/regx && npm pack --pack-destination /tmp/reg && tar xzf /tmp/reg/*.tgz -C /tmp/regx
   cd /tmp/regx/package && find . -type f | while read -r f; do cmp -s "$f" "/tmp/tag/$f" || echo "DIFF $f"; done
   ```
   With the modes normalised the local pack reproduces the registry tarball byte for byte (equal
   `shasum`); when it does not, compare the extracted trees and report a content diff — never a
   "mismatch" that is only a file mode.
7. Install acceptance, in a real profile:
   ```bash
   dsh plugin --profile <name> add @jimmyzm/dsh-billing-card@<version>
   ```
   Then tell the user a restart is required (the Host half is cached per process). After the
   restart, `curl -s -o /dev/null -w '%{http_code}' <gui>/deepseek-billing-card/data` must be
   `200`, and the payload must show both currency tables plus the calendar.

## Verification

Every step above leaves a one-line answer you paste into the report: the assertion count, the
file list and sizes, the loaded `Object.keys`, the version/shasum/integrity, the run URL and
conclusion, the install result and the route status. A release is verified only when the numbers
match the repo, not when the commands ran.

## Failure handling

- Publish workflow red on OIDC: check the package's trusted-publisher configuration on npm and
  that the workflow's `id-token: write` permission and the tag event are intact. Do not work
  around it with `NPM_TOKEN` or a local publish.
- `npm view` says the package is not found or too new: the publish run had not finished; re-check
  the run before concluding anything.
- Shasum mismatch: the published tarball came from a different tree — compare
  `npm pack --dry-run` on the tag against `npm view … dist.tarball` contents and fix the tree,
  never the published tag.
- Card unchanged after install: the app was not restarted (Host half) or the page was not
  reloaded (Client half). Verify the served module `rev` before believing the install landed.
- Extra files in the tarball: fix `files[]` or `.npmignore`; do not publish "as is" and warn.

## Prohibited

- `git push --force` on `main`, or rewriting/moving an already-published tag or version.
- Publishing without the user's explicit approval for that exact version.
- Local `npm publish`, `npm unpublish`, `npm deprecate`, or `npm owner` changes as a shortcut.
- Adding `docs/`, `test/`, `.agents/`, or `AGENTS.md` back to `files[]` to "make the README work".
- Shipping a version bump that is not matched by a tag and a changelog-worthy README line.
- Reporting "published" from a workflow that has not finished, or "installed" without the restart
  note.
