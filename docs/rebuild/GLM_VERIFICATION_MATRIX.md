# GLM 验证矩阵 — 结论 ↔ 证据 ↔ 验证状态

状态定义：
- **已验证** — 读到直接证据，且（对可复现项）在仓库外的装载器里用受控输入跑出预期结果。
- **部分验证** — 代码事实确认，但影响/后果未被测量；或机制确认、发生概率未知。
- **无法验证** — 需要运行中的 DSH 宿主、网络或浏览器，本环境不具备。
- **与证据冲突** — 该结论被本次测量或读码**否证**。

**规则**：未执行的验证一律不标"已验证"。所有复现脚本位于 `/tmp/glm-audit/`（仓库外），未写入项目目录。

---

## 1. 基线与只读命令

| 命令 | 结果 |
| --- | --- |
| `git log --oneline -1` | `7512286 docs: leave the shared DSH ceiling to the manifest`（分支 `preview`） |
| `grep -n '"version"' package.json` | `3:  "version": "1.3.0",` |
| `node --check index.js && node --check parse.js && node --check client.js && npm test` | 全部通过；`npm test 2>&1 \| grep -c '^PASS'` = **1004**，`grep -c '^FAIL'` = **0** |
| `npm pack --dry-run` | tarball 13 个文件（`client.js` 88.1 kB、`parse.js` 17.0 kB、`index.js` 9.9 kB 等），无 `test/`、无 `docs/`、无 `.agents/` |
| `wc -l` | `index.js` 263 / `parse.js` 455 / `client.js` 1912 / `test/client.test.mjs` 2083 / `test/host.test.mjs` 400 / `test/parsers.test.mjs` 391 / skill 116·258·118·301 / `AGENTS.md` 135 |
| `git status --short`（每次命令后复查） | 全程仅 `?? docs/rebuild/`（Kimi 的目录，本次未改） |

**[事实]** 本次审计零写入：未 `git add/commit/push/tag`，未 `npm install`，未 `npm publish`，未修改任何业务代码、配置、测试、skill、`AGENTS.md` 或 Kimi 的六份报告。所有脚本执行均在 `/tmp`，输出为 stdout。

### 复现脚本清单（全部只读 + 只在内存里构造输入）

| 脚本 | 用途 | 结论 |
| --- | --- | --- |
| `boot.mjs` | 把真实 `client.js` 经 `window.__ModuleLoader__` 载入，配微型 React | 基础设施 |
| `repro.mjs` | H1（五种 id）、H2（崩溃 + 少算）、M1（EUR）、M3 | 见 §2 |
| `repro2.mjs` | M2（正确场景：三源全缺 + 无 Key 终态）与对照组；M3 | 关键证据 |
| `repro3.mjs` | Host 侧 H3；H4 的第一次尝试（**无效**，见 §4） | H3 有效 |
| `repro4.mjs` | H4（per-URL fetch 路由 + 快慢两读） | 决定性 |
| `repro5.mjs` | 共享重试预算假设（**未证实**） | 见 §4 |
| `protokeys.mjs` | 归一化后哪些原型键仍命中原型链 | 否证 `toString` 反例 |
| `contrast.mjs` | 从 `CARD_CSS` 取真实 token 色值，按 WCAG 公式复算 | 确认 4.46:1 |

---

## 2. Kimi 结论 → 证据 → 状态（CODE_QUALITY_AUDIT.md）

