#!/usr/bin/env node
// Offline cases for reconcile-notes.mjs: language order, both fence characters, missing files,
// path resolution, and the mechanical boundaries. Every case builds its own temp tree, so no real
// changelog, version or release is touched.
//
// Run: node .agents/skills/release-verification/test-reconcile-notes.mjs

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'reconcile-notes.mjs');

const ZH_CL = '# 更新日志\n\n## 1.3.0 — 2026-10-28\n\n### 新增\n\n- 卡片重做。\n\n### 修复\n\n- 卡片消失。\n';
const EN_CL = "# Changelog\n\n## 1.3.0 — 2026-10-28\n\n### Added\n\n- The card was redesigned.\n\n### Fixed\n\n- The card disappeared.\n";
const PIN = 'dsh plugin --profile web add @jimmyzm/dsh-billing-card@1.3.0';
// Fences of a known length, so a four-backtick block holding three backticks needs no escaping.
const BT3 = '`'.repeat(3);
const BT4 = '`'.repeat(4);
const zhBlock = (extra = '') => `## ✨ 新进展\n\n- 卡片重做。\n${extra}\n## ⬆️ 升级\n\n\`\`\`bash\n${PIN}\n\`\`\`\n`;
const enBlock = (extra = '') => `## ✨ What's New\n\n- The card was redesigned.\n${extra}\n## ⬆️ Upgrade\n\n\`\`\`bash\n${PIN}\n\`\`\`\n`;
// `extra` stays inside the block of its own language: a Chinese detail line in the English block
// would make that block's prose mixed, which is a different test.
const notes = ({ zh = '', en = '' } = {}) => `${zhBlock(zh)}\n---\n\n${enBlock(en)}\n`;

let pass = 0;
let fail = 0;
const created = [];

// `mkdtempSync` hands back /var/... on macOS while a child process sees /private/var/...: compare
// real paths, or every path assertion fails on a symlink.
function tmp(prefix = 'dbc-rel-test-') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

