#!/usr/bin/env node
// Mechanical reconciliation of one release's notes against the two changelogs.
//
// It reports facts — the version headings it found, the entry inventory with stable ids, the
// language layout of the notes — and runs only the checks that can fail without reading meaning.
// It never decides that two texts say the same thing: equal counts and matching words are not
// agreement, so the semantic mapping stays a manual step in SKILL.md.
//
// Paths:
//   --root   the repository root holding both changelogs (default: the current directory)
//   --notes  the notes file, or `-` for stdin. A relative path resolves against the current
//            directory, never against --root, so one command means one file wherever it is run.
// Both are printed as absolute paths before any verdict.
//
// Usage:
//   node .agents/skills/release-verification/reconcile-notes.mjs --tag v1.3.0 --notes <file|->
//
// Exit: 0 = no mechanical failure (semantic review still required), 2 = mechanical failure.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ZH = 'CHANGELOG.zh-CN.md';
const EN = 'CHANGELOG.md';
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u;
const SECTION_EMOJI = /(✨|🐛|🧩|⬆)/u;
const KNOWN_SECTION = /(新进展|已修复|兼容性|升级|what'?s new|added|fixed|changed|compatibility|upgrade)/i;
const RULE = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;

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
const cwd = process.cwd();
const rootDir = resolve(cwd, opt.root);
const notesPath = opt.notes === '-' ? '-' : resolve(cwd, opt.notes);
const checks = [];
const check = (verdict, name, detail) => checks.push({ verdict, name, detail });

// One fence tokenizer for every reader below. Blocks of fenced text are masked out before
// entries, headings or prose are read, so a `- item` inside a snippet is never an entry, a
// `## 1.3.0` inside one never becomes a heading, and a `---` inside one never splits a language.
// A fence closes on the same character, with at least as many of them as opened it, and with
// nothing but whitespace after: ` ``` ` inside a ` ```` ` block is content, not a closer.
const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

function fenceMask(lines) {
  const mask = [];
  let open = null;
  for (const line of lines) {
    const m = line.match(FENCE);
    if (open === null) {
      if (m) { open = { char: m[1][0], len: m[1].length }; mask.push(true); continue; }
      mask.push(false);
    } else if (m && m[1][0] === open.char && m[1].length >= open.len && m[2].trim() === '') {
      open = null; mask.push(true);
    } else {
      mask.push(true);
    }
  }
  return mask;
}

// `## 1.3.0`, `## 1.3.0 — 2026-10-28`, `## [1.3.0] - 2026-10-28`, `## v1.3.0`. The trailing
// lookahead keeps `1.3.0` from matching the heading of `1.3.0-rc.1`.
function headingFor(ver) {
  const esc = ver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^##\\s+\\[?\\s*v?${esc}\\s*\\]?(?![\\w.-])`);
}

function versionSection(text, ver) {
  const lines = text.split('\n');
  // The changelog is a document with snippets in it: a fenced `## 1.3.0` is an example, so the
  // heading search, the duplicate search and the end of the section all read this mask. Missing
  // it here would make a documented snippet look like a second release and cut a real entry off.
  const mask = fenceMask(lines);
  const re = headingFor(ver);
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (!mask[i] && re.test(lines[i])) hits.push(i);
  if (hits.length === 0) return null;
  const start = hits[0];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (!mask[i] && /^##\s/.test(lines[i])) { end = i; break; }
  }
  return {
    heading: lines[start],
    line: start + 1,
    lines: lines.slice(start + 1, end),
    mask: mask.slice(start + 1, end),
    alsoAt: hits.slice(1).map((i) => i + 1),
  };
}

// Blocks are separated by a horizontal rule outside a fence, so a `---` inside a snippet cannot
// split a language by accident. The language of a block is decided from its characters, never
// from its position; the order is checked separately.
function splitBlocks(lines, mask) {
  const out = [];
  let cur = { lines: [], mask: [] };
  for (let i = 0; i < lines.length; i++) {
    if (!mask[i] && RULE.test(lines[i])) { out.push(cur); cur = { lines: [], mask: [] }; continue; }
    cur.lines.push(lines[i]);
    cur.mask.push(mask[i]);
  }
  out.push(cur);
  return out.filter((b) => b.lines.join('').trim() !== '');
}

function language(block) {
  // The prose decides the language, so fenced snippets are left out: a Chinese block that
  // carries one long install command would otherwise count as mostly Latin.
  let cjk = 0;
  let ascii = 0;
  for (let i = 0; i < block.lines.length; i++) {
    if (block.mask[i]) continue;
    for (const ch of block.lines[i]) {
      if (CJK.test(ch)) cjk++;
      else if (/[A-Za-z]/.test(ch)) ascii++;
    }
  }
  const ratio = cjk / (cjk + ascii || 1);
  const label = ratio >= 0.5 ? 'zh' : ratio <= 0.1 ? 'en' : 'ambiguous';
  return { label, ratio, cjk, ascii };
}

// Entries are top-level bullets only. An indented bullet is a detail of its parent: it gets no id,
// because the mapping table has one row per change, and a nested line would silently double it.
function inventory(idPrefix, block, level) {
  const subs = [];
  let cur = null;
  let nested = 0;
  const heading = new RegExp(`^#{${level}}\\s+(.*\\S)\\s*$`);
  for (let i = 0; i < block.lines.length; i++) {
    if (block.mask[i]) continue;
    const line = block.lines[i];
    const h = line.match(heading);
    if (h) { cur = { title: h[1], entries: [] }; subs.push(cur); continue; }
    if (/^[ \t]{2,}[-*]\s+\S/.test(line)) { nested++; continue; }
    const b = line.match(/^[ \t]{0,1}[-*]\s+(.*\S)\s*$/);
    if (!b) continue;
    if (!cur) { cur = { title: '(no subsection)', entries: [] }; subs.push(cur); }
    cur.entries.push({ id: `${idPrefix}#${subs.reduce((n, s) => n + s.entries.length, 0) + 1}`, text: b[1] });
  }
  const count = subs.reduce((n, s) => n + s.entries.length, 0);
  return { subs, count, level, nested };
}

function sections(block) {
  const found = [];
  for (let i = 0; i < block.lines.length; i++) {
    if (block.mask[i]) continue;
    const h = block.lines[i].match(/^##\s+(.*\S)\s*$/);
    if (h) found.push(h[1]);
  }
  return found;
}

// Fenced lines are read here on purpose: the install command lives in one.
function pinned(block) {
  const pins = [];
  for (const line of block.lines) {
    for (const m of line.matchAll(/@jimmyzm\/dsh-billing-card@([0-9A-Za-z.\-]+)/g)) pins.push(m[1]);
  }
  return pins;
}

function date(heading) {
  const m = heading.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function load(file) {
  try {
    return { text: readFileSync(file, 'utf8') };
  } catch (err) {
    return { error: err.code === 'ENOENT' ? 'no such file' : err.message };
  }
}

// --- changelogs -------------------------------------------------------------

const zhFile = join(rootDir, ZH);
const enFile = join(rootDir, EN);
const zhRead = load(zhFile);
const enRead = load(enFile);
const zhs = zhRead.text ? versionSection(zhRead.text, version) : null;
const ens = enRead.text ? versionSection(enRead.text, version) : null;

for (const [file, read, sec] of [[ZH, zhRead, zhs], [EN, enRead, ens]]) {
  if (read.error) {
    check('FAIL', `${file}`, `cannot read ${join(rootDir, file)} (${read.error}) — --root resolves to ${rootDir}`);
    continue;
  }
  if (sec) check('PASS', `${file} heading`, `line ${sec.line}: ${sec.heading}`);
  else check('FAIL', `${file} heading`, `no "## ${version}" section — wrong version, or the entry was never written`);
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

// The section carries its own mask, so the fence scan that decided where the section ends is the
// one the inventory reads — a second scan of the slice could disagree with the first.
const zhBlock = zhs ? { lines: zhs.lines, mask: zhs.mask } : null;
const enBlock = ens ? { lines: ens.lines, mask: ens.mask } : null;
const zhInv = zhBlock ? inventory('zh', zhBlock, 3) : null;
const enInv = enBlock ? inventory('en', enBlock, 3) : null;

for (const [file, inv] of [[ZH, zhInv], [EN, enInv]]) {
  if (inv && inv.count === 0) check('REVIEW', `${file} section`, 'the version section has no bullets — confirm the release really changed nothing');
}

// --- notes ------------------------------------------------------------------

let body;
try { body = opt.notes === '-' ? readFileSync(0, 'utf8') : readFileSync(notesPath, 'utf8'); }
catch (err) { die(`cannot read notes ${notesPath} (${err.message})`); }

if (body.trim() === '') check('FAIL', 'notes', `${notesPath} is empty`);
else check('PASS', 'notes', `${notesPath}, ${Buffer.byteLength(body)} bytes`);

const noteLines = body.split('\n');
const bl = splitBlocks(noteLines, fenceMask(noteLines));
const langs = bl.map(language);
const zhAt = langs.map((l, i) => (l.label === 'zh' ? i : -1)).filter((i) => i >= 0);
const enAt = langs.map((l, i) => (l.label === 'en' ? i : -1)).filter((i) => i >= 0);
const shape = langs.map((l, i) => `block ${i + 1} = ${l.label} (CJK ${Math.round(l.ratio * 100)}%)`).join(', ');

if (bl.length === 0) {
  check('FAIL', 'notes layout', 'nothing to split — the body is empty');
} else if (bl.length === 2 && zhAt.length === 1 && enAt.length === 1 && zhAt[0] === 0 && enAt[0] === 1) {
  check('PASS', 'notes layout', shape);
} else if (bl.length === 2 && zhAt.length === 1 && enAt.length === 1) {
  check('FAIL', 'notes layout', `English comes first — the body is Chinese, then a --- rule, then English (${shape})`);
} else {
  check('FAIL', 'notes layout', `${bl.length} block(s); need exactly two — Chinese, a --- rule, English — ${shape}`);
}
const layoutOk = checks.filter((c) => c.name === 'notes layout').every((c) => c.verdict === 'PASS');

const LANG_BLOCK = { zh: zhAt[0], en: enAt[0] };
const noteSections = {};
const noteEntries = {};
for (const lang of ['zh', 'en']) {
  const i = LANG_BLOCK[lang];
  if (i === undefined) continue;
  noteSections[lang] = sections(bl[i]);
  noteEntries[lang] = inventory(lang === 'zh' ? 'zh-n' : 'en-n', bl[i], 2);
  if (!layoutOk) continue;
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
  if (noteEntries[lang].nested) check('REVIEW', `${lang} entries`, `${noteEntries[lang].nested} nested bullet(s) are not entries — map each with its parent`);
}

// --- report -----------------------------------------------------------------

const out = [];
out.push(`release ${opt.tag}  (version ${version})`);
out.push(`root  ${rootDir}`);
out.push(`notes ${opt.notes === '-' ? 'stdin' : notesPath}`);
out.push('');

out.push('MECHANICAL');
for (const c of checks) out.push(`  ${c.verdict.padEnd(6)} ${c.name.padEnd(22)} ${c.detail}`);
out.push('');

function dumpInventory(label, inv) {
  out.push(`  ${label}  ${inv.subs.length} subsection(s), ${inv.count} entry/entries${inv.nested ? `, ${inv.nested} nested` : ''}`);
  for (const s of inv.subs) {
    out.push(`    ${'#'.repeat(inv.level)} ${s.title} (${s.entries.length})`);
    for (const e of s.entries) out.push(`      ${e.id.padEnd(6)} ${e.text}`);
  }
}

out.push('INVENTORY — counts are not a verdict');
for (const [file, inv, read] of [[ZH, zhInv, zhRead], [EN, enInv, enRead]]) {
  out.push('');
  if (read.error) { out.push(`  ${file}  (cannot read ${join(rootDir, file)})`); continue; }
  if (!inv) { out.push(`  ${file}  (no "## ${version}" section)`); continue; }
  dumpInventory(file, inv);
}
for (const lang of ['zh', 'en']) {
  if (!noteEntries[lang]) continue;
  out.push('');
  const label = lang === 'zh' ? 'notes — Chinese block' : 'notes — English block';
  out.push(`  ${label}  sections: ${noteSections[lang].map((h) => `"${h}"`).join(', ') || '(none)'}`);
  dumpInventory('', noteEntries[lang]);
}
out.push('');

// --- what is left to a human ------------------------------------------------

const semantic = [];
if (noteSections.zh?.some((h) => /兼容|compatib/i.test(h)) || noteSections.en?.some((h) => /兼容|compatib/i.test(h))) {
  semantic.push('compatibility section present — the changelogs have none: confirm every line there traces to a changelog entry');
}
semantic.push('map every zh entry, every en entry and every notes bullet: covered / merged / omitted with a reason');
semantic.push('every notes bullet needs an entry in this version of BOTH changelogs; the commit range only confirms that entry is true');
semantic.push('a change that shipped without a changelog entry is a gap in the changelogs — fill both languages first, never cite the commit instead');
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
