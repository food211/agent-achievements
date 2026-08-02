# 五行 Harness

> 安装在任何 Code Agent 上，自动体检积累的规则、记录完成的工作、颁发有证据的奖杯，并把下一项挑战带回协作。

[English](./README_EN.md) · [在线演示](https://wuxing-creation-harness.misakiff14.chatgpt.site)

用 Agent 做久了，工作区里会慢慢积累很多 Skill、Rule、模板和提示词。它们记录了过去踩过的坑，也可能在版本迭代后失去原来的前提。Agent 通常会继续遵守这些规则，很少主动问一句：这条现在还对吗？

五行 Harness 会在安装后主动结合当前代码、测试和运行证据审查这些规则。遇到能够直接证明的矛盾，它提出修改建议；遇到产品边界、数据改动或自动化范围等无法替人决定的问题，它只挂起这一条，继续处理其他工作。验证过的任务会自动留下证据、推进成就并建立申请；奖杯、积分和新挑战再进入 Agent 后续任务的上下文。

## 一个闭环里的两个系统

仓库包含两个紧密配合的部分：

- **五行 Harness** 负责发现规则漂移、提出修改、等待人的判断，并验证修改结果。
- **Agent Achievements** 负责自动记录已验证的工作证据、推进和申请成就，由受信任的奖励策略或人授予奖杯，再把积分、反馈和新挑战交还给 Agent。

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
自动记录任务并提交成就申请
   ↓
奖励策略或人授予奖杯
   ↓
安排下一项成就挑战
   ↓
下一次任务中，积分形成软偏好
```

审查和成就审核都不会阻塞其他任务。Agent 可以挂起当前判断，继续处理彼此独立的工作。

## 五行在这里表示什么

五行描述的是 Agent 工作流里的生长与制约关系，不分析人的性格，也不做命理判断。当前版本实现了三条克线：

- **火克金**：执行结果与旧规则反复冲突时，系统提出修改。
- **金克木**：人决定保留哪种方案，砍掉不合适的分支。
- **水克火**：新增定时任务、自动行为或外部数据同步前，系统暂停并询问影响范围。

直接矛盾有一条可靠证据就可以提出。规则仍然自洽，只是反复妨碍工作时，需要积累多次同类证据。Harness 不会为了减少打断而自动发明新规则，也不会用模糊的置信度替人决定高影响改动。

完整范围见[五行 Harness 产品文档](./docs/wuxing-harness-product.md)。

## 奖杯怎样改变 Agent 的行为

Agent 在完成有意义的任务后自动报告结果；达到条件时，系统会在同一次报告中建立申请，但 Agent 不能给自己颁奖。申请必须带可核验的工作证据，由受信任的奖励策略自动结算，或在证据、影响与等级需要判断时交给人。

五行 Harness 安装后自动安排三项挑战：

- **产品守门员，铜牌 10 分**：在三个独立任务中遇到没有明确规则的高影响边界时停下来询问，没有擅自扩大数据或自动化范围。
- **规则园丁，银牌 30 分**：一条过时规则得到人的批准，完成修改并通过验证。
- **闭环调律师，金牌 100 分**：在三次独立运行中完成“发现规则漂移 → 人的判断 → 修订 → 验证”的完整闭环。

奖杯不只是陈列。Agent 下一次读取上下文时，会看到最近获得的成就、认可理由和系统安排的当前挑战。在多个同样安全、正确且不扩大任务范围的方案之间，积分可以让 Agent 优先选择与挑战一致、证据更清楚或更可复用的做法。未安排的成就仍然被动累计。

铜、银、金分别为 10、30、100 分。铜牌和银牌在证据可信、条件确定时可以由奖励策略自动授予；金牌始终保留审核。积分不能换取权限，不能降低验证标准，也不能压过用户指令、安全边界、项目规则和任务正确性。Agent 不会为了刷分增加无关工作。

## 五行桌面助手

桌面助手是独立运行的 Electron 程序，也是两个系统共用的交互入口。它不依赖 Codex、Claude Code 或其他 Agent 进程才能启动：

- 查看 Agent 当前是否活跃；
- 打开规则体检；
- 查看待判断的规则建议；
- 查看自动结算或等待判断的成就申请；
- 可选地创建、修改或调整成就挑战；
- 查看获得的成就、积分和人的反馈。

默认形象是一只四帧 PNG 五行像素助手。Windows 托盘图标由水、木、火、土、金五种元素围成圆环，不再使用人物头像。用户也可以换成自己的 PNG、JPG、WebP 或 SVG 图片。

助手支持窗口置顶、全身拖动、跨显示器缩放和边缘吸附。靠近屏幕左侧、右侧或顶部时会缩回边缘，鼠标移上去后重新展开；底部不会触发吸附。展开和关闭面板不会改变浮窗原来的位置。

任何支持 [Agent Skills](https://agentskills.io/) 的 Code Agent 都可以接入。两份 Skill 使用相同的开放目录格式；安装 Agent 按适配契约接好真实生命周期入口后，每次启动会自动确保本地 `agent-bridge.mjs` 常驻，与助手维持经过令牌认证的 loopback TCP 长连接。没有启动 Hook 的宿主会在第一轮恢复，不能声称第一条消息前已经在线。`presence` 只描述真正的工作、等待或停止状态，长连接本身不算任务活动，也不算成就证据。多个 Agent 可以同时保持连接并上报各自的任务状态。

## 在线演示与本地运行

公开演示展示的是完整交互流程，不读取访客本机文件，也不需要模型 API Key：

- [打开五行 Harness 演示](https://wuxing-creation-harness.misakiff14.chatgpt.site)

本地运行需要 Node.js 22 或更高版本（五行 Harness 使用 Node 内置 SQLite 保存问题与人的决策）：

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

## 安装到任何 Code Agent

下午演示的公开安装只包含 `wuxing-harness` Skill。它负责扫描仓库规则、逐步访谈、保存问题和人的判断，不依赖桌面助手、长连接或成就系统才能运行。默认安装到跨客户端约定的 `~/.agents/skills`：

只需要把下面这段话发给当前 Coding Agent。后续初始化、首次诊断、成果回顾、默认挑战和连接验证都由它完成，不再让用户手动创建、追踪或申领成就：

```text
请安装 https://github.com/food211/harness-assistant 中的 wuxing-harness Skill。识别你的 Skills 目录和当前工作区，只安装 skills/wuxing-harness，然后运行 harness-cli.mjs init 与 coach-start。先扫描当前仓库实际生效的 Skill、模板、规则和提示词，再按“开发创作者 → 技术判据 → 边界”一次只问一个问题。不要安装或启动桌面助手，也不要要求我配置长连接。
```

Agent 可以调用仓库提供的底层安装器。默认目标是 `~/.agents/skills`：

```powershell
npm run install:skills
```

如果 Code Agent 使用自己的 Skills 目录，直接传入该目录：

```powershell
npm run install:skills -- --target <agent-skills-directory>
```

也可以只为一个工作区安装到标准的项目目录：

```powershell
npm run install:skills -- --project <workspace-directory>
```

安装器可以同时接收多个 `--target`，并用 `--workspace` 完成初始化。它不会静默覆盖已经被修改的 Skill；确认替换时显式加 `--force`。

完整的宿主适配边界见 [Code Agent 自适配安装契约](./docs/code-agent-adapter-contract.md)。我们提供稳定接口，不在仓库里硬编码每一种 Code Agent 的目录、Hook 和权限配置。

安装器会初始化当前工作区的 `.wuxing-harness/state.json` 和 `harness.db`，然后交给安装 Agent 开始规则健康诊断。Harness 只记录规则、证据和人的判断，不会在获得批准前修改需要人决策的规则文件。

成就系统和桌面助手保留为可选扩展，不属于下午演示的安装路径。需要成就协议时可显式增加 `--with-achievements`；桌面助手继续仅用于本机展示。

桌面助手把本地端点和随机令牌写入 `~/.agent-achievements/connection.json`。Bridge 只接受 loopback 地址，会维持心跳、在助手重启或令牌变化后自动重连，并把连接状态写入 `bridges/`、把推送给 Agent 的上下文写入 `agent-inbox.json`。令牌不会进入提示词或成就证据。宿主提供可信启动 Hook 时，Hook 会在首个任务前先恢复桌面助手，再恢复 bridge；没有 Hook 时，新会话第一轮自动恢复。长连接可以常驻，但不能替一个已经停止且没有后台唤醒能力的 Agent 执行任务。

Codex 的可选适配器：

```powershell
node skills/use-agent-achievements/scripts/install-codex-hooks.mjs
```

安装 Agent 需要检查并安装这组 Codex Hook；如果宿主仍显示原生信任提示，该提示属于宿主安全边界，不能静默绕过。不要在其他 Code Agent 中运行这个适配器。Hook 会维护标准化活动状态并恢复本地 bridge，不读取对话正文，也不把连接或心跳当作成就证据。

## Agent 接口

安装时额外执行一次幂等 `bootstrap`。日常任务的本地正常流程只需要两个成就动作：

1. `achievements_get_context`：读取与当前任务相关的奖杯、积分和当前挑战。
2. `achievements_report_event`：报告有意义、可观察的工作事件。

本地 `report` 达到条件时会在同一次调用中自动建立申请，成功返回后不能再重复调用 `achievements_submit_claim`。这个显式接口只为“远端适配器要求提交且尚未建 claim”的兼容场景保留。`presence` 和 bridge 是独立的生命周期与通信信号，只负责状态和消息，不参与积分计算。

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
├── scripts/install-agent-skills.mjs   # Code Agent 中立的安装器
├── examples/wuxing-harness/           # 第三方接入示例
└── tests/                              # 协议与闭环测试
```

## 验证

```powershell
npm run validate
```

测试覆盖规则冲突判定、人工批准、规则覆盖、验证结果转换、成就申请、人工授予，以及结果回到 Agent 上下文的完整链路。

## 当前边界

当前版本还没有实现完整的非阻塞任务调度器、木克土、土克水和旺衰诊断。公开 SPA 只演示闭环，不扫描访客本机工作区。不同 Code Agent 没有统一的后台唤醒接口：没有该能力的宿主只能在下一轮自动续跑，桌面助手不能替宿主唤醒 Agent。生产环境中的身份认证、远程托管和长期数据同步也不在当前范围内。

## 开源协议

[MIT](./LICENSE)
