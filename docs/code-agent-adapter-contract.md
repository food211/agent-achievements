# Code Agent 零手工适配契约

这份文档是给执行安装的 Coding Agent 看的，不是让用户照着配置。安装请求本身授权当前 Agent 在用户指定范围内安装两份 Skill、初始化本地状态并完成可用的宿主适配。安装结束后，用户不应再被要求手动初始化、创建成就、选择追踪目标或提交申请。

五行助手提供通用 Skill、CLI、JSON Schema 和本地状态目录。宿主差异由当前安装 Agent 识别并通过能力声明适配，不要把 Codex、Claude Code、Cursor、OpenCode 或其他产品的内部机制写进通用协议。

## 完成标准

安装任务只有同时满足下列条件才算完成：

1. 宿主可以在后续任务中加载 `wuxing-harness` 与 `use-agent-achievements`。
2. `bootstrap` 已初始化成就状态、内置五行挑战和当前工作区 Harness 状态。
3. Bootstrap 返回的四个动作均已识别：桌面助手常驻、Agent 长连接、首次五行规则诊断、首次成果回顾。
4. 桌面助手与当前 Agent 的 `agent-bridge.mjs` 已按动作提供的检测和启动参数运行；bridge 达到 `connected`，并能在助手重启或令牌轮换后自动重连。
5. 宿主启动时会自动探测并恢复 bridge；有启动 Hook 时在首个任务前执行，没有 Hook 时在第一轮开始自动执行，不要求用户打开终端。
6. 后续任务会自动读取成就上下文、记录有意义的完成结果、让本地 `report` 自动建立申请，并接收新的挑战。
7. 能力声明与宿主实际能力一致；bridge 常驻不被伪装成 Agent 后台唤醒能力。

## 安装流程

1. 识别当前工作区、稳定的 Agent ID、宿主 runtime ID，以及宿主实际扫描的 Skills 或规则目录。
2. 探测下列能力，只声明真实存在且可安全使用的项：
   - `agent-skills`：原生读取开放 Agent Skills 目录；
   - `task-boundary`：能在每个 Agent 轮次开始和结束执行 Skill 指令；
   - `lifecycle-hook`：宿主提供受信任的会话生命周期 Hook；
   - `post-task-event`：宿主能在任务完成后提供规范化事件；
   - `background-wake`：宿主明确支持在没有新用户消息时唤醒 Agent。
   - `prompt-injection`：宿主适配器可以把长连接收到的 `prompt_request` 作为新的用户提示词送入指定工作区会话，并返回投递回执。
3. 把两份 Skill 安装为相邻目录。原生支持 Agent Skills 时优先使用跨客户端目录 `~/.agents/skills`，否则使用宿主能读取的目录，并在宿主原生规则中建立一个最小桥接：每轮加载两份 `SKILL.md`，执行其中的任务边界循环。宿主桥接留在用户自己的 Agent 配置中，不写回通用 Skill。
4. 从仓库根目录运行安装器。当前 Agent 应自己填写参数，不让用户替它判断：

   ```powershell
   node scripts/install-agent-skills.mjs --target <skills-directory> --workspace <workspace> --agent <stable-agent-id> --runtime <runtime-id> --capability agent-skills --capability task-boundary
   ```

   项目级标准目录可以使用：

   ```powershell
   node scripts/install-agent-skills.mjs --project <workspace> --agent <stable-agent-id> --runtime <runtime-id> --capability agent-skills --capability task-boundary
   ```

5. 安装器会自动调用幂等 `bootstrap`，再初始化相邻的 Wuxing Harness。读取输出中的 `agent_next_actions`，在同一轮执行：
   - `ensure_companion_running`：按动作提供的检测方式确认桌面助手是否运行；需要时从仓库或已安装程序脱离终端启动；
   - `ensure_agent_bridge`：先检查 `detection` 指向的状态文件；未连接时按原样执行 `bridge_command.program`、`bridge_command.args` 和 `bridge_command.cwd`，使用 `shell: false` 并脱离当前终端；
   - `run_wuxing_diagnostic`：检查当前规则与代码、测试、运行证据是否一致，只提交证据充分的发现；
   - `diagnose_past_achievements`：回顾已经发生的正向成果，提交证据，供奖励策略结算。
