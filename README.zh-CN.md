<!-- prettier-ignore -->
<div align="center">

<img src="https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/icon.svg" alt="" height="72" />

# dsh-billing-card

*DSH 侧边栏里的 DeepSeek 余额、实时单价与计费时段*

![平台](https://img.shields.io/badge/platform-web-blueviolet?style=flat-square)
[![npm](https://img.shields.io/npm/v/@jimmyzm/dsh-billing-card?style=flat-square)](https://npmx.dev/package/@jimmyzm/dsh-billing-card)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)](LICENSE)
[![](https://img.shields.io/npm/unpacked-size/@jimmyzm/dsh-billing-card?style=flat-square)](https://npmx.dev/package/@jimmyzm/dsh-billing-card)
[![](https://img.shields.io/github/actions/workflow/status/jimmyzm/dsh-billing-card/ci.yml?style=flat-square&label=tests)](https://github.com/jimmyzm/dsh-billing-card/actions/workflows/ci.yml)
[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) · **简体中文**

[功能](#功能) • [截图](#截图) • [安装](#安装) • [工作原理](#工作原理) • [已知边界](#已知边界) • [开发](#开发)

</div>

DSH（DeepSeek Harness）侧边栏底部的一张卡片：余额、它背后的提供商与模型、档单价，以及当前计费时段和下次切换的倒计时。

<div align="center">
  <img src="https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/screenshots/holiday-banner.png" alt="假期中的卡片" width="320" />
</div>

## 功能

- **余额** —— DSH 账号余额（充值 + 赠金）或 API Key 对应的 DeepSeek 开放平台余额，按当前提供商的计费方式显示，随输入框切换。
- **一行一事** —— 提供商单独一行、模型名另起一行，价格属于哪个渠道一眼可见。
- **档单价** —— 当前模型在现行时段的输入、缓存、输出价格；其他渠道提供的模型不显示价格。
- **计费时段** —— 绿色「空闲」/ 黄色「高峰」；切换倒计时在左上角，保留「距高峰 / 距空闲」字样并用当前时段同色。
- **假期标识**（中文界面）—— 假期显示蓝色横条和假期名，调休日显示灰色「调休」标签。
- **按界面语言计价** —— 中文界面人民币价，其他语言美元价。
- **跟随应用** —— 卡片自带 token 层的明暗主题、中英文字典，抓不到上游数据时用内置数据。

## 截图

真实渲染，侧边栏 256 px、2× 密度。

| 假期 —— `国庆节` | 调休日 —— `调休` |
| --- | --- |
| ![假期](https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/screenshots/holiday-banner.png) | ![调休](https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/screenshots/makeup-chip.png) |

| 英文界面、美元价 | 深色主题 |
| --- | --- |
| ![英文界面](https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/screenshots/english-usd.png) | ![深色主题](https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/screenshots/dark-theme.png) |

## 安装

已发布到 npm（[`@jimmyzm/dsh-billing-card`](https://npmx.dev/package/@jimmyzm/dsh-billing-card)），是一个 DSH bundle。用你实际运行的 profile（桌面应用用 `desktop`，`dsh web` 用 `web`）：

需要 DSH 0.2.0-rc.1 或更新版本——`engines.dsh` 声明了这个范围；卡片用到的 manifest 字段、页脚插槽、`locale` 与 `webServer` 服务在该版本中都已存在。

```bash
dsh plugin --profile web add @jimmyzm/dsh-billing-card
```

等同于 DSH 插件页上的 **Install from npm**。装完刷新 GUI —— 卡片出现在侧边栏底部；侧边栏收成图标栏时卡片隐藏。

> [!IMPORTANT]
> 插件的 Host 半边每次启动只加载一次，所以**安装或升级后要重启一次应用**。重启之前卡片用内置数据。

需要带 Web GUI、侧边栏底部插槽和账号服务的 DSH。卸载：

```bash
dsh plugin --profile web remove @jimmyzm/dsh-billing-card
```

## 工作原理

Host 半边在每次启动时拉取两份价目表和中国大陆节假日日历，通过 `GET /deepseek-billing-card/data` 提供；Client 半边是 `sidebar.footer.action` 里的 React 组件，读取该路由、跟随输入框的模型选择，并每 30 秒刷新一次余额。

切到由开放平台计费的提供商时，卡片会立刻让 Host 重读一次余额，金额随切换生效，不用等下一个刷新周期。

### 计费时段

高峰是北京时间周一至周五 09:00–12:00 和 14:00–18:00，中国法定节假日除外；其余为空闲时段。

### 货币

中文界面用人民币价目表，其他语言用美元价目表。不做汇率换算，余额保持钱包自身的货币。

### 悬停提示

悬停挂在每行的「本体」上：余额数字本身（只给帮助光标，**不加下划线** —— 数字已经是卡片上最响的
元素，再加一条虚线会被读成链接）、模型名（虚线，标出可悬停），以及两个标签（时段、调休，各自带
帮助光标）。模型名的提示只在官方价目渠道下出现：换了别的服务商，卡片上的数字只是参考价，不是它的
报价。

每个气泡都是卡片自己画的「明细表」—— 不借用宿主的图元，所以它跟着主题走，而不是继承一块固定的
深色底板：每个事实一行「名称 → 取值」（充值是绿点，赠金是黄点），再来一条分隔线，最后是浅色的脚注。

- **余额** —— 屏幕上那个数字由什么组成：充值、赠金、多久刷新一次。开放平台余额同样读法，
  而且绝不会提到账号余额。
- **模型** —— 一条报价要说清四件事，就说四件：模型 ID、计价单位、快照日期、数字是怎么来的
  （「启动时校准」还是「内置快照」）。

时段标签列出高峰窗口（周一至周五 `09:00-12:00`，再一行 `14:00-18:00`）、高峰之外剩下的时段，
以及日历来源；「调休」标签说明调休日如何计费（像周末一样全天不计高峰）。气泡不会重复卡片上已有的
数字。价格区和假期横条没有悬停提示 —— 文字已经说明了自己。气泡在 240ms 后出现，上方放不下时翻到
下方，移开、失焦或按 `Esc` 立即收起。

### 数据来源

| 内容 | 来源 |
| --- | --- |
| 账号余额、模型 | DSH 账号服务；输入框的模型选择 |
| 开放平台余额 | `GET https://api.deepseek.com/user/balance`，用 Models 页保存的 `DEEPSEEK_API_KEY` 凭据（启动环境是回退） |
| 价格 | <https://api-docs.deepseek.com/zh-cn/quick_start/pricing/> 与 <https://api-docs.deepseek.com/quick_start/pricing/> |
| 节假日 | <https://calendars.icloud.com/holidays/cn_zh.ics> |

## 已知边界

- 价目与节假日在每次启动时读取一次；开放平台余额每 30 秒重新读取。切换提供商时立即重读。
- 没有配置 `DEEPSEEK_API_KEY` 时显示账号余额。
- 非 DeepSeek 官方渠道提供的模型不显示价格。
- 已在 DSH 0.2.1-rc.3 上端到端验证；对 0.2.0-rc.1 而言源码层面的接口一致，只是该版本还不读 `engines.dsh`。
- 卡片需要 HTTP GUI（`dsh web`）；没有 web 服务器时用内置数据，缺少 `uiSession` / `modelDirectories` 服务时按目录默认模型计价。

## 开发

无构建步骤：`client.js` 是手写的浏览器模块，`index.js` 与 `parse.js` 是 Host 半边。卡片只渲染自己的子树，只读 `--dsw-alias-*` 主题变量。

```
package.json        # dsh.bundle.patch + dsh.client
cordis.patch.yml    # 插入 dsh-billing-card 条目
index.js parse.js   # Host 半边：启动抓取 + 数据路由
client.js           # Client 半边：卡片与内置回退数据
locale/             # 插件管理页用的中英文字典
icon.svg            # 插件图标
CHANGELOG.md        # 更新日志，中英双份，新的在前
CHANGELOG.zh-CN.md
docs/               # README 图标与截图（只在仓库里，不进包）
test/               # 离线测试：解析器、Host 路由、Client 渲染
AGENTS.md           # 面向 Agent 的开发规范（只在仓库里，不进包）
.agents/skills/     # 面向 Agent 的项目 skills（只在仓库里，不进包）
.github/workflows/  # ci（测试）与 publish（带 provenance 发布 npm）
```

想在本地跑而不是用已发布的包，把文件夹加进去 —— 它会以链接方式装进 profile，改 `client.js` 刷新页面即生效：

```bash
dsh plugin --profile web add /path/to/dsh-billing-card
```

`npm test` 跑离线测试：解析器跑 `test/fixtures` 里抓下来的页面，Host 路由用桩上游，Client 半边跑在迷你 React 运行时里。无依赖、不联网。`AGENTS.md` 里是开发规范和三个项目 skill。

基于 [MIT 许可](LICENSE)。
