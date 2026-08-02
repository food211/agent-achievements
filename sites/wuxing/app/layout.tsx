import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  const description = "审查 AI 工作区积累的规则，找出与代码、测试和运行事实冲突的地方。";
  return {
    title: "五行 Harness",
    description,
    openGraph: { title: "五行 Harness", description, images: [{ url: image, width: 1707, height: 907 }] },
    twitter: { card: "summary_large_image", title: "五行 Harness", description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
