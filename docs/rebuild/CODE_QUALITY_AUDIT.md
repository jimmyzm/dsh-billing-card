# dsh-billing-card 2.0：代码质量审计

> 阶段：只读审计  
> 基线：`preview@7512286`  
> 验证：`node --check index.js && node --check parse.js && node --check client.js` 通过；`npm test` 为 **1004 PASS / 0 FAIL**

## 0. 标记、方法与限制

- **[事实]**：当前代码、配置、测试或直接只读复现所证明的行为。
- **[推断]**：对维护成本、触发条件和用户影响的判断。
- **[建议]**：重建时应处理的方向，不是已在旧代码实施的修复。
- 严重度综合考虑数据可信度、崩溃面和触发条件；“测试通过”只证明现有断言通过，不证明下列未覆盖路径安全。
- 本次没有重新执行完整真实 DSH／浏览器几何矩阵；UI 结论区分了静态 CSS／token 复算、现有截图和历史几何记录。

## 1. 总体评价

**[事实]** 项目有良好的业务不变量、纯 Host 解析层、按源降级和大量行为测试，依赖图没有循环；但 Client 将领域、传输、异步协调、宿主适配和 UI 集中在同一工厂和大型组件中。现有缺陷主要不是风格问题，而是未建模的输入边界、启动状态和请求生命周期。

**[推断]** 2.0 的最高收益不是“把 JS 改成 TS”或“把文件拆小”，而是建立运行时契约、统一状态机和请求顺序控制，再让 UI 消费稳定视图模型。

## 2. 目录结构、模块职责与依赖方向

| 模块 | 行数 | 当前职责 | 评价 |
| --- | ---: | --- | --- |
| `index.js` | 263 | 上游读取、凭据、内存状态、刷新、HTTP 路由 | Host 边界清楚，但启动提交与余额刷新状态机耦合 |
| `parse.js` | 455 | 纯 HTML/ICS/JSON 解析、北京日期 | 无 I/O、无依赖，是当前最可测试的模块 |
| `client.js` | 1912 | 词典、快照、金额、计费、解析校验、DSH 适配、异步、CSS、组件、tooltip、插槽 | 职责过度集中，是主要维护热点 |
| `test/*.mjs` | 2874 | 自制断言、mini React、假 Cordis、行为回归 | 覆盖广，但 harness 与生产语义有差距 |

**[事实]** 依赖方向为 `index.js -> parse.js`，Client 只加载 React；没有循环依赖。证据：`index.js:13-21`、`client.js:23-28`。

**[事实]** `BillingCard` 从 `client.js:692` 延伸至 `1489`，单个函数同时管理 account/model/selection/remote 状态、五个以上数据与布局 effect、金额和计费投影、tooltip 状态与完整渲染。

**[推断]** 即使没有循环 import，逻辑依赖仍然高度耦合：修改一个余额状态可能需要同时理解路由 effect、选择订阅、30 秒 effect、投影和 tooltip，回归成本集中在整卡 harness。

## 3. 类型设计、`any` 与断言

**[事实]** 项目是纯 JavaScript ESM，没有 TypeScript 源码、类型声明、`tsc`／`checkJs` 门禁、lint 或格式化工具。因而不存在字面意义上的 TypeScript `any` 或 `as` 类型断言。

**[事实]** 现有 JSDoc 多为自然语言，没有形成机器可检查契约。例如 `readRemote` 注释只声明 `{status, prices, holidays}`，实际还返回 `deepseek`：`client.js:1708-1725`。初始 remote state 含 `deepseek`，catch 构造的状态却省略它：`client.js:698-703,798`。

**[推断]** 动态边界等价于大量隐式 `any`：路由 DTO、钱包、目录、React props 和 DSH 服务形状依赖属性访问与局部判断。下述崩溃、误标币种和状态漂移已是实际后果，不是“没有 TS”本身造成的，但说明仅有静态类型也不足，必须有运行时 decoder。

## 4. 高严重度问题

### H1. 特殊模型 ID 可沿原型链得到伪价格并击穿渲染

