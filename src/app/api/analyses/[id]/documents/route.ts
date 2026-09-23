import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseDocument } from "@/lib/documents";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const analysis = await prisma.analysis.findUnique({ where: { id } });
    if (!analysis) return NextResponse.json({ error: "Анализ не найден." }, { status: 404 });
    const form = await request.formData();
    const side = form.get("side"); const file = form.get("file");
    if (side !== "before" && side !== "after") return NextResponse.json({ error: "Укажите сторону сравнения." }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "Файл не найден." }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const documentId = crypto.randomUUID();
    const parsed = await parseDocument(documentId, file.name, side, buffer);
    await prisma.document.create({ data: { id: documentId, analysisId: id, filename: parsed.filename, side, type: parsed.type, size: parsed.size, text: parsed.text, chunks: JSON.stringify(parsed.chunks) } });
    return NextResponse.json({ id: documentId, filename: parsed.filename, side, type: parsed.type, size: parsed.size, chunks: parsed.chunks.length, status: "parsed" });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка загрузки." }, { status: 400 }); }
}
