import { FormEvent, useMemo, useState } from "react";

type Achievement = {
  id: string;
  icon: string;
  title: string;
  intent: string;
  current: number;
  target: number;
  tracked: boolean;
  earned: boolean;
  feedback?: string;
};

const initialAchievements: Achievement[] = [
  {
    id: "product-gatekeeper",
    icon: "🛡️",
    title: "产品守门员",
    intent: "面对持续影响用户数据的产品空白时，不擅自替人决定。",
    current: 2,
    target: 3,
    tracked: true,
    earned: false
  },
  {
    id: "night-shift-keeper",
    icon: "🌙",
    title: "夜班守望者",
    intent: "有任务等待人判断时，继续完成不依赖它的其他任务。",
    current: 2,
    target: 3,
    tracked: false,
    earned: false
  },
  {
    id: "root-cause-detective",
    icon: "🕵️",
    title: "根因侦探",
    intent: "找到能够同时解释多个异常的共同根因。",
    current: 3,
    target: 3,
    tracked: false,
    earned: true,
    feedback: "你没有继续调整滚动条数值，而是找到了两个共同影响高度的状态问题。"
  }
];

const stageCopy = [
  "等待来自第三方 Agent 的工作事件",
  "五行 Harness 已提交证据，两项成就达到条件",
  "人类已授予成就，反馈将在下一次任务中交还给 Agent"
];

