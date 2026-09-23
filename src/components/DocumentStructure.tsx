import { countNumberedStructure } from "@/lib/analysis/sections";
import type { DocumentChunk } from "@/lib/types";

interface DocumentView { side: string; chunks: DocumentChunk[] }

export default function DocumentStructure({ documents }: { documents: DocumentView[] }) {
  const totals = { before: { level1: 0, level2: 0, level3Plus: 0 }, after: { level1: 0, level2: 0, level3Plus: 0 } };
  for (const document of documents) {
    if (document.side !== "before" && document.side !== "after") continue;
    const counts = countNumberedStructure(document.chunks);
    totals[document.side].level1 += counts.level1;
    totals[document.side].level2 += counts.level2;
    totals[document.side].level3Plus += counts.level3Plus;
  }
  return <section className="panel numbered-panel">
    <div className="panel-title"><div><span className="step">СТРУКТУРА ТЕКСТА</span><h2>Нумерованные разделы и пункты</h2></div></div>
    <p>Подсчёт по номерам в начале фрагмента. Повторы из оглавления учитываются один раз для каждого документа.</p>
    <div className="numbered-grid">
      <div className="numbered-head">Уровень</div><div className="numbered-head">До</div><div className="numbered-head">После</div>
      <div>Разделы <small>1.</small></div><strong>{totals.before.level1}</strong><strong>{totals.after.level1}</strong>
      <div>Пункты <small>1.1.</small></div><strong>{totals.before.level2}</strong><strong>{totals.after.level2}</strong>
      <div>Подпункты <small>1.1.1. и глубже</small></div><strong>{totals.before.level3Plus}</strong><strong>{totals.after.level3Plus}</strong>
    </div>
  </section>;
}
