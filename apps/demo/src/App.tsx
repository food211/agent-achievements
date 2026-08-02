import { useState } from "react";

// ── 卡片数据 ──────────────────────────────────────────────
type CardStatus = null | "批准改写" | "降权" | "保留原样";

type Card = {
  id: string;
  intensity: "直接矛盾" | "反复阻碍";
  intensityNote: string;
  rule: string;
  evidence: string;
  suggestion: string;
};

const CARDS: Card[] = [
  {
    id: "c1",
    intensity: "直接矛盾",
    intensityNote: "发现一次即提出",
    rule: "侧写数据经由主进程转发给渲染层",
    evidence:
      "代码与测试的方向相反，实际是渲染层直接订阅。触发 7 次，7 次结果与规则描述相反。规则已无法描述这个系统。",
    suggestion: "按代码实际方向重写这条",
  },
  {
    id: "c2",
    intensity: "直接矛盾",
    intensityNote: "发现一次即提出",
    rule: "前端改动要求真实浏览器验收",
    evidence:
      "触发 12 次，其中 9 次你在电脑前，直接截图反馈更快。规则没有区分有人值守与无人托管，反复造成不必要的等待。",
    suggestion: "加触发条件：仅无人托管时生效",
  },
  {
    id: "c3",
    intensity: "反复阻碍",
    intensityNote: "已积累多次证据",
    rule: "（空白处）AI 按自身偏好补齐历史数据",
    evidence:
      "3 次运行中自行新增后台定时任务，你事后都推翻了。这里没有规则，AI 用了自己的默认倾向填补产品空白。",
    suggestion: "新增规则——无人触发的自动行为实施前必须问人",
  },
];

