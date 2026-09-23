"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
type HistoryItem = { id: string; status: string; stage: string; error?: string; createdAt: string; findingsCount: number; needsReviewCount: number; documents: { filename: string; side: string; type: string }[] };
const statusLabel: Record<string, string> = { pending: "Ожидание", running: "Выполняется", complete: "Готово", failed: "Ошибка" };
const statusClass: Record<string, string> = { pending: "badge", running: "badge renamed", complete: "badge preserved", failed: "badge removed" };
export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/analyses").then((r) => r.json()).then(setItems).catch(() => {}).finally(() => setLoading(false));
  }, []);
  return (
    <div className="site-shell">
      <header className="topbar">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>
          <div className="brand-icon"><svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg></div>
          <div><span>VIVALET</span><small>AUDIT PLATFORM</small></div>
        </Link>
        <div className="top-note"><svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>История анализов</div>
      </header>
      <main className="results-shell">
        <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 20, padding: "44px 0 30px" }}>
          <div><h1 style={{ fontSize: 34, margin: "8px 0 6px" }}>История анализов</h1><p style={{ color: "var(--muted)", margin: 0 }}>Все ранее выполненные сравнения</p></div>
          <Link href="/" className="primary-button" style={{ textDecoration: "none" }}><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 4v16m8-8H4"/></svg>Новый анализ</Link>
        </div>
        {loading ? (
          <div className="panel" style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>Загрузка...</div>
        ) : items.length === 0 ? (
          <div className="panel" style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>Анализы не найдены. <Link href="/" style={{ color: "var(--blue)" }}>Создать первый</Link></div>
        ) : (
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            {items.map((item, idx) => {
              const before = item.documents.filter((d) => d.side === "before");
              const after = item.documents.filter((d) => d.side === "after");
              const date = new Date(item.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
              return (
                <div key={item.id} style={{ padding: "20px 28px", borderBottom: idx < items.length - 1 ? "1px solid var(--line)" : "none", display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "center" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span className={statusClass[item.status] || "badge"}>{statusLabel[item.status] || item.status}</span>
                      {item.status === "running" && <span style={{ fontSize: 11, color: "var(--muted)" }}>{item.stage}</span>}
                      {item.error && <span style={{ fontSize: 11, color: "#bd493b" }}>{item.error.slice(0, 80)}</span>}
                      <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>{date}</span>
                    </div>
                    <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                      {before.length > 0 && <div><span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, letterSpacing: ".1em", display: "block", marginBottom: 4 }}>ДО</span>{before.map((d, i) => <div key={i} style={{ fontSize: 12, color: "#324d66" }}>{d.filename}</div>)}</div>}
                      {after.length > 0 && <div><span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, letterSpacing: ".1em", display: "block", marginBottom: 4 }}>ПОСЛЕ</span>{after.map((d, i) => <div key={i} style={{ fontSize: 12, color: "#324d66" }}>{d.filename}</div>)}</div>}
                    </div>
                    {item.status === "complete" && (
                      <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
                        {item.findingsCount > 0 && <span className="count-pill">{item.findingsCount} вывод{item.findingsCount === 1 ? "" : item.findingsCount < 5 ? "а" : "ов"}</span>}
                        {item.needsReviewCount > 0 && <span className="count-pill" style={{ background: "#fff4e8", color: "#a06010" }}>{item.needsReviewCount} на проверку</span>}
                      </div>
                    )}
                  </div>
                  {item.status === "complete" ? (
                    <Link href={`/analysis/${item.id}`} className="primary-button" style={{ textDecoration: "none" }}>Открыть <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M9 5l7 7-7 7"/></svg></Link>
                  ) : item.status === "running" ? (
                    <Link href={`/analysis/${item.id}`} className="demo-button" style={{ textDecoration: "none" }}>Следить <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M9 5l7 7-7 7"/></svg></Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </main>
      <footer><p>VIVALET &middot; AI Organization Auditor</p></footer>
    </div>
  );
}