| Kimi | 结论摘要 | 我核对到的证据 | 状态 | 与 Kimi 的差异 |
| --- | --- | --- | --- | --- |
| **H1** | 特殊模型 id 沿原型链取伪价格并击穿渲染 | `client.js:505`（归一化）·`:515-526`（无 own 检查）·`:1142-1149`（崩溃点）·`:202,220,1618`（普通对象）·`:1555,1558`（同文件已用 `Object.create(null)`）。实测 `constructor`/`__proto__` → `TypeError` | **部分验证** | 机制**已验证**；可达集**与证据冲突**（`toString`/`valueOf`/`hasOwnProperty` 实测未命中）；后果（子树卸载）**无法验证**（宿主错误边界未知）→ 评级 High→Medium |
| **H2** | 脏钱包既崩溃又静默少算 | `client.js:1519-1535`（不逐项清洗）·`:570-587`（求和前过滤）·`:1061`（气泡遍历原数组）·`:543-563`（`continue`）。实测 `[null,{CNY,'1'}]` → `Cannot read properties of null (reading 'currency')`；脏+净混合 → headline `¥7.50` 无提示 | **已验证** | 无。High 合理 |
| **H3** | 凭据无超时 → 全部启动快照卡住 | `index.js:30`（8000ms 只覆盖 fetch）·`:47`·`:152-163`（无超时）·`:219`（三元素两解构）·`:232`（统一提交）·`:242-246`（定时器无取消）。实测：3 个上游均完成，路由仍 `status:'loading'`，`sources` 四项全 `pending` | **已验证** | 无。**最严重的一条**。补充：`Promise.all` 三元素只解构两个位置，余额结果被丢弃（Kimi 未点名） |
| **H4** | 手动/定时并发，旧响应覆盖新余额 | `index.js:207-216`（去重仅在 `refreshBalance`）·`:219,245`（绕过）·`:191`（无条件写）。另 `index.js:166-172` 注释 vs `:191` 实现矛盾。实测：读 #1 慢 / #2 快，完成序 2→1，`state served: ready 11.00`（= 旧值赢） | **已验证（机制与复现）/ 部分验证（影响）** | 复现成功；但 30 秒定时器会重写（`index.js:242-246`）→ 可自愈，评级 High→Medium |
| **M1** | 非法币种改标 CNY、缺失组成写 `'0'` | `parse.js:88-90`（Host 正确丢弃）vs `client.js:1701`（`=== 'USD' ? 'USD' : 'CNY'`）；`parse.js:98-99` 与 `client.js:1703-1704`（`?? '0'`）。实测 EUR → 金额渲染 `¥5.00` | **已验证** | 无。另需追加：写成 `'0'` 会与总额自相矛盾（Kimi 只带半句） |
| **M2** | 部分 loading 被提升为 ready | `client.js:1713-1725`（三者全 null 才保留 loading）·`:772-778`（非 ready 才继续重试）。实测：三源全缺 + `deepseek:'unavailable'` → **只读 2 次**，对照 **11 次**；`host said "loading"; card treated it as ready` | **已验证** | Kimi 标 **[推断]"可能提前"**；测量显示是**默认路径** → 评级 Medium→High |
| **M3** | 路由失败与旧 Host 缺字段不可区分 | `client.js:781-799`（catch 载荷还漏 `deepseek` 键）·`:1003`（归 `absent`）·`:1082-1087`（回退账号余额）。实测：失败态显示 `¥99.00`，note 为空 | **已验证** | 需追加限定：该回退是 `test/client.test.mjs:1438` 的**既有断言契约**（期望 `¥32.50`，注释理由"older Host"），故修改属已测试行为变更 |
| **M4** | 无超时/序号/卸载保护 | `client.js:768-817` 读码：`ask()` 无 `AbortController`、无请求序号；`live` 只挡部分 setState，`:796` 的 `follow` 仍会再发。Kimi 自己标"未构造全部时序" | **部分验证** | 无。诚实标注值得保留 |
| **M5** | 凭据异常被吞 → 误报未配置 Key | `index.js:157-160`（空 `catch`，注释"试环境变量"）·`:176-180`（无 Key → `unavailable`）·`client.js:1091-1093`（文案） | **已验证（代码路径）** | 无 |
| **M6-a** | 气泡无 ARIA 关联；"definition list" 全是 span | `client.js:1326`（`role:'tooltip'`，无 `id`）；全仓 grep 无 `aria-describedby`；`client.js:1342-1356` 行/规则/注脚均为 `span`；测试只测 focus/blur/Escape/文本（`test/client.test.mjs:1968-2054`） | **已验证** | 无 |
| **M6-b** | 数据变化后已打开气泡继续描述旧真相，"违背项目设计约束" | `tipSpec` 只在 dwell 完成时写入（`client.js:1156-1200`）——机制为**代码事实**；但所引 `dsh-card-design:97-99` 原文限定的是 **provider 门控**（模型气泡只属于 official provider），不是"打开中的气泡必须随数据刷新" | **与证据冲突**（就"违背约束"这一表述而言） | 机制保留，定性改为**该 skill 的开放项** |
| 低严重度表 | 若干局部正确性问题 | 抽查逐条准确（行号偏差 ≤2 行） | **已验证（抽查）** | 无 |
| **§9.1** 对比度 4.46:1 | `client.js:596-599`（`--dbc-ink-3:#686e77`、`--dbc-surface-3:#eceff4`）·`:616`。`contrast.mjs` 复算：light **4.46:1 BELOW 4.5**，dark 5.43:1 OK | **已验证** | 无。但需修正归因：`dsh-card-design:54-57` 的实测表**从未包含**这一组合（见 §3 新增 A-03） |
| **§9.1** 刻度越界 | `client.js:613`（chip `padding:0 7px`）·`:619`（amount-row `gap:3px`）·`:631`（`margin-top:2px`）·`:632`（`gap:1px`）；闭集见 `dsh-card-design:48-49`。`.dbc-amount-row` 只有一个子节点：`client.js:1392` | **已验证** | 无 |
| **§9.2** 截图只覆盖两态 | 无法核对截图本身（未打开图像做像素判定） | **无法验证** | Kimi 的表述已自限，恰当 |
| **§9.2 推断** 布局测量耦合 | `client.js:855-903` placement 区读兄弟节点并负 margin 回拉 | **已验证（代码事实）** | 无 |

