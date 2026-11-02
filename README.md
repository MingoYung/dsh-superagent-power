# Sup · Super-agent 全局开关

**在 DSH 会话输入栏按需开启、关闭 Super-agent 后台，避免不使用时仍长期占用系统内存。**

A shared composer switch for starting and gracefully stopping a Super-agent process in DSH.

[![CI](https://github.com/MingoYung/dsh-superagent-power/actions/workflows/ci.yml/badge.svg)](https://github.com/MingoYung/dsh-superagent-power/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

这是一个面向 **Windows / DSH NEXT** 的社区插件。输入栏按钮叫 **Sup**，面板显示完整名称 **Super-agent**。它管理已经安装好的独立 Super-agent profile，不替代 Super-agent 本身。

上游：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [Super-agent research prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)。本项目独立维护，不是 DeepSeek 官方插件。

## 为什么要做这个插件

### 1. 不使用时，让后台真正退出，释放内存

Super-agent 是主动代理，需要在后台等待事件并处理任务。这种设计适合持续值守，但有些用户只在需要时使用它。即使没有正在执行的任务，已启动的 Node 进程、加载的模块和运行时状态仍会占用内存。

这个插件把进程的启停放到日常聊天入口：需要时点“开启”，用完点“关闭”。关闭会先调用 Super-agent 的正常收尾流程，再退出独立 CLI 进程；确认进程退出后，界面才显示“已关闭”。

一次本机验收中，原后台主进程 RSS 约 **468 MB**，关闭后该进程退出。这个数字是一个环境中的观测值，**不是所有机器都能节省 468 MB 的承诺**，也不等同于操作系统总内存必然下降相同数值。实际占用取决于版本、加载的插件、任务和会话状态。

### 2. 一个后台对应一个全局开关，避免会话互相冲突

如果 A 会话设为开启、B 会话设为关闭，却控制同一个后台进程，就会出现相互覆盖或状态误导。因此开关属于 **DSH_HOME + Super-agent profile**，不属于某个聊天会话。

每个会话的输入栏只是同一全局控制的入口。切换会话不会自动启动或关闭后台；多个会话同时操作时，状态版本检查会拒绝过期请求，避免悄悄覆盖新选择。

### 3. 把控制放在经常使用的位置

按钮位于输入栏底部工具区，可以和权限、REA、并发等按钮放在一起。使用短标签 `Sup`，减少对输入栏宽度的占用；状态点和悬浮说明显示当前状态，点击后再查看内存、任务数和完整开关。

```text
输入栏工具区：  [权限]  [REA]  [并发]  [● Sup]
                                     │
                         Super-agent · 全局
                         所有会话共用同一个开关
                         已关闭              [开启]
```

### 4. 关闭前给任务正常收尾的机会

有活动任务时，面板需要再次点击“中断任务并关闭”。关闭流程调用 `Runtime.stop()`，随后使用 DSH 的 `appExit()` 退出，给任务取消、后台工作清理和状态持久化提供正常路径。若控制接口失联或进程未退出，会显示异常，不会直接把状态标成关闭。

## 使用效果

| 状态 | 按钮提示 | 行为 |
| --- | --- | --- |
| 已关闭 | 灰点 | 没有托管的 Super-agent 后台进程 |
| 已开启 | 绿点 | 后台可接收、处理任务，面板显示主进程 RSS 和活动任务数 |
| 启动 / 关闭中 | 黄点 | 等待状态确认，防止重复操作 |
| 异常 | 红点 | 显示原因，由用户决定重试 |

- 全局状态持久化，下次启动桌面时沿用上次选择。
- 正常关闭桌面时会请求后台退出；由本插件启动的子进程也会监听 IPC 断开并尝试收尾。
- 单个控制者和串行操作防止重复启动。端口已被占用时拒绝启动第二份实例。
- 同一渲染窗口的会话共享状态；其他可见窗口约 5 秒刷新一次，重新聚焦时立即刷新。
- 关闭状态只保留桌面内部的按钮与控制服务，不增加一个额外常驻控制器进程。

**取舍：关闭期间不会监听或处理外部任务。** 不做“闲置自动关闭”，因为等待新事件正是主动代理的用途之一，暂无任务不代表用户不需要它值守。需要持续值守时保持开启即可。

关闭会保留配置和历史记录，但中断后的恢复行为由上游 Super-agent 决定，不保证外部命令能从中断位置继续。

## 安装

先安装并配置好 DSH NEXT、Node.js、独立 DSH CLI 和 Super-agent，再接入本插件。

**需要配置两侧：桌面的按钮/控制器，以及 Super-agent 进程里的伴随模块。只导入桌面插件包并不能完成整个安装。**

1. 从 [Releases](https://github.com/MingoYung/dsh-superagent-power/releases) 下载 `.tgz`，或按下方步骤自行构建。
2. 将包安装到桌面 profile，并确认它已加入该 profile 的 bundle 列表。
3. 在 Super-agent profile 中配置本包的 `bridge.js`，双方使用相同的 `homePath`、`profileName` 和密钥文件。
4. 重载后从输入栏 `Sup` 操作，验证开启和关闭。

完整步骤、可复制的配置和卸载方法见 **[安装说明](docs/installation.md)**。示例配置见 [examples](examples)。

## 开发与测试

Windows、Node.js 24+、npm：

```powershell
git clone https://github.com/MingoYung/dsh-superagent-power.git
cd dsh-superagent-power
npm ci
npm run check
npm pack
```

依赖通过 lockfile 固定，构建和测试使用本仓库依赖，不读取开发者电脑上的全局安装路径。运行包中的 React 和 DSH 宿主服务由 DSH 提供；Zod 与浏览器需要的 remote-info 已打包。

测试覆盖真实子进程的启动和正常退出、忙碌任务保护、状态版本冲突、重复控制者、端口占用、认证拒绝、选择持久化、IPC 断开、原生 Gateway 权限与参数校验，以及浏览器模块加载依赖。

测试中的 worker 是隔离夹具，不连接业务账号。桌面 UI 与真实 Super-agent 的本机验收范围见 [验证记录](docs/verification.md)。

## 兼容范围与实现

首版在 Windows、DSH NEXT `2.0.21-next`、内嵌 DSH `0.2.1-rc.4`、独立 CLI `0.2.1-rc.5` 和 Super-agent `0.1.0` 的本机安装上验证。DSH 宿主接口及 Super-agent 内部生命周期接口仍可能变化；其他版本需要重新验证。macOS / Linux 尚未完成验收。

插件依赖 `Runtime.stop()` 等现有接口，通过原生 slot 和 Remote 接入桌面。无需修改 DSH 的 `app.asar` 或给 Super-agent 核心打补丁。详细架构、状态同步和失效边界见 [设计说明](docs/design.md)。

## 贡献与许可证

欢迎提交可复现的问题或改进：[贡献说明](CONTRIBUTING.md)。报告问题时请提供版本与脱敏错误，不要上传控制密钥、登录链接、账号配置或会话记录。

[MIT License](LICENSE)。打包的第三方代码声明见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。
