# dsh-billing-card 2.0：当前公共 API 与隐式契约清单

> 基线：`preview@7512286`  
> 范围：npm 包、Host/Client 入口、HTTP 路由、解析器文件导出、DSH 服务与事件、外部 HTTPS API、静态资源  
> 标记：**[事实]** 当前契约；**[推断]** 稳定性／风险判断；**[建议]** 2.0 设计方向

## 1. 稳定性分类

| 分类 | 含义 |
| --- | --- |
| 包级公开 | `package.json.exports` 明确暴露，消费者可直接引用 |
| 兼容冻结 | 当前项目规则明确要求为运行中升级保留 |
| 宿主契约 | 不是 npm 公共库 API，但 DSH 与插件双方必须遵守 |
| 文件级内部公开 | 文件有 `export`，但未被 package exports 暴露 |
| 隐式契约 | 通过动态属性、字符串、全局对象或事件形状形成，缺版本与类型保障 |

**[推断]** “函数有 export”不等于“可随意视为稳定公共 API”。2.0 需要负责人重新划定支持面，否则内部重构也会被误当成破坏升级。

## 2. npm 包级 API

**[事实]** 来源：`package.json:27-45`。

| 包说明符 | 目标 | 内容 | 分类 |
| --- | --- | --- | --- |
| `@jimmyzm/dsh-billing-card` | `index.js` | Host `apply`、`DATA_PATH` | 包级公开 |
| `@jimmyzm/dsh-billing-card/client` | `client.js` | 有顶层副作用的 DSH Client 脚本 | 包级公开、宿主专用 |
| `@jimmyzm/dsh-billing-card/locale/*.json` | `locale/*.json` | 插件 meta | 包级公开静态资源 |
| `@jimmyzm/dsh-billing-card/icon` | `icon.svg` | 图标 | 包级公开静态资源 |

**[事实]** `parse.js` 在 `files[]` 中，会进入 tarball，但没有 `exports` 子路径；它是 Host 内部运行依赖，不是声明的包级 API。

**[事实]** Client 顶层访问 `window.__ModuleLoader__`，在普通 Node 或无该全局的浏览器中导入会失败；它不是通用同构模块。

## 3. Host 入口 API

### 3.1 `DATA_PATH`

```js
export const DATA_PATH = '/deepseek-billing-card/data';
```

**[事实]** 来源：`index.js:23-28`。分类：**包级公开 + 兼容冻结**。路径保留旧产品名是为了新 Client 与仍在运行的旧 Host 通信。

### 3.2 `apply(ctx)`

```js
export function apply(ctx): void
```

**[事实]** 来源：`index.js:99-263`。激活后：

- 创建共享内存 state 并立即开始异步 load。
- 注册 30 秒余额 timer effect。
- 通过嵌套 `ctx.inject(['webServer'], ...)` 注册路由。
- 无显式返回值，不发布插件自有 Cordis service 或 event。

### 3.3 Host 所消费的 context 契约

| 契约 | 期望形状 | 必需性 | 证据 |
| --- | --- | --- | --- |
| `ctx.logger.warn(message)` | logger 可空；warn 必须为函数才调用 | 可选 | `index.js:60-65` |
| `ctx.effect(callback, label)` | callback 可返回 disposer | Host 生命周期必需 | `index.js:242-251` |
| `ctx.get('credentials')` | 返回 credential service 或 undefined | 可选 | `index.js:152-164` |
| `credentials.resolve(ref)` | Promise，成功命中期望 `{value: string}` | 可选；环境变量回退 | 同上 |
| `ctx.inject(['webServer'], cb)` | 服务出现后执行，消失后清理 | 可选路由能力 | `index.js:253-262` |
| `http.effect(callback, label)` | 绑定嵌套作用域 | 有 Web Server 时 | 同上 |
| `http.webServer.register(route)` | 接收 `{kind, path, handler}` | 有 Web Server 时 | 同上 |

**[事实]** 凭据 ref 固定为 `DEEPSEEK_API_KEY`，环境变量同名：`index.js:33-35,152-164`。

## 4. 解析器文件级导出

以下来自 `parse.js`，分类均为**文件级内部公开**，不是 package exports 承诺。

