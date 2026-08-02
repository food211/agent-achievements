# 五行 Harness 公开演示

这个 SPA 展示五行 Harness 的规则审查闭环：规则与事实冲突、反复造成阻碍，或自动行为越过产品边界时，系统带着证据提出替换方案；人批准后覆盖旧规则，拒绝则保留原文。

```bash
npm install
npm run dev
npm test
```

公开演示不读取访客本机工作区，也不调用模型。真实审查由仓库中的 `skills/wuxing-harness` 在 Agent 工作区内完成。
