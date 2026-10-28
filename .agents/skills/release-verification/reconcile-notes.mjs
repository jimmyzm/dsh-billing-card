#!/usr/bin/env node
// Mechanical reconciliation of one release's notes against the two changelogs.
//
// It reports facts — the version headings it found, the entry inventory with stable ids, the
// language layout of the notes — and runs only the checks that can fail without reading meaning.
// It never decides that two texts say the same thing: equal counts and matching words are not
// agreement, so the semantic mapping stays a manual step in SKILL.md.
//
// Usage:
//   node .agents/skills/release-verification/reconcile-notes.mjs --tag v1.3.0 --notes <file|->
//
// Exit: 0 = no mechanical failure (semantic review still required), 2 = mechanical failure.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ZH = 'CHANGELOG.zh-CN.md';
const EN = 'CHANGELOG.md';
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u;
const SECTION_EMOJI = /(✨|🐛|🧩|⬆)/u;
const KNOWN_SECTION = /(新进展|已修复|兼容性|升级|what'?s new|added|fixed|changed|compatibility|upgrade)/i;

function usage() {
  console.error('usage: reconcile-notes.mjs --tag <vX.Y.Z> --notes <file|-> [--root <dir>]');
}

function die(msg) {
  console.error(`reconcile-notes: ${msg}`);
  process.exit(2);
}

const opt = { root: '.', tag: null, notes: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--tag') opt.tag = argv[++i];
  else if (a === '--notes') opt.notes = argv[++i];
  else if (a === '--root') opt.root = argv[++i];
  else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else die(`unknown argument: ${a}`);
}
if (!opt.tag || !opt.notes) { usage(); process.exit(2); }
if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(opt.tag)) die(`tag is neither v<version> nor <version>: ${opt.tag}`);

const version = opt.tag.replace(/^v/, '');
const checks = [];
const check = (verdict, name, detail) => checks.push({ verdict, name, detail });

function readNotes(path) {
  if (path === '-') return readFileSync(0, 'utf8');
  return readFileSync(path, 'utf8');
}

// `## 1.3.0`, `## 1.3.0 — 2026-10-28`, `## [1.3.0] - 2026-10-28`, `## v1.3.0`. The trailing
// lookahead keeps `1.3.0` from matching the heading of `1.3.0-rc.1`.
function headingFor(ver) {
  const esc = ver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^##\\s+\\[?\\s*v?${esc}\\s*\\]?(?![\\w.-])`);
}

function versionSection(text, ver) {
  const lines = text.split('\n');
  const re = headingFor(ver);
  const hits = lines.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
  if (hits.length === 0) return null;
  const start = hits[0];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return { heading: lines[start], line: start + 1, lines: lines.slice(start + 1, end), alsoAt: hits.slice(1).map((i) => i + 1) };
}

function inventory(idPrefix, lines, level = 3) {
  const subs = [];
  let cur = null;
  let inFence = false;
  const heading = new RegExp(`^#{${level}}\\s+(.*\\S)\\s*$`);
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = line.match(heading);
    if (h) { cur = { title: h[1], entries: [] }; subs.push(cur); continue; }
    const b = line.match(/^\s{0,2}[-*]\s+(.*\S)\s*$/);
    if (!b) continue;
    if (!cur) { cur = { title: '(no subsection)', entries: [] }; subs.push(cur); }
    cur.entries.push({ id: `${idPrefix}#${subs.reduce((n, s) => n + s.entries.length, 0) + 1}`, text: b[1] });
  }
  const count = subs.reduce((n, s) => n + s.entries.length, 0);
  return { subs, count, level };
}

// Blocks are separated by a horizontal rule outside a code fence, so a `---` inside a snippet
// cannot split a language by accident. Order is not assumed: the language of a block is decided
// from its characters, and a block that is neither clearly Chinese nor clearly English stays
// unassigned.
function blocks(text) {
  const out = [];
  let cur = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push(cur); cur = []; continue; }
    cur.push(line);
  }
  out.push(cur);
  return out.filter((b) => b.join('').trim() !== '');
}

