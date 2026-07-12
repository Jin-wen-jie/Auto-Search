import type { Metadata } from "next";
// @ts-ignore - CSS handled by Next.js bundler
import "./globals.css";

export const metadata: Metadata = {
  title: "K12 / Bug Team Price Intelligence",
  description: "K12 and Bug Team AI digital goods price comparison admin",
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
