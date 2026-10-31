# GLM 发现清单 — 缺陷、风险、文档问题与待确认决策

四类分开列，不混排。每个发现带唯一 ID、证据、影响、建议与置信度。

**严重度**：Critical / High / Medium / Low / Info
**置信度**：高（直接证据 + 已复现）/ 中（代码事实，影响为推断）/ 低（仅代码形状推导）
标签：**[事实]** 直接证据；**[推断]** 由代码路径导出，未测量；**[建议]** 设计意见；**[待确认决策]** 须负责人决定。

约定：`K-` 前缀表示该条对应 Kimi 报告中的编号，便于交叉核对。**行号均为本次审计在 HEAD `7512286` 上实测确认。**

---

## A. 真实缺陷（可证伪的代码错误）

### GLM-D-01（= K-H3）凭据服务无超时，可让所有启动快照永不就绪 — **High · 置信度 高**

**[事实]**
- `index.js:152-163` `readApiKey()` 直接 `await credentials.resolve(API_KEY_REF)`，没有超时；`FETCH_TIMEOUT_MS = 8000`（`index.js:30`）只作用于后续 HTTP fetch（`index.js:47`）。
- `index.js:219` `const [tables, holidays] = await Promise.all([...])` 等待全部三类工作完成后才统一提交并置状态；`index.js:232` 才写 `state.status`。
- **额外发现（Kimi 未列）**：`Promise.all` 有三个元素，解构只取两个位置——余额那一路的结果被**丢弃**，虽然副作用（写 `state.deepseek`）仍会发生，但这一行的形状本身说明"三路汇聚"是临时拼起来的，不是设计过的提交点。
- 定时器 `index.js:242-246` 会在启动仍未完成时继续发起新的余额读取，没有取消机制。

**复现**：仓库外装载器 + 一个永不 settle 的 `credentials.resolve` → payload 长期 `status:'loading'`，价格/日历虽已完成却不提交。
**影响**：辅助服务故障放大为全局不可用；Client 长期落内置快照（价格与日历都是快照，金额可信度受损）。
**[建议]** 每源独立提交；凭据读取包进有界适配器；启动/定时/事件共用同一 per-resource 协调器。
**[待确认决策]** 真实宿主中 `credentials.resolve` 挂起的概率——本次无法观测（见 GLM-R-01）。

### GLM-D-02（= K-H2）脏钱包数据既会崩溃也会静默少算 — **High · 置信度 高**

**[事实]**
- `client.js:1519-1535` `readBalance` 只判断 `value.value`/`value.bonusWallets` 是不是数组，逐项不清洗。
- `client.js:570-587` `totalBalance` 用 `walletCurrency(wallet) !== ''` 过滤后才求和（**会**防御）。
- `client.js:1061` 气泡构造 `for (const wallet of account.wallets)` 遍历**未过滤**的原数组并读 `wallet.currency`（**不**防御）。
- `client.js:543-563` `sumAmounts` 对正则不匹配的项 `continue`，不计数、不标记。

**复现**：`[null, {currency:'CNY',balance:'1'}]` → 总额合法生成，随后气泡构造抛异常；`[{CNY,'1.00'},{CNY,'n/a'}]` → 总额显示 `1.00`，无任何"不完整"提示。
**影响**：可用性（渲染抛异常）与金额可信度（不完整总额看起来完整）同时受损。后者更危险——用户看不到任何不确定性。
**[建议]** 在账号适配边界一次性逐项校验，产 `partial` 状态并让气泡显式说明少算了几个钱包。

### GLM-D-03（= K-M2，量化后上调）三源全缺时 `readRemote` 直接判 ready，启动重试被提前终止 — **High · 置信度 高**