function build(files) {
  const dir = tmp();
  const root = join(dir, 'repo');
  mkdirSync(root, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return { dir, root };
}

function invoke({ root, cwd, tag = 'v1.3.0', args = [], input, notesText, notesFile }) {
  const argv = [script, '--tag', tag];
  if (notesFile) argv.push('--notes', notesFile);
  else if (notesText !== undefined) {
    const p = join(cwd ?? root, 'notes.md');
    writeFileSync(p, notesText);
    argv.push('--notes', p);
  } else {
    argv.push('--notes', '-');
  }
  if (root) argv.push('--root', root);
  argv.push(...args);
  return spawnSync(process.execPath, argv, { cwd: cwd ?? root, encoding: 'utf8', input });
}

function expect(name, result, { code, has = [], lacks = [], matches = [] }) {
  const problems = [];
  if (result.error) problems.push(`could not start: ${result.error.message}`);
  if (result.status !== code) problems.push(`exit ${result.status}, expected ${code}`);
  const both = `${result.stdout}${result.stderr}`;
  for (const needle of has) if (!both.includes(needle)) problems.push(`missing ${JSON.stringify(needle)}`);
  for (const needle of lacks) if (both.includes(needle)) problems.push(`unexpected ${JSON.stringify(needle)}`);
  // A substring proves a word is there; a regex can hold the id to the text it must label, which
  // is the difference between "the count is 2" and "entry 2 is the right entry".
  for (const re of matches) if (!re.test(both)) problems.push(`no match for ${re}`);
  if (problems.length === 0) {
    pass++;
    console.log(`PASS ${name} (exit ${result.status})`);
  } else {
    fail++;
    console.log(`FAIL ${name} — ${problems.join('; ')}`);
    console.log(both.trimEnd().split('\n').map((l) => `     | ${l}`).join('\n'));
  }
}

// 1. the documented layout
{
  const { root } = build({ 'CHANGELOG.zh-CN.md': ZH_CL, 'CHANGELOG.md': EN_CL });
  expect('Chinese block, rule, English block', invoke({ root, notesText: notes() }), {
    code: 0,
    has: ['PASS   notes layout', 'block 1 = zh', 'block 2 = en', 'AUTOMATED: PASS (mechanical only'],
  });
}

// 2. the order the skill forbids
{
  const { root } = build({ 'CHANGELOG.zh-CN.md': ZH_CL, 'CHANGELOG.md': EN_CL });
  expect('English block first is rejected', invoke({ root, notesText: `${enBlock()}\n---\n\n${zhBlock()}\n` }), {
    code: 2,
    has: ['FAIL   notes layout', 'English comes first', 'AUTOMATED: FAIL'],
  });
}

// 3./4. a list inside a fence is not an entry, and the fence does close again — both characters
for (const [label, fence] of [['backtick', BT3], ['tilde', '~~~']]) {
  const { root } = build({ 'CHANGELOG.zh-CN.md': ZH_CL, 'CHANGELOG.md': EN_CL });
  const snippet = `\n${fence}bash\n- 假条目不该计入\n${fence}\n\n- 围栏之后是真条目。\n`;
  expect(`${label} fence hides a fake entry, then closes`, invoke({ root, notesText: notes({ zh: snippet }) }), {
    code: 0,
    has: ['PASS   notes layout', '2 entry/entries'],
    matches: [/zh-n#2\s+围栏之后是真条目/],
    lacks: ['假条目'],
  });
}

// 5./6. a changelog that is not there
{
  const { root } = build({ 'CHANGELOG.md': EN_CL });
  expect('missing CHANGELOG.zh-CN.md', invoke({ root, notesText: notes() }), {
    code: 2,
    has: ['cannot read', 'CHANGELOG.zh-CN.md', 'no such file'],
  });
}
{
  const { root } = build({ 'CHANGELOG.zh-CN.md': ZH_CL });
  expect('missing CHANGELOG.md', invoke({ root, notesText: notes() }), {
    code: 2,
    has: ['cannot read', 'CHANGELOG.md', 'no such file'],
  });
}

// 7. a notes path that does not exist
{
  const { root } = build({ 'CHANGELOG.zh-CN.md': ZH_CL, 'CHANGELOG.md': EN_CL });
  expect('notes path not found', invoke({ root, notesFile: join(root, 'nope.md') }), {
    code: 2,
    has: ['cannot read notes', 'nope.md'],
  });
}

// 8. the wrong version
{
  const { root } = build({ 'CHANGELOG.zh-CN.md': ZH_CL, 'CHANGELOG.md': EN_CL });
  expect('version missing from both changelogs', invoke({ root, tag: 'v9.9.9', notesText: notes() }), {
    code: 2,
    has: ['no "## 9.9.9" section'],
  });
}

// 9. the same version twice — a real duplicate, not a fenced example
{
  const dup = `${ZH_CL}\n## 1.3.0 — 2026-10-29\n\n### 新增\n\n- 重复。\n`;
  const dupLine = dup.split('\n').findIndex((l) => l.startsWith('## 1.3.0') && l.includes('10-29')) + 1;
  const { root } = build({ 'CHANGELOG.zh-CN.md': dup, 'CHANGELOG.md': EN_CL });
  expect('duplicated version heading', invoke({ root, notesText: notes() }), {
    code: 2,
    has: ['FAIL   CHANGELOG.zh-CN.md heading', `also at line ${dupLine}`, 'one version, one section'],
  });
}

// 10. an install command that follows `latest`
{
  const { root } = build({ 'CHANGELOG.zh-CN.md': ZH_CL, 'CHANGELOG.md': EN_CL });
  const latest = notes().replaceAll('@1.3.0', '@latest');
  expect('@latest is refused', invoke({ root, notesText: latest }), { code: 2, has: ['pins @latest'] });
}

// 11. one language only
{
  const { root } = build({ 'CHANGELOG.zh-CN.md': ZH_CL, 'CHANGELOG.md': EN_CL });
  expect('single-language body', invoke({ root, notesText: zhBlock() }), { code: 2, has: ['need exactly two'] });
}

// 12. stdin
{
  const { root } = build({ 'CHANGELOG.zh-CN.md': ZH_CL, 'CHANGELOG.md': EN_CL });
  expect('notes from stdin', invoke({ root, input: notes() }), {
    code: 0,
    has: ['notes stdin', 'PASS   notes layout'],
  });
}

// 13. the default --root is the current directory
{
  const { root } = build({ 'CHANGELOG.zh-CN.md': ZH_CL, 'CHANGELOG.md': EN_CL });
  const r = spawnSync(process.execPath, [script, '--tag', 'v1.3.0', '--notes', '-'], { cwd: root, encoding: 'utf8', input: notes() });
  expect('--root defaults to cwd', r, { code: 0, has: [`root  ${root}`] });
}

// 14. relative --root and --notes from somewhere else
{
  const base = tmp();
  const repo = join(base, 'repo');
  const cwd = join(base, 'work');
  mkdirSync(repo, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(repo, 'CHANGELOG.zh-CN.md'), ZH_CL);
  writeFileSync(join(repo, 'CHANGELOG.md'), EN_CL);
  writeFileSync(join(cwd, 'notes.md'), notes());
  const r = spawnSync(process.execPath, [script, '--tag', 'v1.3.0', '--root', '../repo', '--notes', 'notes.md'], { cwd, encoding: 'utf8' });
  expect('relative --root and --notes resolve against cwd', r, {
    code: 0,
    has: [`root  ${repo}`, `notes ${join(cwd, 'notes.md')}`],
  });
}

// 15. a nested bullet is a detail, not an entry
{
  const { root } = build({ 'CHANGELOG.zh-CN.md': ZH_CL, 'CHANGELOG.md': EN_CL });
  const nested = notes({ zh: '\n  - 细节：颜色跟随当前时段\n' });
  expect('nested bullet is not an entry', invoke({ root, notesText: nested }), {
    code: 0,
    has: ['nested bullet(s) are not entries', 'REVIEW'],
  });
}

// 16. an empty version section
{
  const { root } = build({ 'CHANGELOG.zh-CN.md': '# 更新日志\n\n## 1.3.0 — 2026-10-28\n', 'CHANGELOG.md': EN_CL });
  expect('empty changelog section is a review item', invoke({ root, notesText: notes() }), {
    code: 0,
    has: ['has no bullets', 'REVIEW'],
  });
}

// 17. a prerelease heading is not the release
{
  const zh = `# 更新日志\n\n## 1.3.0-rc.1 — 2026-10-20\n\n### 新增\n\n- 预发布条目。\n\n${ZH_CL.slice(ZH_CL.indexOf('## 1.3.0'))}`;
  const en = `# Changelog\n\n## 1.3.0-rc.1 — 2026-10-20\n\n### Added\n\n- The prerelease entry.\n\n${EN_CL.slice(EN_CL.indexOf('## 1.3.0'))}`;
  const { root } = build({ 'CHANGELOG.zh-CN.md': zh, 'CHANGELOG.md': en });
  expect('1.3.0-rc.1 is not read as 1.3.0', invoke({ root, notesText: notes() }), {
    code: 0,
    has: ['PASS   CHANGELOG.zh-CN.md heading'],
    lacks: ['预发布条目'],
  });
}

// 18. no notes at all
{
  const { root } = build({ 'CHANGELOG.zh-CN.md': ZH_CL, 'CHANGELOG.md': EN_CL });
  expect('empty notes', invoke({ root, notesText: '' }), { code: 2, has: ['is empty', 'nothing to split'] });
}

// 19. a changelog snippet that shows a release heading is an example, not a second release
{
  const zh = [
    '# 更新日志', '', '## 1.2.0 — 2026-09-30', '', '### 新增', '', '- 上一版。', '',
    `${BT3}md`, '## 1.3.0 — 2026-10-28', '', '- 示例里的条目', BT3, '',
    '## 1.3.0 — 2026-10-28', '', '### 新增', '', '- 卡片重做。', '',
  ].join('\n');
  const { root } = build({ 'CHANGELOG.zh-CN.md': zh, 'CHANGELOG.md': EN_CL });
  expect('fenced version heading is not a heading and not a duplicate', invoke({ root, notesText: notes() }), {
    code: 0,
    has: ['PASS   CHANGELOG.zh-CN.md heading', '1 entry/entries'],
    lacks: ['also at line', '示例里的条目'],
  });
}

// 20. a `##` inside a snippet must not end the section early
{
  const zh = [
    '# 更新日志', '', '## 1.3.0 — 2026-10-28', '', '### 新增', '', '- 卡片重做。', '',
    `${BT3}bash`, '## 这不是标题，只是片段里的注释', '- 片段里的条目', BT3, '',
    '### 修复', '', '- 卡片消失。', '',
  ].join('\n');
  const { root } = build({ 'CHANGELOG.zh-CN.md': zh, 'CHANGELOG.md': EN_CL });
  expect('fenced heading does not truncate the section', invoke({ root, notesText: notes() }), {
    code: 0,
    has: ['2 entry/entries'],
    matches: [/zh#2\s+卡片消失/],
    lacks: ['片段里的条目'],
  });
}

// 21. a shorter fence inside a longer one is content, in the changelog and in the notes
{
  const zh = [
    '# 更新日志', '', '## 1.3.0 — 2026-10-28', '', '### 新增', '', '- 卡片重做。', '',
    `${BT4}md`, BT3, '## 1.3.0 — 2026-10-29', '', '- 假条目', BT3, BT4, '',
  ].join('\n');
  const { root } = build({ 'CHANGELOG.zh-CN.md': zh, 'CHANGELOG.md': EN_CL });
  expect('four-backtick changelog fence holds three backticks', invoke({ root, notesText: notes() }), {
    code: 0,
    has: ['PASS   CHANGELOG.zh-CN.md heading', '1 entry/entries'],
    lacks: ['also at line', '假条目'],
  });
}
{
  const { root } = build({ 'CHANGELOG.zh-CN.md': ZH_CL, 'CHANGELOG.md': EN_CL });
  const snippet = `\n${BT4}md\n${BT3}\n- 假条目\n${BT3}\n${BT4}\n`;
  expect('four-backtick notes fence holds three backticks', invoke({ root, notesText: notes({ zh: snippet }) }), {
    code: 0,
    has: ['PASS   notes layout', '1 entry/entries'],
    lacks: ['假条目'],
  });
}

console.log('');
if (fail) {
  console.log(`${fail} case(s) failed, ${pass} passed — temp trees kept:`);
  for (const dir of created) console.log(`  ${dir}`);
  process.exit(1);
}
for (const dir of created) rmSync(dir, { recursive: true, force: true });
console.log(`ALL ${pass} CASES PASSED`);
