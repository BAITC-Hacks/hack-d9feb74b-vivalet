import type { Finding, ParsedDocument, SourceReference } from "../types";

export function validRef(ref: SourceReference, documents: ParsedDocument[]): boolean {
  const document = documents.find((item) => item.id === ref.documentId && item.filename === ref.filename);
  const chunk = document?.chunks.find((item) => item.id === ref.chunkId);
  return !!chunk && !!ref.quote.trim() && chunk.text.includes(ref.quote)
    && (ref.section === undefined || ref.section === chunk.section)
    && (ref.page === undefined || ref.page === chunk.page)
    && (ref.paragraph === undefined || ref.paragraph === chunk.paragraph)
    && (ref.sheet === undefined || ref.sheet === chunk.sheet)
    && (ref.row === undefined || ref.row === chunk.rowStart);
}
export function validateFinding(finding: Finding, documents: ParsedDocument[]): boolean {
  if (finding.confidence < 0 || finding.confidence > 1 || !Number.isFinite(finding.confidence)) return false;
  const refs = [...finding.beforeRefs, ...finding.afterRefs];
  if (!refs.length || refs.some((ref) => !validRef(ref, documents))) return false;
  if (finding.type === "lost_function" && !finding.beforeRefs.length) return false;
  if (finding.type === "new_function" && !finding.afterRefs.length) return false;
  if (["moved_function", "modified_function"].includes(finding.type) && (!finding.beforeRefs.length || !finding.afterRefs.length)) return false;
  const sameSideComparison = ["duplicated_function", "conflict_of_interest"].includes(finding.type);
  if (!sameSideComparison && (finding.beforeRefs.some((ref) => documents.find((d) => d.id === ref.documentId)?.side !== "before") || finding.afterRefs.some((ref) => documents.find((d) => d.id === ref.documentId)?.side !== "after"))) return false;
  if (finding.type === "duplicated_function" && (!finding.beforeRefs.length || !finding.afterRefs.length)) return false;
  if (finding.type === "conflict_of_interest" && (!finding.beforeRefs.length || !finding.afterRefs.length)) return false;
  return true;
}