**[事实]** `client.js:1713-1725`：只有 `prices`、`holidays`、`deepseek` **全为 null** 才保留上游 `loading`；否则返回 `status:'ready'`。`client.js:772-778` 的重试仅在 `status !== 'ready'` 时继续。
**复现**：构造"价格与日历均不可用 + 无 Key 终态 `deepseek:'unavailable'`"的 payload → Client **只发起 2 次读**即停止；对照路径为 11 次。
**影响**：Kimi 标为"常见无 Key 启动路径**可能**提前采用快照"；测量显示这是**默认行为**，此后要等 `DATA_REFRESH_MS = 30s` 的 tick 才可能校准。无 Key 用户是本卡片的主要用户群之一，所以严重度从 Medium 上调为 **High**。
**[建议]** "完成"的定义由必需来源的**终态组合**得出，而非"至少有一个非 null"。

### GLM-D-04（= K-M1）Client 把非法币种改标为 CNY、缺失组成写成 0 — **Medium · 置信度 高**

**[事实]** Host 端正确丢弃非 CNY/USD（`parse.js:88-90`，注释明确"错误的币种码就是错误的金额"）；Client 端 `client.js:1701` 用 `value.currency === 'USD' ? 'USD' : 'CNY'`，把 EUR/空/缺失全部变 CNY。`parse.js:98-99` 与 `client.js:1703-1704` 都把解析失败的 `granted`/`toppedUp` 写成 `'0'`。
**复现**：`{currency:'EUR', total_balance:'5.00'}` → Client 产出 `currency:'CNY'` 的余额；`{granted_balance:'x'}` → `granted:'0'`。
**影响**：违反 Invariant 1/2 的精神（不发明数据、不改标）；气泡会出现"充值 0 + 赠金 0"而总额非零的自相矛盾显示。
**[建议]** 未知币种必须拒绝或进入显式 partial；禁止用 `0` 表示未知。

### GLM-D-05（= K-H1，收窄后可达性下降）原型键沿继承链取得伪价格并击穿渲染 — **Medium（Kimi 评 High）· 置信度 高（机制）/ 低（可达性）**

**[事实]**
- `client.js:515-526` `lookupPrice` 用 `table.models[key]`，无 own-property 检查；表对象是普通字面量（`client.js:202,220`）或 `kept = {}`（`client.js:1618`）。
- 崩溃点在 `client.js:1142-1149`：`priced.entry[tier].input`。
- **收窄**：`normalizeModelId`（`client.js:505`）会 `trim().toLowerCase()`。实测在归一化后存活的原型键只有 **`constructor`** 与 **`__proto__`**；`toString`、`hasOwnProperty`、`valueOf`、`isPrototypeOf`、`propertyIsEnumerable`、`toLocaleString` 小写后**不命中**，走 `undefined` 分支被正常跳过。
- **同一文件已认识到该风险**：`client.js:1555,1558` 用 `Object.create(null)` 并配注释"Prototype-free so a model id can never collide with Object keys"——说明这是**处理不一致**，不是认知缺失。

**[建议]** 领域字典统一用 `Object.create(null)` 或 `Map`，查找只接受 own key。
**[建议] 测试修正**：Kimi 提议的端到端反例集里，`toString` 一条**恒真、永不会失败**，不应写入；有效反例是 `constructor`、`__proto__` 及别名表同名键。
**[待确认决策]** 渲染异常在宿主内的隔离范围未知（本次无法验证），所以"使 React 子树卸载"仍是推断，这也是下调评级的主要原因。

### GLM-D-06（Kimi 遗漏）价目解析按位置取列，空头会串列错位 — **High · 置信度 高**

