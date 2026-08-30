import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShiftLog",
  description:
    "Permission-based activity memory for cloud agents. Default off. No screenshots.",
};

const nav = [
  { href: "/", label: "ホーム" },
  { href: "/settings", label: "設定" },
  { href: "/permissions", label: "許可リスト" },
  { href: "/timeline", label: "タイムライン" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <header className="topbar">
          <div className="brand">
            <strong>ShiftLog</strong>
            <span className="muted">観察と記憶（Computer Use なし）</span>
          </div>
          <nav>
            {nav.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