6. 直接读取已安装的 `SKILL.md` 验证内容，不必等待宿主重启索引才完成当前轮。若宿主只能在下次会话重载 Skill，保留 bootstrap 队列，下一轮自动续做。
7. 每个动作成功后调用 `action-complete --action <action-id> --summary <observable-result>`；失败或无法执行的动作保持 pending，不能为了看起来完成而关闭。

底层安装器在仍有动作时返回 `activation_complete: false` 和 `pending_agent_action_count`。这表示工作交还给安装 Agent，并不表示要用户接手；安装 Agent 只有在 bridge 实际连接、其余动作完成或被诚实保留后，才能报告安装结果。当前源码分发从仓库内的绝对 Node 启动脚本拉起桌面助手，仓库必须保留到正式桌面程序安装完成。

## 启动时的长连接适配

安装 Agent 必须把“确保 bridge 存活”接到宿主能够提供的最早安全生命周期点：

- 有受信任启动 Hook：Hook 在首个任务前先按保存的命令恢复桌面助手，再探测并恢复 `bridge_command`；两者都同时检查状态时间和记录的 PID。进入第一轮后，Agent 再幂等运行 `bootstrap` 刷新动作与能力记录。
- 只有 Agent Skills / Rule：在每个新进程或会话的第一轮，加载本 Skill 后先执行同样的探测与恢复，再处理任务。
- 宿主没有任务前执行能力：不能宣称首条消息前已经在线，但必须在首轮自动恢复，不能把启动命令交给用户。

每个 Agent ID 只有一个 bridge 实例；脚本自带锁和陈旧锁恢复。桌面助手也会读取 bootstrap 保存在 adapter 状态中的 `bridge_command`，发现状态过期时监督恢复。不要在 Hook 里自行拼接令牌或端口，也不要使用 `shell: true`。

桌面助手在 `AGENT_ACHIEVEMENTS_HOME/connection.json` 发布仅限 loopback 的 TCP 地址和随机令牌。Bridge 读取该文件、完成首帧认证、维持心跳，并在连接断开后有界退避重连；助手重启产生新端口或新令牌时，bridge 会重新读取发现文件。令牌不得写进提示词、日志、成就证据或远程请求。

以下文件用于本地协调：

- `connection.json`：助手发布的本地端点与认证令牌；
- `bridges/<agent-hash>.json`：bridge 的 `connected`、`reconnecting` 或 `stopped` 状态及进程 PID；
- `agent-inbox.json`：助手推送给 Agent 的规范化上下文与待办动作，不含令牌。

长连接只证明通信通道可用。真实工作状态仍由 `presence` 的 `active`、`idle`、`stopped` 表示；socket 心跳、在线时长、启动 bridge 和启动桌面助手都不能成为成就证据。

### 提示词注入

助手可以通过已认证长连接发送 `prompt_request`。请求必须包含目标 `agent_id`、绝对 `workspace`、受限 `intent` 和不超过 4000 字的提示词。Bridge 只有在安装时绑定了真实宿主适配器时才能声明 `capabilities.prompt_injection`，并必须返回 `prompt_ack`：

- `accepted`：已可靠写入宿主队列；
- `delivered`：已进入目标 Agent 会话；
- `failed`：适配器尝试后失败；
- `unsupported`：当前连接不能注入提示词。

不能把写入普通文件伪装成 `delivered`。Codex 适配器使用受信任的 `Stop` Hook：Bridge 先按仓库保存请求，当前回合结束时 Hook 用 continuation prompt 把它作为新的用户提示词送入同一仓库会话，不连接或复用其他产品的 app-server。没有实时注入能力的宿主保留请求，等宿主下一次安全任务边界消费。

已有安装被修改时，安装器会停止。只有安装请求明确包含替换现有版本的授权，或当前 Agent确认这些只是旧版安装文件时，才使用 `--force`。不要覆盖用户自己改过的 Skill。

## 每轮自动循环

后续每个 Coding Agent 任务按同一套循环运行，不要求用户主动提起五行或成就：