function App() {
  const [view, setView] = useState<"human" | "agent">("human");
  const [stage, setStage] = useState(0);
  const [achievements, setAchievements] = useState(initialAchievements);
  const [showCreate, setShowCreate] = useState(false);

  const tracked = achievements.filter((item) => item.tracked && !item.earned);
  const earned = achievements.filter((item) => item.earned);
  const hiddenPassive = achievements.filter((item) => !item.tracked && !item.earned).length;

  const agentContext = useMemo(() => ({
    schema_version: "agent-achievements/v1",
    agent_id: "codex-voice-md",
    recently_awarded: earned.slice(-2).map((item) => ({
      achievement_id: item.id,
      title: item.title,
      human_feedback: item.feedback ?? "你在真实任务中用证据完成了这项成就。"
    })),
    tracked: tracked.map((item) => ({
      achievement_id: item.id,
      title: item.title,
      progress: { current: item.current, target: item.target, unit: "qualified_tasks" },
      encouragement: item.intent,
      guardrails: ["不得扩大任务范围来获得成就", "用户指令、规则与正确性始终优先"]
    })),
    passive: { visible_to_agent: false, active_count: hiddenPassive },
    operating_priority: ["current_user_instruction", "safety_and_project_rules", "task_correctness", "tracked_achievements"]
  }), [earned, hiddenPassive, tracked]);

  function advanceScenario() {
    if (stage === 0) {
      setAchievements((items) => items.map((item) =>
        item.id === "product-gatekeeper" || item.id === "night-shift-keeper"
          ? { ...item, current: 3 }
          : item
      ));
      setStage(1);
      return;
    }

    if (stage === 1) {
      setAchievements((items) => items.map((item) => {
        if (item.id === "product-gatekeeper") {
          return { ...item, earned: true, tracked: false, feedback: "你没有默认回填历史数据，并且把影响范围讲清楚了。" };
        }
        if (item.id === "night-shift-keeper") {
          return { ...item, earned: true, feedback: "等待判断的夜里，你仍然完成了其他独立任务。" };
        }
        return item;
      }));
      setStage(2);
    }
  }

  function toggleTrack(id: string) {
    setAchievements((items) => {
      const trackedCount = items.filter((item) => item.tracked && !item.earned).length;
      return items.map((item) => item.id === id
        ? { ...item, tracked: item.tracked ? false : trackedCount < 3 }
        : item
      );
    });
  }

  function createAchievement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const intent = String(form.get("intent") ?? "").trim();
    if (!title || !intent) return;
    setAchievements((items) => [...items, {
      id: `custom-${Date.now()}`,
      icon: "✨",
      title,
      intent,
      current: 0,
      target: 3,
      tracked: false,
      earned: false
    }]);
    setShowCreate(false);
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">A</span> Agent Achievements</div>
        <div className="live"><i /> protocol v1 · live</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">AN OPEN ACHIEVEMENT LAYER FOR AI AGENTS</p>
          <h1>让 AI 记得，<br /><em>什么值得被表扬。</em></h1>
          <p className="intro">任何 Agent 都可以提交工作证据。人决定什么值得认可，成就再成为下一次协作里的温柔方向。</p>
        </div>
        <div className="agent-card">
          <div className="agent-orb">✦</div>
          <div><span>当前 Agent</span><strong>Voice MD · Codex</strong><small>接入自 五行 Harness</small></div>
          <div className="level">03<br /><small>成就</small></div>
        </div>
      </section>

      <nav className="view-switch">
        <button className={view === "human" ? "active" : ""} onClick={() => setView("human")}>给人看的成就空间</button>
        <button className={view === "agent" ? "active" : ""} onClick={() => setView("agent")}>Agent 看到的上下文</button>
      </nav>

      {view === "human" ? (
        <div className="dashboard">
          <section className="main-column">
            <div className="section-heading">
              <div><p>ACHIEVEMENTS</p><h2>成就收藏</h2></div>
              <button className="ghost" onClick={() => setShowCreate(!showCreate)}>＋ 创建成就</button>
            </div>

            {showCreate && (
              <form className="create-form" onSubmit={createAchievement}>
                <label>成就名称<input name="title" placeholder="例如：克制的建筑师" /></label>
                <label>什么行为值得表扬？<textarea name="intent" placeholder="描述可观察的行为，而不是抽象品质。" /></label>
                <p>默认以被动方式累计 3 个合格任务，创建后可由人选择追踪。</p>
                <button className="primary" type="submit">保存成就</button>
              </form>
            )}

            <div className="achievement-grid">
              {achievements.map((item) => (
                <article className={`achievement ${item.earned ? "earned" : ""}`} key={item.id}>
                  <div className="badge">{item.icon}</div>
                  <div className="achievement-copy">
                    <div className="title-row"><h3>{item.title}</h3>{item.earned && <span className="earned-label">已获得</span>}</div>
                    <p>{item.intent}</p>
                    {item.feedback && <blockquote>“{item.feedback}”</blockquote>}
                    {!item.earned && (
                      <>
                        <div className="progress"><span style={{ width: `${item.current / item.target * 100}%` }} /></div>
                        <div className="progress-meta"><span>{item.current} / {item.target}</span><span>{item.tracked ? "正在主动追踪" : "被动更新"}</span></div>
                        <button className={item.tracked ? "tracking" : "track"} onClick={() => toggleTrack(item.id)}>
                          {item.tracked ? "停止追踪" : "让 Agent 追踪"}
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside>
            <div className="scenario-card">
              <p className="eyebrow">LIVE INTEGRATION</p>
              <h2>五行 Harness</h2>
              <p>{stageCopy[stage]}</p>
              <div className="event-stack">
                <div><span>task.completed</span><b>{stage >= 1 ? "3" : "2"}</b></div>
                <div><span>judgment.requested</span><b>{stage >= 1 ? "1" : "0"}</b></div>
                <div><span>成就待授予</span><b>{stage === 1 ? "2" : "0"}</b></div>
              </div>
              {stage < 2 && <button className="primary wide" onClick={advanceScenario}>{stage === 0 ? "运行夜班场景" : "查看证据并授予"} →</button>}
              {stage === 2 && <button className="primary wide" onClick={() => setView("agent")}>看看 Agent 知道了什么 →</button>}
            </div>
            <div className="source-card">
              <span>CONNECTED SOURCES</span>
              <div><b>五</b> Wuxing Harness <i>connected</i></div>
              <div><b>＋</b> Your agent system <i>POST /v1/events</i></div>
            </div>
          </aside>
        </div>
      ) : (
        <section className="agent-view">
          <div className="agent-note">
            <p className="eyebrow">COMPACT · RELEVANT · ACTIONABLE</p>
            <h2>这是 Agent 真正看到的自己</h2>
            <p>被动成就不会提前暴露。只有最近获得的认可和人明确追踪的目标进入上下文，最多三项。</p>
            <div className="priority">
              <span>优先级</span>
              用户指令 ＞ 安全与规则 ＞ 正确性 ＞ 追踪成就
            </div>
          </div>
          <pre>{JSON.stringify(agentContext, null, 2)}</pre>
        </section>
      )}

      <footer>What if an AI could remember not only what it did — but what we appreciated?</footer>
    </main>
  );
}

export default App;

