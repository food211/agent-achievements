# Agent Achievements · AI 成就系统

> 同一仓库包含两个彼此独立、可通过协议联动的系统：Agent Achievements 成就层，以及审查 Agent 规则的五行 Harness。

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
- **系统发现**：桌宠回顾 Skill、规则和真实产物，把 Agent 已经带来的正向改变结算为成就。
- **用户创建**：人可以直接创建，或先让 Agent 生成草案，再决定条件和是否追踪。
- **等级与积分**：徽章固定为铜、银、金三级，分别价值 10、30、100 分；只有正式授予后才计分。
- **规则高于成就**：用户指令、安全要求、项目规则和任务正确性始终优先。
- **申请必须有证据**：Agent 可以申请成就，但不能给自己颁奖。
- **审核不阻塞任务**：提交申请后继续工作，不等待人的成就审核。

第一套接入案例是[五行 Harness](./skills/wuxing-harness/SKILL.md)，协议本身不绑定 Codex、Claude Code 或任何特定运行时。

## 两种界面

### 给人看的图形界面

- 创建成就与达成条件，或先写一句目标请 Agent 生成可编辑草案；
- 首次启动时回顾 Agent 已经通过 Skills 做成的正向成果；
- 查看被动进度和已获得成就；
- 选择最多三个主动追踪目标；
- 审核 Agent 提交的证据；
- 将具体的表扬反馈交还给 Agent。

### 给 Agent 看的上下文

Agent 只会看到：

- 最近获得且与当前任务相关的成就、等级和分值；
- 人明确追踪的目标、进度和自然完成机会；
- 人为什么认可过去的工作；
- 防止为了“刷成就”扩大任务范围的边界。

未追踪的隐藏进度、完整奖杯墙和管理配置不会占用 Agent 上下文。

### 跟随 Agent 的桌面伙伴

桌面伙伴不是 Codex 专属挂件，也不会通过猜测进程名判断某个产品是否启动。任何安装了 Skill 的 Agent 都可以发送标准 `presence` 心跳：

- Agent 会话开始或执行任务时，桌面伙伴醒来并进入工作状态；
- 多个 Agent 可以同时报告自己的身份与当前任务；
- 心跳过期或会话结束后，奖杯留在桌面并进入睡眠状态；
- 点击宠物可以展开当前追踪目标、进度和最近获得的认可。

桌面伙伴与第三方 UI、Skill 共享 `~/.agent-achievements` 中的规范化状态。设置 `AGENT_ACHIEVEMENTS_HOME` 可以隔离不同身份或工作空间。

## 仓库结构

```text
agent-achievements/
├── apps/demo/                         # 人类界面与 Agent 上下文预览
├── apps/companion/                    # 跟随 Agent 生命周期的桌面伙伴
├── packages/protocol/                 # 标准 JSON Schema
├── skills/use-agent-achievements/     # 可安装的 Agent Skill
├── skills/wuxing-harness/              # 规则审查 Skill
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

桌面伙伴默认是一只会呼吸、眨眼、挥动把手并回应 Agent 状态的活奖杯。Agent 心跳只改变它的清醒状态，不再控制显隐；获得新成就时它会庆祝。

Windows 右下角系统托盘会显示独立的高对比度活奖杯图标；桌宠继续常驻，不额外占用任务栏按钮。Windows 可能会把首次出现的图标放进 `^` 隐藏图标区，可从那里拖到任务栏通知区域。

桌宠默认置顶，也可以在「外观与常驻」或托盘菜单中关闭/重新开启；选择会保存在本机。

桌宠也是五行 Harness 的桌面入口。托盘菜单或展开面板中的「规则体检」会打开线上演示；桌面壳只额外提供拖拽、置顶、吸附和托盘能力。本地开发时可通过 `WUXING_ASSISTANT_URL=http://127.0.0.1:4318` 改用本地服务。

## 五行 Harness

规则越积越多，Agent 通常只会继续添加，很少主动发现旧规则已经和代码、测试或运行事实对不上。五行 Harness 把规则审查做成一个可安装 Skill：它读取工作区已有规则和相关证据，提出带替换文本、影响范围和可逆性的修改建议，等人批准后直接覆盖旧规则。

完整主张和范围见[产品文档](./docs/wuxing-harness-product.md)。

当前实现三条克线：

- **火克金**：执行结果推翻旧规则。直接矛盾发现一次就提出；规则仍自洽但反复造成阻碍时，积累多次证据再提出。
- **金克木**：人批准或拒绝方案，砍掉不合适的修改分支。
- **水克火**：新增定时任务、无人触发的自动行为或外部数据同步先停下来，说明影响后交给人判断。

安装 Skill 后，可以直接说“审一下这个工作区积累的规则”：

```powershell
Copy-Item -Recurse skills\wuxing-harness "$env:CODEX_HOME\skills\wuxing-harness"
```

