// 초안 일괄 생성 잡 (#66) — fire-and-forget 3종 세트 준수 (CLAUDE.md ④):
//   ① 고아 자동 재개: sweep 어댑터 + GET 폴링이 runDraftJob 을 다시 부른다 (멱등).
//   ② 배치별 부분 저장: 댓글 1건 완료마다 원장 draft 저장 + 잡 done/heartbeat 갱신.
//   ③ 외부 호출 타임아웃: generateText(reasoning) 는 claude-cli 자체 하드 타임아웃을 가진다.
import { randomUUID } from "crypto";
import { generateReplyOptions } from "./drafts";
import { missingDraftOptions, own, pendingComments, setDraftOptions, type IgCommentLedger, type IgLedgerComment, type IgMedia } from "./model";
import {
  readDraftJob,
  readFacts,
  readLedger,
  writeDraftJob,
  updateLedger,
  type DraftJob,
} from "./storage";

// in-process 실행 가드 — dev hot-reload 재평가에도 하나만 돌게 globalThis 에 둔다.
function runningSet(): Set<string> {
  const g = globalThis as typeof globalThis & { __igDraftJobs?: Set<string> };
  g.__igDraftJobs ??= new Set();
  return g.__igDraftJobs;
}

/** 초안을 고를 수 있는 게시물 수. 최신 게시물만 고르게 한다(2026-10-17 henry). */
export const PICKABLE_POSTS = 3;

/** 초안 대상으로 고를 수 있는 최신 게시물 (올린 시각 최신순) */
export function latestMedia(ledger: IgCommentLedger, limit = PICKABLE_POSTS): IgMedia[] {
  return Object.values(ledger.media)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

/** scope "media:<id>,<id>" = 고른 게시물들. 최신 게시물 밖의 id 는 버린다. */
export function mediaScope(ledger: IgCommentLedger, mediaIds: string[]): string | null {
  const allowed = new Set(latestMedia(ledger).map((m) => m.id));
  const ids = [...new Set(mediaIds)].filter((id) => allowed.has(id));
  return ids.length ? `media:${ids.join(",")}` : null;
}

/** scope 에 맞는 남은 댓글. "all" · "missing" · "media:<id>,<id>" · 게시물 id 하나. */
export function scopeTargets(ledger: IgCommentLedger, scope: string): IgLedgerComment[] {
  if (scope === "missing") return missingDraftOptions(ledger);
  const ids = scope.startsWith("media:") ? new Set(scope.slice(6).split(",")) : null;
  return pendingComments(ledger).filter((c) => scope === "all" || (ids ? ids.has(c.mediaId) : c.mediaId === scope));
}

/**
 * 잡 시작: scope="all" 이면 미답글 전부, "missing" 이면 후보 3개가 없는 미답글만,
 * 아니면 그 게시물(mediaId)의 미답글만.
 * 이미 도는 잡이 있으면 그 잡을 돌려준다 (동시 2개 금지 — CLI 슬롯 낭비 방지).
 */
export async function startDraftJob(scope: string): Promise<DraftJob> {
  const existing = await readDraftJob();
  if (existing && existing.status === "running") return existing;

  const ledger = await readLedger();
  const targets = scopeTargets(ledger, scope);
  const now = new Date().toISOString();
  const job: DraftJob = {
    id: randomUUID(),
    scope,
    commentIds: targets.map((c) => c.id),
    done: [],
    failed: [],
    status: targets.length > 0 ? "running" : "done",
    createdAt: now,
    updatedAt: now,
  };
  await writeDraftJob(job);
  if (job.status === "running") void runDraftJob(job.id);
  return job;
}

/**
 * 잡 실행 — 멱등. 절대 reject 하지 않는다(내부 settle). sweep/GET 이 언제든 다시 불러도 안전.
 */
export async function runDraftJob(jobId: string): Promise<void> {
  const running = runningSet();
  if (running.has(jobId)) return;
  running.add(jobId);
  try {
    const job = await readDraftJob();
    if (!job || job.id !== jobId || job.status !== "running") return;

    for (const commentId of job.commentIds) {
      const current = await readDraftJob();
      if (!current || current.id !== jobId || current.status !== "running") return; // 중지됨
      if (current.done.includes(commentId) || current.failed.some((f) => f.commentId === commentId)) continue;

      const ledger = await readLedger();
      const comment = own(ledger.comments, commentId);
      // 그 사이 답글이 달렸거나 건너뛴 댓글은 조용히 완료 처리
      if (!comment || comment.repliedByMe || comment.skipped) {
        await writeDraftJob({ ...current, done: [...current.done, commentId], updatedAt: new Date().toISOString() });
        continue;
      }

      try {
        const facts = await readFacts();
        const options = await generateReplyOptions({ ledger, comment, facts });
        // 부분 저장: 원장 후보(+빈 초안 채움) + 잡 진행을 각각 최신 상태에서 갱신
        await updateLedger((latest) => setDraftOptions(latest, commentId, options));
        const fresh = await readDraftJob();
        if (!fresh || fresh.id !== jobId) return;
        await writeDraftJob({ ...fresh, done: [...fresh.done, commentId], updatedAt: new Date().toISOString() });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const fresh = await readDraftJob();
        if (!fresh || fresh.id !== jobId) return;
        await writeDraftJob({
          ...fresh,
          failed: [...fresh.failed, { commentId, error: message.slice(0, 300) }],
          updatedAt: new Date().toISOString(),
        });
      }
    }

    const finished = await readDraftJob();
    if (finished && finished.id === jobId && finished.status === "running") {
      await writeDraftJob({ ...finished, status: "done", updatedAt: new Date().toISOString() });
    }
  } catch {
    // settle — 잡 파일 접근 자체가 실패한 경우. 다음 sweep 이 재시도한다.
  } finally {
    running.delete(jobId);
  }
}