| 导出 | 输入 → 输出 | 证据 |
| --- | --- | --- |
| `PRICING_URLS` | `{CNY: string, USD: string}` | `parse.js:15-18` |
| `DEEPSEEK_BALANCE_URL` | 开放平台余额 URL | `parse.js:20-23` |
| `HOLIDAY_URL` | iCloud ICS URL | `parse.js:24-25` |
| `toBeijingDate(instant)` | epoch ms → `YYYY-MM-DD` | `parse.js:40-48` |
| `parseDeepseekBalance(text)` | JSON 字符串／对象 → balance DTO 或 null | `parse.js:71-101` |
| `parsePricingHtml(html, asOf, currency)` | HTML → PriceTable 或 null | `parse.js:332-339` |
| `parseHolidayCalendar(text)` | ICS → HolidayCalendar 或 null | `parse.js:372-454` |

**[建议]** 2.0 若希望这些函数成为公共 SDK，应显式导出、版本化并定义输入上限；否则应留在内部模块，避免仅因可导入就被当成稳定 API。

## 5. Client 宿主模块 API

### 5.1 Loader 返回值

```js
{
  inject: [
    'slots',
    'locale',
    'timer',
    'remote',
    'remote.account',
    'remote.session'
  ],
  apply(ctx)
}
```

**[事实]** 来源：`client.js:1492-1495,1910-1911`。分类：**宿主契约**。

### 5.2 `apply(ctx)` 注册项

**[事实]**

1. `ctx.locale.register('dsh-billing-card', {zh, en})`：`client.js:1881-1886`。
2. 注册 slot：

```js
{
  name: 'sidebar.footer.action',
  id: 'dsh-billing-card',
  order: 10,
  locale: 'dsh-billing-card',
  inject: () => ({
    every,
    readLocale,
    readBalance,
    readModel,
    watchSelection,
    watchUpstream
  })
}
```

证据：`client.js:1888-1906`。

### 5.3 `BillingCard` 隐式 props

| Prop | 当前契约 | 证据 |
| --- | --- | --- |
| `wide` | 仅严格 `false` 时隐藏；所有 hooks 仍运行 | `client.js:692-696,1421-1425` |
| `t(key)` | 可选翻译函数，缺失时显示 key | `client.js:692-694` |
| `every(callback, delay)` | interval，返回可选 disposer | `client.js:696,713-716,1885` |
| `readLocale()` | 返回 active locale | `client.js:909,1886` |
| `readBalance()` | Promise<AccountState> | `client.js:819-853,1518-1536` |
| `readModel()` | Promise<ModelState> | `client.js:1538-1583` |
| `watchSelection(handler)` | 订阅 `{provider, model}`／null，返回 disposer | `client.js:1744-1844` |
| `watchUpstream(handler)` | 订阅提供商／凭据事件，返回 disposer | `client.js:1858-1879` |

**[推断]** 这些 props 虽不是 npm 文档 API，却是 slot 注册与组件之间的内部公共边界；重建若拆分 UI，应把它们改成显式 adapter/view-model 契约，而不是继续隐式扩散。

## 6. HTTP 路由 API

### 6.1 基本契约

**[事实]**

```text
path: /deepseek-billing-card/data
kind: exact
methods: GET, HEAD
success: 200
content-type: application/json; charset=utf-8
cache-control: no-store
other methods: 405, allow: GET, HEAD
```

证据：`index.js:73-92,257-261`。

### 6.2 刷新查询

```text
GET /deepseek-billing-card/data?balance=refresh
```

**[事实]** 该请求启动后台余额读取，但立即返回当前内存状态，不保证响应中含新余额。Host 对手动刷新做一个在途 Promise 与 3 秒最小间隔；Client 最多两次、每秒跟进。证据：`index.js:80-85,196-215`；`client.js:789-797`。

**[事实]** 判断使用 `request.url.includes('balance=refresh')`，不是结构化 query 解析：`index.js:84`。

**[推断]** 这是带副作用的 GET，依赖同源／本机可信和 no-store；是否需认证、Origin 限制或独立 refresh 命令，取决于 DSH Web Server 的实际暴露边界，当前仓库不能证明。

### 6.3 顶层 payload

以下为文档记号，不表示当前已有 TypeScript 类型：