1. 确认 bridge 状态仍新鲜，必要时自动恢复；写入 `active` presence，并读取当前任务的成就上下文。
2. 先完成用户任务。当前挑战和积分只能在多个同样正确、安全、范围相同的方案之间提供软偏好。
3. 任务完成、失败或挂起时，报告一个规范化事件和实际验证中产生的证据。不要把每个工具调用都算成任务。
4. 本地 `report` 在达到条件时自动建立申请，不再重复调用 `claim`；只有远端适配器明确返回尚未创建的 `submit_claim` 动作时才使用兼容接口。Agent 不自行授予奖杯。
5. 接收奖励策略安排的新挑战，并在以后相关任务中自然推进。不要为了追分扩大当前任务。
6. 将 session 标记为 `idle` 或 `stopped`。

积分与奖杯不能换取权限，不能降低安全和验证标准，也不能压过用户指令、项目规则与正确性。它们只影响低风险的行为偏好，例如在本来就需要验证时优先留下更清晰的证据，或在等价方案中优先选择更可复用的做法。

## 通用命令

所有宿主都调用同一组命令：

```powershell
node <skill-path>/scripts/achievement-cli.mjs bootstrap --agent <agent-id> --runtime <runtime-id> --workspace <workspace> --capability <capability>
node <skill-path>/scripts/agent-bridge.mjs --agent <agent-id> --runtime <runtime-id> --session <stable-bridge-session-id>
node <skill-path>/scripts/achievement-cli.mjs presence --agent <agent-id> --session <session-id> --runtime <runtime-id> --status active|idle|stopped --task-id <task-id> --summary <summary>
node <skill-path>/scripts/achievement-cli.mjs context --agent <agent-id> --task-id <task-id> --task-type <type> --summary <summary> --risk <risk> --format markdown
node <skill-path>/scripts/achievement-cli.mjs report --input <event.json>
node <skill-path>/scripts/achievement-cli.mjs claim --input <claim.json>
```

公开载荷以 `packages/protocol/schemas/` 中的 JSON Schema 为准。`runtime.id` 使用宿主自己的稳定标识，不要伪装成其他产品。默认状态目录为 `~/.agent-achievements`；设置 `AGENT_ACHIEVEMENTS_HOME` 可以隔离不同配置。

## 能力降级

| 宿主能力 | 自动化方式 | 明确限制 |
|---|---|---|
| 有生命周期 Hook 与任务事件 | 启动 Hook 探测并恢复 bridge；任务 Hook 负责 presence 和规范化边界；Skill 负责上下文与证据 | Hook 失败必须放行主任务并保留待办 |
| 只有 Agent Skills 或原生规则 | 新会话第一轮恢复 bridge，每个 Agent 轮次按 Skill 自动执行完整循环 | 第一条用户消息前无法执行代码 |
| 没有原生 Agent Skills | 当前安装 Agent 建立最小宿主规则桥接，仍调用同一 CLI | 不能假装 Skill 已被原生发现 |
| 没有 `background-wake` | 待办动作持久化，下一轮自动续做 | 不能主动唤醒 Agent，也不能承诺实时处理 |
| 有 `prompt-injection` | 助手按钮可向选中的仓库会话发送规范化提示词，并等待 `prompt_ack` | 只允许投递到用户选择的工作区；不能绕过宿主权限和审批 |

没有统一 Hook 并不妨碍任务内自动化。`agent-bridge.mjs` 可以常驻并保持通信通道，但不能替一个已经停止且没有唤醒接口的 Agent 执行新任务。桌面助手是独立进程，可以开机常驻、监督 bridge、显示状态和奖杯；通用安装器不会假装拥有跨平台 GUI 安装能力，也不会在测试或非交互环境默认拉起 Electron。

## 禁止事项

- 不读取或复制完整对话正文，只保存任务摘要和证据引用。
- 不监听特定产品的进程名判断 Agent 是否在线。
- 不把 presence、安装动作、工具调用量或自我描述当作成就证据。
- 不让 Agent 调用审核接口给自己颁奖。
- 不为追求积分扩大任务、绕过审批或修改安全设置。
- 不把“bridge 已连接”冒充“Agent 正在工作”或“Agent 可被后台唤醒”。
- 不为伪装“零手工”而静默覆盖用户修改或启用未获信任的宿主 Hook。
