# dsh-ccswitch

在 DeepSeek Harness（DSH）中直接使用 [CC Switch](https://github.com/farion1231/cc-switch) 已配置的 Claude、Codex/GPT 和 Gemini 模型。

插件会自动读取当前设备上的 CC Switch 配置，不需要在 DSH 中重复填写 API key 或登录信息。

支持 macOS、Windows 和 Linux。

## 使用前准备

1. 安装并打开 CC Switch。
2. 在 CC Switch 中添加可用的 provider，并确认模型可以正常使用。
3. 安装 DeepSeek Harness。

## 安装插件

macOS、Windows PowerShell 和 Linux 都可以执行：

```bash
dsh plugin --profile web add github:upJiang/dsh-ccswitch
```

安装完成后重启 DSH。前台运行时先按 `Ctrl+C` 停止，再重新启动：

```bash
dsh web --host 127.0.0.1 --port 3080
```

重新打开或刷新 DSH 页面后，就可以在模型选择器中看到 CC Switch 的 provider 和模型。

## 选择模型

打开 DSH 的模型选择器：

1. 找到名称为 CC Switch provider 的模型分组。
2. 直接选择需要的模型。
3. 模型较多时，DSH 会在菜单顶部自动显示搜索框，输入模型名称即可筛选。

插件会自动读取 CC Switch 后续的配置变化。添加、删除或修改 provider 后，通常不需要重新安装插件。

## 只显示部分 provider

默认显示 CC Switch 中所有可用 provider。如果只想使用其中一部分，可以创建配置文件。

macOS/Linux：

```text
~/.dsh/ccswitch-providers.json
```

Windows：

```text
%USERPROFILE%\.dsh\ccswitch-providers.json
```

文件内容：

```json
{
  "include": [
    "my-codex-provider",
    "ccswitch/claude/*"
  ]
}
```

可以填写 CC Switch 中显示的 provider 名称，也可以使用 `*` 通配符。保存文件后，DSH 会自动刷新可用模型。

## CC Switch 使用了自定义目录

正常情况下不需要设置路径，插件会自动查找当前用户的 CC Switch 数据库。

如果在 CC Switch 中使用了自定义数据目录、便携目录或同步盘，需要告诉插件数据库的位置。

macOS/Linux：

```bash
DSH_CCSWITCH_DB='/path/to/cc-switch.db' \
  dsh web --host 127.0.0.1 --port 3080
```

Windows PowerShell：

```powershell
$env:DSH_CCSWITCH_DB = 'D:\path\to\cc-switch.db'
dsh web --host 127.0.0.1 --port 3080
```

## 在多台设备上使用

在每台设备上分别安装 CC Switch、DSH 和本插件即可。

- Mac 会读取 Mac 上的 CC Switch 配置；
- Windows 会读取 Windows 上的 CC Switch 配置；
- 两台设备可以使用不同的 provider 和模型；
- 插件不会在设备之间同步数据库、API key 或登录信息。

## 没有看到模型

按顺序检查：

1. CC Switch 中是否已经添加并启用了 provider。
2. CC Switch 中的模型是否可以正常请求。
3. 安装插件后是否重启并刷新了 DSH。
4. 是否配置了错误的 `ccswitch-providers.json` 筛选条件。
5. 使用自定义 CC Switch 目录时，`DSH_CCSWITCH_DB` 是否指向正确的 `cc-switch.db` 文件。

如果市场提示 `@google/genai` 或 `protobufjs` 的构建脚本被 pnpm 拦截，请更新到 `dsh-ccswitch` `0.1.1` 或更高版本后重新安装。新版会使用 DSH 已提供的运行时依赖，不需要为这两个包单独放行构建脚本。

## 升级 DSH 后插件无法加载

DSH 目前仍处于 pre-release，`@deepseek-ai/dsh-llm` 与 `@earendil-works/pi-ai` 的内部接口在版本之间会发生变化，因此每个 `dsh-ccswitch` 版本只适配同一代的 DSH。

| 现象 | 受影响版本 | 原因 | 修复版本 |
| --- | --- | --- | --- |
| 启动报错 `does not provide an export named 'CallId'` | `0.1.1` 及更早 | DSH `0.1.2` 起把 `CallId` 改名为 `ToolCallId`；`pi-ai` `0.83` 起停止原因新增 `pending`/`deferred` | `0.1.2` |
| 启动报错 `does not provide an export named 'CallId'`，或模型转换失败 | `0.1.2` | DSH `0.2.0` 起把工具结果改为独立的 `tool` 角色消息（不再是 `tool-result` 内容块），新增 `developer` 角色，并把 provider 入参改为 `TranscriptContext` | `0.1.3` |

请更新到 `dsh-ccswitch` `0.1.3` 或更高版本后重新安装并重启 DSH：

- `0.1.2` 适配 DSH `0.1.5`（`@deepseek-ai/dsh-llm` `0.1.5-rc`、`@earendil-works/pi-ai` `0.85`）；
- `0.1.3` 适配 DSH `0.2.0`（`@deepseek-ai/dsh-llm` `0.2.0-rc`、`@earendil-works/pi-ai` `0.87`）。该版本不再自带模型搜索：DSH `0.2.0` 已在模型选择器中内置搜索，旧的自定义搜索依赖的 DOM 结构同时发生了变化。

> 重要：profile 的 `package.json` 会把插件固定到某个 git commit。升级 DSH 或重新执行 `dsh plugin add` 会用该 commit 覆盖本地已安装的 `lib`。因此修复后必须让固定版本指向包含修复的提交，否则问题会再次出现。
