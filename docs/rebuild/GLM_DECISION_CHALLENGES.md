# GLM 决策挑战清单 — 必须由项目负责人确认的事项

本文**不替负责人决策**。每项给：背景与证据、可选项、各选项的代价、风险、以及我的推荐（推荐是意见，不是结论）。

优先级按"是否阻断下一步"排序，而非按议题大小。**编号 `Q-` 与 [GLM_FINDINGS.md](GLM_FINDINGS.md) 的 `GLM-Q-*` 对应；`D-xx` 指 Kimi 的 `REBUILD_DECISIONS.md`。**

---

## 第一层：阻断项（不解决就无法合法地开始任何重建）

### Q-01（= D-30 / D-31 / D-32）是否解除"零构建 / 无 bundler / 无运行时依赖"约束

**证据 **[事实]**
- `AGENTS.md:5`：「Three plain ES modules, no build step, no runtime dependencies, no bundler.」
- `.agents/skills/dsh-plugin-development/SKILL.md:118`，位于 **"Not allowed in this half"** 清单末条：「Add a build step or a bundler.」
- `REBUILD_OPTIONS.md:176-180`（§2.9 推荐 TypeScript + 轻量 bundler 作为开发依赖）与 `REBUILD_DECISIONS.md` D-32（建议允许）。
- `REBUILD_OPTIONS.md:31` 把"用户已允许 2.0 重议工程规范"标为 **[事实]**，但仓库内无任何可核查记录（`AGENTS.md`、四份 skill、CHANGELOG、`git log` 均无）。

**为什么它是第一阻断项**：它决定 48 项决策里至少 8 项（D-30…D-35、D-40）的实现形态，也决定 `release-verification` skill 的产物校验步骤是否需要重写。当前 tarball 有 13 个运行时文件（`npm pack --dry-run`），全部是源码原样——"产物即源码"是现在可验证的性质。

| 选项 | 收益 | 代价 | 风险 |
| --- | --- | --- | --- |
| **不解除**（保持零构建） | 与现有规则、skill、发布验证完全一致；审计/排障可直接读 tarball | 分层只能落在"模块内逻辑分区 + Host 侧真实文件拆分"，Client 物理拆分受 Loader 能力限制 | 分层不彻底，`client.js` 仍偏大（1912 行） |
| **解除，采用 TS + bundler**（Kimi 的方案 A） | 类型提示、更彻底的目录分层 | 需同步修改 `AGENTS.md:5` 与 plugin-dev skill；新增构建链、lockfile 面、CI 阶段 | **未经宿主实测即采用可能产出 Loader 加载不了的产物**——这是不可回滚的用户可见故障（旧 Client 已被替换） |
| **解除，但只允许 `checkJs`**（不引入 bundler） | 拿到类型收益的大部分，不引入构建产物 | JSDoc 成本；无 bundler 时 Client 仍需单文件 | 与"解除"的动机不完全匹配，可能两头不讨好 |

**我的推荐 [建议]**：默认走 **不解除 + A′**（见 `GLM_INDEPENDENT_AUDIT.md` §9.4），因为**已证实的六类缺陷（脏输入、并发、状态机、解析脆弱）没有一个是由"缺少类型系统"造成的**，而引入构建会新增两个当前不存在且无法在本环境验证的风险（产物可加载性、供应链）。若负责人正式解除，请把"先用真实 DSH 验证产物能被 Loader 加载"写成 D-33 里已建议的门禁，并且**在任何用户可见升级之前**完成。

**必须同时决定**：若维持禁令，`REBUILD_OPTIONS.md` §2.9 与 D-32 需要标注为"已被规则否决"，否则下一位 agent 会在两份文档之间任选其一。

---

### Q-02（= D-33 / 新议题）宿主 Loader 的真实模块加载能力

**证据**：**[无法验证]** 本次审计未运行 DSH，无宿主、无网络。

**为什么必须由负责人（或一次宿主实验）关闭**：A′ 的"抽取到 `shared.js`"能否在 Client 侧落地，完全取决于 Loader 是否允许 `client.js` 做相对 import。Kimi 用一句 **[推断]**（`REBUILD_OPTIONS.md:180`：零构建变体"物理拆分会受限，维护性收益较小"）否掉了它，但这是可行性问题，不是收益问题——推断不能替代实验。

