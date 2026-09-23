import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { parseDocument } from "@/lib/documents";
export const runtime = "nodejs";
export async function POST() {
  try {
    const dir = path.join(process.cwd(), "testdocs");
    const files = await readdir(dir);
    const before = files.find((name) => /редакция_8/i.test(name));
    const after = files.find((name) => /редакция_9/i.test(name));
    if (!before || !after) return NextResponse.json({ error: "Демо-документы редакций 8 и 9 не найдены." }, { status: 404 });
    const analysis = await prisma.analysis.create({ data: {} });
    for (const [filename, side] of [[before, "before"], [after, "after"]] as const) {
      const buffer = await readFile(path.join(dir, filename));
      const documentId = crypto.randomUUID();
      const parsed = await parseDocument(documentId, filename, side, buffer);
      await prisma.document.create({ data: { id: documentId, analysisId: analysis.id, filename, side, type: parsed.type, size: parsed.size, text: parsed.text, chunks: JSON.stringify(parsed.chunks) } });
    }
    return NextResponse.json({ id: analysis.id });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка запуска демо." }, { status: 500 }); }
}