**[事实]**

- `lookupPrice` 直接读取 `table.models[key]`，没有 own-property 检查：`client.js:515-524`。
- 内置表和远程清洗表均使用普通对象：`client.js:202-232,1618-1626`。
- 模型 id `constructor` 会取得继承的 `Object` 函数；随后 `priced.entry[tier].input` 访问不存在的 tier：`client.js:1142-1148`。
- 同文件对目录 `names/providers` 已使用 `Object.create(null)` 防碰撞，说明该风险在另一边界已被认识但未统一处理：`client.js:1554-1558`。

**[推断]** 一个合法字符串形式的宿主输入或污染 payload 可违反“错误数据降级而不崩溃”的不变量，使 React 子树卸载。

**[建议]** 领域集合使用无原型字典或 `Map`，所有查找只接受 own key；加入 `constructor`、`__proto__`、`toString` 的端到端反例。

### H2. 混合坏钱包数据可崩溃，也可让总额静默少算

**[事实]**

- `readBalance` 原样接收 `value` 和 `bonusWallets` 数组，没有逐项清洗：`client.js:1531-1535`。
- `totalBalance` 在局部过滤钱包：`client.js:570-587`；但气泡又遍历未经滤的原数组并读取 `wallet.currency`：`client.js:1061-1069`。
- 因而 `[null, {currency:'CNY', balance:'1'}]` 可先生成有效总额，再在气泡构造时抛异常。
- `sumAmounts` 对无法解析的金额直接 `continue`：`client.js:543-563`。一个有效钱包与一个同币种无效钱包会显示“有效但不完整”的总额，没有不完整标记。

**[推断]** 这同时影响可用性和金额可信度，比单纯 UI 错误更严重；现有“钱包正常／空数组”测试没有覆盖混合脏数据。

**[建议]** 在账号适配器边界一次性验证每个钱包；无效项应使对应钱包或总额进入明确的 `partial/failed` 状态，不能一边忽略、一边继续遍历原始数据。

### H3. 凭据服务无超时，可阻塞全部启动数据提交

**[事实]**

- `readApiKey()` 直接等待 `credentials.resolve()`，8 秒超时就只覆盖后续 HTTP fetch：`index.js:45-51,152-184`。
- 启动 `load()` 用一个 `Promise.all` 同时等待价格、日历和余额，然后才统一提交价格／日历并置 ready：`index.js:218-234`。
- 因此凭据 Promise 永不 settle 时，即使价目和日历已完成，也保持 `pending/loading`。
- 30 秒定时器仍可继续调用新的余额读取，没有取消机制：`index.js:242-246`。

**[推断]** 辅助服务故障会放大成所有启动快照长期不就绪，Client 只能长期使用内置价目和日历，并可能积累并发读取。

**[建议]** 每源独立提交和超时；凭据读取纳入有界适配器；启动与定时刷新共用同一资源协调器。

### H4. Host 手动与定时刷新可并发，旧响应可覆盖新余额

**[事实]**

- `balanceRead` 只去重经过 `refreshBalance()` 的显式刷新：`index.js:196-216`。
- 定时器直接调用 `loadDeepseekBalance()`，启动也直接调用：`index.js:218-246`。
- 每次读取完成后都无条件写入 `state.deepseek`，没有 generation 或 latest-wins：`index.js:173-193`。

**[推断]** 若较早请求较晚返回，它可以用旧余额覆盖较新的结果，直到下一次成功刷新；当前“一个在途 + 3 秒”只覆盖手动突发，并未覆盖完整资源生命周期。

**[建议]** 统一所有触发源，采用按资源的 single-flight／revision／取消策略，并定义错误时保留还是撤下最后有效值。

## 5. 中严重度问题

### M1. Client 会把非法 API 币种改标为 CNY，缺失组成也会被改写成零

**[事实]** Host 正确丢弃非 CNY/USD：`parse.js:85-90`；Client 却用 `value.currency === 'USD' ? 'USD' : 'CNY'`，使 EUR、空值或缺失币种变成 CNY：`client.js:1692-1705`。`granted/toppedUp` 非法时默认 `'0'`，Host 也采用同样默认：`parse.js:98-99`。

