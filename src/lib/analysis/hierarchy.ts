import type { DocumentChunk } from "../types";

/** Preserve exact text and locations. Context follows numbering, including across PDF pages. */
export function withHierarchy(chunks: DocumentChunk[]): DocumentChunk[] {
  let stack: { number: string; chunk: DocumentChunk }[] = [];
  let sheet: string | undefined;
  return chunks.map((chunk) => {
    if (chunk.sheet !== sheet) { stack = []; sheet = chunk.sheet; }
    const number = chunk.text.trim().match(/^(\d+(?:\.\d+)*)(?:\.(?=\s|[А-ЯЁ])|\s)/u)?.[1];
    if (number) stack = stack.filter((parent) => number.startsWith(`${parent.number}.`));
    const parents = [...stack];
    const actor = [...parents].reverse().find(({ chunk: parent }) => /(?:директор|руководител|аудитор|департамент|отдел|служб)/i.test(parent.text));
    const result: DocumentChunk = {
      ...chunk, section: number ?? stack.at(-1)?.number ?? chunk.section,
      chapter: (number && !number.includes(".")) ? chunk.text : parents[0]?.chunk.text,
      parentContext: parents.map(({ chunk: parent }) => parent.text).join("\n"),
      parentChunkIds: parents.map(({ chunk: parent }) => parent.id),
      sectionActor: actor?.chunk.text,
    };
    if (number) stack.push({ number, chunk: result });
    return result;
  });
}
