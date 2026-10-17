import { NextRequest, NextResponse } from "next/server";
import { mediaScope, runDraftJob, scopeTargets, startDraftJob } from "@/lib/instagram-comments/draft-job";
import { scanQuestions } from "@/lib/instagram-comments/drafts";
import { own } from "@/lib/instagram-comments/model";
import { readDraftJob, readFacts, readLedger, updateFacts } from "@/lib/instagram-comments/storage";

// 초안 일괄 생성 (#66). POST 흐름:
//   1) 처음 호출(답변 없음) → 미답글을 훑어 henry 에게 물어볼 정보가 있으면 {questions} 만 반환 (잡 시작 안 함)
//   2) 답변과 함께 재호출(또는 skipQuestions) → facts 저장 후 백그라운드 잡 시작, {job} 반환
// GET: 잡 진행 상황 (읽기 전용)
// POST {action:"resume"}: 고아 잡 재개 (멱등)

export async function GET() {
  const job = await readDraftJob();
  return NextResponse.json({ job });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    scope?: string; // "all" | mediaId
    /** 고른 최신 게시물들 (최대 3개). 있으면 scope 보다 먼저다. */
    mediaIds?: string[];
    skipQuestions?: boolean;
    answers?: { question?: string; answer?: string }[];
    action?: string;
  };

  if (body.action === "resume") {
    const job = await readDraftJob();
    if (job && job.status === "running") void runDraftJob(job.id); // 멱등 — 고아면 재개
    return NextResponse.json({ job });
  }
  let scope = body.scope?.trim() || "all";
  if (Array.isArray(body.mediaIds)) {
    const picked = mediaScope(await readLedger(), body.mediaIds.filter((id): id is string => typeof id === "string"));
    if (!picked) return NextResponse.json({ error: "최신 게시물 3개 중에서 골라 주세요." }, { status: 400 });
    scope = picked;
  }

  const existing = await readDraftJob();
  if (existing && existing.status === "running") {
    return NextResponse.json({ error: "이미 초안 생성이 돌고 있어요. 끝난 뒤 다시 시도해주세요." }, { status: 409 });
  }

  // 선질문 답변 저장 (있으면)
  const answers = (body.answers ?? []).filter(
    (a): a is { question: string; answer: string } =>
      Boolean(a.question?.trim()) && Boolean(a.answer?.trim())
  );
  if (answers.length > 0) {
    const now = new Date().toISOString();
    await updateFacts((facts) => {
      const next = [...facts];
      for (const a of answers) {
        const idx = next.findIndex((f) => f.question === a.question);
        const fact = { question: a.question.trim(), answer: a.answer.trim(), savedAt: now };
        if (idx >= 0) next[idx] = fact;
        else next.push(fact);
      }
      return next;
    });
  }

  // 선질문 스캔 — 답변을 이미 받았거나 건너뛰면 생략
  if (!body.skipQuestions && answers.length === 0) {
    const ledger = await readLedger();
    const targets = scopeTargets(ledger, scope);
    if (targets.length === 0) {
      return NextResponse.json({ error: "초안을 만들 남은 답글이 없어요." }, { status: 400 });
    }
    const facts = await readFacts();
    try {
      const questions = await scanQuestions({
        comments: targets.map((c) => ({ username: c.username, text: c.text })),
        mediaCaptions: [...new Set(targets.map((c) => own(ledger.media, c.mediaId)?.captionFirstLine ?? ""))].filter(Boolean),
        facts,
      });
      if (questions.length > 0) return NextResponse.json({ questions, scope });
    } catch {
      // 질문 스캔 실패는 치명적이지 않다 — 바로 생성으로 넘어간다.
    }
  }

  const job = await startDraftJob(scope);
  return NextResponse.json({ job });
}