**[推断]**  malformed payload 不是安全降级，而是被转换成看似可信的人民币金额；气泡还可能出现“充值 0 + 赠金 0”与总额不相等。

**[建议]** 未知币种和缺失必需字段必须拒绝或进入显式 partial 状态，禁止默认成真实零。

### M2. 部分 `loading` 响应会被提升为 `ready`，提前停止启动重试

**[事实]** `readRemote` 只有在 prices、holidays、deepseek 三者都为 null 时才保留上游 `loading`：`client.js:1713-1725`。无 Key 时 Host 可很快写入 `deepseek.unavailable`，而价格／日历仍在加载：`index.js:173-180`。Client 看到非 null deepseek 即返回整体 ready，启动重试只在非 ready 时继续：`client.js:772-778`。

**[推断]** 常见无 Key 启动路径可能提前采用内置价目和日历，直到下一次 30 秒常规刷新才校准。

**[建议]** 不用一个整体 ready 代替所有来源状态；启动完成条件应由各必需来源的终态组合而成。

### M3. 路由失败与旧 Host 缺字段不可区分，可能显示错误付款方余额

**[事实]** HTTP 非成功、JSON 失败或网络异常都会清空远程数据：`client.js:781-799`。`deepseek == null` 被归为 `absent`，开放平台 provider 在 `absent` 时回退账号余额：`client.js:1002-1004,1082-1087`。

**[推断]** 对旧 Host 的兼容逻辑被同时应用到暂时性路由故障；用户选择开放平台付款时，可能看到另一个账户的余额且无降级说明。

**[建议]** 传输错误、协议不支持、数据源未配置、数据源失败必须是不同状态；付款方余额不可用时优先显示明确通知，而非跨账户替换。

### M4. Client 请求没有超时、顺序或完整卸载保护

**[事实]** `ask()` 没有 AbortController、请求序号或 in-flight 管理：`client.js:781-810`。初始加载、30 秒 tick、选择变化、四类事件和 1 秒跟进均可触发请求。`live` 只阻止部分 setState；`.then()` 后续仍可创建 follow-up，`ask()` 自身不检查 live：`client.js:768-817`。

**[推断]** 旧响应可能覆盖新状态；慢请求可无限 pending；特定卸载时序下仍可能再发请求。此项为代码路径推导，未在本次单独构造全部时序。

**[建议]** Client Application 层统一协调按资源的 latest-wins、取消、销毁和重复事件合并。

### M5. 凭据读取异常被吞掉，可能误报“未配置 API Key”

**[事实]** credential store 异常后直接尝试环境变量且不记录日志：`index.js:153-160`。若环境也无 Key，状态变为 `unavailable`：`index.js:176-180`，Client 显示“未配置 API Key”：`client.js:1091-1093`。

**[推断]** “凭据服务损坏”和“用户没有配置”被合并，误导用户和排障，也不符合其他来源失败会 warning 的策略。

### M6. Tooltip 与数据真相、辅助技术关联不足

**[事实]**

- tooltip 无 `id`，触发器无 `aria-describedby`：`client.js:1205-1220,1321-1327`。
- 所谓 definition list 实际全部由普通 span 组成：`client.js:1342-1356`。
- 打开内容保存为独立 `tipSpec`，只在 dwell 完成时写入：`client.js:1156-1200`；provider/model 更新不会自动更新或关闭已打开气泡。
- 现有测试主要检查 focus、blur、Escape 和文本，不检查 ARIA 关联：`test/client.test.mjs:1968-2054`。

**[推断]** 屏幕阅读器难以把气泡理解为当前触发器描述；会话切换后旧气泡可能继续描述旧真相，违背项目“bubble must not outlive its truth”的设计约束。

## 6. 低严重度与局部正确性问题

