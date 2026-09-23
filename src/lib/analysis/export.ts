import type { AnalysisResult } from "../types";
import { changeLabels } from "./semantic-report";

export function semanticMarkdown(result: AnalysisResult): string {
  if (!result.semanticChanges) return "";
  return "\n\n## Смысловые изменения функций\n\n" + result.semanticChanges.map((change) => {
    const facts = result.units.flatMap((unit) => unit.functions);
    const describe = (ids: string[]) => facts.filter((fn) => ids.includes(fn.id)).map((fn) => `${fn.semantic?.actor || "Исполнитель не установлен"}: ${fn.originalText}`).join("\n");
    return `### ${change.changeTypes.map((type) => changeLabels[type]).join(" + ")}\n\nДо: ${describe(change.oldFunctionIds) || "—"}\n\nПосле: ${describe(change.newFunctionIds) || "Соответствие не найдено"}\n\n${change.reasoning}\n\nПокрытие: ${result.mode === "rules" ? "не оценивалось" : `${Math.round(change.coverageScore * 100)}%`}. Уверенность: ${Math.round(change.confidence * 100)}%. Требует проверки: ${change.requiresHumanReview ? "да" : "нет"}.\n\n${[...change.beforeRefs, ...change.afterRefs].map((ref) => `- ${ref.filename}, ${ref.section ? `п. ${ref.section}` : `фрагмент ${ref.chunkId}`}: «${ref.quote}»`).join("\n")}\n\nПроверка: ${change.verification?.status ?? "не выполнена"}. ${change.verification?.reason ?? ""}${change.review ? `\n\nРешение сотрудника: ${change.review.status}, ${change.review.reviewedAt}. ${change.review.note}` : ""}`;
  }).join("\n\n");
}