function language(block) {
  // The prose decides the language, so fenced snippets are left out: a Chinese block that
  // carries one long install command would otherwise count as mostly Latin.
  let cjk = 0;
  let ascii = 0;
  let inFence = false;
  for (const line of block) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    for (const ch of line) {
      if (CJK.test(ch)) cjk++;
      else if (/[A-Za-z]/.test(ch)) ascii++;
    }
  }
  const ratio = cjk / (cjk + ascii || 1);
  const label = ratio >= 0.5 ? 'zh' : ratio <= 0.1 ? 'en' : 'ambiguous';
  return { label, ratio, cjk, ascii };
}

function sections(block) {
  const found = [];
  for (const line of block) {
    const h = line.match(/^##\s+(.*\S)\s*$/);
    if (h) found.push(h[1]);
  }
  return found;
}

function pinned(block) {
  const pins = [];
  for (const line of block) {
    for (const m of line.matchAll(/@jimmyzm\/dsh-billing-card@([0-9A-Za-z.\-]+)/g)) pins.push(m[1]);
  }
  return pins;
}

function date(heading) {
  const m = heading.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// --- mechanical checks ------------------------------------------------------

const zhs = versionSection(readFileSync(join(opt.root, ZH), 'utf8'), version);
const ens = versionSection(readFileSync(join(opt.root, EN), 'utf8'), version);

if (zhs) check('PASS', `${ZH} heading`, `line ${zhs.line}: ${zhs.heading}`);
else check('FAIL', `${ZH} heading`, `no "## ${version}" section — wrong version, or the entry was never written`);

if (ens) check('PASS', `${EN} heading`, `line ${ens.line}: ${ens.heading}`);
else check('FAIL', `${EN} heading`, `no "## ${version}" section — wrong version, or the entry was never written`);

for (const [file, sec] of [[ZH, zhs], [EN, ens]]) {
  if (sec?.alsoAt.length) {
    check('FAIL', `${file} heading`, `the same version is also at line ${sec.alsoAt.join(', ')} — one version, one section`);
  }
}

if (zhs && ens) {
  const [dz, de] = [date(zhs.heading), date(ens.heading)];
  if (!dz || !de) check('REVIEW', 'release date', 'a heading carries no YYYY-MM-DD date — confirm both describe the same release');
  else if (dz === de) check('PASS', 'release date', `${dz} in both headings`);
  else check('FAIL', 'release date', `${ZH} says ${dz}, ${EN} says ${de}`);
}

let body = '';
try { body = readNotes(opt.notes); } catch (err) { die(`cannot read notes: ${err.message}`); }
const bodyBytes = Buffer.byteLength(body);
if (body.trim() === '') check('FAIL', 'notes', `${opt.notes} is empty`);
else check('PASS', 'notes', `${opt.notes}, ${bodyBytes} bytes`);

const bl = blocks(body);
const langs = bl.map(language);
const zhBlocks = langs.map((l, i) => (l.label === 'zh' ? i : -1)).filter((i) => i >= 0);
const enBlocks = langs.map((l, i) => (l.label === 'en' ? i : -1)).filter((i) => i >= 0);

if (bl.length === 0) {
  check('FAIL', 'notes layout', 'nothing to split — the body is empty');
} else if (bl.length === 2 && zhBlocks.length === 1 && enBlocks.length === 1) {
  const desc = langs.map((l, i) => `block ${i + 1} = ${l.label} (CJK ${Math.round(l.ratio * 100)}%)`).join(', ');
  check('PASS', 'notes layout', desc);
} else {
  const shape = langs.map((l, i) => `block ${i + 1}: ${l.label} (CJK ${Math.round(l.ratio * 100)}%, ${l.cjk} CJK / ${l.ascii} latin)`).join('; ');
  check('FAIL', 'notes layout', `${bl.length} block(s), need one Chinese and one English — ${shape}. Split them by hand; this script will not guess an order`);
}

const LANG_INDEX = { zh: zhBlocks[0], en: enBlocks[0] };
const noteSections = {};
const noteEntries = {};
for (const lang of ['zh', 'en']) {
  const i = LANG_INDEX[lang];
  if (i === undefined) continue;
  noteSections[lang] = sections(bl[i]);
  noteEntries[lang] = inventory(lang === 'zh' ? 'zh-n' : 'en-n', bl[i], 2);
  const pins = pinned(bl[i]);
  if (pins.length === 0) {
    check('REVIEW', `${lang} upgrade command`, 'no pinned install command found — confirm the section is genuinely absent, not forgotten');
  } else if (pins.every((p) => p === version)) {
    check('PASS', `${lang} upgrade command`, `@${version}`);
  } else if (pins.every((p) => p === 'latest')) {
    check('FAIL', `${lang} upgrade command`, 'pins @latest — the command must reproduce this release');
  } else {
    check('FAIL', `${lang} upgrade command`, `names ${[...new Set(pins)].map((p) => '@' + p).join(', ')}, tag is @${version}`);
  }
  const unknown = noteSections[lang].filter((h) => !SECTION_EMOJI.test(h) && !KNOWN_SECTION.test(h));
  if (unknown.length) check('REVIEW', `${lang} section headings`, `unrecognised: ${unknown.map((h) => `"${h}"`).join(', ')} — every line under one needs a verdict by hand`);
  if (noteEntries[lang].count === 0) check('REVIEW', `${lang} entries`, 'no bullets — a release with no change is a version bump, not a release');
}

// --- inventory --------------------------------------------------------------

const out = [];
out.push(`release ${opt.tag}  (version ${version})`, '');

out.push('MECHANICAL');
for (const c of checks) out.push(`  ${c.verdict.padEnd(6)} ${c.name.padEnd(28)} ${c.detail}`);
out.push('');

function dumpInventory(label, inv) {
  out.push(`  ${label}  ${inv.subs.length} subsection(s), ${inv.count} entry/entries`);
  for (const s of inv.subs) {
    out.push(`    ${"#".repeat(inv.level)} ${s.title} (${s.entries.length})`);
    for (const e of s.entries) out.push(`      ${e.id.padEnd(6)} ${e.text}`);
  }
}

out.push('INVENTORY — counts are not a verdict');
for (const [file, sec] of [[ZH, zhs], [EN, ens]]) {
  if (!sec) { out.push(`  ${file}  (no section)`); continue; }
  out.push('');
  dumpInventory(file, inventory(file === ZH ? 'zh' : 'en', sec.lines));
}
for (const lang of ['zh', 'en']) {
  if (!noteEntries[lang]) continue;
  out.push('');
  const label = lang === 'zh' ? 'notes — Chinese block' : 'notes — English block';
  out.push(`  ${label}  sections: ${noteSections[lang].map((h) => `"${h}"`).join(', ') || '(none)'}`);
  dumpInventory('', noteEntries[lang]);
}
out.push('');

// --- what is left to a human -----------------------------------------------

const semantic = [];
if (noteSections.zh?.some((h) => /兼容|compatib/i.test(h)) || noteSections.en?.some((h) => /兼容|compatib/i.test(h))) {
  semantic.push('compatibility section present — the changelogs have none: confirm every line there traces to a changelog entry or a commit in the range');
}
semantic.push('map every zh entry, every en entry and every notes bullet: covered / merged / omitted with a reason');
semantic.push('check the reverse: each notes bullet has a source in this version, not in a neighbour');
semantic.push('check zh section and en section list the same changes; a one-sided entry is a changelog bug');

out.push('LEFT TO THE SEMANTIC REVIEW (SKILL.md step 6 — this script cannot pass or fail them)');
for (const s of semantic) out.push(`  - ${s}`);
out.push('');

const failures = checks.filter((c) => c.verdict === 'FAIL').length;
const reviews = checks.filter((c) => c.verdict === 'REVIEW').length;
if (failures) {
  out.push(`AUTOMATED: FAIL (${failures}) — fix these before publishing. No semantic verdict has been made.`);
} else {
  out.push(`AUTOMATED: PASS (mechanical only, ${reviews} review item(s)) — this is not agreement between the texts.`);
  out.push('The release stays UNVERIFIED until the mapping above is complete and reported.');
}
console.log(out.join('\n'));
process.exit(failures ? 2 : 0);