```ts
type HostPayload = {
  status: 'loading' | 'ready' | 'failed';
  prices: {
    CNY: PriceTable | null;
    USD: PriceTable | null;
  };
  holidays: HolidayCalendar | null;
  deepseek: DeepseekBalance | null;
  sources: {
    'pricing.CNY': 'pending' | 'ready' | 'failed';
    'pricing.USD': 'pending' | 'ready' | 'failed';
    calendar: 'pending' | 'ready' | 'failed';
    deepseek: 'pending' | 'ready' | 'failed' | 'unavailable';
  };
  at: string | null;
};
```

**[事实]** 初始化见 `index.js:100-113`，最终提交见 `index.js:218-234`。顶层 `status` 只根据价格表和日历计算，不根据余额；`at` 是启动价目／日历提交时间。

### 6.4 `PriceTable`

```ts
type PriceTable = {
  asOf: string;
  currency: 'CNY' | 'USD';
  models: Record<string, {
    label: string;
    peak: PriceTier;
    idle: PriceTier;
  }>;
};

type PriceTier = {
  input: number;
  cacheRead: number;
  output: number;
};
```

**[事实]** 证据：`parse.js:306-322`。单位隐式为每 100 万 tokens；只有峰谷三类完整的模型被保留，至少一个完整模型才接受整张表。

**[事实]** Client 内置表额外含 `source` 和 `unitTokens`，Host DTO 不含：`client.js:191-233`。Client 校验时用路由对象的 key 强制决定 currency，不校验 `value.currency`：`client.js:1614-1633`。

### 6.5 `HolidayCalendar`

```ts
type HolidayCalendar = {
  days: number[];
  names: Record<string, string>;
  makeup: number[];
  makeupNames: Record<string, string>;
  years: number[];
};
```

**[事实]** 证据：`parse.js:438-453`。

- day number 是 `Date.UTC(北京日期) / 86400000`。
- `DTEND` 排他；同日休覆盖班；同日多个名字用 `、` 连接。
- 单事件最多展开 31 天；休／班各自最多 400 个不同日期。
- Client 将 days/makeup 转为 Set，但不使用 years：`client.js:1648-1684`。

### 6.6 `DeepseekBalance`

```ts
type DeepseekBalance =
  | {
      status: 'ready';
      available: boolean;
      currency: 'CNY' | 'USD';
      total: string;
      granted: string;
      toppedUp: string;
      at: string;
    }
  | { status: 'unavailable' | 'failed'; at: string };
```

**[事实]** 证据：`index.js:173-193`。金额是十进制字符串；`total` 来自 `total_balance`，`granted/toppedUp` 只用于分解。

**[事实]** Client 二次校验后只保留 `status/currency/total/granted/toppedUp`，丢弃 `available/at`：`client.js:1692-1705`。未知 currency 当前被默认成 CNY，属于已知缺陷而非推荐契约。

### 6.7 当前未消费字段

| 字段 | 生产方 | 当前 Client 使用 |
| --- | --- | --- |
| `sources` | Host 每源状态 | 不使用 |
| 顶层 `at` | Host 启动提交时间 | 不使用 |
| `holidays.years` | 日历解析器 | 不使用 |
| `deepseek.available` | 上游 `is_available` | 丢弃 |
| `deepseek.at` | Host 每次余额读取 | 丢弃 |

**[推断]** 这些字段是“看似可观测但无法驱动产品语义”的契约负担。2.0 应明确使用、删除或保留为受版本治理的诊断信息。

## 7. DSH Client 服务契约

### 7.1 账号余额

```js
ctx.remote.account.getBalance({
  version,
  locale,
  timezoneOffsetSeconds
})
```

**[事实]** 来源：`client.js:1496-1523`。`version` 读 `window.__DSH_BOOT__.release.version`，缺失时 `0.0.0`。

期望响应：

```ts
{
  ok: true;
  value: null | {
    status: 'ready';
    value: Array<{ currency: string; balance: string }>;
    bonusWallets: Array<{ currency: string; balance: string }>;
  };
}
```

**[事实]** 异常、非 ok、非 ready → failed；null → signedOut；数组当前原样进入 state：`client.js:1526-1535`。

### 7.2 模型目录

```js
ctx.remote.session.modelCatalog()
```

期望核心形状：

```ts
{
  ok: true;
  value: {
    default: { provider?: string; model?: string };
    groups?: Array<{
      id: string;
      name: string;
      models?: Array<{ id: string; name?: string }>;
    }>;
    failures?: Array<{ id: string; name: string }>;
  };
}
```

**[事实]** 来源：`client.js:1538-1582`。`routableProviders` 等字段被忽略；`failures` 只补 provider 显示名。