---

## 3. Kimi 其余报告的结论 → 证据 → 状态

| 报告 | 结论 | 证据 | 状态 |
| --- | --- | --- | --- |
| PRODUCT §1–§4 | 定位/场景/余额归属/计费规则 | `AGENTS.md:29-58`（八条不变量，引用行号逐条正确）、`client.js` 的 `billsOnOpenPlatform`/`billsAtListPrice`/`OFFICIAL_PROVIDERS` | **已验证** |
| PRODUCT §8 | 历史实现细节 | `git log`（近 5 条均为 docs/chore，与描述一致）、两份 CHANGELOG | **已验证** |
| PRODUCT §1.2 | 用户痛点强度以 **[事实]** 呈现 | 仓库内无用户数据/反馈/统计的任何来源 | **与证据冲突**（标签误用：应为推断） |
| CURRENT §1–§4 | 模块职责、数据流、四条调用链 | 逐行读 `index.js`/`parse.js`/`client.js`；30 秒 tick `index.js:242-246`、每秒渲染链、`ctx.inject(['webServer'], …)` 嵌套注册 | **已验证** |
| CURRENT §5 | Host/Client 能力边界 | `AGENTS.md` Architecture 表 + `client.js` 的 `inject` 数组 + `index.js` 的 `ctx.get('credentials')` | **已验证** |
| CURRENT §8 | 部署与兼容边界 | `index.js:28`（frozen path）、`package.json` 的 `engines.dsh` 双段区间、`client.js:1425`（`if (!wide) return null` 位于所有 hook 之后） | **已验证** |
| CURRENT §9 | 7 条架构问题 | 抽查全部可核；`load()` 无并发/取消语义已实测（`index.js:219-232` vs `:207-216`） | **已验证** |
| CURRENT — | **遗漏**：未列 `AGENTS.md:5` + skill:118 的零构建禁令 | 两份文件原文 | 记为新增 GLM-A-01 |
| API §3.1/§4/§5/§6.1–6.6 | 路由与 payload 形状、解析器导出、Loader 返回值 | `index.js:28,84`、`parse.js` 导出、`client.js` 的 `readRemote/readPriceBook/readHolidays/readDeepseek`（`:1642,1669,1692`）与 `API_INVENTORY` 文档字段逐一对照 | **已验证** |
| API §6.7 | 若干字段当前未消费 | `grep` 确认无消费点；例：`available`（`parse.js:95` 产出，client.js 无任何读取） | **已验证** |
| API §7 | 宿主服务契约（`slots/locale/timer/remote`、`uiSession`、`modelDirectories`、`remote.account`、`remote.session.modelCatalog`） | `client.js` 实际取用点核对 | **已验证（代码读取面）/ 无法验证（服务真实语义）** |
| API §10.1 | 无 `schemaVersion`；`?balance=refresh` 子串判定 | `index.js:84` `request.url.includes('balance=refresh')`；payload 无版本字段 | **已验证** |
| API §3.3 | `credentials.resolve` 无超时 | `index.js:152-163` | **已验证**（Kimi 只列为风险，应升为契约缺陷 → 本报告 GLM-D-01） |
| OPTIONS §1.3 | 三条"不应误当成事实的假设" | 与代码一致（尤其"TS 不能解决路由坏数据"：校验仍需手写） | **已验证** |
| OPTIONS §1.3 | "用户已允许 2.0 重议工程规范"标为 **[事实]** | 仓库内不可核查（`AGENTS.md`/skill/CHANGELOG/`git log` 均无） | **无法验证 + 标签误用** |
| OPTIONS §2/§5/§6 | 方案 A 分层、比较表、推荐 A | 分层与已证实缺陷的映射成立；构建/Loader 前提不可验证 | **部分验证** |
| OPTIONS §3.1 | 方案 B 的四个可行性阻断 | 与 `AGENTS.md` Architecture 表一致：账号/目录/会话能力只在 Client 侧被证明 | **已验证（对"能力未被证明"这一判断）/ 无法验证（Host 是否真的没有）** |
| OPTIONS §4 | 方案 C 需求不足 | `OFFICIAL_PROVIDERS` 为显式三元素集合、仓库无第二 provider 证据 | **已验证** |
| DECISIONS D-01…D-48 | 48 项决策、阻断项、负责人摘要 | 逐条对照代码/测试/规则；发现 D-30/D-32 与规则冲突、D-20 与"The route is frozen"冲突、D-10 与 D-28 内部矛盾、D-13 与 `test/client.test.mjs:1438` 冲突 | **部分验证**（内容真实，四处需修订） |
| DECISIONS 整体 | 缺 `status` / `approver` / "破坏哪些断言"字段 | 表格列结构本身 | **已验证（文档事实）** |

