import { NextResponse, type NextRequest } from "next/server";
import { classifyAiError } from "@/lib/ai-error";
import { getMeeting } from "@/lib/meetings/store";
import { extractMyTodos } from "@/lib/meetings/my-todos";
import { rejectCrossSiteWrite } from "@/lib/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const blocked = rejectCrossSiteWrite(request);
  if (blocked) return blocked;
  const { id } = await context.params;
  const meeting = await getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: "회의를 찾을 수 없습니다" }, { status: 404 });
  }
  if (!meeting.transcript?.segments.length && !meeting.analysis) {
    return NextResponse.json({ error: "아직 전사가 없는 회의입니다" }, { status: 409 });
  }
  try {
    return NextResponse.json({ drafts: await extractMyTodos(meeting) });
  } catch (error) {
    const info = classifyAiError(error);
    return NextResponse.json(
      { error: info.message },
      { status: info.kind === "timeout" ? 504 : 502 }
    );
  }
}
