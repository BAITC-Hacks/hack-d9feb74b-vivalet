import type { Finding, ParsedDocument, SourceReference } from "../types";

export function validRef(ref: SourceReference, documents: ParsedDocument[]): boolean {
  const document = documents.find((item) => item.id === ref.documentId && item.filename === ref.filename);
  const chunk = document?.chunks.find((item) => item.id === ref.chunkId);
  return !!chunk && !!ref.quote.trim() && chunk.text.includes(ref.quote);
}
export function validateFinding(finding: Finding, documents: ParsedDocument[]): boolean {
  if (finding.confidence < 0 || finding.confidence > 1 || !Number.isFinite(finding.confidence)) return false;
  const refs = [...finding.beforeRefs, ...finding.afterRefs];
  if (!refs.length || refs.some((ref) => !validRef(ref, documents))) return false;
  if (finding.type === "lost_function" && !finding.beforeRefs.length) return false;
  if (["duplicated_function", "conflict_of_interest"].includes(finding.type) && finding.afterRefs.length < 2) return false;
  return true;
}
