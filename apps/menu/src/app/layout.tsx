import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";

// O arquivo mora no repositório (ver `fonts/LEIAME.md`): o build não depende
// do Google, e o celular do cliente também não pede nada a ele.
const sora = localFont({
  src: "./fonts/sora-latin.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-sora",
});

export const metadata: Metadata = { title: "Cardápio" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={sora.variable}>
      <body className="min-h-dvh bg-paper font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