| 选项 | 做法 | 代价 |
| --- | --- | --- |
| **A 宿主实验**（推荐） | 在一个 profile 里装一个含相对 import 的最小 Client，看是否加载 | 一次安装/重启，需要用户配合；不改动本仓库 |
| **B 假定不支持** | A′ 的抽取只在 Host 侧发生，Client 保持单文件内部逻辑分区 | 收益缩水，但零不确定性 |
| **C 假定支持** | 直接按 A′ 拆分 | 若假设错误，升级到该版本的用户卡片消失，且需要发版回滚 |

**[建议]** C 是唯一不可接受的选项——它把未验证假设直接投放到用户机器。**[待确认决策]** A 还是 B。

---

### Q-03（= 新议题，Kimi 未列）Invariant 8 的作用域要不要扩到"一切外部输入"

**证据 **[事实]**
- `AGENTS.md:57-58`：不变量 8 的校验责任点名 `readPriceBook` / `readHolidays` / `readRemote`——即**路由解码器**。
- 实际崩溃与静默错误的输入来自**注入服务**：`readBalance`（`client.js:1519-1535`，账号钱包）与 `readModel`（`client.js:1539`，模型目录 id）。

**影响**：Kimi 把 H1/H2 描述成"违反 Invariant 8"是扩大解释；更准确的结论是**规则留了空白**。这个空白已经在代码里留下两种不一致的处理：`client.js:1555,1558` 用了 `Object.create(null)` 并写了防碰撞注释，而 `client.js:1618` 的 `kept = {}` 和 `client.js:202,220` 的快照 `models` 是普通对象；`client.js:570-587` 过滤钱包，而 `client.js:1061` 不过滤。

| 选项 | 后果 |
| --- | --- |
| **扩写规则，再改代码**（推荐 [建议]） | 修复落在规则上，下一个 agent 不会在未覆盖边界再犯 |
| **只改代码** | 缺陷消失但空白仍在；同类问题会在下一个新输入源复现 |
| **不扩写，改为把输入源全部纳入路由** | 与方案 B 的能力假设绑定，本次无法验证（Q-01 相关） |

**[待确认决策]** 这条改的是 `AGENTS.md`，按仓库规则与提交同权，需要明确授权。

---

## 第二层：语义决策（会改变用户可见行为，不能当作 bugfix 顺手做）

### Q-04（= D-13）路由失败时，开放平台 provider 能不能显示账号余额

**证据 **[事实]**
- `client.js:1003` 把 `deepseek` 的 `null/undefined` 归为 `absent`；`client.js:1082-1087` 在 `absent` 且账号 ready 时渲染账号余额。
- **该行为是被测试锁定的契约**：`test/client.test.mjs:1438` 断言 `'an absent API route falls back to the account balance'` 期望 `¥32.50`，注释理由是"older Host has no balance route"。
- `absent` 目前同时承载三种真实情形：旧 Host 无该字段、路由此刻 5xx/网络失败、JSON 解析失败（`client.js:781-799` 一律清空；且 `:798` 的 catch 载荷连 `deepseek` 键都不带）。

**Kimi 的建议（D-13）**：付款方不可用时优先显式通知，仅在"明确登出且另一来源确为可用付款来源"时回退。

**我的判断**：Kimi 的问题诊断正确，但 D-13 少写了最重要的一点——**这是已测试行为的变更，且变更会让旧 Host 兼容倒退**。一个仍跑旧 Host 的用户升级新 Client 后，会看到「未配置 API Key」而不是一个数字，这与 `AGENTS.md` 的"In-place upgrade depends on a still-running Host"关注点直接相关。

| 选项 | 收益 | 代价 |
| --- | --- | --- |
| **A 拆状态**：`absent-by-transport` / `absent-by-old-host` / `unconfigured` 三态，只有第二态回退 | 消除误导且保留旧 Host 兼容 | Client 无法从一次失败响应区分"旧 Host"与"此刻失败"（除非 Host 有版本信号 → 见 Q-06） |
| **B 一律通知**（贴近 Kimi D-13） | 语义最干净 | 直接破坏 `:1438`；旧 Host 用户体验倒退 |
| **C 保持现状，只在气泡里说明来源** | 零兼容风险 | 用户仍可能把另一个账户的余额读成当前付款方 |

**[建议]** 若 Q-06 决定引入 `schemaVersion`，A 才真正可实现；否则 A 只是把猜测换个名字。**[待确认决策]** 依赖 Q-06。

