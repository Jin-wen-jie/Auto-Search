import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Price Intelligence",
  description: "AI digital goods price comparison admin",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