// ── 主组件 ───────────────────────────────────────────────
export default function App() {
  const [decisions, setDecisions] = useState<Record<string, CardStatus>>({});
  const [copied, setCopied] = useState(false);

  const handledCount = Object.values(decisions).filter(Boolean).length;

  function decide(id: string, action: CardStatus) {
    setDecisions((prev) => ({ ...prev, [id]: action }));
  }

  function copyInstall() {
    navigator.clipboard.writeText("/plugin install wuxing-harness").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="page">

      {/* ══ 第 1 段 · 首屏 ══ */}
      <section className="s-hero">
        <span className="chip">五行 HARNESS</span>
        <h1>
          你的规则越装越多<br />
          AI 从来不会主动删掉它们
        </h1>
        <p className="lead">
          一个可安装的 skill。装进你自己的工作区，它读你已有的规则、代码和运行记录，
          找出哪些规则和事实已经对不上、哪些还在被执行但早该失效，带着证据交给你判断。
        </p>
        <div className="install-box">
          <code>/plugin install wuxing-harness</code>
          <button className="copy-btn" onClick={copyInstall} aria-label="复制安装命令">
            {copied ? "✓ 已复制" : "复制"}
          </button>
        </div>
      </section>

      {/* ══ 第 2 段 · 理念 ══ */}
      <section className="s-concept">
        <div className="concept-grid">
          {/* 左：只有生 */}
          <div className="concept-col">
            <span className="concept-label">现在所有的 agent 框架</span>
            <p className="concept-big">只有生</p>
            <div className="diagrams-wrap">
              <WuxingDiagram mode="grow-only" />
              <RuleBar mode="only-grow" />
            </div>
            <p className="concept-body">
              出一次事故加一条规则，遇到一个特例加一个例外。系统记住了所有过去的问题，
              却不知道哪些问题现在还存在。
            </p>
            <p className="concept-end">越来越僵</p>
          </div>

          {/* 右：加上克 */}
          <div className="concept-col">
            <span className="concept-label concept-label--right">五行 Harness 补上的</span>
            <p className="concept-big concept-big--accent">加上克</p>
            <div className="diagrams-wrap">
              <WuxingDiagram mode="with-ke" />
              <RuleBar mode="with-retire" />
            </div>
            <p className="concept-body">
              执行结果推翻旧规则，人的判断砍掉不合适的方案，现实信号中止正在跑的行动。
              加规则有成本，推一档必有代价。
            </p>
            <p className="concept-end concept-end--accent">还能长</p>
          </div>
        </div>

        <div className="concept-quote">
          <strong>AI 不只需要记忆，也需要代谢。</strong>
          <span>记录和遗忘、生成和淘汰、继承和推翻，本来就是同一件事的两面。</span>
        </div>
      </section>

      {/* ══ 第 3 段 · 样例清单 ══ */}
      <section className="s-cards">
        <div className="cards-header">
          <h2>装上之后你会拿到这样一份清单</h2>
          <span className="cards-note">样例来自一个真实工作区</span>
        </div>

        <div className="card-list">
          {CARDS.map((card) => {
            const status = decisions[card.id];
            return (
              <article key={card.id} className={`rule-card ${status ? "decided" : ""} ${card.intensity === "反复阻碍" ? "card--repeat" : "card--conflict"}`}>
                <div className="card-top">
                  <span className="intensity-tag">{card.intensity}</span>
                  <span className="intensity-note">{card.intensityNote}</span>
                </div>
                <p className="card-rule">{card.rule}</p>
                <p className="card-evidence">{card.evidence}</p>
                <p className="card-suggestion">→ {card.suggestion}</p>
                {status ? (
                  <p className="card-confirmed">✓ 已{status}，写回规则文件</p>
                ) : (
                  <div className="card-actions">
                    {(["批准改写", "降权", "保留原样"] as CardStatus[]).map((action) => (
                      <button key={action} className={`action-btn action-btn--${action}`} onClick={() => decide(card.id, action)}>
                        {action}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* ══ 第 4 段 · 三个数字 ══ */}
      <section className="s-metrics">
        <div className="metric-block">
          <strong>3</strong>
          <span>这次判出该改</span>
        </div>
        <div className="metric-divider" />
        <div className="metric-block">
          <strong className={handledCount > 0 ? "metric--accent" : ""}>{handledCount} / 3</strong>
          <span>你已处理</span>
        </div>
        <div className="metric-divider" />
        <div className="metric-block">
          <strong>47</strong>
          <span>规则总数</span>
        </div>
      </section>

      {/* ══ 第 5 段 · 边界与邀请 ══ */}
      <section className="s-bottom">
        <div className="bottom-grid">
          <div className="bottom-col">
            <h3>适用范围</h3>
            <p>
              任何有代码、测试或运行记录可以对照的工作区。不只是开发者——只要你写过 skill、
              加过自定义指令、维护过一份「AI 应该怎么做」的文档，规则只增不减这个问题就已经在发生。
            </p>
          </div>
          <div className="bottom-col">
            <h3>这次没做</h3>
            <p>
              完整的非阻塞待判队列、木克土与土克水、旺衰诊断。它们在图上，不在这次的代码里。
              说清楚做了什么、没做什么，比假装做完了有用。
            </p>
          </div>
        </div>

        <div className="invite-card">
          <div className="invite-text">
            <strong>装上一周，告诉我三个数</strong>
            <p>
              你的规则里有几条被判该改、你同意了几条、哪一条你觉得它判错了。判错的那条最有用。
            </p>
          </div>
          <a
            className="invite-btn"
            href="https://github.com/food211/agent-achievements"
            target="_blank"
            rel="noreferrer"
          >
            在 GitHub 查看
          </a>
        </div>
      </section>

      <footer className="page-footer">
        AI 不只需要记忆，也需要代谢。
      </footer>
    </div>
  );
}

// ── 五行图 ───────────────────────────────────────────────
// 节点位置：上=水, 右上=木, 右下=火, 左下=土, 左上=金
const W_NODES = [
  { x: 70, y: 10, label: "水" },   // 上
  { x: 124, y: 49, label: "木" },  // 右上
  { x: 103, y: 116, label: "火" }, // 右下
  { x: 37, y: 116, label: "土" },  // 左下
  { x: 16, y: 49, label: "金" },   // 左上
];

// 相克五角星连线：水→火(0→2)、火→金(2→4)、金→木(4→1)、木→土(1→3)、土→水(3→0)
// 高亮三条：水克火(0→2)、火克金(2→4)、土克水? 按文档：高亮 水克火、火克金、土克水
// 文档底线：相克只高亮三条 水克火、火克金、土克水；其余两条（金克木、木克土）浅灰
const KE_LINES = [
  { from: 0, to: 2, active: true },   // 水克火
  { from: 2, to: 4, active: true },   // 火克金
  { from: 4, to: 1, active: false },  // 金克木（未做）
  { from: 1, to: 3, active: false },  // 木克土（未做）
  { from: 3, to: 0, active: true },   // 土克水
];

function WuxingDiagram({ mode }: { mode: "grow-only" | "with-ke" }) {
  const size = 140;
  return (
    <svg width={size} height={size} viewBox="0 0 140 130" className="wuxing-svg" aria-hidden="true">
      {/* 外环相生五边形 */}
      <polygon
        points={W_NODES.map((n) => `${n.x},${n.y}`).join(" ")}
        fill="none"
        stroke={mode === "grow-only" ? "#aab0b8" : "#6b7480"}
        strokeWidth="1.5"
      />

      {/* 相克五角星（仅 with-ke 显示） */}
      {mode === "with-ke" &&
        KE_LINES.map((line, i) => {
          const from = W_NODES[line.from];
          const to = W_NODES[line.to];
          return (
            <line
              key={i}
              x1={from.x} y1={from.y}
              x2={to.x} y2={to.y}
              stroke={line.active ? "#D85A30" : "rgba(180,180,180,0.22)"}
              strokeWidth={line.active ? "2" : "1"}
            />
          );
        })}

      {/* 节点圆 */}
      {W_NODES.map((n, i) => (
        <g key={i}>
          <circle
            cx={n.x} cy={n.y} r="11"
            fill={mode === "grow-only" ? "#2a2d36" : "#2a2d36"}
            stroke={mode === "grow-only" ? "#5a6070" : "#8a9090"}
            strokeWidth="1"
          />
          <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="10" fill="#c8cdd8" fontFamily="STSong, SimSun, serif">
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── 柱状图 ───────────────────────────────────────────────
const GROW_HEIGHTS = [18, 28, 38, 46, 55, 64, 72, 80, 88, 96, 104, 112];
const MIXED_HEIGHTS = [72, 45, 88, 32, 60, 96, 50, 78, 42];
const RETIRED_INDICES = [1, 4, 7]; // 三根退役柱

function RuleBar({ mode }: { mode: "only-grow" | "with-retire" }) {
  const MAX_H = 116;
  const BAR_W = 9;
  const GAP = 4;

  if (mode === "only-grow") {
    return (
      <svg width={140} height={130} viewBox="0 0 140 130" className="bar-svg" aria-hidden="true">
        {GROW_HEIGHTS.map((h, i) => (
          <rect
            key={i}
            x={4 + i * (BAR_W + GAP)}
            y={MAX_H - h + 8}
            width={BAR_W}
            height={h}
            rx="2"
            fill="#4a5060"
          />
        ))}
      </svg>
    );
  }

  return (
    <svg width={140} height={130} viewBox="0 0 140 130" className="bar-svg" aria-hidden="true">
      {MIXED_HEIGHTS.map((h, i) => {
        const x = 8 + i * (BAR_W + GAP + 3);
        const y = MAX_H - h + 8;
        const retired = RETIRED_INDICES.includes(i);
        if (retired) {
          return (
            <g key={i}>
              <rect x={x} y={y} width={BAR_W} height={h} rx="2" fill="none" stroke="#D85A30" strokeWidth="1.2" />
              <line x1={x} y1={y} x2={x + BAR_W} y2={y + h} stroke="#D85A30" strokeWidth="1.2" />
            </g>
          );
        }
        return (
          <rect key={i} x={x} y={y} width={BAR_W} height={h} rx="2" fill="#4a5060" />
        );
      })}
    </svg>
  );
}
