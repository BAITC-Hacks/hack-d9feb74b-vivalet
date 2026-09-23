"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, Layers3, ShieldCheck, Sparkles, UploadCloud } from "lucide-react";

type FileRecord = { filename: string; type: string; size: number; side: "before" | "after"; status: string };
export default function Home() {
  const router = useRouter();
  const [id, setId] = useState<string>();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function ensureAnalysis(): Promise<string> {
    if (id) return id;
    const response = await fetch("/api/analyses", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось создать анализ.");
    setId(data.id); return data.id;
  }
  async function upload(side: "before" | "after", selected: FileList | null) {
    if (!selected?.length) return;
    setBusy(true); setError("");
    try {
      const analysisId = await ensureAnalysis();
      for (const file of Array.from(selected)) {
        const pending: FileRecord = { filename: file.name, type: file.name.split(".").pop()?.toUpperCase() || "", size: file.size, side, status: "Обработка" };
        setFiles((current) => [...current, pending]);
        const form = new FormData(); form.append("side", side); form.append("file", file);
        const response = await fetch(`/api/analyses/${analysisId}/documents`, { method: "POST", body: form });
        const data = await response.json();
        setFiles((current) => current.map((item) => item === pending ? { ...item, status: response.ok ? "Распознан" : "Ошибка" } : item));
        if (!response.ok) throw new Error(`${file.name}: ${data.error}`);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка загрузки."); }
    finally { setBusy(false); }
  }
  async function demo() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/demo", { method: "POST" }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось подготовить демо.");
      router.push(`/analysis/${data.id}?run=1`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка демо."); setBusy(false); }
  }
  const ready = files.some((file) => file.side === "before" && file.status === "Распознан") && files.some((file) => file.side === "after" && file.status === "Распознан");
  return <main className="site-shell">
    <header className="topbar"><div className="brand"><span className="brand-icon"><Layers3 size={20}/></span><span>VIVALET <small>AI Organization Auditor</small></span></div><span className="top-note"><ShieldCheck size={16}/> Анализ с проверяемыми источниками</span></header>
    <section className="hero"><div className="eyebrow"><span className="eyebrow-dot"/> ИНТЕЛЛЕКТУАЛЬНЫЙ АНАЛИЗ ДОКУМЕНТОВ</div><h1>Организационные изменения<br/><em>под вашим контролем.</em></h1><p>Сравните структуру и функции подразделений до и после реорганизации. Каждое существенное заключение связано с исходным фрагментом документа.</p><div className="hero-features"><span><FileText size={16}/> PDF, DOCX, XLSX</span><span><Sparkles size={16}/> Поиск изменений</span><span><ShieldCheck size={16}/> Проверка источников</span></div></section>
    <section className="workspace"><div className="section-heading"><div><span className="step">01 / ЗАГРУЗКА</span><h2>Документы для сравнения</h2><p>Добавьте один или несколько документов для каждой версии структуры.</p></div><button className="demo-button" onClick={demo} disabled={busy}><Sparkles size={17}/> Запустить демо</button></div>
      <div className="upload-grid">{(["before", "after"] as const).map((side) => <div className="upload-card" key={side}><div className="upload-title"><span className={side === "before" ? "number before" : "number after"}>{side === "before" ? "01" : "02"}</span><div><h3>{side === "before" ? "До реорганизации" : "После реорганизации"}</h3><p>{side === "before" ? "Действовавшие положения и структуры" : "Новые положения и структуры"}</p></div></div><label className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(side, event.dataTransfer.files); }}><UploadCloud size={29}/><strong>Перетащите файлы сюда</strong><span>или нажмите для выбора</span><small>PDF, DOCX, XLSX · до 20 МБ на файл</small><input type="file" accept=".pdf,.docx,.xlsx" multiple onChange={(event) => void upload(side, event.target.files)}/></label><div className="file-list">{files.filter((file) => file.side === side).map((file, index) => <div className="file-row" key={`${file.filename}-${index}`}><FileText size={18}/><div><strong>{file.filename}</strong><small>{file.type} · {(file.size / 1024).toFixed(0)} КБ</small></div><span className={file.status === "Ошибка" ? "file-error" : "file-ok"}>{file.status}</span></div>)}</div></div>)}</div>
      {error && <div className="alert">{error}</div>}<div className="upload-actions"><span>Файлы сохраняются локально для повторного просмотра анализа.</span><button className="primary-button" disabled={!ready || busy} onClick={() => router.push(`/analysis/${id}?run=1`)}>Начать анализ <ArrowRight size={18}/></button></div>
    </section><footer>VIVALET · Аналитический прототип для оценки организационных изменений</footer>
  </main>;
}