### Q-05（= D-12）余额读取失败时，保留最后成功值还是撤下

**证据 **[事实]** 注释 `index.js:166-172` 承诺"最后的好金额保持可见"；实现 `index.js:191` 无条件写 `{status:'failed', at}`。Kimi 的 D-12 建议保留 stale-if-error 并标 `stale` + `observedAt`。

**分歧点**：这不是纯技术问题。一张显示余额的卡片，"保留旧数字"与"显示失败"是两种不同的用户承诺——前者避免闪烁但可能让用户按旧数字决策，后者准确但会频繁闪断（30 秒一次读，`index.js:245`）。

| 选项 | 收益 | 代价 | 需要新增 |
| --- | --- | --- | --- |
| **A stale-if-error**（Kimi 倾向） | 消除闪烁；与 `dsh-plugin-development` 的"读气泡判断来源"流程一致 | 用户可能按旧值决策；必须显式标注 `observedAt`，而气泡当前只显示状态 | 文案 + 双语键 + 断言 |
| **B fail-closed，改注释**（最小改动） | 无新语义、无新文案；当前行为即正确 | 读失败即显示"读取失败，稍后重试"，30 秒自愈 | 只删/改注释 |

**[建议]** 在 2.0 之前先做 B（把注释改成实现，成本 1 行），把 A 作为独立产品决策延后——因为 A 需要设计层新增（气泡里放 `observedAt` 属于 `dsh-card-design` 的开放项，需按该 skill 的规则"决定后记录"）。**注意**：Q-05 与 H4（旧值覆盖新值）是**两个问题**：Q-05 决定"失败显示什么"，H4 决定"乱序响应谁赢"；后者无论 A/B 都要修（latest-wins）。

### Q-06（= D-19）payload 是否引入 `schemaVersion`，`?balance=refresh` 是否改精确解析

**证据 **[事实]** `index.js:84` 用 `request.url.includes('balance=refresh')` 判定副作用请求；payload 无版本字段（`API_INVENTORY.md` §10.1 亦指出）。

| 选项 | 收益 | 代价 |
| --- | --- | --- |
| **A 加 `schemaVersion` + 精确解析 query** | Q-04 的三态可实现；子串误触发消失；新旧组合可判定 | 需要新旧 Host/Client 组合矩阵（D-21）；路由路径仍不动 |
| **B 只改精确解析** | 消除子串误触发，成本极低 | 不解决 Q-04 依赖的版本信号 |
| **C 都不做** | 零风险 | Q-04 只能选 B/C 方案 |

**[建议]** B 立刻可做（不属于架构决策）；A 与 Q-04 绑定为同一决策包。

### Q-07（= D-16）调休文案是否继续把"数据巧合"写成"永久规则"

**证据 **[事实]** 气泡文案 `调休日按周末处理，全天不计高峰。`（见 `npm test` 输出行 `PASS the make-up bubble is its note`）。`AGENTS.md:40-43`（Invariant 3）的理由从句是"**因为** every 2025–2026 make-up day falls on a weekend"；`dsh-card-design:153` 又规定"Nothing ships in a state the card cannot reach"，并把"Peak + 调休 impossible"列为固定项。

**为什么 Kimi 是对的，且还应更进一步**：若某年出现**工作日的调休**，按 Invariant 3 它按工作日规则计费（会有高峰），届时这句绝对化文案就是错的，而"peak+调休 不可能"这条固定规则也会同时失效。也就是说，**一条 UI 文案和一条固定视觉规则都建立在日历数据的偶然分布上**。D-16 指出了文案，没有指出 skill 里那条同源的固定规则。

| 选项 | 收益 | 代价 |
| --- | --- | --- |
| **A 文案描述当日实际原因**（Kimi 倾向） | 不会因数据漂移而失真 | 需要为"周末调休"和"工作日调休"两种措辞准备双语键 |
| **B 保持现状 + 在 skill 里把偶然性写清** | 零用户可见变更 | 未来日历变化时仍会失真 |
| **C 让计费逻辑显式使用 makeup 集合** | 语义"正确" | **违反 Invariant 3**（班只做默认不改变规则），不可选 |

**[建议]** A；同时修订 `dsh-card-design:153` 的措辞，把"不可能"改为"当前日历数据下不出现"。**[待确认决策]** 涉及 `AGENTS.md`/skill 文本与双语键，需授权。

---

## 第三层：范围与依赖（容易被"顺手加进去"的项）