---

## 4. 尝试过但**未通过**的验证（按任务要求显式记录）

| 编号 | 想验证什么 | 实际结果 | 状态 |
| --- | --- | --- | --- |
| **V-1** | `settle()` 的 `attempts` 被事件驱动的 `?balance=refresh` 共享，可提前耗尽启动轮询预算（`client.js:772-778`） | `repro5.mjs`：静默路径 **11 次**读；有事件路径也是 **11 次**，其中 `?balance=refresh` 计数 **0** → **未产生区分度，假设未被证实** | **未通过**（保留为推断，见 GLM-R-03；脚本尾部的结论句是代码形状推理，不是测量） |
| **V-2** | H4 的第一次复现（`repro3.mjs`） | 失败：同一 fetch stub 同时服务 HTML 与 JSON，且 `total_balance:'V1'` 过不了 `amountText` → 状态 `failed`、`bal.total` 为 `undefined`，脚本以 `TypeError` 结束 | **作废**，改用 `repro4.mjs`（per-URL 路由 + 合法十进制串）后成功 |
| **V-3** | M2 的第一次复现（`repro.mjs` 的 M2 段） | 无效：输入里带了完整可用的 CNY 价目，`readPriceBook` 返回非 null，缺陷不会出现；该行"prices shown … asOf 2026-10-30 vs 2026-10-26"证明当时价目已是活的 | **作废**，`repro2.mjs`（三源全缺 + 无 Key 终态）才是有效证据 |
| **V-4** | `toString` 反例（Kimi H1 建议） | 实测 `toString: miss`（`normalizeModelId` 小写化后不再命中原型属性）；`valueOf`/`hasOwnProperty`/`isPrototypeOf`/`propertyIsEnumerable`/`toLocaleString` 同 | **与证据冲突** → 该反例不应写入测试 |
| **V-5** | 对比度是否只影响浅色主题 | `contrast.mjs`：light **4.46:1 BELOW 4.5**，dark 5.43:1 OK → 只在浅色主题越界 | **已验证（部分）**：其余组合均达标，但背景近似值（节日条带用 9% wash 近似）为计算近似，非像素取样 |
| **V-6** | 真实宿主/浏览器渲染、Loader 产物形态 | 未执行（无宿主、不装依赖、不开浏览器） | **无法验证** |

---

## 5. 本次新增的自有结论及其验证状态

