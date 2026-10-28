---
name: release-verification
description: Verify this package before a commit that moves the version or ships it, then validate the artifact that comes back — notes against both changelogs, tarball contents, install path, provenance. Every step leaves one line for the report.
whenToUse: Bumping package.json (version, files, exports, dsh.*) or cordis.patch.yml; cutting a tag or GitHub release; reconciling release notes with the two changelogs; or proving that a published npm artifact matches this tree and installs into DSH.
---

# Release verification

A release is verified when the numbers match the repo and the notes and both changelogs describe one release — not
when the commands ran. A step you did not run is not a step you may report as passed, "should pass" is not "passed",
and a script that counts bullets cannot tell you that two texts agree.

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
5. Assemble the release notes from the changelog — every line has a source there, but the notes are not a copy of
   it. Start by listing everything the tag will contain and checking that each commit is claimed by the new
   section:

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
   reproduces the notes rather than whatever is newest.

   The notes may merge related entries, drop a detail or use fewer words: they are what a user reads before
   upgrading, not a second changelog. What they may not do is lose a key change or gain a claim — step 6 is the
   check, and it is cheaper than an edit after publication.

   Compatibility is the one section a version does not earn on its own. Open it only when upgrading costs the user
   something — a migration step, a changed behaviour, a dropped Host version. Reassurance ("no new dependency, the
   data route is unchanged") does not qualify: it is the normal state, not a compatibility change. Once a real note
   appears, repeat it verbatim in the two minor releases that follow the one it was born in, then drop it: a note
   from `1.3.0` also runs in `1.4.0` and `1.5.0`, and `1.6.0` is the first release free of it. A repeat carries
   its origin — `(first noted in 1.3.0)` / 「（首次出现于 1.3.0）」 — while the release that birthed the note
   stays bare, so the last version in the chain still separates new entries from carried-forward ones. A user
   who skips two releases still reads what will break. The changelog's `### Compatibility` follows the same
   rule, because the notes and that section have to agree on what upgrading costs.

   Write them to a file rather than into the release command, so step 6 reads exactly what step 7 will publish:

   ```bash
   tag=v1.3.0
   notes=$(mktemp "${TMPDIR:-/tmp}/dbc-rel.XXXXXX") || exit 1
   echo "$notes"   # write the notes here, then carry this path into steps 6 and 7
   ```

6. Reconcile the notes with both changelogs — before the release exists, while a correction is still free.

   Name the version and the three texts first: the tag (`v1.3.0`), the heading it must match (`## 1.3.0`), and one
   section per changelog plus the notes file. No language is ever compared with the other: each notes block is read
   against the changelog of its own language.

   ```bash
   tag=v1.3.0
   node .agents/skills/release-verification/reconcile-notes.mjs --tag "$tag" --notes "$notes"
   ```

   It prints the paths it resolved, the headings it found, an inventory of both changelog sections and both notes
   blocks with stable ids (`zh#1…`, `en#1…`, `zh-n#1…`), and `PASS` / `FAIL` / `REVIEW` for what a machine can
   decide: a version heading exists once in each changelog, both headings carry the same date, the body is not
   empty, it splits into a Chinese block, a `---` rule and an English block **in that order** — Chinese first, as
   step 5 requires — and every pinned install command names this version. A `---` inside a fenced snippet splits
   nothing, and a `~~~` fence hides its contents as reliably as a backtick one. The ids are for the table, not for
   a verdict: exit `0` means the mechanical checks passed, and the script prints that much itself.

   `--root` is the repository that holds both changelogs (default: the current directory). `--notes` is the notes
   file, or `-` for stdin, and a relative path resolves against the **current directory**, never against `--root`.
   From the repo root neither flag is needed; from anywhere else pass both, and read the first two lines of the
   output — they are the resolved paths, so a wrong file shows up before any verdict.

   The script's own cases are offline and re-runnable:
   `node .agents/skills/release-verification/test-reconcile-notes.mjs` — language order, both fence characters, a
   missing changelog, a missing notes path, a duplicated heading, `@latest`. Rerun them after editing the script;
   an audit is only as good as its cases.

   The rest is reading. One row per changelog entry, one table per language:

   | id | changelog entry | in the notes | verdict |
   | --- | --- | --- | --- |
   | `zh#1` | 卡片重做：首行是倒计时… | `zh-n#1` | covered |
   | `zh#7` | 说明文字的行高（`18px` → `16px`） | — | omitted: 2 px, nothing to act on |

   - **Covered** — one entry, one bullet; the wording is free to differ.
   - **Merged** — several entries, one bullet: name every id in the cell. The counts then differ, which is legal.
   - **Omitted** — allowed only when no user acts on or notices the change. A new capability, a changed behaviour,
     a fix for something visible, a compatibility cost and a limit a user can hit are **key**; omitting one fails
     the release however small the diff is.
   - Every id in the inventory lands in exactly one row. A row you cannot decide is `UNVERIFIED` — not "probably
     fine", and never counted as covered.

   Then turn it around: every notes bullet has to be supported by an entry in **this version of both changelogs**.
   The commits in `git log <previous-tag>..<tag>` are evidence that those entries are true — never a substitute for
   one. A change that shipped without a changelog entry is a gap in the changelogs: write it into `CHANGELOG.md`
   and `CHANGELOG.zh-CN.md` first, re-run this step, and only then let the notes mention it. A bullet about
   something from an earlier release, or about something no entry records, comes out of the notes.

   Last, the two changelogs against each other: pair the entries (`zh#1 ↔ en#1` …) and confirm each version records
   the same set of changes. They are two editions of one record, so a one-sided entry is a changelog bug, not a
   style choice. Pair them by hand, never by diffing the text.

   Three verdicts, decided and reported separately:

   - `中文 CHANGELOG` — the section exists, its entries are changes in this range, and none of the range is missing.
   - `英文 CHANGELOG` — the same, and it lists the same set as the Chinese file.
   - `Release Notes` — every key change appears in both languages, and no line goes beyond what the changelogs
     record.

   Two `PASS` and one `UNVERIFIED` is not a pass. The release ships on three `PASS`, with the omission rows stated
   and their reasons.

7. Cut the tag and the release; publishing runs from `.github/workflows/publish.yml` on the release event, using npm
   trusted publishing (OIDC).

   ```bash
   tag=v1.3.0
   test -s "$notes" || { echo "empty notes: $notes"; exit 1; }   # $notes: the file step 6 reconciled
   git tag "$tag" && git push origin "$tag"
   gh release create "$tag" --title "$tag" --notes-file "$notes"
   gh release view "$tag" --json name,tagName --jq '.name + " " + .tagName'   # name == tag
   gh run watch   # on the publish run
   ```

   What the release carries must be the file step 6 reconciled. `gh` adds one newline to the body, so compare the
   two with the trailing blanks removed rather than byte for byte:

   ```bash
   work=$(mktemp -d "${TMPDIR:-/tmp}/dbc-post.XXXXXX") || exit 1
   gh release view "$tag" --json body --jq .body > "$work/published.md" || exit 1
   diff -u <(printf '%s\n' "$(cat "$notes")") <(printf '%s\n' "$(cat "$work/published.md")") \
     && echo "published body == the reviewed file"
   rm -rf "$work"
   ```

   Any other difference means the body was edited after the review, so the reconciliation no longer describes what
   shipped: re-run step 6 against the published body (`--notes -` reads stdin), then publish the fix with
   `gh release edit "$tag" --notes-file "$notes"`.

   The workflow refuses a tag whose name is neither `v<version>` nor `<version>`, so a mismatch fails before anything
   is published. **Never run `npm publish` locally** — provenance only exists when the workflow signs it. The job is
   idempotent: it asks the registry's version document first and prints `already on the registry; skipping publish`
   when the version exists, so a re-run is green instead of `E403 cannot publish over the previously published
   versions`. Do not read that skip as a failure, and do not bump the version just to re-run. Editing a release
   afterwards does **not** re-publish — the workflow reacts to `published` (plus a manual dispatch) — so a wrong title
   or a missing bullet is cheap to fix.

8. Validate the artifact that came back:

   ```bash
   npm view @jimmyzm/dsh-billing-card version dist-tags time --json
   npm view @jimmyzm/dsh-billing-card dist.shasum dist.integrity --json
   npm audit signatures   # provenance/attestation check
   ```

   `dist-tags.latest` must be the new version and the attestation must point at this repository and this tag. For the
   artifact itself, pack the **tagged tree**, not the working copy: `git archive` restores git's own modes
   (`0644` / `0755`), so the checkout is left alone and no `chmod` is needed. Compare contents first; the shasum only
   means something once the modes match.

   ```bash
   set -o pipefail      # otherwise a failing `git archive` looks like an empty extraction
   tag=v1.3.0           # the tag under verification
   work=$(mktemp -d "${TMPDIR:-/tmp}/dbc-verify.XXXXXX") || exit 1
   mkdir -p "$work/tag" "$work/reg" "$work/regx" || exit 1

   git archive "$tag" | tar x -C "$work/tag" || exit 1            # modes come from git, not the checkout
   ( cd "$work/tag" && npm pack --pack-destination "$work/reg" ) || exit 1
   tar xzf "$work"/reg/*.tgz -C "$work/regx" || exit 1

   ( cd "$work/regx/package" && find . -type f | while read -r f; do
       cmp -s "$f" "$work/tag/$f" || echo "DIFF $f"
     done )

   shasum -a 1 "$work"/reg/*.tgz     # against `npm view @jimmyzm/dsh-billing-card dist.shasum`
   rm -rf "$work"                    # only once the report line is written
   ```

   Zero `DIFF` lines and an equal shasum mean the registry serves this tag. A differing shasum with every file equal
   is a **mode** difference, not a content one: name the files with the line below and `chmod` only those, never the
   tree — the tree is what is being verified. If a step fails, the directory is kept: read the error, then delete it.

   ```bash
   git ls-files | xargs ls -l | awk '$1 !~ /^d/ && $1 !~ /r..r..r../ { print $1, $NF }'
   ```

9. Install acceptance, in a real profile:

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
**commit range and the section that claims each commit**, the release title against the tag, the version/shasum/
integrity, the run URL and conclusion, the install result and the route status.

The documents get three verdicts of their own — `中文 CHANGELOG`, `英文 CHANGELOG`, `Release Notes` — each `PASS`,
`FAIL` or `UNVERIFIED`, with the two mapping tables, every omission and its reason, and every row still unresolved.
The mechanical run is quoted with its exit code and labelled mechanical: `AUTOMATED: PASS` is never reported as "the
notes match the changelogs", because nothing has compared them. If the script or its cases changed in this release,
their exit code goes into the report too, and no `PASS` is reported from a run that skipped them.

## Failure handling

- Publish workflow red on OIDC: check the package's trusted-publisher configuration on npm, and that the workflow's
  `id-token: write` permission and the release event are intact. Do not work around it with `NPM_TOKEN` or a local
  publish.
- The publish job refuses the tag: its name is neither `v<version>` nor `<version>`. Fix the tag or the version, never
  the check.
- `npm view` says the package is not found or too new: the publish run had not finished; re-check the run before
  concluding anything.
- Shasum mismatch: the pack came from a tree whose modes differ (`0600` vs `0644` in the tar header). Pack
  `git archive <tag>` instead of the working copy; only if the members still differ is it a different tree — then fix
  the tree, never the published tag.
- The release title is the product name plus the version (`DSH 计费卡片 v1.3.0`): that is not the rule.
  `gh release edit <tag> --title <tag>`.
- `reconcile-notes.mjs` exits `2`: read the `FAIL` lines — a version heading missing from a changelog, two headings
  dated differently, a body that does not split into Chinese and English, an install command pinning another version
  or `@latest`. Fix the document, never the script.
- `FAIL notes layout … English comes first`: the body is Chinese, a `---` rule, English. Move the blocks; the rule
  is not the script's to relax.
- `cannot read …/CHANGELOG.zh-CN.md` or `cannot read notes …`: `--root` or `--notes` resolved somewhere else. The
  first two output lines print both paths, and a relative `--notes` is anchored at the current directory.
- A changelog entry the notes drop and that is not plainly non-key: add the bullet, or record the omission and the
  reason. Silence is neither, and "it is in the changelog" is not an argument — a reader of the release page never
  opens it.
- A notes bullet with no changelog entry behind it: the changelogs are incomplete, not the notes. Add the entry to
  both files — a commit proves the change is real, it does not excuse the missing entry — then re-run step 6.
- Counts that differ while the mapping is complete are legal — one bullet can carry three entries. The mapping
  decides, not the number.
- The published body differs from the reviewed file: the release was edited after step 6, so the verdicts describe
  a text nobody can read. Re-run step 6 on the published body, then `gh release edit --notes-file`.
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
- Reporting the notes as verified because the counts matched, the bullets diffed clean, or the script exited `0`.
- Checking a notes block against the changelog of the other language, or diffing the two changelogs as text.
