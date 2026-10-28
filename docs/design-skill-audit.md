# 设计知识来源报告

本文件回答一个问题：`.agents/skills/dsh-card-design/SKILL.md` 里的每一条规则，凭什么这么写。

范围是 2026-10 这次「卡片重设计 + 自绘 tooltip + README banner」，做回溯与文档；同期附带的死代码清理见第 8 节。

> **定位**：本文件是审计证据与决策记录，**不是规范**。设计数值的唯一权威是
> `.agents/skills/dsh-card-design/SKILL.md` 的 **Values**；`AGENTS.md` 只保留业务不变量与兼容性守卫。
>
> **读这一页的顺序**——这里混着三种内容，别一起读：
>
> - **历史记录**：第 1–7 节与第 8 节的验证结果是 2026-10 审计当时跑出来的证据。`已确认` 说的是「当时执行过、
>   看到过」，不是「今天仍然如此」；引用任何一条之前，先重跑它给出的命令。
> - **当前规范**：只有一个地方——skill 的 **Values**。本文件没有一条数值可以当规范引用。
> - **未完成事项**：全部在第 6 节（`--dbc-label-quiet` 的去向、对比度数值是否需要重测）。它们至今**没有**关闭：
>   读到「当时记作 4.71:1」不等于「已经查清今天的值是 4.71:1」。
>
> **2026-10-29 的整理**：这些数值已从 `AGENTS.md` 迁入该 skill，正文里的 `AGENTS.md:NNN` 一律改为章节名
> （那些行号现在指向别处，`AGENTS.md` 已瘦身到一百多行）。正文里的 `client.js:NNN` 是 2026-10 的快照，请按同一行
> 给出的标识符（token 名、类名、常量名）定位。除此之外正文保持原样。
>
> 这次整理目前只在 `preview` 分支（`67c2049` 起），**尚未合入 `main`**。打了标签的 `v1.3.0`（`689e463`）里仍是
> 旧分工：`AGENTS.md` 251 行、数值写在它的 `## Design scale` 与 `## Hover text` 里；skill 202 行，开头就写着
> 「The *values* live in `AGENTS.md`」。同一句「数值已迁入 skill」在两条分支上真假相反，读之前先确认自己在哪条
> 分支上——分支名只说明改动停在哪里，不说明它已经完成。本文凡是给出结论性状态的地方，都附了提交号或命令；没附的，
> 一律按历史记录读。

标记约定：

- **已确认** —— 本会话中我亲自执行、抓取或读取得到的证据（命令、文件、行号、提交）。
- **来源待确认** —— 只能确认技能内容与作者声明，无法确认上游的某个具体版本/提交。
- **推测** —— 不写。凡属推测一律落在第 6 节，等人工补充。

三个标记都只对**审计当时**有效。2026-10-29 没有重新取证的历史条目，一律按历史记录读，不当作现状。

---

## 1. 找到的第三方 Skills 及来源

| Skill | 安装方式（用户确认的标准命令） | 本次会话实际执行的命令 | 版本 / 提交 | 许可证 |
| --- | --- | --- | --- | --- |
| `refactoring-ui` | `npx skills add https://github.com/s0xdk/refactoring-ui-skill --skill refactoring-ui` | `npx --yes skills use "https://github.com/s0xdk/refactoring-ui-skill" --skill "refactoring-ui"`（`use` 把全文打印到 stdout，存于 `/tmp/skills-refactoring-ui.txt`，279 行） | frontmatter 只有 `name` + `description`，**无版本号** → 提交待确认 | MIT，`Copyright (c) 2026 s13k`（目录内 `LICENSE`） |
| `ui-taste` | `npx skills add https://uizze.sh/` | `npx skills use "https://uizze.sh/" --skill "ui-taste"`（用户 m04220 指定，输出存于 `/tmp/skills-ui-taste.txt`，87 行） | `MANIFEST.json`：`version "uizze-design-v14"`，`designStack.version 4.6.0`，`commit 8a0e198da34ebc5b936a9d5975fb7a3b1cf353b7`；frontmatter `metadata.version 0.3.0`，author `UIZZE <business@uizze.com>` | Apache-2.0，附 `NOTICE`（声明部分内容改编自 Impeccable） |
| `banner-design` | `npx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill banner-design` | `npm_config_cache=/tmp/npm-cache npx -y skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill banner-design --agent '*' -y --copy`（用户 m07023 指定） | frontmatter：`metadata.author: claudekit`，`metadata.version "1.0.0"`；安装器的 `skills-lock.json` 已删 → 上游提交待确认 | MIT（仅声明，未随附 LICENSE 文本） |

