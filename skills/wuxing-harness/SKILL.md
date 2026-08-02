---
name: wuxing-harness
description: Audit accumulated workspace rules from any Agent Skills-compatible Code Agent against current code, tests, artifacts, and run evidence; identify direct contradictions, repeatedly harmful rules, and unauthorized automation; prepare evidence-backed replacements for human approval; overwrite approved rules; and report verified improvements for human recognition. Use when a user asks to audit, prune, metabolize, update, or check whether AGENTS.md, CLAUDE.md, rules, Skills, prompts, or long-running Agent constraints are stale, drifting, over-broad, or blocking work.
---

# 五行 Harness

审查工作区积累的规则，找出该改、该删和该停下询问的地方。不要为了套五行而制造问题。

这份 Skill 遵守开放的 Agent Skills 目录格式。不要假定当前运行在 Codex、Claude Code、Cursor、OpenCode 或其他特定宿主中。按当前 Code Agent 能读取的规则源和工具能力执行；宿主没有专属 Hook 时，核心审查流程仍应完整运行。

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
6. 把待判断项交给人。允许批量展示，但逐条记录批准或拒绝。
7. 获得批准后，重新读取目标文件完整内容，确认原文仍存在，然后直接覆盖旧规则。不要让新旧两版同时留在上下文里。历史交给版本控制。
8. 运行与影响范围相称的验证，记录改前、改后和验证结果。拒绝的发现保留判断记录，不改规则。

## 与成就系统形成闭环

如果同级 Skills 目录里安装了 `use-agent-achievements`，`harness-cli.mjs init` 会登记两项成就：

- `规则园丁`：规则得到人批准、完成修改并通过验证后，才提交一次申请。
- `产品守门员`：面对会持续影响用户数据的产品空白，正确停下来请人判断三次后，才提交申请。

CLI 会把合格结果转换为 `agent-achievements/v1` 事件并交给成就系统。找出问题、扫描文件、提出很多建议都不算成就。Agent 只能提交带证据的申请，不能自行授予。人授予或拒绝后，结果会在后续任务的 Agent 成就上下文里出现。

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
node <skill-path>/scripts/harness-cli.mjs propose --input <finding.json>
node <skill-path>/scripts/harness-cli.mjs list
node <skill-path>/scripts/harness-cli.mjs decide --finding <id> --decision approve|reject --note <text>
node <skill-path>/scripts/harness-cli.mjs applied --finding <id> --input <application.json>
```

记录默认保存在当前工作区 `.wuxing-harness/state.json`。脚本只保存判断和证据，不自行修改规则文件。成就申请始终晚于人的批准和实际验证，不能反过来驱动审查结论。

## 给人的输出

先给结论和最强证据，再给替换文本。不要只说“这条规则可能过时”。没有达到证据门槛的内容放进“继续观察”，不能进入待批准清单。
