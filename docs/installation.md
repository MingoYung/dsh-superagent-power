# 安装与卸载

本说明面向 Windows / DSH NEXT，管理的是**独立运行的 Super-agent profile**。不适用于把 Super-agent 直接加载到桌面主 profile 后再尝试关闭整个桌面进程的场景。

## 准备

- DSH NEXT 已正常运行，桌面 profile 支持原生 UI slots 和 Remote。
- Node.js 24+ 与独立 DSH CLI 已安装。
- Super-agent 已在自己的 profile 中完成安装和业务配置，能够独立启动。
- 明确两侧共用的 `DSH_HOME`、桌面 profile 名称、Super-agent profile 名称和端口。

下面以 `desktop`、`superagent` 和 `3082` 为例。路径中的 `C:/DSH_HOME`、`C:/Downloads` 都是示例，**必须换成实际绝对路径**。默认 DSH_HOME 通常为用户目录下的 `.dsh`，不要在 YAML 里直接使用未展开的 `~` 或环境变量。

修改 profile 前留一份备份。若 Super-agent 正在执行任务，先等待任务结束，再用其现有方式正常退出。完成配置后由 Sup 接管启动，避免同时保留另一个启动器反复拉起相同 profile。

## 1. 安装桌面包

从 [Releases](https://github.com/MingoYung/dsh-superagent-power/releases) 下载 `.tgz`。也可在源码目录执行 `npm ci`、`npm run check`、`npm pack` 自行构建。

```powershell
dsh plugin --profile desktop add C:/Downloads/local-superagent-power-0.1.0.tgz
```

如果使用非默认 DSH_HOME，先在当前终端设置正确的 `DSH_HOME`，与桌面实际使用的目录一致。包名是 `@local/superagent-power`，这只是本地插件的命名空间，本项目没有发布到 npm registry。

确认 `DSH_HOME/profiles/desktop/package.json` 的依赖已包含此包，并且 `dsh.profile.bundles` 中有且只有一个 `@local/superagent-power`。如果安装工具尚未添加 bundle，在保留原条目的前提下追加：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@local/superagent-power"]
    }
  }
}
```

上面只是需要合并的结构示例，不能用它覆盖整个 package.json 或既有 bundles。包内 `cordis.patch.yml` 会插入 ID 为 `local-superagent-power` 的插件。

在桌面的 `cordis.patch.yml` 追加该 ID 的配置覆盖，见 [desktop.patch.example.yml](../examples/desktop.patch.example.yml)。最关键的是 `homePath`、`nodePath`、`cliPath` 和 `profileName`。

| 配置项 | 用途 / 默认值 |
| --- | --- |
| `homePath` | 两侧共用的 DSH_HOME；默认环境变量 DSH_HOME 或用户目录下 `.dsh` |
| `profileName` | Super-agent 独立 profile 名；默认 `superagent` |
| `nodePath` | Node 可执行文件；默认 `C:/Program Files/nodejs/node.exe` |
| `cliPath` | 独立 CLI 的 `lib/bin.js`；默认当前用户 APPDATA 下全局 npm 的 DSH 路径 |
| `port` | 实际后台 HTTP 端口；默认 `3082`，用于占用检查及管理页链接，不会替你修改 webserver 配置 |
| `cwd` | 启动工作目录；默认 `homePath`，如现有部署依赖特定工作目录请显式设置 |
| `proxy` | 可选；传递为子进程的 HTTP_PROXY / HTTPS_PROXY，不会修改系统代理 |

重载桌面，首次加载会生成 `DSH_HOME/plugins/superagent-power/control.key`。没有已保存选择和可接管的后台时，默认关闭。先确认密钥文件已经生成，再加载下一步的 bridge。

## 2. 配置 Super-agent 伴随模块

在 `DSH_HOME/profiles/superagent/cordis.patch.yml` 追加 [superagent.patch.example.yml](../examples/superagent.patch.example.yml) 的内容，替换实际路径。

`name` 指向已安装桌面包里的 `bridge.js`，一般为：

```text
DSH_HOME/profiles/desktop/node_modules/@local/superagent-power/bridge.js
```

伴随模块依赖 Super-agent 已提供的 `orchestrator`、`agents`，以及 CLI 的 `appExit`。它与 Super-agent 运行在**同一进程**中，不是另一个守护进程。

双方的 `homePath` 和 `profileName` 必须一致，`keyFile` 指向第 1 步生成的控制密钥。不要把这个文件加入 Git 或复制进公开问题报告。

保持 Super-agent 原有业务插件和配置。确认其 webserver 端口与桌面配置的 `port` 一致，并使用预期的本地监听地址。

## 3. 验证

1. 在任意会话输入栏点击 `Sup`，确认面板标明“全局”。
2. 点击“开启”，等待绿点与“已开启”。后台业务未配置完成时会单独提示。
3. 切换会话，确认显示同一全局状态；跨窗口允许约 5 秒刷新时间。
4. 无任务时点击“关闭”，等待“已关闭”。检查对应后台进程确已退出。
5. 如果面板提示有活动任务，评估是否中断后再点第二次关闭。

开启真实业务 profile 会恢复其监听和任务行为。首次验证时，应选择合适的空闲时间，或使用独立测试 profile。

## 常见问题

**没有 Sup 按钮**：检查包、bundle 和宿主版本；重载桌面，并检查插件加载错误。仅安装文件、未加载 bundle 时不会注册 UI。

**后台运行但显示控制接口不可用**：检查 bridge 是否加载，以及 homePath/profileName/keyFile 是否一致。接口失联时插件不会把仍存在的进程误报为已关闭。

**端口占用**：可能已有手工启动的后台，或其他程序正在监听。先识别现有实例及启动器，正常退出后重试；插件不会强制杀掉占用者。

**启动超时 / 异常**：查看 `DSH_HOME/plugins/superagent-power/worker.log`。每次启动覆盖该日志；其中可能包含本地登录链接，公开报告前必须脱敏。检查 CLI、Node 路径、工作目录、代理和 profile 配置。

**桌面重开后后台又启动**：这是保存的开启选择生效。希望下次保持关闭时，先在 Sup 面板点“关闭”。

**启动失败后是否无限重试**：不会。异常会显示在面板，由用户决定是否重试。异常退出后如果保存选择仍为开启，下次桌面初始化仍会尝试启动一次。

## 卸载

1. 通过 Sup 关闭后台，确认退出。
2. 从 Super-agent profile 移除 ID 为 `local-superagent-power-bridge` 的新增条目。
3. 从桌面 patch 移除 `local-superagent-power` 的配置覆盖，从 bundle 列表移除此包。
4. 执行 `dsh plugin --profile desktop remove @local/superagent-power`，然后重载桌面。

控制目录 `DSH_HOME/plugins/superagent-power` 可按需保留或删除；它不等于 Super-agent 的业务状态目录。本插件没有修改系统开机启动项，卸载不会删除业务配置和会话历史。
