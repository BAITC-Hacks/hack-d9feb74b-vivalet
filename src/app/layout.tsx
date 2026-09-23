import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Vivalet — Анализ организационных изменений", description: "Сопоставление структуры и функций с проверяемыми источниками" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
