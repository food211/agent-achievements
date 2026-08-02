---
name: wuxing-harness
description: Audit accumulated AI workspace rules against current code, tests, artifacts, and run evidence; identify direct contradictions, repeatedly harmful rules, and unauthorized automation; prepare evidence-backed replacement proposals for human approval; then overwrite approved rules and record the result. Use when a user asks to audit, prune, metabolize, update, or check whether AGENTS.md, CLAUDE.md, rules, Skills, prompts, or long-running Agent constraints are stale, drifting, over-broad, or blocking work.
---

# 五行 Harness

审查工作区积累的规则，找出该改、该删和该停下询问的地方。不要为了套五行而制造问题。

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

记录默认保存在当前工作区 `.wuxing-harness/state.json`。脚本只保存判断和证据，不自行修改规则文件。

## 给人的输出

先给结论和最强证据，再给替换文本。不要只说“这条规则可能过时”。没有达到证据门槛的内容放进“继续观察”，不能进入待批准清单。
