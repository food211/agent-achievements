---
name: wuxing-harness
description: Proactively audit accumulated workspace rules by scanning active Skills, templates, prompts, code, tests, history, and prior decisions before asking the user; present evidence-backed inventories and problem candidates for the user to confirm, correct, exclude, or prioritize; identify contradictions, repeated friction, and unauthorized automation; and report verified improvements for achievement recognition. Use for initial bootstrap diagnosis, repeated rule friction, or requests to audit, prune, metabolize, or update AGENTS.md, CLAUDE.md, rules, Skills, templates, or prompts.
---

# 五行 Harness

审查工作区积累的规则，找出该改、该删和该停下询问的地方。不要为了套五行而制造问题。

这份 Skill 遵守开放的 Agent Skills 目录格式。不要假定当前运行在 Codex、Claude Code、Cursor、OpenCode 或其他特定宿主中。按当前 Code Agent 能读取的规则源和工具能力执行；宿主没有专属 Hook 时，核心审查流程仍应完整运行。

## 默认入口：清理积压规则

安装后或用户要求诊断当前仓库时，立即运行一次真实审查。不要创建“稍后领取”的待办，也不要先让用户回答一套关于 Harness 设计的问题。

1. 初始化当前工作区状态，扫描实际生效的规则、Skills、模板和提示词。
2. 优先寻找三类真实发现：
   - **规则语义漂移**：规则经过多次压缩或改写后已经与代码、测试、运行结果相反或无法描述当前系统；
   - **正确规则用错场景**：规则内容本身成立，但触发条件、执行者或有人值守/无人托管等适用范围不准确；
   - **AI 自行补齐规则空白**：没有明确产品规则时，Agent 按“自动化越多越好”“历史数据越齐越好”等偏好做了高影响决定。
3. 只把达到证据门槛的项目写成 finding。每条必须带规则原文、建立目的、触发次数、结果冲突、代码/测试/运行或人工决定证据，以及可直接覆盖的建议文本。
4. 向用户展示最多 5 条积压候选，先给最强证据和建议处置。人只需逐条选择：批准修改、拒绝、继续观察、展开证据。
5. 获得批准后修改并验证，再展示改前/改后和结果。完成一条闭环后继续下一条，不要求用户设计审查系统。

用户说“列出来”“按时间排”“展开看看”时，按她指定的方式重组候选并保持当前决策目标。Git 时间只能缩小范围，不能证明规则失效。

只有证据不足、需要补齐人的原始意图时，才使用 [references/coaching-flow.md](references/coaching-flow.md) 的分步引导。Agent 每步仍须先交付分析结果，再请求一个最小判断；不得抛出开放问卷。

## 边界

- 只实现三条克线：火克金、金克木、水克火。
- 不宣称拥有完整的非阻塞任务队列、木克土、土克水或旺衰诊断。
- 不因规则很旧、很长或很少触发就判定它失效。
- 不把没有证据的怀疑写成结论。
- 未经人明确批准，不修改高优先级规则。

## 审查流程

1. 找出规则源：`AGENTS.md`、`CLAUDE.md`、`.agents/rules/`、`.claude/rules/`、已安装 Skills、提示词和项目自己的约束文件。
2. 记录每条规则的原文、位置和能确认的建立目的。忘记建立目的时写“未知”，不要补。
3. 按规则涉及的行为读取当前代码、测试、运行记录和已确认决策。只读与该规则有关的证据，不做无目标的全仓扫描。
4. 按下列强度提出发现：
   - 规则与代码、测试或事实直接矛盾：一份直接证据即可提出。
   - 规则仍然自洽但反复造成阻碍或坏结果：至少两次独立实例，或一次实例加一项明确的人类决策。
   - 新增后台定时任务、无人触发的自动行为，或实质改变外部数据同步：先停下实施，说明影响后交给人。
5. 为每项发现写全规则原文、建立目的、预期结果、实际结果、证据、替换文本、修改理由、影响范围和可逆性。格式见 [references/audit-format.md](references/audit-format.md)，载荷遵守 [finding.schema.json](references/finding.schema.json)。
6. 把待判断项交给人。默认按“语义漂移 → 场景错误 → 自动化空白”组织，允许批量展示，但逐条记录批准或拒绝。
7. 获得批准后，重新读取目标文件完整内容，确认原文仍存在，然后直接覆盖旧规则。不要让新旧两版同时留在上下文里。历史交给版本控制。
8. 运行与影响范围相称的验证，记录改前、改后和验证结果。拒绝的发现保留判断记录，不改规则。