**[事实]** `parse.js:255-258` 生成列 id 时 `.filter(cell => cell !== '')` 删除空单元格；`parse.js:298-303` 随后 `values.forEach((cell, at) => … models[ids[at]] …)` **按位置**取值。两个索引空间不再同构。
**复现**：表头 `['', 'deepseek-chat', 'deepseek-reasoner']` → `ids = ['deepseek-chat','deepseek-reasoner']`，于是第一列（被丢弃的空头列）的价格写进 `deepseek-chat`。
**影响**：把 A 模型的价写进 B 模型——直接违反 Invariant 1，且**完全没有降级提示**（卡片会显示一个看起来合理的错价格）。
**[建议]** 保留空头占位（用 `null` id 而非过滤掉），或按表头单元格文本而非位置对齐；配一条"上游留空头列"的解析用例。
**说明**：`parse.js:163`（`amountOf` 只取一行里第一个数字）与本条同类：解析器依赖位置/首个匹配，而非标签身份。Kimi 在覆盖空白里泛泛提了解析矩阵不足，**未指出这两条具体路径**。

### GLM-D-07（Kimi 遗漏）`truncateCents` 的浮点回退与 Invariant 4 直接冲突 — **Medium · 置信度 高（代码事实）/ 中（可达性）**

**[事实]** `client.js:461-465`：正则不匹配时走 `Number.isFinite(fallback) ? Math.trunc(fallback * 100) / 100 : null`。`AGENTS.md:44-45`（Invariant 4）明写"以十进制字符串求和、只向零截断**一次**、never add floats、never truncate per wallet"；该函数的 docstring 也承诺精确十进制。
**[推断]** `× 100` 再 `trunc` 对某些十进制值（二进制表示略低于目标）会少一分，例如 `0.29` 类形态；具体触发值随输入而定，本次未穷举。
**[建议]** 去掉浮点回退或改为字符串十进制；把"浮点回退"列入 Invariant 4 的显式禁止项，并补一条用例锁死。

### GLM-D-08（Kimi 遗漏）非法日历日期被 `Date.UTC` 静默归一化 — **Medium · 置信度 高**

**[事实]** `parse.js:355` 只检查 `month < 1 || month > 12 || day < 1 || day > 31`。2 月 30 日这类值通过校验，被下游 `Date.UTC` 归一化成 3 月的某一天并进入假日集合。
**影响**：在**错误的日期**上抑制高峰（计费错误），且把不存在的日期当成数据——同一越界方向还有 `MAX_EVENT_DAYS = 31`（`parse.js:33,389`）与 `MAX_HOLIDAY_DAYS = 400`（`parse.js:31,390`），这两条是有意的上限，本条不是。
**[建议]** 用 `Date.UTC(y,m-1,d)` 回读 `getUTCDate()` 校验往返一致；不一致则丢弃该事件。

### GLM-D-09（= K-M5）凭据读取异常被吞掉，误报"未配置 API Key" — **Medium · 置信度 高**

**[事实]** `index.js:157-160` `catch { }`（注释"损坏的存储不值得让卡片失败；试环境变量"）；若环境也没有 Key → `index.js:176-180` 状态 `unavailable` → Client 显示"未配置 API Key"（`client.js:1091-1093` 分支）。
**影响**：把"凭据服务损坏"和"用户没配"合并成一个用户可见结论，误导用户与排障；同文件其他源的失败会走 warning，策略不一致。
**[建议]** 区分 `unconfigured` 与 `credential-store-error`，后者进入 per-source 状态并可见。

### GLM-D-10（= K-H4，评级下调）定时刷新绕过 single-flight，旧响应可覆盖新余额 — **Medium（Kimi 评 High）· 置信度 高（机制）/ 高（自愈性）**

**[事实]**
- `index.js:207-216` `refreshBalance()` 内有 in-flight 去重 + `BALANCE_ASK_GAP_MS` 节流。
- `index.js:245`（定时器）与 `index.js:219`（启动）直接调 `loadDeepseekBalance()`，**绕过**该去重。
- 每次读取完成无条件写 `state.deepseek`，无 generation / latest-wins。
- 注释与实现不一致：`index.js:166-172` 承诺"失败时最后的好金额保持可见"，而 `index.js:191` 写 `{ status: 'failed', at }`。