### Q-08（= D-10）价格与日历要不要从"启动快照"改为可配置定时刷新

**证据 **[事实]** `AGENTS.md` Architecture 表与 `index.js:239-241` 注释都把价目/日历定义为启动快照；`dsh-plugin-development` 的"Route and refresh mechanics"明写"Nothing sits on the request path"、快照只取一次，只有开放平台余额按 30 秒重读。D-10 建议"改为可配置的定时刷新"。

**我的意见：这条与 D-28 自相矛盾，且没有对应的已证实缺陷。** D-28 的建议是"优先无配置默认值"，而 D-10 引入"可配置"。H3 的真实问题是**每源独立提交 + 凭据超时**，与刷新频率无关；把它顺路做成定时刷新，会在同一变更里引入配置面、上游负载变化与新鲜度语义变化。

| 选项 | 收益 | 代价 | 风险 |
| --- | --- | --- | --- |
| **A 不改，只修 H3**（推荐 [建议]） | 直击已证实缺陷；改动面最小 | 上游价目/日历变化仍需重启才可见（与现状一致） | 无新增 |
| **B 固定间隔定时刷新（非配置）** | 新鲜度提升 | 上游负载倍增；`README` 的"启动快照"表述、skill 常量表都要改 | 与 Invariant 1 的"来源"无关，但会让"bubble 说 启动时校准 vs 内置快照"这套排障语言失效 |
| **C 可配置**（D-10） | 灵活 | 配置存储、迁移、默认值、双语设置 UI | 引入 `AGENTS.md` 未覆盖的配置面（D-28 明确不鼓励） |

**[待确认决策]** 若负责人选 B/C，请同时说明"价目快照"与"日历快照"是否同频——两者混用会让气泡的来源标签需要新增词汇。

### Q-09（= D-34）是否引入 decimal / schema 校验库

**证据 **[事实]** `AGENTS.md:73`「no new npm dependency without an explicit OK」；`README`/Architecture 表重复"无运行时依赖"。项目内已有十进制实现：`parse.js:58`（`amountText`）、`client.js:543-587`（`sumAmounts` + `totalBalance`）。

**[建议]** 不引入。已证实的金额缺陷（GLM-D-07 `truncateCents` 的浮点回退、GLM-D-04 的 `'0'` 默认）都是**现有实现里的分支**，不是"缺库"。D-34 的"优先小而有测试的实现"与我的结论一致，但仓库规则需要显式 OK，因此这项仍是 **[待确认决策]** 而非既定事实。

### Q-10（= D-07 / 方案 C）是否做多 provider / 多 source 平台

**证据 **[事实]** `OFFICIAL_PROVIDERS` 是显式三元素集合（`AGENTS.md:50-54`，禁止 substring）；仓库中不存在第二家 provider 或第二数据渠道的任何证据。Kimi 对 C 的结论是"技术可行但需求不足，当前不采用"。

**[建议]** 同意 Kimi。补充一条成本：平台化会要求 `DATA_PATH` 与 payload 结构泛化，而 `DATA_PATH` 是 `AGENTS.md` 明确冻结的。等于说 C 与既有兼容守卫冲突，不只是"贵"。

### Q-11（= D-20 / D-21 / 与 `AGENTS.md` 的冲突）旧路径保留多久、支持哪些新旧组合

**证据 **[事实]** `AGENTS.md` 的兼容守卫第一条：**"The route is frozen."** `DATA_PATH = '/deepseek-billing-card/data'`（`index.js:28`）保留产品名，理由是"原地升级依赖一个仍在跑的旧路径 Host"。D-20 却写"2.0 允许改但仍有现实部署组合"。

**[建议]** 把 D-20 改写为"当前规则下不可改；若要改需先修订 `AGENTS.md` 的兼容守卫并给出下线条件"。D-21 的兼容矩阵建议（至少支持"旧 Host + 新 Client"只读降级）与 `test/client.test.mjs:1438` 的既有契约方向一致，可保留为验收项——**但注意**它与 Q-04 的选项 B 冲突（B 恰好会取消这条降级）。

---

## 第四层：治理与验收（决定"谁来判定通过"）

### Q-12（= D-35 / D-37 / D-39 / D-40 + GLM-R-06）哪些验收标准应当被自动化

