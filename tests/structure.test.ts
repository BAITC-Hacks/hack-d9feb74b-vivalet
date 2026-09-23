import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "../src/lib/documents";
import { extractRules } from "../src/lib/analysis/extract";
import { countNumberedStructure } from "../src/lib/analysis/sections";

describe("sample organizational structure", () => {
  it("counts only units explicitly listed in section 3.4", async () => {
    const fixtures = [
      { filename: "Положение_о_внутреннем_аудите_редакция_8_обезличено.docx.pdf", side: "before" as const, expected: 2, levels: [14, 147, 166] },
      { filename: "Положение_о_внутреннем_аудите_редакция_9_обезличено.docx", side: "after" as const, expected: 4, levels: [14, 146, 155] },
    ];
    for (const fixture of fixtures) {
      const buffer = await readFile(join(process.cwd(), "testdocs", fixture.filename));
      const document = await parseDocument(crypto.randomUUID(), fixture.filename, fixture.side, buffer);
      const units = extractRules(document);
      const children = units.filter((unit) => !unit.isRoot);
      expect(children).toHaveLength(fixture.expected);
      expect(children.flatMap((unit) => unit.functions).length).toBeGreaterThan(0);
      expect(children.every((unit) => unit.sourceRefs[0].quote.includes("Департамент"))).toBe(true);
      expect(units.some((unit) => unit.name.includes("Управление рисками организаций"))).toBe(false);
      expect(units.find((unit) => unit.isRoot)?.name).toMatch(/Блок внутреннего аудита/);
      const numbering = countNumberedStructure(document.chunks);
      expect([numbering.level1, numbering.level2, numbering.level3Plus]).toEqual(fixture.levels);
    }
  });
});