**复现**：per-URL fetch stub + 让第一次读慢、第二次读快 → 观察到的最终值是较早那一次（`state served: ready 11.00`，即旧值覆盖新值）。
**[推断] 下调理由**：该状态由 30 秒定时器持续重写（`index.js:242-246`），最坏是**一个可见期内**显示旧余额，属可自愈的陈旧值，不是持续错误计费。仍应修，但不是 High。
**[事实] 保留部分**：注释与实现的矛盾是确定性的，与并发无关也该修——它承诺了一个不存在的"最后好值保持可见"行为。

### GLM-D-11（= K-M6，仅机制部分）气泡缺少可访问性关联；"definition list"实为 span — **Low · 置信度 高**

**[事实]** `client.js:1326` `role:'tooltip'`，全仓无 `aria-describedby`（grep 确认）；气泡行全部由 `span` 组成（`client.js:1342-1356`）。测试只覆盖 focus/blur/Escape 与文本（`test/client.test.mjs:1968-2054`），不断言 ARIA 关联。
**[修正]** Kimi 用 `dsh-card-design:97-99` 的"must not outlive its truth"论证"气泡陈旧违背设计约束"。**该条固定规则的实际限定是 provider 门控**（模型气泡只属于 official provider），不是"数据变化时刷新已打开气泡"。气泡在 provider/model 变化后不自动更新是代码事实（`tipSpec` 只在 dwell 完成时写入），但归属应是**开放项**，不是违背约束。
**[建议]** 若要保留 `role:'tooltip'`，补 `id` + 触发器 `aria-describedby`；否则改用不承诺关联的静态角色。

### GLM-D-12（= K-M3，但需加"这是已测试契约"）路由失败与旧 Host 缺字段不可区分 — **Medium · 置信度 高**

**[事实]** `client.js:781-799` 任何非 2xx/JSON 失败/网络异常都会清空远程数据（`.catch(() => settle({status:'failed', prices:null, holidays:null}))` 甚至**不带 `deepseek` 字段**）；`client.js:1003` 把 `null/undefined` 归为 `absent`；`client.js:1082-1087` 在 `absent` 且账号 ready 时回退账号余额。
**[事实] 关键限定（Kimi 未提）**：该回退是被测试锁定的契约——`test/client.test.mjs:1438` 断言"an absent API route falls back to the account balance"，期望渲染 `¥32.50`，注释写明理由是"older Host has no balance route"。
**影响**：`absent` 同时承载"旧 Host"与"路由此刻失败"两种语义，用户可能看到另一个付款方的余额而无说明。
**[待确认决策]** 修法（改为显式通知）会破坏 `:1438` 这条为旧 Host 兼容而写的断言，属**已测试行为变更**，须负责人确认（另见 GLM-Q-04）。
**[事实] 附带**：`client.js:798` 的 catch 载荷缺 `deepseek` 键，与 `readRemote` 的失败载荷形状不一致（后者返回 `deepseek: null`）。当前被 `?? 'absent'` 掩盖，属潜在漂移点。

---

## B. 设计风险（当前不是缺陷，但结构上会持续产生缺陷）

### GLM-R-01 宿主行为全部未验证，而方案分歧恰好落在宿主能力上 — **Info · 置信度 高（限制本身确定）**

**[事实]** 本次审计未运行 DSH。Loader 是否支持相对 ESM、渲染异常的隔离范围、Host 是否存在账号/目录/会话服务，均**无法验证**。
**影响**：这三项分别是 A 与 A′ 的分歧点、H1/H2 的真实严重度、以及方案 B 的可行性前提。**任何架构决策都应显式记录这三项未知**，否则结论建立在推断上。

### GLM-R-02 Invariant 8 的作用域缺口：宿主服务输入不在"必须校验"的规则里 — **High（规则缺陷）· 置信度 高**