三者都以临时目录形式出现过，路径可核：

- `/var/folders/j5/yv68ck3j24v02d7n8rzs78mr0000gn/T/skills-use-2ayWrd/refactoring-ui/`（`SKILL.md` `README.md` `LICENSE` `assets/` `references/`）
- `…/T/skills-use-GiX9SQ/ui-taste/`（`reference/{polish,craft,distill,audit,new-work,operate,overdrive,ios}.md`、`references/`、`MANIFEST.json`、`CHECKSUMS.sha256`、`MODIFICATIONS.md`、`LICENSE`、`NOTICE`）
- `banner-design` 曾被 vendor 进仓库（提交 `840a28e`），现按用户要求删除 vendored 副本、只作为第三方来源记录：仓库内只剩 `.agents/skills/{dsh-card-design,dsh-plugin-development,billing-regression-testing,release-verification}` 四个项目自有 skill。

---

## 2. 本次重设计中实际使用它们的证据

### 2.1 `refactoring-ui`：一次性的「取值收敛」pass

- 当时 `CARD_CSS` 里存在 `15 / 12.5 / 12 / 11.5 / 11 / 10.5 / 10` 七个字号、`1,2,3,4,5,6,8,9,10` 九个间距值。按该 skill 的「从固定刻度取值、相邻值至少差 ~25%」规则，一次性收敛为 3 个字号与 `4 / 8 / 12` 三档间距，圆点 `5px → 4px`，tooltip 文字不透明度 `.72 → .8`、`.88 → .9`，共 23 条 CSS 规则。
- 这些具体值随后又被换向重设计整体替换；现值以 skill 的 **Scale** 与 **Contrast** 为准。
- 同一轮在 `AGENTS.md` 新增了一段刻度规则（2026-10-29 起迁入 skill 的 **Scale**），避免后来者再手填半档值。
- 那次刻度（`12/14/16`）在设计换向后的最终实现里被 `11 / 13 / 17 / 20` 取代——**不是推翻该规则，而是同一条规则换了刻度**。当时的新 skill 因此刻意只写「移动一档」而不写像素；现在 skill 的 **Scale** 记下了当前刻度，换刻度时须同步改它。

### 2.2 `ui-taste`：像素级对比度审计与「先定位漂移类型」

