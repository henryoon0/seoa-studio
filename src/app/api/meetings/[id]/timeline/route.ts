// 회의 1분 타임라인. GET=읽기 전용, POST=만들기 시작·멈춘 잡 이어 쓰기. 회의록 자체는 바꾸지 않는다.
import { NextResponse } from "next/server";
import { isValidMeetingId } from "@/lib/meetings/validate";
import { getMeeting } from "@/lib/meetings/store";
import { readTimeline } from "@/lib/meetings/timeline/store";
import { ensureTimeline } from "@/lib/meetings/timeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteCtx) {
  const { id } = await params;
  if (!isValidMeetingId(id)) return NextResponse.json({ error: "잘못된 회의 id" }, { status: 400 });
  if (!(await getMeeting(id))) return NextResponse.json({ error: "회의를 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json(await readTimeline(id));
}

export async function POST(_req: Request, { params }: RouteCtx) {
  const { id } = await params;
  if (!isValidMeetingId(id)) return NextResponse.json({ error: "잘못된 회의 id" }, { status: 400 });
  const state = await ensureTimeline(id);
  if (!state) return NextResponse.json({ error: "회의를 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json(state);
}