**[事实]** `AGENTS.md:57-58` 把"每个穿过 loopback 路由的字段都在 Client 侧由 `readPriceBook` / `readHolidays` / `readRemote` 复验"写成不变量——列名恰好是**路由解码器**。而 GLM-D-02/05 的输入来自 `remote.account`、`remote.session.modelCatalog`（`readBalance` `client.js:1519`、`readModel` `client.js:1539`），**不在该不变量的字面覆盖内**。
**影响**：这不是"违反了不变量"，而是**不变量留下了空白**。代码里已经出现两种处理（`Object.create(null)` 有、own-key 检查无；`totalBalance` 过滤有、气泡遍历不过滤）正是空白的表现。
**[建议]** 把不变量作用域扩到"一切外部输入：路由 payload + 注入服务 + `ctx.get`"，再补代码——顺序反了会漂移。**[事实]** Kimi 把 H1/H2 描述为违反 Invariant 8，属扩大解释；正确结论是规则本身需要修订。

### GLM-R-03 `settle()` 的重试预算可能被刷新流量耗尽 — **Low · 置信度 低（未测出，仅代码形状）**

**[推断]** `client.js:772-778` 的 `attempts` 对所有 `settle()` 调用递增，`DATA_POLL_LIMIT`/`DATA_FAIL_LIMIT` 由本次状态选择；事件驱动的 `?balance=refresh` 也经过它，理论上可提前耗尽启动轮询预算。
**[事实] 未验证**：`repro5.mjs` 中两种路径均为 11 次读、刷新计数 0，**假设未被证实**。本项**不得**标记为已验证（矩阵中标"尝试但未定论"），保留价值是提示 M4 需要一条更具体的宿主侧时序用例。

### GLM-R-04 布局对宿主兄弟节点的测量耦合 — **Medium · 置信度 高**

**[事实]** `client.js:855-903` 的 placement 区读取"footer action row"的前方兄弟并测量其高度，用负 margin 把自己拉回行首。slot API 不变而宿主改用非 flex 布局时，卡片会错位。
**影响**：宿主侧任何 DOM 结构变化都会打到这张卡，而离线套件无法感知（无浏览器）。
**[建议]** 至少把该机制的假设写进 `dsh-card-design` 的固定层，并在宿主升级检查表里列为一条；这是**无法自动化**的风险，只能靠显式记录降低意外。

### GLM-R-05 契约无版本协商，`?balance=refresh` 用 URL 子串判定 — **Medium · 置信度 高**

**[事实]** `index.js:84` `request.url.includes('balance=refresh')`；payload 无 `schemaVersion`。子串判定意味着任何一段 URL（路径、Referer 派生的 query 顺序、代理注入的片段）出现该串都会触发一次带副作用的读。
**[建议]** 解析查询参数；payload 加版本号，让新旧半部组合可判定。**[事实]** 这与"路由冻结"（`DATA_PATH` 不可改）不冲突：改的是 body 与解析方式，不是路径。

### GLM-R-06 视觉/无障碍规范缺少可自动化的那部分门禁 — **Medium · 置信度 高**

**[事实]** 已自动化：字典键集一致（`test/client.test.mjs:473`）、`var(--dbc-*)` 全部已声明（`:2078`）。**未**自动化：4.5:1 对比度、间距/圆角闭集、196/232px 几何。越界值持续存在于树中：`client.js:613`（chip `padding:0 7px`）、`:619`（amount-row `gap:3px`，且 `:1392` 显示其只有一个子节点）、`:631`（`margin-top:2px`）、`:632`（`gap:1px`）、`:616`（调休 chip `--dbc-ink-3` on `--dbc-surface-3` = **4.46:1**）。
**[建议]** 对比度与刻度闭集是**纯函数**，可用同一套无框架风格强制（读 `CARD_CSS` 字符串 → 解析 `light-dark()` → WCAG 公式 → 对照白名单）。这是本报告对"加提示词"式治理建议的具体替代：**能算的就算，不能算的才写进文档**。**[推断]** 几何与真实宿主渲染无法离线强制，只能靠人工实测记录。