| 问题 | 代码证据 | 维护风险 |
| --- | --- | --- |
| ICS 不存在的日期会被 `Date.UTC` 规范化而非拒绝 | `parse.js:348-357` 只检查日 1–31 | 畸形数据可在错误日期标记假日 |
| 空模型列被过滤，价格列未同步过滤 | `parse.js:254-258,298-303` | 上游出现空列时 id 与价格下标可错位 |
| 金额单元格只提取第一段数字 | `parse.js:157-167` | 非当前格式或负号可能被误读，而非失败 |
| Host 注释称保留最后成功余额，代码却改为 failed | `index.js:166-171,189-193` | 维护者会按错误契约演进 |
| Host `status` 只看价格和日历，Client 又可因余额把它视为 ready | `index.js:224-233`；`client.js:1713-1725` | 总体状态语义不一致 |
| `sources`、`at`、`years`、`available` 生产但不消费 | `index.js:100-113`；`client.js:1692-1725` | DTO 扩张但没有契约治理 |
| 路由路径在 Host/Client 双份硬编码 | `index.js:28`；`client.js:43` | 人工同步；当前虽有意冻结，仍缺版本握手 |
| HEAD 与 GET 共用 `response.end(body)`，测试只查状态 | `index.js:73-92`；`test/host.test.mjs:244-248` | 真实 server 可能抑制 body，但 handler 契约未明确验证 |

**[建议]** 上述局部问题应转化为新架构的契约测试，而不是只在旧函数里逐条打补丁。

## 7. 状态管理、错误处理与重复代码

### 7.1 状态管理

**[事实]** Client 使用多个独立 `useState` 保存账号、目录、选择和 remote，并用可变的 `api.current` 在服务与 effect 间传递 `refreshRoute`：`client.js:698-712,768-853`。Host 则是一个共享可变 state，由启动、定时器和显式刷新共同写入：`index.js:99-113,173-246`。

**[推断]** 当前缺少“某一资源的一次读取”这一统一抽象，导致启动、定时、事件和手动触发各自实现一部分状态机；竞态和重复请求是结构性结果。

### 7.2 错误处理

**[事实]** 正面实践是价格、日历分别 catch，Client 按币种和日历独立回退：`index.js:120-142`；`client.js:1642-1646`。负面是凭据异常被吞、钱包无效项被忽略、非法币种被默认、路由失败与协议缺失合并。

**[建议]** 新模型至少区分 `idle/loading/ready/unavailable/failed/partial/stale`，并携带 `errorKind`、`observedAt`、`provenance`；不要用 null 同时表达未加载、不支持、失败和无数据。

### 7.3 重复与漂移点

**[事实]**

- 路由路径重复：`index.js:28`、`client.js:43`。
- Host/Client 各有 30 秒常量和刷新逻辑，需要人工保持节奏与语义一致。
- 北京日期／日数逻辑存在于 `parse.js` 和 `client.js`。
- 内置 `PriceTable` 含 `source/unitTokens`，Host 解析 DTO 不含：`client.js:191-233`；`parse.js:318-322`。
- 内置日历和 Host 日历分别构造，来源不同但需保持相同语义：`client.js:337-365`；`parse.js:438-453`。

**[推断]** 重复本身不是最大问题，问题是重复处承载同一业务契约却没有单一所有权，未来容易只改一半。

## 8. 可测试性与覆盖审计

### 8.1 已有优势

**[事实]**

- 解析器使用真实 fixture 和合成表，覆盖列换序、缺字段、千分位、全角数字、ICS folding、DTEND、重叠节日和余额币种。
- Host 覆盖可选 Web Server 生命周期、单源失败、超时、Bearer header、显式刷新节流和 405。
- Client 覆盖全部工作日边界、周末、节假日、金额精度、provider 规则、locale、会话切换、快照回退、tooltip 和折叠 hooks。
- 测试对可见文本、价格和气泡作行为断言，不只是检查“不抛异常”。

### 8.2 覆盖空白

