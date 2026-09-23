"use client";
import { useState } from "react";
import type { AnalysisResult, SemanticChange, SourceReference } from "@/lib/types";
import { changeLabels } from "@/lib/analysis/semantic-report";

export default function SemanticResults({ result, analysisId, onSource, onRefresh }: { result: AnalysisResult; analysisId: string; onSource: (ref: SourceReference) => void; onRefresh: () => Promise<void> }) {
  const [filter, setFilter] = useState("all");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string>();
  const [error, setError] = useState("");
  const functions = result.units.flatMap((unit) => unit.functions);
  const changes = result.semanticChanges ?? [];
  const visible = changes.filter((change) => filter === "all" || (filter === "review" ? change.requiresHumanReview && !change.review : change.changeTypes.includes(filter as keyof typeof changeLabels)));
  const refs = (items: SourceReference[]) => <div className="reference-list">{items.map((ref, index) => <button className="source-link" key={`${ref.chunkId}-${index}`} onClick={() => onSource(ref)}>{ref.filename} · {ref.section ? `п. ${ref.section}` : ref.page ? `стр. ${ref.page}` : `абз. ${ref.paragraph ?? "—"}`}</button>)}</div>;
  async function review(change: SemanticChange, status: "confirmed" | "rejected") {
    setSaving(change.id); setError("");
    try {
      const response = await fetch(`/api/analyses/${analysisId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changeId: change.id, status, note: notes[change.id] ?? "" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Не удалось сохранить решение.");
      await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить решение."); }
    finally { setSaving(undefined); }
  }
  return <section className="panel">
    <div className="panel-title"><h2>Смысловые изменения функций</h2><span className="count-pill">{visible.length} записей</span></div>
    <p>Сравнение исполнителей, полномочий, области действия и условий. Оценка покрытия отражает сохранение смысла функции.</p>
    <div className="filters"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Все</button><button className={filter === "review" ? "active" : ""} onClick={() => setFilter("review")}>Ожидают проверки</button>{Object.entries(changeLabels).filter(([key]) => changes.some((change) => change.changeTypes.includes(key as keyof typeof changeLabels))).map(([key, label]) => <button className={filter === key ? "active" : ""} key={key} onClick={() => setFilter(key)}>{label}</button>)}</div>
    {error && <p role="alert">{error}</p>}
    {!visible.length && <p>Нет функций для выбранного фильтра.</p>}
    {visible.map((change) => <article className="finding-card" key={change.id}>
      <div className="finding-head"><strong>{change.changeTypes.map((type) => changeLabels[type]).join(" + ")}</strong><span>Уверенность: {Math.round(change.confidence * 100)}%</span></div>
      <p>{change.requiresHumanReview ? "Предварительный вывод — требуется проверка" : change.meaningPreserved ? "Функция сохранена" : "Содержание функции изменилось"}{change.oldFunctionIds.length > 0 && <> · Покрытие: {result.mode === "rules" ? "не оценивалось" : `${Math.round(change.coverageScore * 100)}%`}</>}</p>
      <div className="evidence-grid">{(["before", "after"] as const).map((side) => <div key={side}><h3>{side === "before" ? "Редакция до" : "Редакция после"}</h3>{functions.filter((fn) => (side === "before" ? change.oldFunctionIds : change.newFunctionIds).includes(fn.id)).map((fn) => <div key={fn.id}>
        <strong>{fn.semantic?.actor || "Исполнитель не установлен"}</strong><p>{fn.originalText}</p>
        <small>Полномочия: {fn.semantic?.authorityType ?? "unknown"}{fn.semantic?.scope.length ? ` · Область: ${fn.semantic.scope.join(", ")}` : ""}</small>
        {fn.semantic?.conditions.length ? <p>Условия: {fn.semantic.conditions.join("; ")}</p> : null}
      </div>)}{refs(side === "before" ? change.beforeRefs : change.afterRefs)}</div>)}</div>
      <div className="reason-box"><strong>Смысл изменения</strong><p>{change.reasoning}</p></div>
      <p>Риск потери: {change.changeTypes.includes("POTENTIAL_GAP") ? "возможный пробел; требуется подтверждение" : change.requiresHumanReview ? "не установлен — требуется проверка" : change.oldCoveredByNew ? "не обнаружен по проверенным функциям" : "частичное покрытие или изменение функции"}.</p>
      {change.verification && <details><summary>Проверка вывода: {change.verification.status === "SUPPORTED" ? "подтверждается источниками" : change.verification.status === "REFUTED" ? "найдено опровержение" : "недостаточно данных"}</summary><p>{change.verification.reason}</p>{refs(change.verification.evidence)}</details>}
      {change.changeTypes.includes("POTENTIAL_GAP") && <p>Проверено функций новой редакции: {change.searchedAfterIds.length}. Полный поиск: {change.globalSearchComplete ? "выполнен" : "не завершён"}.</p>}
      {change.review && <p>Решение сотрудника: {change.review.status === "confirmed" ? "подтверждено" : "отклонено"}. {change.review.note}</p>}
      {change.requiresHumanReview && <details><summary>{change.review ? "Изменить решение сотрудника" : "Проверить вручную"}</summary><p>Решение сохраняется отдельно от исходной оценки модели.</p><label>Обоснование решения<textarea aria-label="Обоснование решения" value={notes[change.id] ?? ""} onChange={(event) => setNotes({ ...notes, [change.id]: event.target.value })} maxLength={2000}/></label><div className="filters"><button disabled={!!saving || !notes[change.id]?.trim()} onClick={() => void review(change, "confirmed")}>Подтвердить</button><button disabled={!!saving || !notes[change.id]?.trim()} onClick={() => void review(change, "rejected")}>Отклонить</button></div></details>}
    </article>)}
  </section>;
}
