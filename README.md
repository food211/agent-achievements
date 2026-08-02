# 五行 Harness

> 帮 AI Agent 检查已经积累的规则，让过时规则得到修订，并把人的认可带回下一次协作。

[English](./README_EN.md) · [在线演示](https://wuxing-creation-harness.misakiff14.chatgpt.site) · [安装说明](https://wuxing-creation-harness.misakiff14.chatgpt.site/install)

用 Agent 做久了，工作区里会慢慢积累很多 Skill、Rule、模板和提示词。它们记录了过去踩过的坑，也可能在版本迭代后失去原来的前提。Agent 通常会继续遵守这些规则，很少主动问一句：这条现在还对吗？

五行 Harness 会结合当前代码、测试和运行证据审查这些规则。遇到能够直接证明的矛盾，它提出修改建议；遇到产品边界、数据改动或自动化范围等无法替人决定的问题，它停下这一条，把理由交给人。人的判断会改回规则，验证过的改进可以申请成就。人确认后，这份认可会进入 Agent 下一次任务的上下文。

## 一个闭环里的两个系统

仓库包含两个紧密配合的部分：

- **五行 Harness** 负责发现规则漂移、提出修改、等待人的判断，并验证修改结果。
- **Agent Achievements** 负责接收已验证的工作证据，让人授予成就，再把成就和反馈交还给 Agent。

```text
工作区规则
   ↓
五行 Harness 读取代码、测试与运行证据
   ↓
发现矛盾或判断边界
   ↓
人批准、拒绝或修改建议
   ↓
Agent 覆盖旧规则并完成验证
   ↓
提交成就申请
   ↓
人授予成就和具体反馈
   ↓
下一次任务中，Agent 看到这份认可
```

审查和成就审核都不会阻塞其他任务。Agent 可以挂起当前判断，继续处理彼此独立的工作。

## 五行在这里表示什么

五行描述的是 Agent 工作流里的生长与制约关系，不分析人的性格，也不做命理判断。当前版本实现了三条克线：

- **火克金**：执行结果与旧规则反复冲突时，系统提出修改。
- **金克木**：人决定保留哪种方案，砍掉不合适的分支。
- **水克火**：新增定时任务、自动行为或外部数据同步前，系统暂停并询问影响范围。

直接矛盾有一条可靠证据就可以提出。规则仍然自洽，只是反复妨碍工作时，需要积累多次同类证据。Harness 不会为了减少打断而自动发明新规则，也不会用模糊的置信度替人决定高影响改动。

完整范围见[五行 Harness 产品文档](./docs/wuxing-harness-product.md)。

## 成就怎样回到 Agent

Agent 可以提交成就申请，不能给自己颁奖。申请必须带上可核验的工作证据，并经过人的审核。

五行 Harness 内置两项成就示例：

- **规则园丁，银牌 30 分**：一条过时规则得到人的批准，完成修改并通过验证。
- **产品守门员，铜牌 10 分**：Agent 在没有明确产品规则时停下来询问，没有擅自补齐历史数据或扩大自动化范围。

人授予成就时可以写下具体反馈。Agent 下一次读取上下文时，会看到最近获得的成就、人的认可理由，以及当前主动追踪的目标。未追踪成就只被动累计，不会诱导 Agent 为刷分扩大任务范围。

铜、银、金分别为 10、30、100 分。用户指令、安全边界、项目规则和任务正确性始终高于成就目标。

## 五行桌面助手

桌面助手是两个系统共用的交互入口：

- 查看 Agent 当前是否活跃；
- 打开规则体检；
- 查看待判断的规则建议；
- 审核 Agent 提交的成就申请；
- 创建、修改和追踪成就；
- 查看获得的成就、积分和人的反馈。

默认形象是一只四帧 PNG 五行像素助手。Windows 托盘图标由水、木、火、土、金五种元素围成圆环，不再使用人物头像。用户也可以换成自己的 PNG、JPG、WebP 或 SVG 图片。

助手支持窗口置顶、全身拖动、跨显示器缩放和边缘吸附。靠近屏幕左侧、右侧或顶部时会缩回边缘，鼠标移上去后重新展开；底部不会触发吸附。展开和关闭面板不会改变浮窗原来的位置。

任何安装了 Skill 的 Agent 都可以通过标准 `presence` 心跳唤醒助手，不绑定 Codex 或 Claude Code。多个 Agent 可以同时上报自己的身份和任务状态。

## 在线演示与本地运行

公开演示展示的是完整交互流程，不读取访客本机文件，也不需要模型 API Key：

- [打开五行 Harness 演示](https://wuxing-creation-harness.misakiff14.chatgpt.site)
- [查看安装说明](https://wuxing-creation-harness.misakiff14.chatgpt.site/install)

本地运行需要 Node.js 20 或更高版本：

```powershell
npm install
npm run companion
```

本地启动规则审查页面：

```powershell
npm run build --workspace=@agent-achievements/wuxing-assistant
npm run wuxing
```

打开 `http://127.0.0.1:4318`。

## 安装两个 Skill

五行闭环需要安装两个相邻的 Skill。一个负责规则审查，另一个负责成就协议和 Agent 上下文。

```powershell
Copy-Item -Recurse skills\wuxing-harness "$env:CODEX_HOME\skills\wuxing-harness"
Copy-Item -Recurse skills\use-agent-achievements "$env:CODEX_HOME\skills\use-agent-achievements"
```

安装后，可以对 Agent 说：

```text
审一下这个工作区积累的规则。
```

Harness 把待判断项保存在工作区的 `.wuxing-harness/state.json`。它只记录规则、证据和人的判断，不会在获得批准前修改规则文件。

如果需要让 Codex 自动同步活跃状态，可以安装生命周期 Hook：

```powershell
node skills/use-agent-achievements/scripts/install-codex-hooks.mjs
```

安装后需要在 Codex `/hooks` 中审核并信任该 Hook。它只写入标准化的在线状态，不读取对话正文，也不把心跳当作成就证据。

## Agent 接口

日常任务只向 Agent 暴露三个成就动作：

1. `achievements_get_context`：读取与当前任务相关的成就和追踪目标。
2. `achievements_report_event`：报告有意义、可观察的工作事件。
3. `achievements_submit_claim`：事件达到申请条件后，提交证据申请。

`presence` 是独立的生命周期信号，只负责更新桌面助手状态，不参与积分计算。

所有公开载荷使用 `agent-achievements/v1`，以 [`packages/protocol/schemas`](./packages/protocol/schemas) 中的 JSON Schema 为唯一事实源。具体输入输出见[协议说明](./skills/use-agent-achievements/references/protocol.md)。

## 仓库结构

```text
agent-achievements/
├── apps/companion/                    # 五行桌面助手
├── apps/wuxing-assistant/             # 本地规则审查 SPA
├── apps/demo/                         # 成就协议交互 Demo
├── sites/wuxing/                      # 公开演示与安装页面
├── packages/wuxing-core/              # 五行审查内核
├── packages/protocol/                 # 成就 JSON Schema
├── skills/wuxing-harness/             # 可安装的规则审查 Skill
├── skills/use-agent-achievements/     # 可安装的成就 Skill
├── examples/wuxing-harness/           # 第三方接入示例
└── tests/                              # 协议与闭环测试
```

## 验证

```powershell
npm run validate
```

测试覆盖规则冲突判定、人工批准、规则覆盖、验证结果转换、成就申请、人工授予，以及结果回到 Agent 上下文的完整链路。

## 当前边界

当前版本还没有实现完整的非阻塞任务调度器、木克土、土克水和旺衰诊断。公开 SPA 只演示闭环，不扫描访客本机工作区。生产环境中的身份认证、远程托管和长期数据同步也不在当前范围内。

## 开源协议

[MIT](./LICENSE)
