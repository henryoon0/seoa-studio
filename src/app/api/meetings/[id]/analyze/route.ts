import { NextRequest, NextResponse } from "next/server";
import { localAi } from "@/lib/meetings/local-ai";
import { reanalyzeMeeting } from "@/lib/meetings/reanalyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * 저장된 전사로 분석을 다시 돌린다(재분석). 프롬프트가 개선됐을 때 기존
 * 회의가 새 품질(topics·화자 라벨 보정)을 얻는 경로.
 */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const outcome = await reanalyzeMeeting(id, localAi);
    switch (outcome.kind) {
      case "updated":
        return NextResponse.json({ analysis: outcome.analysis });
      case "missing":
        return NextResponse.json({ error: "not found" }, { status: 404 });
      case "no-transcript":
        return NextResponse.json(
          { error: "전사가 있어야 다시 분석할 수 있습니다" },
          { status: 409 }
        );
      case "stale":
        return NextResponse.json(
          { error: "분석하는 동안 전사본이 계속 바뀌었습니다. 잠시 뒤 다시 시도해 주세요" },
          { status: 409 }
        );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "재분석 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