### GLM-R-07 CI 不覆盖当前工作分支 — **Low · 置信度 高**

**[事实]** `.github/workflows/ci.yml:7` `push: branches: [main]`，而当前分支是 `preview`；`pull_request` 与 `workflow_dispatch` 仍会跑。直接推 `preview` 不触发门禁。
**[建议]** 若 `preview` 是长期分支，把 push 触发扩到它；否则明确"必须开 PR 才受保护"。同时记录：CI 里没有构建步骤（本来就没有）、没有浏览器/真实 DSH E2E。

---

## C. 文档缺陷（规则/报告/注释与代码不一致）

### GLM-A-01 零构建禁令与重建方案正面冲突，且冲突未被承认 — **High · 置信度 高**

**[事实]** `AGENTS.md:5`："Three plain ES modules, **no build step, no runtime dependencies, no bundler**"。`.agents/skills/dsh-plugin-development/SKILL.md:118`（"Not allowed in this half"末条）："Add a build step or a bundler."。`REBUILD_OPTIONS.md:176-180` 与 `REBUILD_DECISIONS.md` 的 D-32 却推荐 TypeScript + bundler。
**影响**：三份文档同时存在时，任何按 skill 执行的 agent 会拒绝方案 A 的工程方式；按报告执行的 agent 会违反 skill。必须先解一处。
**[待确认决策]** 见 GLM-Q-01。

### GLM-A-02 `[事实]` 标签被用于不可核查的断言 — **Medium · 置信度 高**

**[事实]** `REBUILD_OPTIONS.md:31` 把"用户已允许 2.0 重议工程规范"标为 **[事实]**，但仓库内没有任何记录（`AGENTS.md`、skill、CHANGELOG、git log 都不含该授权）。按标签定义它应是 **[待确认决策]**。
**影响**：方案 A 的推荐建立在该句之上；一个错误标签会让负责人以为约束已经解除。
**[建议]** 审计/报告类文档也应遵守"改变约束的表述必须引到可核查来源"，否则降级为待确认。见 §治理。

### GLM-A-03 设计 skill 的"实测对比度表"从未覆盖调休 chip — **Low · 置信度 高**

**[事实]** `.agents/skills/dsh-card-design/SKILL.md:54-57` 列出 ink-1/2/3、chip green/amber、blue 的实测值，**不含** `--dbc-ink-3` on `--dbc-surface-3`（调休 chip 的组合）。
**影响**：4.46:1 的越界不是"改了色忘了复算"，而是"这一对从未被测过"。文档若按 Kimi 的表述修正，会引导读者去找一次并不存在的改动记录。
**[建议]** 在 skill 表里补测这一对，并把"新增任何 前景/背景 组合必须补测"写成一条固定检查（或按 GLM-R-06 自动化）。

### GLM-A-04 `index.js` 的余额注释描述了不存在的行为 — **Medium · 置信度 高**

**[事实]** `index.js:166-172`："A failed request is reported, and the last good amount stays visible until the balance is unreadable for good."；实现 `index.js:191` 无条件写 `{status:'failed', at}`，不保留旧值。
**影响**：读者与后续 agent 会按注释推断行为；GLM-D-10 的评级判断也依赖这条（若保留旧值成立，陈旧显示影响更小）。
**[建议]** 二选一：实现注释承诺的 last-known-good，或改注释。这属于 Kimi §7.3"漂移点"的一个具体实例，Kimi 未指名。

### GLM-A-05 不变量在四份 skill 中被逐条复述 — **Low · 置信度 高**

**[事实]** `AGENTS.md:29-58` 的八条在 `dsh-card-design`、`billing-regression-testing`、`dsh-plugin-development` 中各有带限定语的重述。
**[建议]** skill 只保留"本半部独有的禁止项"，不变量本体改为引用 `AGENTS.md` 行段。将来修订只需改一处。**[推断]** 复述带来的漂移成本已随 GLM-R-02 显现（作用域缺口在各 skill 里被继承）。

