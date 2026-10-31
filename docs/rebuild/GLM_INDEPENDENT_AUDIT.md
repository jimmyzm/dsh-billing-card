# GLM 独立审计报告 — @jimmyzm/dsh-billing-card

对 `docs/rebuild/` 下六份 Kimi 逆向工程报告的独立复核。本文只给判定与证据，不给实现。

## 1. 结论摘要

**总体判定：六份报告的事实层高度可信，推断层有四处需要下调或收窄，结论层（推荐方案 A）在工程约束未被正式解除前不成立。**

- Kimi 引用的源码行号、测试行号与规则条款绝大多数准确（抽查 20+ 处，偏差 ≤2 行，无一处指向不存在的代码）。**[事实]**
- 全部 4 个 High 与 6 个 Medium 的代码机制我都能独立复现或从代码路径直接确认；其中 **H3 的复现是决定性的**，H4、M1、M2、M3 也各自测到了。**[事实]**
- 需要修改的结论：**H1 的可达面被夸大**（`toString` 反例实际不可达）、**H4 的 High 评级偏高**（自愈 ≤30 秒）、**M6 对 skill 条款的引用被扩大解释**、**§1.3 把"用户已允许重议工程规范"标成 [事实] 但仓库内无证据**。**[事实 + 推断]**
- Kimi 的遗漏有 6 项，其中 1 项直接冲突 Invariant 4（`truncateCents` 的浮点回退），1 项是仓库自己的设计记录已标注为未解决的实时视觉缺陷（196px 中文带调休换行）。**[事实]**
- 架构选项：**A 的方向对，但它把"引入 TypeScript + bundler"当作方案的一部分**，而 `AGENTS.md:5` 与 `dsh-plugin-development` skill 同时禁止构建与 bundler。在负责人解除该约束之前，可执行的是本文 §9.4 的 A′（同样的分层与运行时契约，纯 ES 模块、零构建、零依赖）。**[建议]**

置信度说明：本文所有 **[事实]** 均可用只读命令复现；**[推断]** 标出未被测量覆盖的部分；**[建议]** 是设计意见；**[待确认决策]** 必须由负责人决定，本文不代替其决策。逐条证据映射见 [GLM_VERIFICATION_MATRIX.md](GLM_VERIFICATION_MATRIX.md)。

## 2. 审计范围、方法与限制

### 2.1 做了什么

- 完整读取六份报告（合计约 99 KB）。
- 完整读取 `AGENTS.md`、`index.js`(263)、`parse.js`(455)、`client.js`(1912)、三个测试文件(2083/400/391)、四份 skill、CI workflow、`package.json`、`docs/design-skill-audit.md`。
- 运行只读/无副作用检查：`node --check` ×3、`npm test`、`npm pack --dry-run`、`git status`、`wc -l`、大量 `grep`/`sed`。
- 在仓库外的 `/tmp/glm-audit/` 搭了一个最小装载器，把 `client.js` 的真实模块取出来，用受控输入复现 H1/H2/H3/H4/M1/M2/M3 与对比度计算。脚本全部在 `/tmp`，未进入仓库。

### 2.2 基线证据

| 项 | 值 | 证据 |
| --- | --- | --- |
| 分支 / HEAD | `preview` / `7512286` | `git log --oneline -1` |
| 版本 | `1.3.0` | `package.json:3` |
| 门禁 | **1004 条 PASS，0 条 FAIL** | `npm test \| grep -c '^PASS'` = 1004；`grep -c '^FAIL'` = 0 |
| 运行时文件 | tarball 13 个文件 | `npm pack --dry-run` |
| 工作树 | 干净，仅 `?? docs/rebuild/`（Kimi 的目录） | `git status --short`，每次命令后复查 |

**[事实]** 本次审计没有修改任何业务代码、配置、测试、skill、`AGENTS.md` 或 Kimi 的原始报告。

### 2.3 限制（这些限制决定了本文哪些结论只能是推断）

1. **没有运行中的 DSH 宿主**。未启动应用，未观察到真实 Loader、`ctx`、`webServer`、`remote` 服务的实际行为。所有关于宿主行为的说法——Loader 是否支持相对 ESM import、渲染抛异常时宿主是否隔离该错误、slot 布局是否变化——都**无法验证**，只能标注为待确认。
2. **不访问网络**。三个上游（两个价目页、iCloud 日历）与 `api.deepseek.com` 的真实响应形状只以 `test/fixtures/` 的捕获件和 `index.js` 的请求代码为据。
3. **不读对话历史之外的授权来源**。Kimi 报告中"用户已允许重议工程规范"这类断言，仓库内没有可核查的记录；我无法证实也无法证伪。
4. **未做浏览器渲染**。对比度用 WCAG 公式对 token 色值复算，几何结论用 `client.js` 的 CSS 与仓库既有实测记录，不是本轮像素测量。

## 3. 逐份报告判定

