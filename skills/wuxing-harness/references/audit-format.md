# 审查记录格式

每项发现使用以下结构。公开字段保持严格，不添加临时顶层字段；额外信息放进 `extensions`。

```json
{
  "schema_version": "wuxing-harness/v1",
  "finding_id": "finding-browser-context",
  "kind": "direct_conflict|repeated_friction|automation_boundary",
  "relation": "fire_overcomes_metal|metal_overcomes_wood|water_overcomes_fire|unmapped",
  "mapping_note": "映射自然时留空；卡住时原样写原因",
  "title": "一句具体结论",
  "rule": {
    "path": ".claude/rules/example.md",
    "locator": "标题或行定位",
    "text": "当前规则原文",
    "rationale": "能确认的建立目的，未知则写未知"
  },
  "expected_outcome": "规则原本希望带来的结果",
  "observed_outcome": "当前代码、测试或运行实际发生的事",
  "trigger_count": 3,
  "contradiction_count": 2,
  "evidence": [
    {
      "type": "code|test|run|decision|artifact",
      "ref": "可重新定位的文件、测试、运行或决策引用",
      "summary": "这项证据具体证明什么"
    }
  ],
  "proposal": {
    "replacement": "批准后直接覆盖旧规则的完整文本",
    "reason": "为什么这样改",
    "impact_scope": "会影响哪些任务、数据或 Agent 行为",
    "reversibility": "如何恢复，以及恢复成本"
  },
  "extensions": {}
}
```

## 证据门槛

| kind | 最少证据 | 补充要求 |
|---|---:|---|
| `direct_conflict` | 1 | 必须能直接定位到与规则矛盾的代码、测试或事实 |
| `repeated_friction` | 2 | 两次独立实例，或一次实例加一项明确的人类决策 |
| `automation_boundary` | 1 | 必须说明可能改动的数据范围和为什么不能自行决定 |

批准后的应用记录：

```json
{
  "schema_version": "wuxing-harness/v1",
  "path": ".claude/rules/example.md",
  "before": "覆盖前的完整规则文本",
  "after": "覆盖后的完整规则文本",
  "validation": ["重新读取目标文件", "相关测试通过"]
}
```
