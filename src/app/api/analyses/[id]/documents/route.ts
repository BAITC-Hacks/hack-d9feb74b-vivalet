import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseDocument } from "@/lib/documents";
export const runtime = "nodejs";
const sideSchema = z.enum(["before", "after"]);
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const analysis = await prisma.analysis.findUnique({ where: { id } });
    if (!analysis) return NextResponse.json({ error: "Анализ не найден." }, { status: 404 });
    const form = await request.formData();
    const sideRaw = form.get("side");
    const sideResult = sideSchema.safeParse(sideRaw);
    if (!sideResult.success) return NextResponse.json({ error: "Укажите сторону сравнения: before или after." }, { status: 400 });
    const side = sideResult.data;
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Файл не найден." }, { status: 400 });
    if (file.size === 0 || file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "Размер файла должен быть от 1 байта до 20 МБ." }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const documentId = crypto.randomUUID();
    const parsed = await parseDocument(documentId, file.name, side, buffer);
    await prisma.document.create({ data: { id: documentId, analysisId: id, filename: parsed.filename, side, type: parsed.type, size: parsed.size, text: parsed.text, chunks: JSON.stringify(parsed.chunks) } });
    return NextResponse.json({ id: documentId, filename: parsed.filename, side, type: parsed.type, size: parsed.size, chunks: parsed.chunks.length, status: "parsed" });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка загрузки." }, { status: 400 }); }
}