### 3.1 PRODUCT_REVERSE_ENGINEERING.md — 基本合理，个别地方"推断"标注不足

**保留：**
- 产品定位、五个核心场景、"余额归属由 provider 决定"的解析，与 `AGENTS.md:46-49`（Invariant 5）、`AGENTS.md:50-54`（Invariant 6）以及 `client.js` 的 `billsOnOpenPlatform` / `billsAtListPrice` 一致。**[事实]**
- §8"业务要求与历史实现细节"对八条不变量的引用行号正确（`AGENTS.md:29-58` 区间）。**[事实]**
- §9.3 把需要负责人确认的产品问题单列，没有替负责人决策，符合审计规范。**[事实]**

**需要修改：**
- **[事实]** 中混入了若干只能算**推断**的句子：例如把"用户痛点"的强度写成事实，而仓库内没有任何用户数据、反馈记录或使用统计（README/CHANGELOG 只有版本与功能描述）。这不是错误结论，而是**标记纪律问题**——本报告用同一套标签，Kimi 对事实/推断的自评标准在执行上不一致。
- **遗漏**：没有把 `docs/design-skill-audit.md:230` 已实测确认的"196px 中文带调休今天就在换行"列为仍然存在的已知产品可见缺陷。用户看得见的东西被排除在"已实现功能清单"之外。

### 3.2 CODE_QUALITY_AUDIT.md — 最有价值的一份，四处评级需要调整

**保留（独立复现成功）：**
- **H3** 决定性复现：`index.js:219` 用 `const [tables, holidays]` 只解构两个位置，`Promise.all` 的第三个 promise（余额）结果被丢弃；凭据 promise 不 settle 时价格/日历即便完成也不提交。我用一个不 resolve 的凭据 stub 观察到 payload 停在 `loading`。**[事实]**
- **H2** 两种模式都复现：`[null, {currency:'CNY',balance:'1'}]` 先由过滤后的 `totalBalance`（`client.js:570-587`）算出合法总额，再由未过滤的原始遍历（`client.js:1061`）抛异常；`sumAmounts`（`client.js:548`）对解析失败静默 `continue`，导致"有效但不完整"的总额且无 partial 标记。**[事实]**
- **H1 的机制**成立，但**可达面需收窄**，见 §5.1。
- **M1/M2/M3/M5** 均确认，见 §5.2、§5.3。
- §9.1 的 UI 偏差（对比度、刻度、`.dbc-amount-row` 的孤儿 gap）复核为准确：`--dbc-ink-3 #686e77` on `--dbc-surface-3 #eceff4` 复算 **4.46:1**；`.dbc-chip` 的 `padding:0 7px`（`client.js:613`）、`.dbc-amount-row{gap:3px}`（`client.js:619`，其父只有一个子节点 `client.js:1392`）、`margin-top:2px`（`client.js:631`）、`gap:1px`（`client.js:632`）都在 `dsh-card-design:48` 的闭集 `4/5/6/8/10/12` 之外。**[事实]**

**需要修改的评级：**
- **H1 → Medium**（Kimi 评 High）。机制真实，修复成本极低（同文件 `client.js:1555-1558` 已经用 `Object.create(null)` 处理过同类问题），但触发要求宿主模型目录里出现字面为 `constructor` 或 `__proto__` 的模型 id。仓库无证据表明存在。**[事实]** 至于崩溃后果，"React 子树被卸载"是推断，且**宿主是否隔离卡片渲染异常无法验证**。**[待确认决策/无法验证]**
- **H4 → Medium**（Kimi 评 High）。旧覆盖新的机制确认，但它落在一个 30 秒自自愈定时器上（`index.js:242-246`），最坏情况是一次可见期内显示旧余额，而不是持续错误计费。仍然值得修——因为它同时暴露了"注释与实现不一致"：`index.js:166-172` 承诺"失败时最后的好金额保持可见"，而 `index.js:191` 无条件写 `{status:'failed'}`。**[事实]**
- **M3 的修法需要加一条前置说明**：`absent → 回退账号余额`并不是未定义行为，它已经被 `test/client.test.mjs:1438` 断言为契约（"an absent API route falls back to the account balance"，期望 `¥32.50`），注释还写明理由是"older Host has no balance route"。**[事实]** 所以 Kimi 的建议（不可用时优先显示通知而非跨账户替换）是一次**已测试行为的变更**，必须走负责人决策，不能当作纯 bugfix 落地。

**M6 需要修正引用：** Kimi 用 `dsh-card-design:97-99` 的"must not outlive its truth"论证打开中的气泡会陈旧。原文那条**固定规则**明确限定在 provider 门控（气泡只在 official provider 下属于该模型），不是"数据变化时必须刷新已打开的气泡"。**[事实]** 气泡在 provider/model 变化后不自动更新仍是代码事实（`tipSpec` 只在 dwell 完成时写入），但把它称作"违背项目设计约束"是把条款扩大了；正确表述是**开放项**（该 skill §"Open"允许逐例决定并记录）。

