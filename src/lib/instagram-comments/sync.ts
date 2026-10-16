// 수집(폴링) 파이프: 최근 게시물 → 댓글 → 원장 병합. 앱을 열 때 + 15분 stale 기준으로 호출된다.
import {
  fetchComments,
  fetchMe,
  fetchRecentMedia,
  refreshTokenIfNeeded,
  resolveAccessToken,
} from "./graph";
import { upsertFetched, type FetchedComment, type IgCommentLedger, type IgMedia } from "./model";
import { hasAttempt } from "./queue-model";
import { checkAllUnknownReplies } from "./send-queue";
import { readLedger, readSendQueue, updateLedger } from "./storage";

/** 대기줄에 기록된 답글 번호 → 댓글 id. 동기화가 같은 답글을 다른 댓글에 배정하지 않게 한다. */
async function queueReplyOwners(): Promise<{ owners: Map<string, string>; held: Set<string> }> {
  const queue = await readSendQueue();
  const owners = new Map<string, string>();
  const held = new Set<string>();
  for (const i of queue.items) {
    if (i.replyId) owners.set(i.replyId, i.commentId);
    // 발송 중이거나, 시도했는데 결과가 확정되지 않은 항목 — 그 답글이 이미 달려 있을 수 있다.
    else if (i.status === "sending" || i.status === "unknown" || (hasAttempt(i) && i.status !== "sent")) held.add(i.commentId);
  }
  return { owners, held };
}

/** 페이지 상한에 걸려 다 못 읽은 게시물이 있을 때 화면에 보일 안내. */
export function incompleteNotice(count: number): string {
  return `댓글이 너무 많아 게시물 ${count}개의 댓글을 끝까지 읽지 못했어요. 앞쪽 댓글만 보여요.`;
}

export const SYNC_STALE_MS = 15 * 60 * 1000; // 15분

export function isStale(ledger: IgCommentLedger, nowMs = Date.now()): boolean {
  if (!ledger.sync.lastSyncAt) return true;
  return nowMs - Date.parse(ledger.sync.lastSyncAt) > SYNC_STALE_MS;
}

/** 실동기화. 성공 시 갱신된 원장을 저장하고 돌려준다. */
export async function syncNow(): Promise<IgCommentLedger> {
  await refreshTokenIfNeeded();
  const token = await resolveAccessToken();
  try {
    const me = await fetchMe(token);
    const rawMedia = await fetchRecentMedia(token, 5);
    const media: IgMedia[] = rawMedia.map((m) => ({
      id: m.id,
      captionFirstLine: (m.caption ?? "").split("\n")[0].slice(0, 80),
      permalink: m.permalink,
      timestamp: m.timestamp,
      commentsCount: m.comments_count,
      mediaType: m.media_type,
    }));
    const fetched: FetchedComment[] = [];
    const fetchedCountByMedia = new Map<string, number>();
    let cutShort = 0;
    for (const m of rawMedia) {
      if (m.comments_count === 0) continue;
      const { comments, complete } = await fetchComments(token, m.id);
      if (!complete) cutShort += 1;
      fetchedCountByMedia.set(m.id, comments.length);
      for (const c of comments) {
        // 표시 아이디는 from.username 우선 (타인은 최상위 username 이 null 로 온다).
        const username = c.from?.username ?? c.username ?? "(알 수 없음)";
        fetched.push({
          id: c.id,
          mediaId: m.id,
          username,
          authorId: c.from?.id ?? "",
          text: c.text ?? "",
          timestamp: c.timestamp,
          parentId: c.parent_id,
        });
      }
    }
    // 조용한 실패 감지: 댓글이 달린 게시물인데 API 가 200 + 빈 목록을 준 경우.
    // 토큰에 instagram_business_manage_comments 권한이 빠졌거나 앱이 라이브 모드가 아닐 때 이렇게 온다.
    const invisible = media.filter(
      (m) => m.commentsCount > 0 && (fetchedCountByMedia.get(m.id) ?? 0) === 0
    );
    const total = invisible.reduce((sum, m) => sum + m.commentsCount, 0);
    // 수집은 잠금 밖, 병합은 잠금 안에서 최신 원장에 — 그 사이 저장된 초안·발송 기록을 지키기 위해.
    // 결과 불명 답글이 실제로 달렸는지 조회만 한다 (발송 없음). 실패해도 동기화는 계속한다.
    await checkAllUnknownReplies().catch((e) =>
      console.warn("[ig-sync] 결과 불명 확인 실패:", e instanceof Error ? e.message : e)
    );
    const { owners, held } = await queueReplyOwners();
    return await updateLedger((latest) => {
      const next = upsertFetched(latest, media, fetched, me.username, me.user_id, new Date().toISOString(), owners, held);
      next.sync.incomplete = cutShort > 0 ? incompleteNotice(cutShort) : undefined;
      if (invisible.length > 0) next.sync.lastError = `댓글 ${total}개가 있는데 API가 빈 목록을 돌려줬어요. 토큰에 댓글 권한(instagram_business_manage_comments)이 빠졌거나 앱이 라이브 모드가 아닌 경우입니다. Meta 개발자 대시보드에서 확인하고 새 토큰을 .env.local 의 IG_ACCESS_TOKEN 에 붙여넣어 주세요.`;
      return next;
    });
  } catch (error) {
    return updateLedger(
      (latest): IgCommentLedger => ({
        ...latest,
        sync: { ...latest.sync, lastError: error instanceof Error ? error.message : String(error) },
      })
    );
  }
}

/** stale 이면 동기화, 아니면 저장된 원장 그대로. */
export async function syncIfStale(): Promise<IgCommentLedger> {
  const ledger = await readLedger();
  if (!isStale(ledger)) return ledger;
  return syncNow();
}

/**
 * 자동화 규칙 대상 게시물만 가볍게 재수집 — 매 실행마다 새 댓글을 바로 본다.
 * lastSyncAt 은 건드리지 않는다: 이걸 갱신하면 1분 폴링이 stale 판정을 영원히
 * 리셋해 전체 수집(새 게시물 발견)이 다시는 돌지 않는다.
 */
export async function syncTargetMedia(mediaIds: string[]): Promise<void> {
  const targets = [...new Set(mediaIds)].filter(Boolean);
  if (targets.length === 0) return;
  const token = await resolveAccessToken();
  const me = await fetchMe(token);
  const fetched: FetchedComment[] = [];
  let cutShort = 0;
  for (const mediaId of targets) {
    const { comments, complete } = await fetchComments(token, mediaId);
    if (!complete) cutShort += 1;
    for (const c of comments) {
      const username = c.from?.username ?? c.username ?? "(알 수 없음)";
      fetched.push({
        id: c.id,
        mediaId,
        username,
        authorId: c.from?.id ?? "",
        text: c.text ?? "",
        timestamp: c.timestamp,
        parentId: c.parent_id,
      });
    }
  }
  const { owners, held } = await queueReplyOwners();
  await updateLedger((latest) => {
    const next = upsertFetched(latest, [], fetched, me.username, me.user_id, new Date().toISOString(), owners, held);
    next.sync.lastSyncAt = latest.sync.lastSyncAt;
    // 일부 게시물만 읽는 경로라 "다 읽었다"는 지우지 않고, 못 읽은 경우만 알린다.
    if (cutShort > 0) next.sync.incomplete = incompleteNotice(cutShort);
    return next;
  });
}
