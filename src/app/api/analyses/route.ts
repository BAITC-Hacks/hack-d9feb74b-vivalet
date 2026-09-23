import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export const runtime = "nodejs";
export async function GET() {
  const analyses = await prisma.analysis.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { documents: { select: { filename: true, side: true, type: true } } } });
  return NextResponse.json(analyses.map((a) => {
    const result = a.result ? (() => { try { return JSON.parse(a.result); } catch { return null; } })() : null;
    return { id: a.id, status: a.status, stage: a.stage, error: a.error, createdAt: a.createdAt, updatedAt: a.updatedAt, documents: a.documents, findingsCount: result?.findings?.length ?? 0, needsReviewCount: result?.needsReview?.length ?? 0 };
  }));
}
export async function POST() {
  const analysis = await prisma.analysis.create({ data: {} });
  return NextResponse.json({ id: analysis.id });
}