### 3.3 CURRENT_ARCHITECTURE.md — 准确，7 条架构问题全部可核；缺一条最硬的约束冲突

**保留：** 模块所有权表、数据流图、四条调用链（启动/30 秒/切换/每秒）、§5 的 Host/Client 能力边界与 `AGENTS.md` 的 Architecture 表一致；§8 部署与兼容边界（frozen `DATA_PATH`、`engines.dsh` 预发布区间、`wide` 是 prop 不是 mount gate）逐条对得上代码与规则。**[事实]**

- §9 提到的"`index.js` 里 `load()` 是事实上的 orchestrator 但无并发/取消语义"经确认：`index.js` 只有 `refreshBalance`（`:207-216`）内部有 single-flight + gap 去重，定时器（`:245`）与启动（`:219`）都绕过它。**[事实]**

**遗漏（重要）：**
- 没有指出 `AGENTS.md:5`（"Three plain ES modules, no build step, no runtime dependencies, no bundler"）与 `.agents/skills/dsh-plugin-development/SKILL.md:118`（"Add a build step or a bundler."，列在 **Not allowed in this half**）这两处**硬约束**，会使 REBUILD_OPTIONS 的方案 A 直接违规。架构报告应当把"当前不可变约束清单"写全，否则选项报告是在无约束条件下选优。**[事实]**
- §9 未列 Invariant 8 的作用域缺口，见 §5.3。

### 3.4 API_INVENTORY.md — 最扎实的一份，几乎无需修改

**保留：**
- §1 稳定性分类、§3.1 `DATA_PATH` 冻结理由、§4 解析器导出、§5.1 Loader 返回值、§5.2 注册项、§6.1–6.6 路由与 payload 形状，与我逐行读的 `index.js` / `client.js` 一致；文档化的 `HostPayload` / `PriceTable` / `HolidayCalendar` / `DeepseekBalance` 字段与实际返回对象字段能对上。**[事实]**
- §6.7"当前未消费字段"grep 复核成立：例如 payload 顶层 `at`/`sources` 的部分键、`holidays.makeupNames` 之类在 `client.js` 无消费点。**[事实]**（注意：这是"未被 Client 读取"，不等于"可安全删除"——它们是 Host 的诊断输出，见 §7。）
- §7 宿主服务契约（`inject` 数组、`ctx.get('uiSession')`、`ctx.get('modelDirectories')`、`remote.account`、`remote.session.modelCatalog`）与 `client.js` 的实际取用一致；§10.1 风险点（无 `schemaVersion`、`?balance=refresh` 用子串判定）都是代码事实：`index.js:84` 用 `request.url.includes('balance=refresh')`。**[事实]**

**需要补充：**
- §3.3 Host 消费的 context 契约里，`credentials.resolve` **无超时**这一条只作为风险提及；结合 H3，它应当被升级为契约级缺陷（凭据服务是启动就绪的单点）。**[建议]**
- **不一致**：§5 描述 Client 侧字典构建时，`readModel` 用 `Object.create(null)` 防原型碰撞（`client.js:1555,1558`），而 `readPrices` 的 `kept = {}`（`client.js:1618`）与内置快照 `models: {...}`（`client.js:202,220`）是普通对象。同一风险在两个边界处理不同，API 清单应显式标注这个差异，而不是只标 H1 的崩溃。**[事实]**

### 3.5 REBUILD_OPTIONS.md — 方向正确，推荐 A 的前提不成立

**保留：**
- §1.3 明确"不应误当成事实的假设"，并否掉了"TypeScript 能解决路由坏数据"——这一条判断正确，值得肯定：**编译期类型不提供运行时输入校验**，而本项目真正的问题面是运行时外部输入（宿主服务 + HTTP payload）。**[事实]**
- 对方案 B 的四个可行性阻断（Host 无法证明知道浏览器当前会话、无 Web Server 时的降级、多客户端上下文、账号/目录能力）没有粉饰，直接判为"能力验证后再议"，这是诚实的处理。**[事实]**
- 对方案 C "技术可行但需求不足"、"当前不采用"，我同意：没有第二家 provider、没有第二渠道的证据，SPI 的长期兼容成本无对应收益。**[建议]**

