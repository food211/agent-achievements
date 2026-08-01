"use client";

import { useEffect, useMemo, useState } from "react";

const SAMPLE = "我们总以为，创作需要更完整的方法、更准确的表达和更稳定的输出。只要不断优化流程，内容自然会变得更好。但真正重要的，也许还是保持耐心，相信时间会给出答案。";
const ACTIONS = [
  ["water", "引水", "加一个真实现场"],
  ["wood", "生枝", "换个角度往下写"],
  ["fire", "点火", "早点把话说出来"],
  ["earth", "落土", "用事实换掉空话"],
  ["metal", "修枝", "删到只剩需要的"],
] as const;

type Action = (typeof ACTIONS)[number][0];
type Diagnosis = {
  summary: string;
  evidence: string[];
  explanation: string;
  recommended_action: Action | null;
  why_this_action: string | null;
  uncertainty: string | null;
  terrain: Record<Action, string>;
};
type Revision = { text: string; exchange: string; learned_judgment: string };
type Preference = { action: Action; statement: string; confirmations: number; status: "candidate" | "stable" };

async function request<T>(body: object): Promise<T> {
  const response = await fetch("/api/wuxing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "request-failed");
  return data;
}

export default function Home() {
  const [text, setText] = useState(SAMPLE);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [selected, setSelected] = useState<Action | null>(null);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [busy, setBusy] = useState<"diagnose" | Action | null>(null);
  const [message, setMessage] = useState("");
  const [decision, setDecision] = useState<"accepted" | "rejected" | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const savedTheme = localStorage.getItem("wuxing-theme") as "light" | "dark" | null;
    setTheme(savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    try { setPreferences(JSON.parse(localStorage.getItem("wuxing-preferences") || "[]")); } catch { setPreferences([]); }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("wuxing-theme", theme);
  }, [theme]);

  const activeAction = selected || diagnosis?.recommended_action || null;
  const actionName = useMemo(() => ACTIONS.find(([id]) => id === selected)?.[1], [selected]);

  async function diagnoseText() {
    if (text.trim().length < 20) { setMessage("再多写一点，我现在还看不出它卡在哪。"); return; }
    setBusy("diagnose"); setMessage(""); setRevision(null); setSelected(null); setDecision(null);
    try { setDiagnosis(await request<Diagnosis>({ operation: "diagnose", text, preferences })); }
    catch { setMessage("这次没读出来，再试一次。"); }
    finally { setBusy(null); }
  }

  async function rewrite(action: Action) {
    if (!diagnosis || diagnosis.uncertainty) return;
    setBusy(action); setSelected(action); setDecision(null); setMessage("");
    try { setRevision(await request<Revision>({ operation: "rewrite", text, action, diagnosis, preferences })); }
    catch { setMessage("这次没改出来，再试一次。"); }
    finally { setBusy(null); }
  }

  function decide(accepted: boolean) {
    if (!revision || !selected) return;
    setDecision(accepted ? "accepted" : "rejected");
    if (!accepted) return;
    const next = [...preferences];
    const existing = next.find((item) => item.action === selected && item.statement === revision.learned_judgment);
    if (existing) {
      existing.confirmations += 1;
      existing.status = existing.confirmations >= 2 ? "stable" : "candidate";
    } else {
      next.push({ action: selected, statement: revision.learned_judgment, confirmations: 1, status: "candidate" });
    }
    setPreferences(next);
    localStorage.setItem("wuxing-preferences", JSON.stringify(next));
  }

  return (
    <main className="page-shell">
      <header className="masthead">
        <div className="brand-mark" aria-hidden="true"><i /><i /><i /><i /><i /><span>文</span></div>
        <div><small>WUXING CREATION HARNESS</small><h1>五行创作调控</h1><p>调那个还差一点</p></div>
        <div className="masthead-tools"><span>只看这一稿</span><button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "浅色" : "深色"}</button></div>
      </header>

      <section className="workspace">
        <article className="paper source-card">
          <Title number="01" title="原文" note="把那段还差一点的文字放进来" />
          <textarea aria-label="需要诊断的原文" value={text} onChange={(event) => setText(event.target.value)} />
          <button className="primary full" disabled={busy !== null} onClick={diagnoseText}>{busy === "diagnose" ? "我在读…" : "看看差在哪"}</button>
          <p className="message" role="status">{message}</p>
        </article>

        <article className="paper terrain-card">
          <Title number="02" title="这一稿怎么了" note="每个判断都能在原文里找到" />
          <div className={`terrain focus-${activeAction || "none"}`} aria-label="五种创作力量的文字地形">
            <div className="terrain-earth" /><div className="terrain-water" /><div className="terrain-wood" /><div className="terrain-fire" /><div className="terrain-metal" /><div className="terrain-spirit">文</div>
          </div>
          <div className="element-labels">{ACTIONS.map(([id, label]) => <span className={activeAction === id ? "active" : ""} key={id}>{label}</span>)}</div>
          {!diagnosis ? <div className="empty"><b>从原文开始</b><p>放进一段文字，我先找出最值得动的地方。</p></div> : diagnosis.uncertainty ? <div className="diagnosis uncertain"><h2>{diagnosis.summary}</h2><p>{diagnosis.uncertainty}</p></div> : <div className="diagnosis"><small>我看到的是</small><h2>{diagnosis.summary}</h2><p>{diagnosis.explanation}</p><ul>{diagnosis.evidence.map((item) => <li key={item}>“{item}”</li>)}</ul><strong>{diagnosis.why_this_action}</strong></div>}
          <div className="actions">{ACTIONS.map(([id, label, note]) => <button key={id} disabled={!diagnosis || Boolean(diagnosis.uncertainty) || busy !== null} className={`${diagnosis?.recommended_action === id ? "recommended" : ""} ${selected === id ? "selected" : ""}`} onClick={() => rewrite(id)}><b>{label}</b><small>{busy === id ? "改稿中…" : note}</small></button>)}</div>
        </article>

        <article className="paper revision-card">
          <Title number="03" title="改过以后" note="一次只动一处" />
          {!revision ? <div className="revision empty"><b>还没动笔</b><p>{diagnosis ? "我标出了最想先试的那个，你也可以选别的。" : "先看看原文差在哪。"}</p></div> : <><div className="revision"><small>{actionName}之后</small><p>{revision.text}</p><strong>{revision.exchange}</strong></div><div className="judgment"><small>这次我记住什么</small><blockquote>{revision.learned_judgment}</blockquote>{!decision && <div><button className="primary" onClick={() => decide(true)}>记住这个</button><button onClick={() => decide(false)}>不是这个</button></div>}{decision && <p className={decision}>{decision === "accepted" ? "先放在这里，下次碰到相似的文字再看。" : "好，这次不算。"}</p>}</div></>}
        </article>
      </section>

      <section className="preference-trail"><div><small>YOUR CREATIVE PREFERENCE</small><h2>我记住的偏好</h2></div><div className="preferences">{preferences.length ? preferences.map((item) => <article key={`${item.action}-${item.statement}`}><span>{item.status === "stable" ? "已经记住" : "刚记下"}</span><b>{item.statement}</b><small>{ACTIONS.find(([id]) => id === item.action)?.[1]} · 第 {item.confirmations} 次</small></article>) : <p>相似的选择多了，我才会把它当成偏好。</p>}</div></section>
    </main>
  );
}

function Title({ number, title, note }: { number: string; title: string; note: string }) {
  return <div className="section-label"><span>{number}</span><b>{title}</b><small>{note}</small></div>;
}
