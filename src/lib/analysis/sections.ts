import type { DocumentChunk } from "../types";

export interface NumberedStructure {
  level1: number;
  level2: number;
  level3Plus: number;
  total: number;
}

/** Counts unique explicit numbers at the start of a fragment; repeated table-of-contents entries count once. */
export function countNumberedStructure(chunks: DocumentChunk[]): NumberedStructure {
  const numbers = new Set<string>();
  for (const chunk of chunks) {
    const number = chunk.text.trim().match(/^(\d+(?:\.\d+)*)\.(?=\s|[А-ЯЁ])/u)?.[1];
    if (number) numbers.add(number);
  }
  const levels = [...numbers].map((number) => number.split(".").length);
  return {
    level1: levels.filter((level) => level === 1).length,
    level2: levels.filter((level) => level === 2).length,
    level3Plus: levels.filter((level) => level >= 3).length,
    total: numbers.size,
  };
}