**必须修改：**
1. **§1.3 把"用户已允许 2.0 重议工程规范"标为 [事实]，但仓库内无证据。** 按本文的标签纪律，它应是 **[待确认决策]**。整个方案 A 的工程方式（§2.9）建立在它之上。**[事实]**
2. **§2.9 推荐 TypeScript + 轻量 bundler**，与 `AGENTS.md:5` 和 `dsh-plugin-development:118` 正面冲突；§2.10 自己写了前置条件"必须正式批准工程约束变化"，但推荐语（§6）没有把这个前置条件写进理由，读者会把 A 当成可立即执行的方案。**[事实]**
3. **§2.9 的"退化变体"没有被认真评价。** Kimi 用一句 **[推断]** 打发掉"零构建变体"（"物理拆分会受限，维护性收益较小"），但没有论证。 Loader 是否支持相对 ESM 属于**无法验证**项（见 §2.3）；在真实宿主里，`client.js` 是 Loader 加载的单文件，任何物理拆分都受 Loader 能力约束。**[待确认决策]** 也就是说：零构建变体的可行性不能靠推断否定，需要一次宿主侧实验或负责人确认。
4. **横向比较表（§5）缺两行关键维度**：与现存约束的冲突程度、以及"修复本次已证实缺陷所需的最小改动量"。加上这两行，A 与 A′ 的排序会变化。

### 3.6 REBUILD_DECISIONS.md — D-01…D-48 覆盖充分，但阻断项排序错位

**保留：** 清单把"保留/淘汰/必须现在定/可推迟"分开，§9 有立项前阻断项，§10 给负责人摘要——这是六份里最接近可执行治理的一份。**[事实]**

**需要修改：**
- §9 的阻断项把架构选型排在前面，但真正的**第一阻断项**是"是否解除 `AGENTS.md:5` 与 plugin-dev skill 的零构建禁令"。它决定 A 是否可用、决定 48 项里多少项的实现形态。**[建议]**
- 若干"决策"其实是被代码与测试已锁定的既成事实（例如 `DATA_PATH` 冻结、`absent` 回退账号余额）。把它们与真正开放的问题并列，会让负责人以为可以随手改；应当显式标注"改动将破坏 X 断言 / Y 不变量"。**[事实]**
- D-32（工程规范）与本文 §3.3 指出的 skill 禁令冲突未被承认。**[事实]**

## 4. 经证实、应原样保留的问题

| Kimi 编号 | 判定 | 我的复核方式 |
| --- | --- | --- |
| H2 钱包脏数据（崩溃 + 静默少算） | 已证实，High 合理 | 两类输入各跑一次，观察到异常与少算 |
| H3 凭据无超时阻塞启动提交 | 已证实，High 合理，最严重 | 不 settle 的凭据 stub → payload 永停 loading |
| M1 非法币种改标 CNY / 缺失组成写 '0' | 已证实 | `client.js:1701`、`parse.js:98-99` |
| M2 部分 loading 被提升为 ready | 已证实（可量化） | 全 null 价目 + 终态 `deepseek:'unavailable'` → 只读 2 次即停，对照 11 次 |
| M3 路由失败与旧 Host 缺字段不可区分 | 已证实 | `client.js:1003,1082-1087` |
| M4 无超时/序号/卸载保护 | 代码事实；后果为推断 | 阅读 `ask()`/`settle()`（`client.js:768-817`），Kimi 自己标了"未构造全部时序"，诚实 |
| M5 凭据异常被吞 | 已证实 | `index.js:158-160` 空 catch，环境回退 |
| M6 ARIA 关联不足 | 已证实（机制）；"违背约束"夸大 | `client.js:1326` `role:'tooltip'` 无 `id`，全仓无 `aria-describedby`；气泡行全为 `span`（`client.js:1342-1356`） |
| 低严重度表 | 抽查准确 | 与 §3.2 的 CSS 刻度核对 |
| UI 偏差（对比度 4.46、刻度、孤儿 gap） | 已证实 | 复算 + grep |

## 5. 应修改或收窄的结论

### 5.1 H1：可达集只有 `constructor` 与 `__proto__`

**[事实]** `lookupPrice` 在索引前做 `normalizeModelId`（`client.js:505`：`trim().toLowerCase()`）。`toString` / `hasOwnProperty` / `valueOf` 小写后不再命中原型属性，`models[key] === undefined` 因而**跳过**；只有本来就全小写的原型键能存活。实测（对象字面量 + 同一套归一化）：

```
constructor  -> 命中，priced.entry[tier].input 抛 TypeError
__proto__    -> 命中（Object.prototype），抛 TypeError
toString / hasOwnProperty / valueOf / isPrototypeOf / propertyIsEnumerable -> 未命中
```

所以 Kimi 建议的"加入 `constructor`、`__proto__`、`toString` 的端到端反例"里，`toString` 一条**永远不会失败**，写进测试只会制造一条恒真用例。修正：反例集为 `constructor`、`__proto__`、以及别名表（`PRICE_SNAPSHOT.aliases`，同样是普通对象）上的同名键。

### 5.2 Invariant 8 存在作用域缺口，这是 Kimi 没有说清的根因

**[事实]** `AGENTS.md:57-58`（Invariant 8）原文把校验责任限定在 **`readPriceBook` / `readHolidays` / `readRemote`** —— 即**穿过 loopback 路由的字段**。而 H1、H2 的实际输入来自 **DSH 客户端服务**（模型目录、账号钱包），不在该不变量的字面覆盖范围内。