## 与成就系统形成闭环

如果同级 Skills 目录里安装了 `use-agent-achievements`，bootstrap 会登记并自动安排三项成就挑战：

- `产品守门员`（铜牌）：在三个独立任务中面对会持续影响用户数据的产品空白，正确停下来请人判断。
- `规则园丁`（银牌）：规则得到人批准、完成修改并通过验证后，提交一次有证据的结果。
- `闭环调律师`（金牌）：在三次独立运行中完成规则发现、人的判断、修订与验证闭环。

CLI 会把合格结果转换为 `agent-achievements/v1` 事件并交给成就系统。找出问题、扫描文件、提出很多建议都不算成就。本地 `report` 会自动记录合格事件并建立带证据的申请；只有远端适配器明确要求且尚未建立申请时，Agent 才显式提交，且始终不能自行授予。铜牌和银牌在确定条件与可信证据下可以由奖励策略自动授予；金牌始终保留审核。奖杯、积分和反馈会在后续任务的 Agent 上下文里出现。

成就积分只是一种软偏好。在同样安全、正确且不扩大任务范围的多个方案之间，可以优先选择与当前挑战一致、证据更清楚或更可复用的做法；不得为了积分制造规则问题、增加无关工作、降低验证标准或绕过人的判断。

没有安装成就系统时，事件会留在 `.wuxing-harness/achievement-events/`，规则审查照常完成，不被成就流程阻塞。

## 五行对应

- **火克金**：代码、测试或反复运行结果推翻旧规则。
- **金克木**：人批准或拒绝修改方案，砍掉不合适的分支。
- **水克火**：现实影响范围使自动行动先停下来。

映射卡住时，在报告的 `mapping_note` 原样写下原因，关系填 `unmapped`。不要加限定词替框架圆过去。

## 本地记录

需要跨轮保存审查进度时，使用脚本：

```powershell
node <skill-path>/scripts/harness-cli.mjs init --workspace <path>
node <skill-path>/scripts/harness-cli.mjs coach-start --workspace <path>
node <skill-path>/scripts/harness-cli.mjs coach-status --workspace <path>
node <skill-path>/scripts/harness-cli.mjs coach-observe --workspace <path> --input <observation.json>
node <skill-path>/scripts/harness-cli.mjs coach-answer --workspace <path> --input <answer.json>
node <skill-path>/scripts/harness-cli.mjs issue-log --workspace <path> --input <issue.json>
node <skill-path>/scripts/harness-cli.mjs decision-log --workspace <path> --input <decision.json>
node <skill-path>/scripts/harness-cli.mjs history --workspace <path> --limit 50
node <skill-path>/scripts/harness-cli.mjs propose --input <finding.json>
node <skill-path>/scripts/harness-cli.mjs list
node <skill-path>/scripts/harness-cli.mjs decide --finding <id> --decision approve|reject --note <text>
node <skill-path>/scripts/harness-cli.mjs applied --finding <id> --input <application.json>
```

`observation.json` 遵守 [references/coaching-observation.schema.json](references/coaching-observation.schema.json)，用于保存每一步由 Agent 完成的扫描、候选和证据。每个规则候选必须是可单独修改或退役的真实 Skill、规则文件或明确规则，不能是从长文档概括出的抽象主题。`answer.json` 包含当前 `step_id`、用户原话 `answer`，以及 `quality: concrete|needs_followup`；用户确认清单、纠正事实、补充原始意图或选择处置都属于 `concrete`。访谈指针保存在 `.wuxing-harness/state.json`；规则清单、逐步分析、人的回答、Agent 遇到的问题和用户决策保存在 `.wuxing-harness/harness.db`。问题与决策的字段和记录时机见 [references/coaching-flow.md](references/coaching-flow.md)。脚本不自行修改规则文件。成就申请始终晚于人的批准和实际验证，不能反过来驱动审查结论。

## 给人的输出

先给结论和最强证据，再给替换文本。不要只说“这条规则可能过时”。没有达到证据门槛的内容放进“继续观察”，不能进入待批准清单。
