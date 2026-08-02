# Code Agent 自适配安装契约

这份文档交给准备安装五行助手的 Coding Agent。宿主自己识别安装位置和生命周期能力，五行助手只提供通用 Skill、CLI、JSON Schema 和本地数据目录。

## 安装目标

完成后，当前 Code Agent 应当能够：

1. 发现并读取 `wuxing-harness` 与 `use-agent-achievements` 两份 Skill；
2. 在任务开始时读取成就上下文；
3. 用通用 `presence` 心跳更新桌面助手状态；
4. 报告有证据的事件，并在满足条件时提交成就申请；
5. 在没有宿主专属 Hook 时仍能完成以上动作。

桌面助手是独立进程，不应由适配器启动、关闭或探测。双方只通过 `~/.agent-achievements` 中的规范化状态通信。设置 `AGENT_ACHIEVEMENTS_HOME` 可以改用其他数据目录。

## Agent 应当怎样安装

1. 识别当前宿主实际扫描的用户级或项目级 Skills 目录。优先使用跨客户端目录 `~/.agents/skills`；宿主有明确原生目录时也可以使用。
2. 从仓库根目录运行安装器，把两份 Skill 安装到同一个 Skills 根目录：

   ```powershell
   node scripts/install-agent-skills.mjs --target <skills-directory>
   ```

   项目级安装可以使用：

   ```powershell
   node scripts/install-agent-skills.mjs --project <workspace-directory>
   ```

3. 重新载入宿主的 Skills 索引，确认两份 `SKILL.md` 都能被发现。
4. 运行 `use-agent-achievements/scripts/achievement-cli.mjs init`，不要创建宿主专属的数据副本。
5. 用一个临时会话依次发送 `active`、`idle`、`stopped`，确认桌面助手能够读取状态。
6. 再运行一次五行 Harness 的 `init`，确认返回的 `achievement_sync.status` 为 `ready`。

已有安装被修改时，安装器会停止。只有用户确认替换后才加 `--force`。

## 通用接口

所有宿主都调用同一组命令：

```powershell
node <skill-path>/scripts/achievement-cli.mjs init
node <skill-path>/scripts/achievement-cli.mjs presence --agent <agent-id> --session <session-id> --runtime <runtime-id> --status active|idle|stopped --task-id <task-id> --summary <summary>
node <skill-path>/scripts/achievement-cli.mjs context --agent <agent-id> --task-id <task-id> --task-type <type> --summary <summary> --risk <risk> --format markdown
node <skill-path>/scripts/achievement-cli.mjs report --input <event.json>
node <skill-path>/scripts/achievement-cli.mjs claim --input <claim.json>
```

载荷以 `packages/protocol/schemas/` 中的 JSON Schema 为准。`runtime.id` 使用宿主自己的稳定标识，不要伪装成 Codex 或其他产品。

## 生命周期适配

先检查宿主是否提供受信任的会话 Hook。能够适配时，将宿主事件映射为：

| 宿主事件 | 通用状态 |
|---|---|
| 会话开始、收到用户任务、工具执行有进展 | `active` |
| 当前轮结束，仍可能继续对话 | `idle` |
| 会话关闭或宿主退出 | `stopped` |

长任务应当在心跳过期前刷新 `active`。Hook 执行失败必须放行主任务，不能因为桌面助手离线而中断 Coding Agent。

宿主没有 Hook 时，不修改宿主内部文件来模拟 Hook。按 `SKILL.md` 在任务边界主动调用 `presence`，其余能力保持不变。

## 适配器不能做什么

- 不读取或复制完整对话正文；
- 不监听特定产品的进程名判断 Agent 是否在线；
- 不自动授予、拒绝或撤销成就；
- 不把 `presence` 当作成就证据；
- 不改变用户的安全策略、审批设置或工具权限；
- 不要求桌面助手和 Code Agent 同时启动。

宿主专属配置应留在用户自己的 Agent 配置目录，不要写回两份通用 Skill。只有能被其他 Agent 复用的协议改进才进入仓库。