这带来两个后果：
1. Kimi 用"违反 Invariant 8"描述 H1/H2，是在**扩大解释**一条比缺陷更窄的规则。**[事实]**
2. 更严重的是**规则本身**：`readRemote` 之后的 `payload.deepseek` 由 `readDeepseek` 处理、`readBalance`（`client.js:1519-1535`）与 `readModel` 完全不在这条不变量里，"宿主服务输入不需要防御"就成了规则留下的空白。修复顺序应是**先补规则，再补代码**，否则下一个 agent 会在同一处再犯。**[建议]**

### 5.3 `settle()` 的重试预算可能是共享的——但未测出，只能作为推断

**[推断]** `client.js:772-778` 的 `attempts` 对每个 `settle()` 递增，且 `DATA_POLL_LIMIT`(10)/`DATA_FAIL_LIMIT`(3) 由**这一次** `settle` 的状态选出。事件驱动的 `?balance=refresh` 读回同样经过 `settle`，因此理论上可提前耗尽启动期的轮询预算。

我专门构造了 `/tmp/glm-audit/repro5.mjs` 验证：静默启动 11 次读、选择变化后仍 11 次读且 `?balance=refresh` 计数为 0——**假设未被证实**（测试环境的选件时机没有产生刷新流量）。该项**不得记为已验证**，矩阵里标"尝试但未定论"。价值在于：它指出了 M4 缺少一个更具体的失败模式，值得在真实宿主里测。

### 5.4 M2 的量化补充（支持 Kimi，并提高其优先级）

**[事实]** 我构造"三源全缺 + 无 Key 终态"的 payload：Client 只发起 2 次读即判 ready（对照组 11 次）。也就是说 M2 不是"可能提前停止"，而是**在常见无 Key 启动路径上确实提前停止**，此后要靠 `DATA_REFRESH_MS` 的 30 秒 tick 才可能校准。Kimi 的"推断"应当升为"事实 + 已测量"。

## 6. Kimi 报告遗漏的问题

按影响排序：

1. **[事实] `truncateCents` 的浮点回退违反 Invariant 4。** `client.js:461-465`：正则不匹配时用 `Math.trunc(fallback * 100) / 100`。Invariant 4（`AGENTS.md:44-45`）规定"钱包总额以十进制字符串相加、只向零截断一次"，且明写"never add floats, never truncate per wallet"。这不只是风格问题：`× 100` 再 `trunc` 对形如 `0.29` 的值会因二进制表示落到 28.999… 而少一分。六份报告均未提及。**注意可达性未测**：正常金额路径下正则命中，该回退只在异常输入时生效，属 **[推断]** 影响面。
2. **[事实] 196px 中文带调休换行是仓库自己已确认的实时视觉缺陷。** `docs/design-skill-audit.md:230` 明确写"196px 的中文带调休**今天就在换行**（head 高 18 → 34，卡片跟着高 16px）"。Kimi 的 §9.2 只说截图覆盖不足，没有把这条已实测的未决项列进缺陷清单，也没有在优先级里给它位置。
3. **[事实] `parse.js:355` 的日期界只做 `day > 31`。** 2 月 30 日这类非法日不会被拒绝，会被 `Date.UTC` 归一化到 3 月初的某一天，进而在错误的日期上抑制高峰。属于"Invariant 1 不许发明日历数据"的边界问题，Kimi 未提。
4. **[事实] `parse.js:255-258` 与 `:298-303` 的列对齐风险。** 表头 id 生成时 `.filter(cell => cell !== '')` 会删掉空单元格，而价格单元随后**按位置** `ids[at]` 取值。上游只要在某列留一个空头，其后所有列的模型都会错位一行——把 A 模型的价格写进 B 模型。这是"错误价格"级风险，比 M1 的"错误币种"更直接影响金额可信度。Kimi 完全没有覆盖价目解析的这条路径（§8 覆盖空白只泛泛说解析矩阵不足）。
5. **[事实] `parse.js:163` 只取一行里的第一个数字**（`/\d+(?:\.\d+)?/.exec`）。单元格若变成"1.00（含税 0.06）"这类形状，会静默取第一个数。属于同一类"解析器按位置/按第一个匹配"的脆弱点。
6. **[事实] `parse.js:98-99`（以及 Client 的 `:1703-1704`）把缺失/非法的 `granted_balance`、`topped_up_balance` 写成 `'0'`**，Kimi 只在 M1 里带了半句"Host 也采用同样默认"，没有指出这会与总额产生可见不一致（气泡里"充值 0 + 赠金 0"而总额非零），也没说这属于"把未知当已知"。
7. **[事实] CI 不覆盖当前分支。** `.github/workflows/ci.yml:7` 的 `push` 限定 `branches: [main]`，而工作分支是 `preview`：`pull_request` 与手工触发仍会跑，但直接推 `preview` 不跑门禁。Kimi 的工程/发布决策（D 系列）谈到了"真实 DSH 验证缺失"，没提这个更基础的缺口。