**证据 **[事实]** 当前**已**自动化：zh/en 键集一致（`test/client.test.mjs:473`）、每个 `var(--dbc-*)` 都已声明（`:2078`）、tooltip 分隔线存在、以及 1004 条业务断言。**未**自动化：4.5:1 对比度、间距/圆角闭集、196/232px 几何、真实宿主渲染。越界值持续留在树里：`client.js:613`（`padding:0 7px`）、`:619`（`gap:3px` 且 `:1392` 只有一个子节点）、`:631`（`margin-top:2px`）、`:632`（`gap:1px`）、`:616`（调休 chip 复算 **4.46:1** < 4.5）。

**[建议]** 分三类处理，不要笼统"纳入验收标准"：
1. **可算即算**：对比度（解析 `light-dark()` + WCAG 公式）与刻度闭集（正则抽 `CARD_CSS` 里的 px 值 + 白名单）。纯离线、无新依赖，与现有套件同风格。
2. **可测不可自动化**：196/232px 几何——`dsh-card-design` 已给渲染 harness，缺的是"视觉结论必须附 harness 输出"这条要求，而不是新工具。
3. **既不可测也不可自动化**：真实 DSH 渲染 / 屏幕阅读器 / 宿主布局变化（GLM-R-04）。这类只能记为**已知未覆盖风险**，写清"发布前需人工确认"，不要在决策清单里伪装成可达成的门禁。

**这条也直接回答任务书里的"不要建议单纯增加提示词长度来解决本质上可以自动化验证的问题"**：上面第 1 类就是本仓库里两处"能算但只写在文档里"的规则。

### Q-13（= D-44 / D-45）是否新建五份 skill

**证据 **[事实]** D-45 建议至少新增 `domain-contracts`、`host-client-development`、`async-state-testing`、`ui-accessibility`、`release-build-verification`。现有四份 skill 与 `AGENTS.md` 的分工是稳定的（`dsh-plugin-development` / `dsh-card-design` / `billing-regression-testing` / `release-verification`）。`AGENTS.md` 的"Keep the skills current"另有一条明确限制：**"If it fits none of them, say so rather than inventing a new skill."**

**分歧**：`host-client-development` ≈ 现有 `dsh-plugin-development`；`ui-accessibility` 的主题（气泡、对比度、主题）已在 `dsh-card-design` 内；`async-state-testing` 的用例设计已在 `billing-regression-testing` 内；`release-build-verification` 只在 Q-01 选"解除"时才需要存在。

**[建议]** 优先**改写现有 skill**，只在 Q-01 决定引入构建时才新建 `release-build-verification`。五份新 skill 会把"同一数值多处为权威"（D-45 自己声明要避免的）从当前的 4 处扩到 9 处。**[待确认决策]** 若坚持新建，需同时决定旧四份的归宿——并行存在会造成规则冲突（正是 GLM-A-01 的成因）。

### Q-14（= D-47 + 本报告自身）`docs/rebuild/` 的证据地位

**证据 **[事实]** `docs/` 是 repository-only、不进 tarball（`AGENTS.md` Working rules）。D-47 建议把 `docs/rebuild/` 当作 2.0 决策证据。

**需要负责人注意的一点**：本次审计发现该目录里存在**被标为 [事实] 但仓库内不可核查**的断言（`REBUILD_OPTIONS.md:31`，即 Q-01 的前提）。若整个目录升格为"决策证据"，这类断言会获得超出其证据强度的权威。

**[建议]** 采纳目录，但加一条纪律：报告类文档里凡"改变约束状态"或"声称存在授权"的句子，必须引到可核查来源（文件:行 / commit / 用户消息原文），否则降级为 **[待确认决策]**。这条纪律同样适用于本 GLM 报告——如果我某处标注不当，应以同等标准纠正。

### Q-15（= D-22）支持矩阵以何处为权威

**证据 **[事实]** `AGENTS.md` 兼容守卫：`engines.dsh` 显式列每条预发布线，且"the `<0.3.0` ceiling is the constraint every plugin carries, not a fact about this one, so the READMEs describe only the lowest Host that works and leave the ceiling to the manifest a resolver reads"——这正是最近一次提交 `7512286 docs: leave the shared DSH ceiling to the manifest` 所做的收敛。D-22 建议"以真实能力测试重定 engines，不只改范围字符串"。

**[建议]** 同意 D-22 的方向，但要明确权威位置仍是 manifest（`package.json`），README 只写最低可用 Host；不要把支持矩阵同时抄进 README、CHANGELOG 与 skill 三处。**[无法验证]** 真实 DSH 版本能力本次未测，矩阵本身需要宿主实验才能定。

