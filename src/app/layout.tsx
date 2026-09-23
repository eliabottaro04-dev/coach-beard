import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Coach Beard",
  description: "Assistente d'asta Fantacalcio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <nav className="border-b border-slate-700 bg-slate-900">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="text-lg font-semibold text-white">
              🧔 Coach Beard
            </Link>
            <div className="flex gap-4 text-sm">
              <Link
                href="/"
                className="text-slate-300 hover:text-emerald-300"
              >
                Setup
              </Link>
              <Link
                href="/asta"
                className="text-slate-300 hover:text-emerald-300"
              >
                Asta Live
              </Link>
              <Link
                href="/chat"
                className="text-slate-300 hover:text-emerald-300"
              >
                Chat
              </Link>
              <Link
                href="/giocatori"
                className="text-slate-300 hover:text-emerald-300"
              >
                Giocatori
              </Link>
              <Link
                href="/obiettivi"
                className="text-slate-300 hover:text-emerald-300"
              >
                Obiettivi
              </Link>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