## 7. 关于 §6.7"未消费字段"的一点澄清

**[事实]** `grep` 确认这些字段没有 Client 读取点。**[建议]** 但"未消费"不等于"可删"：payload 的 `sources` 与 `at` 是 Host 侧唯一可观测的降级证据，而 `dsh-plugin-development` 的"Failure handling"依赖读气泡来区分 `启动时校准` 与 `内置快照`。2.0 若要清理契约，应把它们**纳入**诊断契约而不是删除——否则排障能力倒退。

## 8. 无法验证、必须交由负责人或宿主实验确认的项

1. **[待确认决策]** DSH Loader 能否加载相对 ESM 多文件 Client；这是 A 与 A′ 分歧的物理前提。
2. **[无法验证]** 卡片渲染抛异常时宿主的错误边界行为（影响 H1/H2 的真实严重度评级）。
3. **[无法验证]** Host 侧是否存在账号余额 / 模型目录 / 可见会话服务（决定方案 B 是否值得继续评估）。
4. **[无法验证]** 真实 `credentials.resolve` 是否会挂起（H3 的机制已在代码层确认，发生概率只能由宿主侧观测）。
5. **[待确认决策]** `AGENTS.md:5` 与 plugin-dev skill 的零构建禁令是否解除。
6. **[待确认决策]** `test/client.test.mjs:1438` 锁定的 `absent → 账号余额`回退是否允许改为显式通知（M3 修法的直接后果）。

## 9. 候选架构的独立评价

### 9.1 判据

本文只回答一个问题：**哪种结构能以最小新增复杂度，消除 §4/§5/§6 里已被证实的缺陷面？** 不因为"分层 + 契约 + DI"流行而推荐它。

### 9.2 方案 A（契约优先分层双端 + TS + bundler）

- **解决**：H1/H2/M1/M2（`Contracts` 的运行时 decoder + `Domain` 的纯规则）、H3/H4/M4（`Application` 的统一协调器）。这些正是已证实缺陷的位置，映射是真实的，不是修辞。**[事实]**
- **只是搬走的复杂度**：类型层。`any`→具名类型不改变运行时输入形状，Kimi 自己在 §1.3 否掉了"TS 解决路由坏数据"；但要更进一步——**TS 的 `interface` 描述 DTO 也不产生校验**，校验必须仍然手写（zod/valibot 或自研守卫），而自研守卫在纯 JS 里同样能写。**[推断]**
- **无实际收益的层**：`ui/` 下的 ViewModel 层与 `adapters/` 的 ports 抽象——本卡片只有一个视图、两个入口、一个消费者；`client.js` 现在的"spec builder + render"已经等价于 ViewModel。**[建议]**
- **最难测试/调试之处**：构建产物与 Loader 的接缝。一旦引入 bundler，"tarball 里是 13 个运行时文件"这条现有可验证性质（`npm pack --dry-run`）会改变，`release-verification` skill 的产物校验步骤需要重写。**[事实]**
- **被迫重设计的情形**：Loader 不支持产物形态（如需要单文件自包含、禁止共享 chunk）——A 的实现会退化成 A′ 再加一层构建。
- **现在必须定的**：零构建约束。**可推迟的**：`ui/` 拆分粒度、ViewModel 形状。
- **最贵的将来变更**：`DATA_PATH`、payload 字段语义、provider 集合（这三项一旦改，旧 Host × 新 Client 组合即断裂）。A 在这三项上和现状等价，没有优势也没有劣势。

### 9.3 方案 B / C

- **B**：四个可行性阻断未解，我同意"能力验证后再议"。补充一点：B 把余额判定搬到 Host，会**新增**一个已证实缺陷类（Host 无法可靠知道当前浏览器会话的 provider），方向与"减少跨半部契约风险"相反。**[推断]**
- **C**：没有第二个 provider、没有第二数据渠道的证据；SPI 的长期兼容成本换不到当前收益。同意"当前不采用"。**[建议]**

### 9.4 A′：同样的分层与运行时契约，零构建、零依赖（本文替代方案）

**[建议]** A′ 不是"保守版 A"，它在两个已证实缺陷类别上与 A 等价，但少掉一整类新风险。

