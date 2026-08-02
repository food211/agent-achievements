import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "安装五行 Harness",
  description: "把五行 Harness 装进支持 Skills 的 AI Agent，开始审查工作区积累的规则。",
};

export default function InstallLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