### GLM-A-06 `docs/rebuild/` 未把"不可变约束"列为需求层输入 — **Medium · 置信度 高**

**[事实]** `PRODUCT_REVERSE_ENGINEERING.md` 与 `CURRENT_ARCHITECTURE.md` 均未汇总 `AGENTS.md:5`、`DATA_PATH` 冻结、仅 `require('react')`、`--dbc-*` 自持、`engines.dsh` 区间为一节；约束只在选项报告里以"前置条件"零散出现。
**影响**：需求 → 架构 → 选项的链条在第二步丢失了硬约束，导致 §5 的排序建立在无约束前提上。
**[建议]** 增设"不可变约束 / 需负责人批准才能变更的约束"两层清单。

### GLM-A-07 设计记录里的实时视觉缺陷未进入缺陷清单 — **Medium · 置信度 高**

**[事实]** `docs/design-skill-audit.md:230` 已实测写明"196px 的中文带调休**今天就在换行**（head 高 18 → 34，卡片跟着高 16px）"，`client.js` 的中文条件（`makeupName`）使英文不受影响。Kimi 的 §9.2 只说"截图不能证明各种宽度正确"，未把这条**已确认**的未决项列入缺陷或优先级。
**影响**：用户可见的布局缺陷被降级为"验证限制"。

---

## D. 待确认决策（本文不代替负责人决定）

| ID | 决策 | 相关发现 | 破坏面 |
| --- | --- | --- | --- |
| GLM-Q-01 | 是否解除 `AGENTS.md:5` + plugin-dev skill 的零构建/无 bundler 禁令 | A-01、R-01 | 决定 A / A′ 路线；影响 `release-verification` 的产物校验 |
| GLM-Q-02 | 宿主 Loader 是否支持相对 ESM 多文件 Client（需实测或负责人确认） | R-01、A-01 | 决定分层能否落到物理文件 |
| GLM-Q-03 | Invariant 8 作用域是否扩到"一切外部输入" | R-02 | 规则文本改动，与 GLM-D-02/05 的修法绑定 |
| GLM-Q-04 | 是否允许 `absent` 不再回退账号余额（改为显式通知） | D-12 | 直接破坏 `test/client.test.mjs:1438`；旧 Host 兼容倒退 |
| GLM-Q-05 | 余额失败时保留最后好值，还是照注释语义改代码 | D-10、A-04 | 影响可见性语义与 30 秒自愈判断 |
| GLM-Q-06 | payload 是否加 `schemaVersion`、`?balance=refresh` 是否改精确解析 | R-05 | 新旧半部组合矩阵；路由路径本身不动 |
| GLM-Q-07 | 未消费的 payload 字段（`sources`、`at` 等）纳入诊断契约还是删除 | Kimi §6.7 | 删除会使 skill 的"读气泡排障"流程失效 |
| GLM-Q-08 | 是否把对比度与刻度闭集做成自动化门禁 | R-06 | 新增断言会抬高 PASS 基线数，需在报告里说明 |
| GLM-Q-09 | `preview` 分支是否纳入 CI push 触发 | R-07 | 仅 CI 配置 |

---

## E. 严重度汇总

| 严重度 | 发现 |
| --- | --- |
| High | D-01、D-02、D-03、D-06、R-02、A-01 |
| Medium | D-04、D-05、D-07、D-08、D-09、D-10、D-12、R-04、R-05、R-06、A-02、A-04、A-06、A-07 |
| Low | D-11、R-03、R-07、A-03、A-05 |
| Info | R-01 |

**与 Kimi 的评级差异（全部有上文理由）**：H1 High→Medium（可达集收窄 + 宿主隔离未知）；H4 High→Medium（30 秒自愈）；M2 Medium→**High**（已测量为默认路径）；新增 D-06/D-07/D-08/A-07 四条 Kimi 未列，其中 D-06 为 High。