| 组成 | 做法 | 对应缺陷 |
| --- | --- | --- |
| 纯模块抽取 | 把 `client.js` 里的 `periodAt`/`nextSwitchAt`/`billsAt*`/`sumAmounts`/`truncateCents`/`readXxx` 移入新增的 `shared.js`（ES 模块，无构建），Host 与 Client 各自 import 自己需要的部分 | §7.3 重复与漂移点（Kimi 已列） |
| 运行时 decoder 前置 | 每个外部输入各一个守卫：`readWallets`（逐项校验，产出 `partial`）、`readModelIds`（own-key + `Object.create(null)`）、`readDeepseek`（未知币种拒绝而非改标） | H1、H2、M1 |
| 单一资源协调器 | Host 侧一个 `readResource(name, trigger)`：per-resource single-flight + generation/latest-wins + 独立提交，启动、30 秒 tick、事件、`?balance=refresh` 全走它；凭据读取包进有界超时 | H3、H4、M4 |
| 状态按源而非整体 | payload 携带 per-source 终态，Client 的"完成"由必需来源的终态组合得出 | M2、M3 |
| 契约版本号 | payload 加 `schemaVersion`，`?balance=refresh` 改为解析查询参数而非子串 | §10.1（Kimi 已提，此处只是不需要 TS 也能做） |

- **为什么不引入 TS/bundler**：`AGENTS.md:5` 与 plugin-dev skill 同时禁止；本项目的真实故障是**运行时外部输入**与**并发时序**，两者都不由编译期类型解决；现有 1004 条断言已覆盖领域规则，A′ 增加的 decoder 与协调器能被同一套（无框架）测试覆盖。
- **A′ 的代价**：类型提示靠 JSDoc + `checkJs`（可离线跑，不必进 CI）；跨文件常量仍需手动同步；`client.js` 仍是 Loader 单文件的物理形态（若 Loader 不支持相对 import，A′ 的"抽取"只能在 Host 侧发生——这是**必须先在宿主里确认**的前提）。
- **A′ 的适用条件**：负责人**不**解除零构建约束，或宿主 Loader 能力未验证。若负责人正式解除并确认产物能被 Loader 加载，A 的分层更彻底，此时应选 A。

### 9.5 最终推荐与适用条件

1. **先决策，后选型**：第一阻断项是 `AGENTS.md:5` + `dsh-plugin-development:118` 是否解除。**[待确认决策]**
2. **未解除 → 采用 A′**（分层与契约与 A 相同，物理形态不变）。**[建议]**
3. **解除且 Loader 产物经实测可用 → 采用 A**，但必须剔除 `ui/ViewModel` 与通用 ports 抽象作为首发范围（它们对已证实缺陷无贡献）。**[建议]**
4. **B 与 C：不做**，B 待宿主能力实测，C 待出现第二个 provider。**[建议]**
5. **任何一条路线之前**：先补 Invariant 8 的作用域（把宿主服务输入纳入），再改代码——否则修复不落在规则上，会漂移。**[建议]**

## 10. 重建流程与 Agent 治理审查

### 10.1 需求 → 架构 → 工程 → 任务的依赖是否清晰

**[事实]** 六份报告构成这条链，且每份都带标记层。**[建议]** 断点在"约束"未被单列为需求层输入：`AGENTS.md:5` 的零构建禁令属第一层需求，却只在选项报告里以"前置条件"出现，导致链条从第二步起与第一步冲突。修正：在 `PRODUCT_REVERSE_ENGINEERING.md` 增设"不可变约束"小节，把 frozen `DATA_PATH`、零构建、仅 `require('react')`、`--dbc-*` 自持调色板、`engines.dsh` 区间列为需求项。

### 10.2 ADR 是否有状态/理由/备选/批准人

**[事实]** `REBUILD_DECISIONS.md` 有编号与摘要，但**没有 status 字段，也没有批准人栏**。48 项里"已决定 / 待决定 / 已被代码锁定"无法区分。**[建议]** 每项补 `status`（proposed/accepted/rejected/blocked-by-owner）、`alternatives`、`approver`、以及"落地将破坏哪些断言/不变量"。

### 10.3 Agent 是否会自改需求、自扩公共 API、自行放大范围

**[事实]** 本仓库有真实的自改风险通道，且它**已被部分自动化防护**：`AGENTS.md` 与 skill 的修改和提交一样需要显式授权（"Editing this file or a skill follows the same rule — there is no documentation exception"）。**[建议]** 缺口是：`docs/rebuild/` 这类"报告"文件不在该规则覆盖内，agent 可以写出新的"事实"而不触发任何门禁——本次 Kimi 的 §1.3 恰好示范了这个通道（一个无证据的 [事实]）。修正：给审计/报告类文档加一条与 skill 同级的规则——**改变约束的表述必须引到可核查来源，否则降级为 [待确认决策]**。

### 10.4 验收标准是否由实现者自定自批

**[事实]** 现有规则里门禁是外部可复核的（`node --check` ×3 + `npm test`，1004 条 PASS/FAIL 一行一条），因此"实现者自己宣布通过"在这个仓库里不成立——任何人重跑即可核对。**[事实]** 但门禁覆盖不到的部分（见 10.5）确实只有实现者能判断，这正是自批风险的真实位置。

### 10.5 可自动强制 vs 仍需人判断 —— 这是本报告对 Kimi 最有用的修正

**[事实]** Kimi 在多处暗示"规范没有自动门禁"。实际情况更细：

