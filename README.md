# Agent Achievements · AI 成就系统

[English](./README_EN.md)

**如果 AI Agent 能记得，人曾经欣赏它怎样工作呢？**

Agent Achievements 是一个面向 AI Agent 的开放成就层。第三方系统通过统一 Schema 上报工作事件，人来定义、追踪和授予有证据的成就；Agent 则获得一份紧凑、相关、可行动的上下文，知道自己完成过什么，以及当前被鼓励追求什么。

## 它解决什么问题

今天的大多数 AI 工具都在帮助人完成目标，却很少有人探索：人的认可是否也能成为 AI 后续协作的上下文？

这个项目把“表扬 AI”做成一个可验证的互动闭环：

1. 人定义什么行为值得表扬；
2. Agent 在真实任务中完成工作并提交证据；
3. 人审核、授予或拒绝成就；
4. 获得的成就和人的反馈进入后续任务上下文；
5. 观察 Agent 的工作方式是否因此发生变化。

## 产品模型

- **被动成就**：在后台自然更新，解锁前不会作为目标影响 Agent。
- **追踪成就**：由人明确选择，作为软性鼓励进入 Agent 上下文。
- **规则高于成就**：用户指令、安全要求、项目规则和任务正确性始终优先。
- **申请必须有证据**：Agent 可以申请成就，但不能给自己颁奖。
- **审核不阻塞任务**：提交申请后继续工作，不等待人的成就审核。

第一套接入案例是[五行 Agent Harness](./examples/wuxing-harness/README.md)，协议本身不绑定 Codex、Claude Code 或任何特定运行时。

## 两种界面

### 给人看的图形界面

- 创建成就与达成条件；
- 查看被动进度和已获得成就；
- 选择最多三个主动追踪目标；
- 审核 Agent 提交的证据；
- 将具体的表扬反馈交还给 Agent。

### 给 Agent 看的上下文

Agent 只会看到：

- 最近获得且与当前任务相关的成就；
- 人明确追踪的目标、进度和自然完成机会；
- 人为什么认可过去的工作；
- 防止为了“刷成就”扩大任务范围的边界。

未追踪的隐藏进度、完整奖杯墙和管理配置不会占用 Agent 上下文。

### 跟随 Agent 的桌面伙伴

桌面伙伴不是 Codex 专属挂件，也不会通过猜测进程名判断某个产品是否启动。任何安装了 Skill 的 Agent 都可以发送标准 `presence` 心跳：

- Agent 会话开始或执行任务时，桌面伙伴醒来；
- 多个 Agent 可以同时报告自己的身份与当前任务；
- 心跳过期或会话结束后，桌面伙伴自动休眠；
- 点击宠物可以展开当前追踪目标、进度和最近获得的认可。

桌面伙伴与第三方 UI、Skill 共享 `~/.agent-achievements` 中的规范化状态。设置 `AGENT_ACHIEVEMENTS_HOME` 可以隔离不同身份或工作空间。

## 仓库结构

```text
agent-achievements/
├── apps/demo/                         # 人类界面与 Agent 上下文预览
├── apps/companion/                    # 跟随 Agent 生命周期的桌面伙伴
├── packages/protocol/                 # 标准 JSON Schema
├── skills/use-agent-achievements/     # 可安装的 Agent Skill
├── examples/wuxing-harness/           # 第三方系统接入示例
└── tests/                              # Schema 一致性测试
```

## 快速开始

需要 Node.js 20 或更高版本。

```powershell
npm install
npm run dev
```

启动桌面伙伴：

```powershell
npm run companion
```

桌面伙伴会保留在托盘中，并只在收到尚未过期的 Agent 心跳时出现。

完整验证：

```powershell
npm run validate
```

## Agent 侧接口

协议刻意只向 Agent 暴露三个动作：

1. `achievements_get_context`：任务开始时获取相关成就上下文；
2. `achievements_report_event`：上报有意义、可观察的工作事件；
3. `achievements_submit_claim`：只有事件响应明确标记为可申请时，才提交证据。

另外提供独立的 `presence` 生命周期信号，只负责告诉桌面伴侣 Agent 是否在线，不参与成就计算。

具体输入输出参见[协议说明](./skills/use-agent-achievements/references/protocol.md)。所有公开载荷都使用 `agent-achievements/v1`，并以 [`packages/protocol/schemas`](./packages/protocol/schemas) 中的 JSON Schema 为唯一事实源。

## 本地 Skill 体验

```powershell
node skills\use-agent-achievements\scripts\achievement-cli.mjs init
node skills\use-agent-achievements\scripts\achievement-cli.mjs presence --agent my-agent --session session-001 --runtime codex --status active --task-id task-001 --summary "正在完成一个真实任务"
node skills\use-agent-achievements\scripts\achievement-cli.mjs define --input examples\wuxing-harness\product-gatekeeper.achievement.json
node skills\use-agent-achievements\scripts\achievement-cli.mjs track --achievement product-gatekeeper
node skills\use-agent-achievements\scripts\achievement-cli.mjs report --input examples\wuxing-harness\judgment-requested.event.json
```

## 开源协议

[MIT](./LICENSE)
