import { NextResponse } from "next/server";
import { deleteMeeting, getMeeting, updateMeeting } from "@/lib/meetings/store";
import { isValidMeetingId } from "@/lib/meetings/validate";
import { parseAnalysis } from "@/lib/meetings/analysis";
import { attachAnalysisEvidence } from "@/lib/meetings/evidence";
import {
  sanitizeHiddenBlocks,
  sanitizeHighlights,
} from "@/lib/meetings/highlights";
import {
  deleteTranscriptSegments,
  parseTranscriptSegmentIds,
} from "@/lib/meetings/delete-transcript-segments";
import type { MeetingUpdate } from "@/lib/meetings/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const TITLE_MAX = 120;

/**
 * 처리 상태 폴링(상세 화면의 ProcessingPoller 가 사용).
 * 읽기 전용. 고아 잡 재개는 POST /api/meetings/[id]/resume 가 맡는다.
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  if (!isValidMeetingId(id)) {
    return NextResponse.json({ error: "잘못된 회의 id" }, { status: 400 });
  }
  const meeting = await getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: "회의를 찾을 수 없습니다" }, { status: 404 });
  }
  return NextResponse.json({
    id: meeting.id,
    status: meeting.status,
    error: meeting.error,
    durationSec: meeting.durationSec,
    transcribeProgress: meeting.transcribeProgress,
    processing: meeting.processing,
  });
}

/**
 * 회의 수정. title(빈 문자열 = 커스텀 제목 해제) 그리고/또는 analysis(직접 편집).
 * analysis 는 parseAnalysis 로 정규화해 저장한다(빈 섹션 키 제거, owner 정규화 —
 * 클라이언트 페이로드를 그대로 신뢰하지 않음).
 */
export async function PATCH(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  if (!isValidMeetingId(id)) {
    return NextResponse.json({ error: "잘못된 회의 id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    title?: unknown;
    analysis?: unknown;
    highlights?: unknown;
    hiddenBlocks?: unknown;
    deleteTranscriptSegmentIds?: unknown;
  };

  if (body.deleteTranscriptSegmentIds !== undefined) {
    const segmentIds = parseTranscriptSegmentIds(
      body.deleteTranscriptSegmentIds
    );
    if (!segmentIds) {
      return NextResponse.json(
        { error: "삭제할 발화 id가 필요합니다" },
        { status: 400 }
      );
    }
    const outcome = await deleteTranscriptSegments(id, segmentIds);
    switch (outcome.kind) {
      case "meeting-not-found":
        return NextResponse.json(
          { error: "회의를 찾을 수 없습니다" },
          { status: 404 }
        );
      case "transcript-not-found":
        return NextResponse.json(
          { error: "삭제할 전사가 없습니다" },
          { status: 409 }
        );
      case "segments-not-found":
        return NextResponse.json(
          { error: "삭제할 발화를 찾을 수 없습니다" },
          { status: 404 }
        );
      case "share-unpublish-failed":
        return NextResponse.json({ error: outcome.message }, { status: 502 });
      case "success":
        return NextResponse.json({
          transcript: outcome.transcript,
          removedIds: outcome.removedIds,
          rebuildingAnalysis: outcome.rebuildingAnalysis,
        });
    }
  }

  const patch: MeetingUpdate = {};

  if (typeof body.title === "string") {
    const title = body.title.trim().slice(0, TITLE_MAX);
    patch.title = title || undefined;
  }

  if (body.highlights !== undefined) {
    if (!Array.isArray(body.highlights)) {
      return NextResponse.json(
        { error: "highlights 는 배열이어야 합니다" },
        { status: 400 }
      );
    }
    const meeting = await getMeeting(id);
    if (!meeting) {
      return NextResponse.json(
        { error: "회의를 찾을 수 없습니다" },
        { status: 404 }
      );
    }
    // 실제 본문과 대조해 어긋난 범위는 재앵커링·폐기(재분석 잔재 방어).
    const cleaned = sanitizeHighlights(body.highlights, meeting);
    patch.highlights = cleaned.length ? cleaned : undefined;
  }

  if (body.hiddenBlocks !== undefined) {
    if (!Array.isArray(body.hiddenBlocks)) {
      return NextResponse.json(
        { error: "hiddenBlocks 는 배열이어야 합니다" },
        { status: 400 }
      );
    }
    const meeting = await getMeeting(id);
    if (!meeting) {
      return NextResponse.json(
        { error: "회의를 찾을 수 없습니다" },
        { status: 404 }
      );
    }
    const cleaned = sanitizeHiddenBlocks(body.hiddenBlocks, meeting);
    patch.hiddenBlocks = cleaned.length ? cleaned : undefined;
  }

  if (body.analysis !== undefined) {
    if (!body.analysis || typeof body.analysis !== "object") {
      return NextResponse.json(
        { error: "analysis 는 객체여야 합니다" },
        { status: 400 }
      );
    }
    const meeting = await getMeeting(id);
    if (!meeting) {
      return NextResponse.json(
        { error: "회의를 찾을 수 없습니다" },
        { status: 404 }
      );
    }
    let normalized = parseAnalysis(JSON.stringify(body.analysis));
    // 편집기는 headline 을 다루지 않는다 — 기존 headline 을 보존한다.
    if (meeting.analysis?.headline) {
      normalized.headline = meeting.analysis.headline;
    }
    if (meeting.analysis?.automationLeads?.length) {
      normalized.automationLeads = meeting.analysis.automationLeads;
    }
    normalized.actionItems = normalized.actionItems?.map((action, index) => {
      const previous = meeting.analysis?.actionItems?.[index];
      return previous?.task === action.task && previous.todo
        ? { ...action, todo: previous.todo }
        : action;
    });
    if (meeting.transcript) {
      normalized = attachAnalysisEvidence(normalized, meeting.transcript);
    }
    patch.analysis = normalized;
  }

  if (Object.keys(patch).length === 0 && typeof body.title !== "string") {
    return NextResponse.json(
      { error: "수정할 내용(title·analysis·highlights·전사)이 필요합니다" },
      { status: 400 }
    );
  }

  const updated = await updateMeeting(id, patch);
  if (!updated) {
    return NextResponse.json({ error: "회의를 찾을 수 없습니다" }, { status: 404 });
  }
  return NextResponse.json({
    title: updated.title ?? null,
    analysis: updated.analysis ?? null,
    highlights: updated.highlights ?? [],
    hiddenBlocks: updated.hiddenBlocks ?? [],
  });
}

/** 회의 레코드 삭제. data/meetings/<id>.json 만 지운다(Obsidian 일지 블록은 보존). */
export async function DELETE(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  if (!isValidMeetingId(id)) {
    return NextResponse.json({ error: "잘못된 회의 id" }, { status: 400 });
  }
  const ok = await deleteMeeting(id);
  if (!ok) {
    return NextResponse.json({ error: "회의를 찾을 수 없습니다" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