| ID | 结论 | 证据 | 状态 |
| --- | --- | --- | --- |
| GLM-D-06 | 价目解析按位置取列，空头导致价格串列 | `parse.js:255-258`（`.filter(cell => cell !== '')`）vs `:298-303`（`values.forEach((cell, at) => … ids[at] …)`） | **已验证（代码事实）**；上游实际留空头的概率 **无法验证** |
| GLM-D-07 | `truncateCents` 的浮点回退违反 Invariant 4 | `client.js:461-465`（`Math.trunc(fallback * 100) / 100`）vs `AGENTS.md:44-45` | **已验证（代码与规则文本）**；触发值未穷举 → 影响面 **[推断]** |
| GLM-D-08 | 非法日历日期被 `Date.UTC` 静默归一化 | `parse.js:355`（只查 `day > 31`） | **已验证（边界条件读码）**；未在装载器里构造 Feb-30 事件跑通全流程 |
| GLM-R-02 | Invariant 8 作用域缺口（只点名路由解码器） | `AGENTS.md:57-58` 原文列名 vs `client.js:1519,1539` 输入源 | **已验证** |
| GLM-A-01 | 零构建禁令 vs 方案 A/D-32 正面冲突 | `AGENTS.md:5` + `dsh-plugin-development:118` vs `REBUILD_OPTIONS:176-180` | **已验证** |
| GLM-A-04 | `index.js` 余额注释描述不存在的行为 | `index.js:166-172` vs `:191` | **已验证** |
| GLM-R-06 / Q-12 | 字典键集与 token 声明**已**自动化；对比度与刻度闭集**未**自动化 | `test/client.test.mjs:473`、`:2078`；越界值 `client.js:613,619,631,632` 仍在树中 | **已验证** |
| GLM-R-07 | CI 不覆盖 `preview` | `.github/workflows/ci.yml:7` `branches: [main]` | **已验证** |
| GLM-A-07 | 196px 中文带调休换行是仓库已实测确认的未决缺陷 | `docs/design-skill-audit.md:230`（"今天就在换行"，head 18→34，卡片 +16px） | **已验证（历史记录）**；本轮**未重做像素测量** → 当前状态 **[推断]** |
| — | `parse.js:163` 只取一行中第一个数字 | `amountOf` 用 `/\d+(?:\.\d+)?/.exec` | **已验证** |

---

## 6. 关键实测输出（原文摘录，便于复核）

```
# npm test（门禁）
PASS every var(--dbc-*) is declared  expected="" actual=""
1004 PASS / 0 FAIL

# protokeys.mjs（否证 H1 的 toString 反例）
constructor: hit (typeof=function, direct['idle']=undefined)
__proto__    : hit (typeof=object, direct['idle']=undefined)
toString: miss / hasOwnProperty: miss / valueOf: miss / length: miss / name: miss

# repro.mjs（H1 / H2 / M1）
H1 THROW    model id "constructor" -> TypeError: Cannot read properties of undefined (reading 'input')
H1 THROW    model id "__proto__"   -> TypeError: Cannot read properties of undefined (reading 'input')
H1 render   model id "toString"    -> price block: (none)
H2 mixed   -> THROW TypeError: Cannot read properties of null (reading 'currency')
H2 partial -> headline "¥7.50" (silent undercount if 7.50)
M1 EUR     -> amount "¥5.00" code ""

# repro2.mjs（M2 / M3）
M2 route asks        : 2   | CTRL route asks : 11
M2 top-level status  : host said "loading"; card treated it as ready
M3 on failure        : amount "¥99.00" note ""

# repro3.mjs（H3）
H3 upstream fetches   : 3 (pricing x2 + calendar completed; balance never resolved)
H3 route status       : loading | prices.CNY null | holidays null
H3 sources            : {"pricing.CNY":"pending","pricing.USD":"pending","calendar":"pending","deepseek":"pending"}

# repro4.mjs（H4）
balance reads issued : 1(slow) -> 2(fast)
completion order     : 2 then 1
state served         : ready 11.00
VERDICT: the OLDER read (#1) overwrote the newer (#2)

# repro5.mjs（V-1，未通过）
startup budget, no events : 11 reads
reads when selection fires: 11 | of which ?balance=refresh: 0

# contrast.mjs
make-up chip  ink-3 on surface-3 (light) : 4.46:1 BELOW 4.5
make-up chip  ink-3 on surface-3 (dark)  : 5.43:1 OK
idle/peak chip light: 4.66 / 4.59 · dark: 7.47 / 7.66
ink-3 on card surface (light) : 5.14 · ink-2 : 7.28 · blue on strip : 6.66
```

---

## 7. 因缺证据而无法完成的审计事项（对应主报告 §11）

1. 宿主 Loader 的模块能力 → A / A′ 的物理形态分歧（**无法验证**）。
2. 渲染异常在宿主内的隔离范围 → H1/H2 真实影响幅度（**无法验证**）。
3. Host 侧是否具备账号/目录/会话服务 → 方案 B 的可行性（**无法验证**）。
4. `credentials.resolve` 在生产中的挂起概率 → H3 优先级只能建立在"机制必然"上（**无法验证**）。
5. "用户已允许重议工程规范"的出处 → 方案 A 前提（**无法验证**）。
6. 196/232px、气泡翻转、箭头定位的当前像素状态 → 本轮未开浏览器，仅引用既有实测记录（**部分验证**）。
7. 上游页面/日历的当前真实形状 → 解析脆弱性是否已被上游触发（**无法验证**，需带来源记录的 fixture 刷新）。
