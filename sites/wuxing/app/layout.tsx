import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "五行创作调控",
    description: "看见这一稿文字卡在哪里，用一次动作把它调回来。",
    openGraph: { title: "五行创作调控", description: "调那个还差一点", images: [{ url: image, width: 1707, height: 907 }] },
    twitter: { card: "summary_large_image", title: "五行创作调控", description: "调那个还差一点", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