Skill 的记录脚本会把待判断项保存在工作区 `.wuxing-harness/state.json`，只保存规则、证据和人的判断，不自行修改规则文件。批准后由 Agent 重新读取目标文件，直接覆盖旧描述并运行相应验证。

规则完成修改并通过验证后，Harness 会把结果转换为成就事件。成就系统只增加进度并接收 Agent 的证据申请，不会自动颁奖；申请会出现在桌面助手的「等待认可」里。人授予或拒绝后，结果会在 Agent 下一次读取成就上下文时出现。找出很多问题、扫描很多文件都不算成就，闭环只奖励已经得到批准并验证过的改进。

本地体验规则审查 Demo：

```bash
npm install
npm run build --workspace=@agent-achievements/wuxing-assistant
npm run wuxing
```

打开 `http://127.0.0.1:4318`。演示使用三项来自真实工作区的规则问题：语义漂移、浏览器验收条件过宽、自动补齐历史数据越过产品判断。公开 SPA 只展示同一闭环，不读取访客本机文件，也不需要模型 API Key。

这次没有实现完整的非阻塞任务队列、木克土、土克水和旺衰诊断。它们属于后续研究，不算进当前能力。

右下角状态灯区分三种生命周期：绿色表示 Agent 正在工作，琥珀色表示本轮已结束、正在等待，灰色表示没有有效会话。Codex 可以安装官方生命周期 hook 适配器，自动在每轮开始、工具进展、停止和会话结束时更新状态：

```powershell
node skills/use-agent-achievements/scripts/install-codex-hooks.mjs
```

安装后在 Codex `/hooks` 中审核并信任该 hook。它只写入规范化 presence，不读取对话正文，也不把 presence 算作成就证据。

整个五行助手都可以操作：短按展开成就面板，移动超过阈值后进入拖动。靠近屏幕左、右或上边缘时，它会自动吸附并缩回，保留足够醒目的可见部分；底部不会触发吸附。鼠标移上去时助手重新探出，吸附位置会跨重启保存。展开与关闭面板不会改变原来的位置。

图鉴分为“系统发现”和“我的成就”。首次结算会请求 Agent 检查已经安装的 Skill、项目规则以及提交、测试、决策记录等真实证据。安装 Skill 本身不算成就；只有 Skill 已经帮助用户产生正向改变才会被记录。高可信铜牌和银牌由桌宠的结算策略自动授予，中可信发现和所有金牌仍需人确认，同一证据只能结算一次。

面板中的“编辑成就”管理用户创建的成就：人可以新建或修改铜、银、金徽章，配置达成事件、目标次数、鼓励和不可越过的边界，也可以从图鉴或追踪列表随时切换追踪状态。修改会保留成就 ID 和已有进度。系统发现成就保留原始 Skill、授予理由和证据，不允许伪装成人工创建的目标。

如果人还没想好成就规则，可以在同一面板写下想鼓励的行为并“委托 Agent 设计”。请求会以严格 Schema 进入共享队列；任意安装了 Skill 的 Agent 都能读取请求、提交规范化草案。草案载入编辑器后仍由人修改并保存，因此 Agent 负责辅助设计，不获得创建或颁奖权限。

窗口和文字使用系统的 DIP 缩放，并在显示器缩放比例变化时重新计算位置，适合多显示器和不同 Windows 缩放设置。

用户可以在详情面板选择自定义图片，也可以让 Agent 生成后安装：

```powershell
node skills/use-agent-achievements/scripts/achievement-cli.mjs avatar --input <图片路径>
```

支持 PNG、JPG、WebP、SVG（不超过 5 MB）；`avatar --reset` 恢复默认的五行像素助手。默认助手使用四帧 PNG 动画，Windows 托盘使用五个元素围成一圈的独立位图图标。

完整验证：

```powershell
npm run validate
```

## Agent 侧接口

日常任务中的成就接口刻意只向 Agent 暴露三个动作：

1. `achievements_get_context`：任务开始时获取相关成就上下文；
2. `achievements_report_event`：上报有意义、可观察的工作事件；
3. `achievements_submit_claim`：只有事件响应明确标记为可申请时，才提交证据。

另外提供独立的 `presence` 生命周期信号，只负责告诉桌面伴侣 Agent 是否在线，不参与成就计算。

当且仅当人从界面发起“帮我设计成就”请求时，Agent 还会在任务上下文中收到 `design_requests`，并可提交符合 `achievement-design-proposal.schema.json` 的草案。这是一条显式的人类委托，不是通用成就管理权限。

首次启动或人主动重新回顾时，Agent 还会收到 `diagnostic_requests`。Agent 只能提交带证据的历史成果报告；是否自动授予由桌宠的确定性结算策略决定。安装、调用次数和无法核验的自述都不会产生积分。

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