### Q-16（= D-25 / D-26）多窗口/多会话与路由安全边界

**证据 **[事实]** 路由是 loopback、`cache-control: no-store`（`index.js` handler，`test/host.test.mjs` 断言 `'not cached'`），`?balance=refresh` 会触发一次带 API Key 的上游读；访问控制完全依赖宿主 Web Server。
**[无法验证]** Web Server 的实际暴露范围（仅 127.0.0.1？是否可被同机其他进程访问？）本次无法观测。D-25/D-26 的"验证 Web Server 暴露范围"是正确且**尚未完成**的动作。

**[待确认决策]** 部署拓扑（是否存在多窗口/远程 Client）需负责人给出；在它明确之前，Host 侧不应引入任何"当前全局选择"式状态——这条与 Kimi D-25 的建议一致。

### Q-17（= D-48）Git 授权边界是否保持

**证据 **[事实]** `AGENTS.md` 的 Git 段：未经当前任务明确授权不 commit/push/tag/release/publish；本地禁跑 `npm publish`（provenance 需由 release workflow 签名）。本次审计全程只读，`git status --short` 仅 `?? docs/rebuild/`。

**[建议]** 保持原样。若 Q-01 引入构建，需要额外明确"构建产物不得提交"，但那是新增项，不是放宽现有边界。

---

## 需要负责人**提供**而我无法自行获取的证据（缺一项就只能悬置对应结论）

| 缺口 | 阻塞的决策 | 建议的补证方式 |
| --- | --- | --- |
| 宿主 Loader 能否加载含相对 import 的 Client | Q-01、Q-02 | 一次最小实验插件安装 |
| 卡片渲染抛异常时宿主是否隔离 | Q-01（严重度）、H1/H2 的真实影响 | 在真实 DSH 里注入一个 `constructor` 模型 id |
| Host 侧是否存在账号/目录/可见会话服务 | 方案 B 是否值得继续评估 | 用 `cordis_inspect_query` / Slot inspector 观测运行中的树 |
| `credentials.resolve` 是否会挂起 | H3 的优先级（机制已证，频率未知） | 宿主侧观测或凭据 store 的文档 |
| "用户已允许重议工程规范"的出处 | Q-01 的全部前提 | 负责人一句话确认，或指出记录所在 |
| 真实上游页面/日历当前形状 | 解析脆弱性（GLM-D-06/08）是否已被上游触发 | 一次带来源记录的 fixture 刷新（属 `billing-regression-testing` 的正式流程） |

---

## 与 Kimi 决策清单的分歧汇总（便于逐条复核）

| 决策 | Kimi 的建议 | 我的意见 | 理由 |
| --- | --- | --- | --- |
| D-30/32 | 采用 A（TS + bundler） | 未解除约束前采用 A′；解除后采用"剔除 ViewModel 层的 A" | 已证实缺陷均非类型缺失所致；构建引入两个本环境无法验证的新风险 |
| D-13 | 优先显式通知 | 依赖 Q-06 的三态拆分，否则旧 Host 兼容倒退 | `test/client.test.mjs:1438` 已把回退写成契约 |
| D-12 | stale-if-error | 先改注释（fail-closed），stale 语义作为独立设计决策 | 需要新增气泡字段与双语键，属设计开放项 |
| D-10 | 可配置定时刷新 | 不改刷新频率，只修 H3 | 与 D-28 冲突，且无对应已证实缺陷 |
| D-16 | 文案描述当日原因 | 同意，并追加修订 `dsh-card-design:153` | 同一偶然性被写成了一条固定视觉规则 |
| D-45 | 新建五份 skill | 优先改写现有四份 | 仓库规则要求"不合身就明说，而不是新造 skill" |
| D-20 | 2.0 允许改旧路径 | 表述应改为"当前规则禁止，改需先修订兼容守卫" | `AGENTS.md` 第一条守卫是"The route is frozen." |
| §6.7 未消费字段 | 列为可清理 | 升格为**诊断契约**而非删除 | `sources`/`at` 是 skill 排障流程的唯一可观测降级证据 |
| H1 反例集 | 加 `constructor`/`__proto__`/`toString` | 去掉 `toString` | 归一化会小写，`toString` 实测不命中，写进去是一条恒真用例 |
