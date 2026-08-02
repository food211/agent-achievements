"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./install.module.css";

const INSTALL_PROMPT = `请从 https://github.com/food211/agent-achievements/tree/main/skills/wuxing-harness 安装 $wuxing-harness。安装后先读取 SKILL.md，再用它审查当前工作区积累的规则。没有证据的怀疑不要进入待批准清单。`;
const FIRST_AUDIT_PROMPT = `用 $wuxing-harness 审一下当前工作区积累的规则。先列出规则源和证据，不要修改文件。`;

export default function InstallPage() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [copied, setCopied] = useState<"install" | "audit" | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("wuxing-harness-theme") as "light" | "dark" | null;
    setTheme(stored || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("wuxing-harness-theme", theme);
  }, [theme]);

  async function copy(kind: "install" | "audit", value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  }

  return (
    <main className={styles.shell}>
      <header className={styles.nav}>
        <Link className={styles.brand} href="/"><span>克</span><div><small>WUXING AGENT HARNESS</small><b>五行 Harness</b></div></Link>
        <div><Link className="quiet-button back-link" href="/">返回演示</Link><button className="quiet-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "浅色" : "深色"}</button></div>
      </header>

      <section className={styles.hero}>
        <small>INSTALL THE SKILL</small>
        <h1>把安装交给 Agent。</h1>
        <p>复制下面这句话，发给支持 Skills 的 Agent。它会把五行 Harness 装进自己的 Skills 目录。</p>
      </section>

      <section className={`${styles.promptCard} ${styles.primaryPrompt}`}>
        <div className={styles.promptHeading}><span>推荐</span><b>让 Agent 自己安装</b></div>
        <pre><code>{INSTALL_PROMPT}</code></pre>
        <button onClick={() => copy("install", INSTALL_PROMPT)}>{copied === "install" ? "已复制" : "复制安装指令"}</button>
      </section>

      <section className={styles.steps}>
        <article><span>01</span><div><b>发给 Agent</b><p>在 Codex、Claude Code 或其他支持 Skills 的 Agent 里，新开一个对话并粘贴安装指令。</p></div></article>
        <article><span>02</span><div><b>确认装好了</b><p>安装目录里应当有 `SKILL.md`、`agents/`、`references/` 和 `scripts/`。重新开一个对话，让 Agent 载入新 Skill。</p></div></article>
        <article><span>03</span><div><b>跑第一次审查</b><p>先让它只列规则和证据。看到修改建议后，再逐条批准或拒绝。</p></div></article>
      </section>

      <section className={styles.firstRun}>
        <div><small>第一次怎么用</small><h2>先审，不要马上改。</h2><p>这句话会让 Harness 读取当前工作区的规则源，先给出证据清单。没有得到批准前，它不会改高优先级规则。</p></div>
        <div className={`${styles.promptCard} ${styles.compactPrompt}`}><pre><code>{FIRST_AUDIT_PROMPT}</code></pre><button onClick={() => copy("audit", FIRST_AUDIT_PROMPT)}>{copied === "audit" ? "已复制" : "复制审查指令"}</button></div>
      </section>

      <section className={styles.manual}>
        <div><small>也可以手动安装</small><h2>只复制一个文件夹。</h2></div>
        <ol>
          <li>从 GitHub 下载仓库中的 <code>skills/wuxing-harness</code> 文件夹。</li>
          <li>把整个文件夹放进 Agent 识别的个人或项目 Skills 目录，文件夹名保持为 <code>wuxing-harness</code>。</li>
          <li>重新打开一个对话，输入 <code>$wuxing-harness</code>，确认 Agent 能读到它。</li>
        </ol>
        <a href="https://github.com/food211/agent-achievements/tree/main/skills/wuxing-harness" target="_blank" rel="noreferrer">在 GitHub 查看 Skill</a>
      </section>

      <section className={styles.note}><b>工作区内容不会发到这个网站。</b><p>这个页面只提供安装说明。真正的规则审查发生在 Agent 所在的工作区，公开 Demo 也没有读取本机文件的能力。</p></section>
    </main>
  );
}
