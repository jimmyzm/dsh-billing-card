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

<img src="https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/banners/minimal-zh-1200x320.png" alt="dsh-billing-card —— 余额、单价与谷峰切换的倒计时，都在 DSH 侧边栏" width="880" />

</div>

## 功能

- 查看为当前所选模型付费的余额：DSH 账号余额，或 API Key 对应的 DeepSeek 开放平台余额。
- 查看所选模型在现行时段每百万 tokens 的输入、缓存、输出价格。
- 查看当前处于高峰还是空闲时段，以及距离下次切换的倒计时。
- 中文界面下，今天的法定节假日和调休日会标出来。
- 中文界面显示人民币价格，其他语言显示美元价格。
- 跟随应用的语言与明暗主题；数据源读不到时使用内置数据。

## 截图

真实渲染，256 px 侧边栏、2× 密度。

<img src="https://raw.githubusercontent.com/jimmyzm/dsh-billing-card/main/docs/screenshots/holiday-banner.png" alt="中文界面：国庆节假期、空闲时段与实时单价" width="576" />

## 安装

从 npm 安装：

```bash
dsh plugin --profile web add @jimmyzm/dsh-billing-card
```

`dsh web` 用 `web` profile，桌面应用用 `desktop`。

升级到最新版本：

```bash
dsh plugin --profile web add @jimmyzm/dsh-billing-card@latest
```

安装或升级后重启 DSH。卡片出现在侧边栏底部；侧边栏收成图标栏时隐藏。

需要 DSH 0.2.0-rc.1 或更新版本，且带有 Web GUI、侧边栏底部插槽，以及账号与模型目录服务。已在 DSH 0.2.1-rc.3 上端到端验证。

卸载：

```bash
dsh plugin --profile web remove @jimmyzm/dsh-billing-card
```

## 计费与价格

高峰时段按北京时间：周一至周五 09:00–12:00 和 14:00–18:00。中国法定节假日不计入高峰，其余时间都是空闲时段。

价格取决于所选模型和当前时段。中文界面报人民币价格，其他语言报美元价格，两者之间不做换算。

其他渠道的模型不套用 DeepSeek 官方价格。

## 余额与数据来源

卡片跟随输入框里选中的提供商：

- DSH 账号余额，含充值与赠金。
- DeepSeek 开放平台余额，用配置的 `DEEPSEEK_API_KEY` 读取。

两者都每 30 秒刷新一次；切换提供商时两者都立刻重读，更换凭据时开放平台余额也立刻重读。没有配置 API Key 时，卡片继续显示 DSH 账号余额。若当前提供商由开放平台计费，余额位置显示「未配置 API Key」。

数据来源：

- 账号余额与所选模型：DSH 账号服务、输入框的模型选择。
- 开放平台余额：`GET https://api.deepseek.com/user/balance`，用 Models 页保存的 `DEEPSEEK_API_KEY`（启动环境是回退）。
- 模型价格：[中文价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) · [英文价格](https://api-docs.deepseek.com/quick_start/pricing/)。
- 中国节假日：[iCloud 节假日日历](https://calendars.icloud.com/holidays/cn_zh.ics)。

价格和节假日在应用启动时读取。某个来源读不到时，用该来源的内置副本。

## 限制

- 价格和节假日不会在应用运行期间自动刷新；重启 DSH 后才会重新读取。
- 非 DeepSeek 官方渠道的模型不显示价格；官方价目表里没有的模型会给出说明。
- DSH 账号未登录时，卡片显示开放平台余额，而不是留空。
- 没有 web 服务器时，价格和节假日用内置快照；应用不提供当前会话的模型选择时，按默认模型计价。

## 开发

无构建步骤，也没有 npm 运行时依赖。`client.js` 是客户端模块；`index.js` 与 `parse.js` 在 Host 侧运行。

运行测试：

```bash
npm test
```

离线测试使用本地 fixture 和模拟运行时，不需要联网。

安装本地目录：

```bash
dsh plugin --profile web add /path/to/dsh-billing-card
```

改客户端代码刷新页面生效；改 Host 代码后重启 DSH。

开发规范见 `AGENTS.md`，项目 skills 在 `.agents/skills/`。

## 许可

[MIT](LICENSE)
