import { describe, expect, it } from "vitest";
import { countNumberedStructure } from "../src/lib/analysis/sections";
import type { DocumentChunk } from "../src/lib/types";

const chunks = (texts: string[]) => texts.map((text, index): DocumentChunk => ({ id: String(index), documentId: "doc", text }));

describe("numbered document structure", () => {
  it("counts levels and ignores repeated contents entries", () => {
    expect(countNumberedStructure(chunks([
      "1. Общие положения", "1. ОБЩИЕ ПОЛОЖЕНИЯ 1", "1.1. Цель", "1.1.1. Проверка",
      "2. Структура", "2.1. Состав", "а. Департамент аудита", "2022 года",
    ]))).toEqual({ level1: 2, level2: 2, level3Plus: 1, total: 5 });
  });
});