### 7.3 可见会话选择

```ts
uiSession.adapter.current.getSnapshot() // => { key: sessionId }
uiSession.adapter.current.subscribe(listener)

modelDirectories.directoryFor(sessionId) // => {
  store: {
    getSnapshot(): { current: { provider, model } | null };
    subscribe(listener): disposer;
  };
  load?(): Promise<unknown>;
}
```

**[事实]** 来源：`client.js:1744-1844`。两个服务均通过 `ctx.get` 可选获取；服务晚到时每秒重试，最多 15 次。

### 7.4 remote 事件

**[事实]** 通过 `remote.$on(event, listener)` 消费：

- `llm/adapters-updated`
- `settings/document-updated`
- `credentials/record-updated`
- `credentials/reference-updated`

证据：`client.js:1858-1879`。listener 不读事件 payload；单个事件订阅异常被吞掉。

### 7.5 其他宿主服务

| 服务 | 调用 | 证据 |
| --- | --- | --- |
| locale | `register`、`getSnapshot().active` | `client.js:1881-1886` |
| timer | `interval(callback, delay)` | `client.js:1885` |
| slots | `inject`、`register` | `client.js:1888-1906` |
| browser fetch | 同源 GET Host 路由 | `client.js:781-799` |
| React | `createElement` 与 hooks | `client.js:26-33` |

## 8. 外部 HTTPS API

| API | 方法／数据 | 当前解析契约 | 证据 |
| --- | --- | --- | --- |
| DeepSeek 中文价目 | GET HTML | 按中文行标签识别模型、峰谷、token 类别 | `parse.js:15-18,187-233,332-339` |
| DeepSeek 英文价目 | GET HTML | 同上，英文标签 | 同上 |
| DeepSeek 余额 | GET JSON + Bearer | `balance_infos[]`，CNY/USD，十进制金额 | `parse.js:20-23,71-101` |
| iCloud 中国日历 | GET ICS | VEVENT、DTSTART/DTEND/SUMMARY、休／班标记 | `parse.js:24-25,372-454` |

**[事实]** 插件没有这些上游的正式版本协商；HTML/ICS 解析是当前格式的专用适配器。

## 9. 静态资源与配置表面

- **[事实]** `locale/zh.json`、`locale/en.json` 只含 `meta.title` 和 `meta.description`，不含卡片运行词典；运行词典在 `client.js`。
- **[事实]** `cordis.patch.yml` 使用稳定 id `dsh-billing-card` 插入 bundle，供禁用／覆盖和升级保持。
- **[事实]** manifest 声明 DSH engine、两个 Client 包级 inject 和 runtime files；没有插件自有用户配置 schema。

## 10. 契约风险与 2.0 建议

### 10.1 当前主要风险

- **[事实]** 无 `schemaVersion`、无共享路由常量、无公开 JSON Schema／类型包。
- **[事实]** null 同时表达未加载、缺失、旧协议和部分失败。
- **[事实]** 内部 DTO 与内置 DTO 形状不完全一致，若数字段生产不消费。
- **[事实]** 大量宿主契约依赖动态嵌套属性，真实版本兼容主要由 stub 和一次 E2E 声明支撑。
- **[推断]** 直接修改现有路由语义会同时影响运行中旧 Host／新 Client 组合，不能只按 npm major 判断安全。

### 10.2 建议的新契约原则

1. **[建议]** 明确公共支持面：Host/Client 入口、静态资源和版本化数据路由；parser 默认内部化。
2. **[建议]** v2 DTO 带 `schemaVersion`、可比较的 `revision`、每源 `status/observedAt/errorKind/provenance`。
3. **[建议]** 运行时 decoder 与 TypeScript 类型同时存在；所有外部输入先校验再进入领域。
4. **[建议]** 金额保持十进制字符串；未知币种、未知版本和不完整必需字段明确拒绝。
5. **[建议]** 旧路由保留兼容期或提供单独 v2 路由；定义新 Host／旧 Client、旧 Host／新 Client 的支持矩阵。
6. **[建议]** refresh 语义与普通读取分离，并依据真实 Web Server 暴露范围决定访问控制。

这些原则尚未实施，最终选择见 [REBUILD_OPTIONS.md](REBUILD_OPTIONS.md) 与 [REBUILD_DECISIONS.md](REBUILD_DECISIONS.md)。