| 规则 | 是否已自动化 | 证据 |
| --- | --- | --- |
| zh/en 字典键集一致 | **已强制** | `test/client.test.mjs:473` |
| 样式表读取的每个 `--dbc-*` 都已声明 | **已强制** | `test/client.test.mjs:2078` |
| tooltip 分隔线存在 | **已强制** | `test/client.test.mjs` 末段断言 |
| 计费窗口/时区/金额精度/provider 选择 | **已强制**（1004 条的主要部分） | `test/client.test.mjs` `CASES`、`test/parsers.test.mjs` |
| 对比度 ≥4.5:1 | **未强制** | 无脚本；色值靠人工复算 |
| 间距/圆角闭集 `4/5/6/8/10/12`、`6/8/10/14/999` | **未强制** | `client.js:613,619,631,632` 的越界值至今在树里 |
| 布局几何（196/232px 是否换行） | **未强制** | 只有 `design-skill-audit` 的人工实测记录 |
| 真实宿主渲染 | **未强制、不可强制** | CI 无浏览器、无 DSH |

**[建议]** 前四项**不需要**再加提示词；后四项里，对比度与刻度闭集是纯函数、可用同套无框架风格强制（读 `CARD_CSS` 字符串、解析 `light-dark()`、按 WCAG 公式复算、对照闭集白名单），成本约一条测试用例的量级；几何与真实宿主只能靠人。**这正是"不要建议单纯增加提示词长度来解决本质上可以自动化验证的问题"在本仓库的具体答案。**

### 10.6 独立复核者能否看到实现证据而非自述

**[事实]** 能——针对代码与测试；**不能**——针对视觉与宿主行为，因为仓库里唯一的形式是"报告里声称看过截图"。**[建议]** 要求任何视觉结论附带可复跑产物（HTML + 命令 + 渲染出的文本测量值），而不只是图片；`dsh-card-design` 已经写了渲染 harness，缺的是"结论必须引用 harness 输出"这条。

### 10.7 失败/修复/复验/停止条件

**[事实]** skill 层已有失败处理表与"不得弱化断言/不得删除用例"的停止条件。**[建议]** 缺一条**硬停止**：同一缺陷在两次修复后仍以不同形式复现，应停止并回到规则层（本次的 Invariant 8 作用域缺口就是典型——不补规则，代码修复只会在下一个未覆盖的边界再犯）。

### 10.8 Git 授权边界

**[事实]** `AGENTS.md` 的 Git 段明确、可执行、且与 skill 一致（无自主 commit/push/tag/publish；`npm publish` 本地禁跑）。**本次审计未触发任何写操作**，`git status --short` 全程只有 `?? docs/rebuild/`。**[事实]** 无需改动。

### 10.9 skill/规则/文档的重复、冲突与陈旧

- **[事实] 冲突（最严重）**：`AGENTS.md:5`（无构建/无 bundler）与 `dsh-plugin-development:118`（"Add a build step or a bundler."） vs `REBUILD_OPTIONS.md:176-180`（推荐 TS + bundler）与 `REBUILD_DECISIONS.md` D-32。三处需要一次性对齐，不能只改选项报告。
- **[事实] 陈旧（轻微）**：`dsh-card-design:54-57` 的实测对比度表**从未包含**调休 chip 的 `--dbc-ink-3` on `--dbc-surface-3` 组合，因此那条 4.46:1 越界值不是"改了色没复算"，而是"从未被测过"。修正文档时要说清这点，否则读者会去找一次并不存在的改动记录。
- **[事实] 重复**：`AGENTS.md:29-58` 八条不变量在四份 skill 里被逐条复述（各 skill 都加了"自己的那一半"限定）。风险是将来只改一处。**[建议]** skill 只保留"本半部独有的禁止项"，把不变量本身改为引用 `AGENTS.md` 行段。
- **[事实]** `docs/design-skill-audit.md` 自称"记录而非规则"，且提醒其 `client.js:NNN` 行号已历史化——这条自标注做得对，值得保留。

## 11. 本审计未能完成的审计事项

1. 无法确认宿主 Loader 的模块加载能力 → A/A′ 的物理形态分歧悬置。
2. 无法确认渲染异常在宿主内的隔离范围 → H1/H2 的真实用户影响幅度只能估算。
3. 无法确认 `credentials.resolve` 在生产中的挂起概率 → H3 的优先级建立在"机制必然"而非"发生频率"。
4. 无法证实"用户已允许重议工程规范" → 方案 A 的前提之一无法核查。
5. 未做浏览器实测 → 196/232px 换行、气泡翻转与箭头定位的当前像素状态只能引用仓库既有实测记录。
6. `repro5.mjs`（共享重试预算）测试未产生区分度 → 该项留在推断层，未升级为缺陷。
7. 未观测真实上游响应 → `parse.js` 对未来的上游格式漂移（§6 第 4、5 条）只能从代码脆弱性判断，无法给出实例。