- 读取了 `reference/polish.md` 与 `reference/craft.md`，按其中的**在渲染后的背景上实测对比度**要求，写了 Python WCAG 脚本，从 DSH asar 里解析出宿主 token 的真实色值（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`），逐对测量。
- 量出的结论直接改了实现：chip 的文字用原始状态色在自身浅底上只有 **2.05:1**（浅色主题），于是改为 `color-mix(state 50%, ink)`；三级淡色文字在纯白上 3.71:1，于是把标签色压暗一级（当时记作 `--dbc-label-quiet`，4.71:1）。该 token 名已不在代码里；今天的对应层级见 skill 的 **Contrast**，去向待确认见第 6 节。
- 该 skill 的「漂移分类：缺 token / 一次性取值 / 概念错配 / 局部缺陷，然后在最窄的正确层级修」被沿用为 skill 的 **Steps → Before you change** 第 2 步。

### 2.3 `banner-design`：确实驱动了 banner 的产出流程

- 尺寸取自其 `references/banner-sizes-and-styles.md` 的 web hero 区间 → 定 `1200×320`；安全区、单一 CTA、≤2 字体、按精确视口截图并核对像素尺寸，都体现在 `/tmp/banners/gen.mjs` 与最终的 `docs/banners/minimal-{zh,en}-1200x320.png`。
- 实际交付走完了它的五步：三套方向 → 用户选 A → 文案迭代（去「账单」、谷/峰上色、安装命令改正）→ 精确尺寸导出 → 并排展示。

---

## 3. 第三方方法与最终实现的对应关系

| 第三方规则 | 最终落点（可核实） | 状态 |
| --- | --- | --- |
| 从固定刻度取间距/字号/圆角 | `dsh-card-design` → **Scale**；`client.js:624`（20px/25px）、`:634`（11px/14px）、`:638`（13px/16px）、`:635` `--dbc-r-inner` | 采用 |
| 相邻刻度差 ≥ ~25% | 字号 `11 / 13 / 17 / 20`；间距当时收敛为 `4 / 6 / 8 / 12`，后来加密到 `4 / 5 / 6 / 8 / 10 / 12`（`dsh-card-design` → **Scale**） | 采用 |
| 用字重与颜色建立层级，而非字号 | 金额 `660`、模型名 `500`、其余 `400`（`client.js:624,634,639`）；淡出用 `--dbc-ink-3` 而非缩小 | 采用 |
| 文字色不超过三档且都 ≥4.5:1 | `--dbc-ink-1/2/3`（`client.js:599-607`），实测值在 `dsh-card-design` → **Contrast** | 采用 |
| 弱化次要信息来实现强调 | 去掉「余额」标签（`dsh-card-design` → **Layout**）；币种前缀 `.dbc-code` 11px（`client.js:626`） | 采用 |
| 分隔线必须可见 | `--dbc-line` 是固定边框浅灰（`light-dark(#e9ebef,#3a3b3f)`），夹在行间看不见 → `.dbc-tip-rule` 用 12% 墨色 mix（提交 `d652196`） | 调整后采用 |
| 状态不能只靠颜色 | 周期 chip 带文字 + `.dbc-dot`，其余 chip 只带文字，倒计时带「距高峰/距空闲」 | 采用 |
| 「标签是最后手段」 | **被产品否决**：用户明确要求「输入 / 缓存 / 输出」「余额」等文字 | 舍弃 |
| 阴影营造层次（模拟光源） | 卡片用 1px 边框 + 纸面，不用阴影；只有浮层用阴影（`client.js:645`） | 舍弃 |
| 一次性修完再复查 | 每轮改完都重新渲染四态（232/196 × 亮/暗 × 中/英） | 采用 |
| banner 精确尺寸 + 安全区 + 单一 CTA | `docs/banners/minimal-{zh,en}-1200x320.png`；CTA 为 `dsh plugin --profile web add …` | 采用 |
| 「始终产出 3 个方案」 | 只用了一轮选型，之后按用户选择精简为 1 套 2 张 | 调整后采用 |
| 用图像生成做视觉素材 | 环境无该能力，改用 CSS/HTML 构建并用真实卡片截图 | 舍弃 |

---

## 4. 被采用、修改和舍弃的规则及理由

**采用**：从刻度取值、层级靠字重与颜色、对比度下限、状态不只靠颜色、漂移分类、渲染后验证、banner 的安全区与精确尺寸。

**修改后采用**：

- 「8pt 间距体系」→ 落到封闭刻度 `4 / 5 / 6 / 8 / 10 / 12`（当时先收到 `4 / 8 / 12` 三档）。卡片内容宽仅
  ~208px，8pt 粒度过粗，`4` 是它的最小可分辨单位。
- 「分隔线用色板中的浅色」→ 统一 12% 墨色 mix。原因是 `--dbc-line` 为固定边框色（`#e9ebef`），不是墨色 mix，
  夹在两行文字之间看不见。
- 「三个方案」→ 一次选型后收敛。README 只放用户选中的那一张，避免仓库里堆积未被引用的资产（提交 `ba9942f`）。

**舍弃**：

- 「标签是最后手段」：与本产品的读数需求冲突——用户要的是「输入 / 缓存 / 输出」这种可直接照抄到 API 文档的固定词。
- 「阴影即层次」：侧边栏底部的卡片若带投影，会和宿主的列表项争夺注意力；最终只用 1px 边框。
- 「em/rem 刻度」：卡片在宿主里是固定像素组件，`em` 会被父级字号污染，`dsh-card-design` → **Scale** 明确禁止。

---

## 5. 新 Skill 中关键设计决策的证据位置

| Skill 中的说法 | 证据 |
| --- | --- |
| token 层只认 `--dbc-*`，用 `light-dark()` | `client.js:599-606`；宿主在 `<html>` 写 `color-scheme`（`dsh-client-ui-layout/lib/client.js:550` 读得依据） |
| 一行一事实、顺序为「倒计时+chip → 金额 → provider → 模型 → 价格」 | `client.js:615-639`；`dsh-card-design` → **Layout** |
| 金额独立成行、超过 12 字符降一档 | `client.js:624-627`、`AMOUNT_SMALL_AT = 12`（`client.js:690`） |
| 倒计时不截断并保留措辞 | `client.js:631-633`；`dsh-card-design` → **Layout** |
| 气泡自绘、不用宿主 Tooltip | `client.js:645-655`；提交 `5c65d96` |
| 气泡箭头朝向触发词、顶点居中 | `TIP_ARROW_APEX_PX = 4`（`client.js:83`）、`TIP_ARROW_EDGE_PX = 12`（`client.js:85`）、`.dbc-tip-arrow`（`client.js:654-655`） |
| 悬停只在标签上、模型行仅官方 provider 可悬停 | `billsAtListPrice`（`client.js:51`）、`OFFICIAL_PROVIDERS`（`client.js:45`）、`AGENTS.md` → **Invariants** 第 6 条 |
| 折叠不得卸载组件（hook 数量恒定） | `client.js:729`；提交 `3e70a92`；`AGENTS.md` → **Layout and compatibility guards** |
| 声明了却没人用的 token 会让线「失踪」 | 提交 `d652196`；新增的静态断言（`test/client.test.mjs`） |
| 截图价格必须来自线上 | `docs/screenshots/*` 由 `curl http://127.0.0.1:<port>/deepseek-billing-card/data` 的真实表生成；`asOf 2026-10-28` |
| 不可出现「高峰 + 调休」这类不可达状态 | 用户 m07153 指出。原写作「已改 `docs/screenshots/*`（…之后的工作区）」，但历史里找不到这次更改：那两张图（`makeup-chip.png`、`dark-theme.png`）在 `ba9942f` 里是被**删除**，不是重画；现存 `holiday-banner.png`（`b60a8a2`）与 `english-usd.png`（`659f711`）。2026-10-29 只按提交核对了文件，未复核这两张图的渲染状态 |

设计链路的提交顺序（供追溯，重设计本身没有独立提交，搭在 tooltip 那次改动里）：

```
5c65d96 feat: draw the card's own hover bubble      ← 重设计 + 自绘气泡
659f711 fix: lead with the countdown and hang the balance bubble on the amount
3e70a92 fix: keep the card mounted when the sidebar collapses
d652196 fix: give the tooltip separator a colour that exists
b60a8a2                                              ← 截图改用线上价目与真实节日倒计时
840a28e                                              ← vendor 了 banner-design skill（d1d28d4 删除）
ba9942f                                              ← 换 banner、统一 icon、并删掉两张截图
```

---

## 6. 无法确认的历史信息，以及需要人工补充的部分

1. **`refactoring-ui` 的上游提交**：仓库 URL 来自我实际执行的命令（已确认），但 skill 文件不带版本号，`s0xdk/refactoring-ui-skill` 的具体 commit **来源待确认**。若要写进第三方声明，需要补一次 `git ls-remote` 或安装器锁文件。
2. **`banner-design` 的上游提交**：安装器生成的 `skills-lock.json` 已随杂项目录一起删除，**来源待确认**。
3. **`banner-design` 已不再随仓库分发**：vendored 副本（`840a28e` 引入）已按你的要求删除，改回第三方安装，因此 MIT 的许可证文本义务不再由本仓库承担。若将来又要 vendor，请连 `LICENSE` 一起带进来。
   安装命令以你给的标准形式记录：`npx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill banner-design`。
4. **`ui-taste` 的获取地址**：命令用的是 `https://uizze.sh/`（用户指定），它与 `uizze.com` 的关系、以及该站点是否对应一个公开仓库，**来源待确认**。
5. ~~`docs/screenshots/` 的旧图~~：`makeup-chip.png`、`dark-theme.png` 已在 `ba9942f` 中随 README 精简一并删除，仓库里只剩 `holiday-banner.png` 与 `english-usd.png`。上一版报告误写成「仍在仓库里」，此处更正。
6. **`--dbc-label-quiet` 的去向**：第 2.2 节记录当时为压暗标签色新增了这个 token，但当前 `client.js` 与 skill 都没有它。它是否就是今天的 `--dbc-ink-3`（skill 记 5.1 / 7.0，与当年的 4.71 不同）**未能确认**；维护者 2026-10-29 回复：本轮无法确认，留待后续复测。2026-10-29 又查了一步：`git log --all -S'dbc-label-quiet' -- client.js` **无输出**，token 名只出现在本文件里，仓库任何提交的 `client.js` 都没写过它——所以「当时新增过这个 token」本身也只有本节这句自述，没有提交可佐证。这一条仍未关闭。
7. **对比度数值未复测**：2.05:1、3.71:1、4.71:1 与 skill 里的 17.8 / 15.0 等都是当时在渲染结果上实测的，2026-10-29 只核对了它们是否仍只出现在一处（结论：`AGENTS.md` 已不再重复这些数，skill 的 **Contrast** 与 **Failure handling** 表各出现一次），没有重新取色 —— 同属留待后续复测，仍未关闭。

### 顺带发现的「文档 vs 代码」不一致

- **已修**：`client.js` 里气泡上方的注释写着「fixed dark surface in both themes」，自绘气泡早已改用 `background:var(--dbc-surface)` / `color:var(--dbc-ink-1)`；本轮随代码清理改成「气泡继承主题，`--dbc-*` 在两种主题下都能解析」。
- **已修**：`.dbc-note` 原为 `13px/18px`，`18` 不在当时的 Design scale 行高刻度上；已收敛为 `13px/16px`（提交 `a758bff`），只影响「本该有数字却没有」的那两格，卡片高度减 2px，断言数不变。今天的刻度见 skill 的 **Scale**。

---

## 7. 后续 UI 任务的用法示例

| 任务 | skill 要求 Agent 做的事 |
| --- | --- |
| 「在卡片上显示今天用了多少 token」 | 先判断是否值得占第六行（默认放进模型气泡，追加一条 `label → value`），复用 11px + 等宽数字，并在 196px 英文下验证。 |
| 「英文界面价格标签被截断了」 | 先缩短英文词（`Cache read` → `Cached`），再检查三列宽度；仍不够就把一项事实移进气泡，不缩字号。 |
| 「让卡片看起来更现代一点」 | 不当成调色请求：先给出 2–3 个具体结构（行式 / 色带 / 分栏），用真实 HTML 在 232px 中英双语下渲染对比，说清各自代价，等用户选定后再实现。 |

这三条例子只保留在本节（skill 里的 Worked examples 已删，避免第二处维护）：其中「新事实放哪」对应 skill 的
**Open** 组，「重设计先定方向」对应 **Steps → Before you change**，「加一张深色截图」按 **Verification** 里
`docs/screenshots/*` 那一条核对（可达状态 + 线上价格）。

---

## 8. 自检记录（审计当时）

- **数值一致性**：新 skill 引用的 `11 / 13 / 17 / 20`、`650+`、`4.5:1`、12% 墨色分隔线等，逐条对照当时的 Design scale 段与 `client.js`，一致。初稿曾把间距刻度写成 `4 / 6 / 8 / 12`，实际是 `4 / 5 / 6 / 8 / 10 / 12`，已按原文更正（今天的刻度见 skill 的 **Scale**）。
- **代码清理**（本轮附带，用户要求，提交 `d1d28d4`）：删除死代码 `client.js` 中 `.dbc-price-empty` 规则、字典里的 `card.balance.total` 与 `card.schedule`（中英各一条，合计 2 键 4 条）、两条过期注释；用 `node --check` 与整套测试验证，断言数保持 1004。
- **Markdown / frontmatter**：两份文件各 1 个一级标题、无跳级标题、无制表符与行尾空格、围栏配对、表格均有表头分隔行；frontmatter 为 `name` + `description` + `whenToUse`，与 `.agents/skills/{dsh-plugin-development,billing-regression-testing,release-verification}` 同构。
- **重复与冲突**：新 skill 的 32 条要点与 `AGENTS.md`、三个既有 skill 的逐条比对结果是 0 处逐字重复；当时的分工是「`AGENTS.md` 管数值与不变量，skill 只写怎么判断、怎么验证」。**2026-10-29 起对调**：数值归 skill 的 **Values**，`AGENTS.md` 只留业务不变量与兼容性守卫，本文件不承担任何规范条目。这次对调目前只在 `preview` 分支生效（见开头），`v1.3.0` 里仍是旧分工。
- **测试**：`node --check` 三个运行时文件通过；`npm test` **1004 PASS / 0 FAIL**（新增文档未被任何测试引用，结果与改动前一致）。
- **技能目录**：按用户要求删除 vendored 的 `.agents/skills/banner-design/`（`840a28e` 引入，`d1d28d4` 删除），改回第三方安装；仓库内只剩四个项目自有 skill。
- **未 commit / push / release / publish**〔历史记录，状态已在 2026-10-29 核实〕：审计当时改动留在工作区等审核。
  此后它们分别落在 `62fd320`（skill 与本文件）、`d1d28d4`（死代码、字典键、vendored skill 的删除）、
  `a758bff`（`.dbc-note` 行高）、`ba9942f`（banner、icon、截图）里，且都已包含在打了标签的 `v1.3.0`
  （`689e463`）中。这一行记录的是当时的边界，不是待办；本文件自身在 2026-10-29 又有一次整理（`67c2049`）。

## 附：审计当时的边界

- **计费与拼装逻辑未动**：`client.js` 只删了死代码与过期注释（`.dbc-price-empty`、两个字典键、两条注释），`index.js` / `parse.js` / 测试 / `AGENTS.md` 均未修改。
- **未 commit / push / release / publish**〔历史记录〕：删除 vendored skill 后的 `git rm` 当时只是暂存。这次删除后来随
  `d1d28d4` 一并提交（同一提交里还删了 `client.js` 的 `.dbc-price-empty`、`card.balance.total`、`card.schedule` 与
  两条过期注释），并进入了 `v1.3.0`。
- **没有把第三方 skill 的正文搬进本仓库**：新 skill 的措辞是按本项目重新写的，只保留来源归属。