| 空白 | 未证明的边界 |
| --- | --- |
| 特殊输入 | 原型键模型 id、混合 null／无效钱包、EUR／缺失币种、缺失组成字段 |
| 启动组合 | `status=loading` 且 deepseek 已非 null；credentials 永久 pending／reject |
| 异步时序 | Host 启动／定时／手动交错；Client 乱序、挂起、卸载后 follow-up |
| 协议语义 | 当前路由失败与旧 Host 的区别；HEAD body；schema 版本 |
| 日历 | 2 月 30／31 日、工作日调休、空模型列 |
| 真实 UI | DOM 几何、Tooltip containing block、Resize/MutationObserver、真实 React 生命周期 |
| 可访问性 | `aria-describedby`、术语列表语义、动态内容公告 |
| 真实宿主 | 多 DSH 版本、真实 Web Server、WebView CSS 能力、多窗口／多会话 |

**[事实]** ReactStub 没有 `useLayoutEffect`，生产代码在测试中回退为普通 effect：`test/client.test.mjs:24-68`；`client.js:32-33`。footer 放置和 tooltip 两次定位因此没有真实几何验证：`client.js:861-903,1224-1315`。

**[事实]** 测试规范禁止 timing sleeps，但 Host 测试仍使用真实 10–60ms 等待和 25ms 超时：`test/host.test.mjs:155-159,213-239,274-289,377-395`。

**[推断]** 1004 是断言数量，不是覆盖率；现有测试对业务 happy path 很强，对并发、恶意／畸形组合和真实平台较弱。真实等待也使 CI 在负载下更容易偶发失败。

## 9. UI 与设计规范偏差

### 9.1 已确认偏差

- **[事实]** 调休 chip 使用浅色 `--dbc-ink-3:#686e77` on `--dbc-surface-3:#eceff4`：`client.js:596-599,616`。按 token 色值 WCAG 公式复算约 **4.46:1**，低于 `.agents/skills/dsh-card-design/SKILL.md:52-57` 的 4.5:1；这不是本轮重新渲染像素测量。
- **[事实]** 规范限定间距 `4/5/6/8/10/12`，实现仍含 `7px` chip padding、`3px` amount gap、`2px` price margin、`1px` price gap、tooltip 的 `7px/2px`：`client.js:613,619-620,631-648`。
- **[事实]** `.dbc-amount-row` 只有一个直接子元素，`gap:3px` 没有实际兄弟间距作用：`client.js:619,1390-1419`。
- **[事实]** 历史设计记录已列出这些未决项：`docs/design-skill-audit.md:164-168,179-239`；当前代码仍保留对应值。

### 9.2 验证限制

**[事实]** 当前中文节日与英文截图中未见明显文字重叠或裁切，但它们只覆盖两个静态状态，不能证明 196/232px、调休、长金额、极端 viewport 或 tooltip 全部正确。

**[推断]** UI 的主要工程风险是规范数值没有自动门禁，且布局通过测量宿主兄弟节点和负 margin 实现：`client.js:855-903`。宿主从 flex 行改为其他布局时，slot API 不变也可能错位。

**[建议]** 重建时将“设计令牌合规、真实浏览器几何、可访问性、动态真相更新”纳入独立 UI 契约，不让领域测试代替视觉测试。

## 10. 优先级建议

1. **[建议] P0：输入可信度**：统一钱包、模型、路由 decoder；消除原型键、非法币种和部分数据伪装。
2. **[建议] P0：资源状态机**：启动、定时、事件、手动刷新统一；确定 latest-wins、超时、取消和销毁语义。
3. **[建议] P1：契约与模块边界**：版本化 DTO，共享纯领域内核，Client Controller 与 UI 分离。
4. **[建议] P1：测试转型**：保留现有业务反例，新增乱序／畸形矩阵、真实浏览器和真实 DSH 验证。
5. **[建议] P2：UI 规范与文档**：处理对比度、刻度、ARIA、宿主布局耦合及注释漂移。

架构映射见 [CURRENT_ARCHITECTURE.md](CURRENT_ARCHITECTURE.md)，候选方案见 [REBUILD_OPTIONS.md](REBUILD_OPTIONS.md)。
