// 발송 대기줄 (wayfinder #81, GLOSSARY.md D11) — 순수 상태 로직.
// henry 가 체크로 승인한 답글들이 하나씩 순서대로 나가는 줄. 일괄 동시 발송은 없다.

import { consecutiveFailures as countFailures, INTERRUPTED_MESSAGE, settleInterrupted, STOPPED_MESSAGE, tooManyFailures } from "@/lib/send-queue/rules";

/**
 * unknown = 요청은 나갔는데 결과를 모른다(시간 초과·연결 끊김·5xx·발송 중 앱 종료).
 * 실제로 달렸을 수 있어 failed 와 구분한다. 다시 담으면 러너가 인스타에서 먼저 확인한다.
 */
export type QueueItemStatus = "queued" | "sending" | "sent" | "failed" | "unknown";

export interface SendQueueItem {
  commentId: string;
  message: string;
  status: QueueItemStatus;
  error?: string;
  queuedAt: string;
  sentAt?: string;
  /** 인스타에 요청을 보낸 횟수. 1 이상이면 재발송 전에 기존 답글을 확인한다. */
  attempts?: number;
  /** 인스타에 처음 요청을 보낸 시각. 결과 불명 확인 때 이 시각 뒤에 달린 우리 답글만 본다. */
  firstAttemptAt?: string;
  /**
   * henry 가 인스타에서 직접 확인하고 "안 달렸다"고 승인한 재발송. 이 표시가 있을 때만
   * 시도 이력이 있는 항목을 확인 없이 다시 보낸다. 다음 시도를 기록할 때 지운다.
   */
  resendApproved?: boolean;
  /** 이 항목으로 확정된 인스타 답글 번호. 결과 불명 확인 때 다른 항목의 답글을 가져다 쓰지 않게 한다. */
  replyId?: string;
}

/**
 * 시도 이력 규칙 (중복 발송 방지의 핵심):
 * 인스타에 요청을 한 번이라도 보낸 항목(attempts ≥ 1)은 줄에서 지우지 않고, 문구도 바꾸지 않는다.
 * 그런 항목은 ① 인스타에서 우리 답글이 정확히 하나 확인되면 sent,
 * ② 아니면 unknown 으로 남고 henry 가 확인 후 다시 보내기를 눌러야만 다시 나간다.
 * 4xx 로 확실히 거절된 첫 시도는 나간 적이 없으니 이력을 지운다(러너 sendOne).
 */
export function hasAttempt(item: Pick<SendQueueItem, "attempts">): boolean {
  return (item.attempts ?? 0) > 0;
}

/** 화면이 그대로 보여 줄 수 있는 한국어 문구를 가진 409 성격의 오류. */
export class QueueConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueConflictError";
  }
}

export const ATTEMPTED_MESSAGE_LOCKED =
  "이미 인스타에 보낸 적이 있는 답글이라 문구를 바꿀 수 없어요. 처음 보낸 문구 그대로만 다시 확인해요.";
export const ATTEMPTED_RECALL_LOCKED =
  "이미 인스타에 보낸 적이 있는 답글이라 줄에서 뺄 수 없어요. 인스타에서 답글이 달렸는지 확인해 주세요.";

/**
 * 문구를 바꿀 수 없는데 다른 문구로 다시 담으려는 댓글 id 목록.
 * 시도 이력이 있거나, 이미 발송권을 잡았거나(sending) 보낸(sent) 항목이 해당한다.
 * 시도 전 queued·failed 항목은 새 문구로 바뀐다(enqueue).
 */
export function messageConflicts(state: SendQueueState, entries: { commentId: string; message: string }[]): string[] {
  return entries
    .filter((e) => {
      const ex = state.items.find((i) => i.commentId === e.commentId);
      if (!ex || ex.message.trim() === e.message.trim()) return false;
      return hasAttempt(ex) || ex.status === "sending" || ex.status === "sent";
    })
    .map((e) => e.commentId);
}

export type QueueStatus = "idle" | "running" | "stopped" | "done";

export interface SendQueueState {
  items: SendQueueItem[];
  status: QueueStatus;
  /** 자동 정지 사유 (연속 실패 등) */
  stopReason?: string;
  startedAt?: string;
  /** heartbeat — sweep 의 stale 판정에 쓴다 */
  updatedAt: string;
}

export function createQueue(now = new Date().toISOString()): SendQueueState {
  return { items: [], status: "idle", updatedAt: now };
}

/**
 * 발송 간격: 매번 15~30초 무작위 (고정값 아님 — 균일 패턴 제거, D11).
 * 2026-08-19 리서치(docs/research/instagram-comment-reply-rate-limits.md)로 10~20초에서 넓혔다.
 * 공개 댓글 답글이 계정 제재를 부르는 지점이고 Meta 는 그 임계값을 공개하지 않는다.
 */
export const SEND_GAP_MIN_MS = 15_000;
export const SEND_GAP_MAX_MS = 30_000;

export function randomGapMs(rand = Math.random()): number {
  return Math.round(SEND_GAP_MIN_MS + rand * (SEND_GAP_MAX_MS - SEND_GAP_MIN_MS));
}

/**
 * 공개 답글 시간당 상한. 간격만으로는 총량을 못 막는다 — 15초 간격이어도
 * 릴스 하나가 터지면 시간당 240건이 나간다. 이 상한이 그 폭주를 끊는다.
 *
 * 30 이라는 값은 공식 문서에 없다(Meta 는 공개 답글 임계값을 공개하지 않는다).
 * 벤더 관행과 사고 사례에서 역산한 추정치다. DM(공식 750/시간)은 별도 상한을 쓴다.
 */
export const HOURLY_REPLY_CAP = 30;
export const HOURLY_WINDOW_MS = 60 * 60 * 1000;

/**
 * 창(1시간) 밖으로 나간 발송 기록을 버리고 오름차순으로 돌려준다.
 * 원장이 무한히 커지지 않게 막는 유일한 장치라, 기록을 남기는 쪽은 반드시 이걸 거친다.
 */
export function pruneSentTimes(times: string[] | undefined, nowMs: number): string[] {
  if (!times?.length) return [];
  const floor = nowMs - HOURLY_WINDOW_MS;
  return times
    .map((t) => Date.parse(t))
    .filter((ms) => Number.isFinite(ms) && ms > floor)
    .sort((a, b) => a - b)
    .map((ms) => new Date(ms).toISOString());
}

export interface HourlyCapState {
  /** 지난 1시간 안에 나간 공개 답글 수 */
  sentInWindow: number;
  /** 지금 더 보낼 수 있는 건수 (0이면 상한 도달) */
  remaining: number;
  /** 상한이 찼을 때, 1건이 다시 열리기까지 남은 ms. 여유가 있으면 0. */
  retryInMs: number;
}

/**
 * 지난 1시간 발송 기록으로 지금 보낼 수 있는지 판정한다.
 * 창이 굴러가는 방식이라, 상한이 찼어도 가장 오래된 발송이 창 밖으로 나가는 순간 1건이 열린다.
 */
export function hourlyCapState(times: string[] | undefined, nowMs: number): HourlyCapState {
  const recent = pruneSentTimes(times, nowMs);
  const remaining = Math.max(0, HOURLY_REPLY_CAP - recent.length);
  const retryInMs =
    remaining > 0 || recent.length === 0
      ? 0
      : Math.max(0, Date.parse(recent[0]) + HOURLY_WINDOW_MS - nowMs);

  return {
    sentInWindow: recent.length,
    remaining,
    retryInMs,
  };
}

/** 연속 실패 자동 정지 임계 (토큰 만료류 전체 장애 방어). 채널 공통 규칙에서 온다. */
export { MAX_CONSECUTIVE_FAILURES } from "@/lib/send-queue/rules";

/**
 * 항목 추가. 시도 전 queued 는 새 문구로 바꾸고, sending/sent 는 건드리지 않고,
 * failed·unknown 은 다시 queued 로 되살린다(재시도 — attempts 는 남겨 러너가 먼저 확인하게 한다). 새 항목은 뒤에 붙는다.
 * 시도 이력이 있는 항목은 처음 보낸 문구를 그대로 둔다(hasAttempt 규칙). 다시 담으면 러너는 보내지 않고
 * 인스타에서 확인만 한다.
 * 담는 순간 status 가 idle/done/stopped 였다면 running 으로 되돌린다.
 */
export function enqueue(
  state: SendQueueState,
  entries: { commentId: string; message: string }[],
  now: string
): SendQueueState {
  const items = [...state.items];
  for (const e of entries) {
    const idx = items.findIndex((i) => i.commentId === e.commentId);
    if (idx >= 0) {
      const ex = items[idx];
      if (ex.status === "queued" && !hasAttempt(ex)) {
        // 아직 인스타에 요청한 적 없는 대기 항목은 henry 가 다시 승인한 새 문구로 바꾼다.
        // 러너는 잠금 안에서 최신 줄을 읽고 발송권을 잡으므로 바뀐 문구가 그대로 나간다.
        if (ex.message !== e.message) items[idx] = { ...ex, message: e.message };
        continue;
      }
      if (ex.status === "failed" || ex.status === "unknown") {
        // 시도 이력이 있으면 처음 문구를 지킨다 (다른 문구는 호출부가 messageConflicts 로 먼저 거절한다).
        const message = hasAttempt(ex) ? ex.message : e.message;
        items[idx] = { ...ex, status: "queued", error: undefined, message, queuedAt: now };
      }
      continue;
    }
    items.push({ commentId: e.commentId, message: e.message, status: "queued", queuedAt: now });
  }
  const hasQueued = items.some((i) => i.status === "queued");
  return {
    ...state,
    items,
    status: hasQueued ? "running" : state.status,
    stopReason: hasQueued ? undefined : state.stopReason,
    startedAt: state.startedAt ?? now,
    updatedAt: now,
  };
}

/**
 * henry 가 인스타에서 직접 보고 "안 달렸다"고 확인한 unknown 을 다시 보내게 한다.
 * 이 경로만 시도 이력이 있는 항목을 인스타 확인 없이 다시 보낸다.
 */
export function approveResend(state: SendQueueState, commentId: string, now: string): SendQueueState {
  const item = state.items.find((i) => i.commentId === commentId);
  if (!item || item.status !== "unknown") {
    throw new QueueConflictError("결과 확인이 필요한 답글만 다시 보낼 수 있어요.");
  }
  return {
    ...markItem(state, commentId, { status: "queued", error: undefined, resendApproved: true }, now),
    status: "running",
    stopReason: undefined,
  };
}

/** 다음에 보낼 항목 (queued 중 맨 앞). */
export function nextQueued(state: SendQueueState): SendQueueItem | null {
  return state.items.find((i) => i.status === "queued") ?? null;
}

/** 항목 상태 갱신. */
export function markItem(
  state: SendQueueState,
  commentId: string,
  patch: Partial<Pick<SendQueueItem, "status" | "error" | "sentAt" | "attempts" | "firstAttemptAt" | "resendApproved" | "replyId">>,
  now: string
): SendQueueState {
  return {
    ...state,
    items: state.items.map((i) => (i.commentId === commentId ? { ...i, ...patch } : i)),
    updatedAt: now,
  };
}

/** 발송 전(queued) 항목 회수 — 줄에서 뺀다. sending/sent/failed 와 시도 이력이 있는 항목은 못 뺀다. */
export function removeQueued(state: SendQueueState, commentId: string, now: string): SendQueueState {
  const item = state.items.find((i) => i.commentId === commentId);
  if (!item || item.status !== "queued") return state;
  if (hasAttempt(item)) throw new QueueConflictError(ATTEMPTED_RECALL_LOCKED);
  return {
    ...state,
    items: state.items.filter((i) => i.commentId !== commentId),
    updatedAt: now,
  };
}

/** 최근 시도들의 연속 실패 수 — sent 를 만나면 끊긴다 (채널 공통 규칙). */
export function consecutiveFailures(state: SendQueueState): number {
  return countFailures(state.items);
}

/** 줄 정리 후 전체 상태 판정: queued 가 남았으면 running 유지, 없으면 done. */
export function settleStatus(state: SendQueueState, now: string): SendQueueState {
  if (state.status === "stopped") return state;
  const hasQueued = state.items.some((i) => i.status === "queued" || i.status === "sending");
  if (hasQueued) return { ...state, status: "running", updatedAt: now };
  const attempted = state.items.length > 0;
  return { ...state, status: attempted ? "done" : "idle", updatedAt: now };
}

/** 연속 실패 임계 도달 시 자동 정지. */
export function stopIfFailing(state: SendQueueState, now: string): SendQueueState {
  // 결과 불명도 연속 실패로 센다 — 네트워크가 통째로 끊긴 경우 계속 시도하지 않게.
  const attempts = state.items.map((i) => (i.status === "unknown" ? { ...i, status: "failed" } : i));
  if (!tooManyFailures(attempts)) return state;
  return {
    ...state,
    status: "stopped",
    stopReason: STOPPED_MESSAGE,
    updatedAt: now,
  };
}

export function queueCounts(state: SendQueueState) {
  const by = (s: QueueItemStatus) => state.items.filter((i) => i.status === s).length;
  return { queued: by("queued"), sending: by("sending"), sent: by("sent"), failed: by("failed"), unknown: by("unknown") };
}

/**
 * 러너가 새로 돌기 시작할 때: 러너는 한 번에 하나뿐이라 남아 있는 sending 은 끊긴 흔적이다.
 * 다시 보내지 않는다 — 원장에 이미 답이 있으면 sent, 없으면 결과 불명(unknown).
 */
export function settleInterruptedSends(state: SendQueueState, repliedByMe: (commentId: string) => boolean, now: string): SendQueueState {
  if (!state.items.some((i) => i.status === "sending")) return state;
  const items = settleInterrupted(state.items, (i) => repliedByMe(i.commentId), (i, result): SendQueueItem =>
    result === "sent" ? { ...i, status: "sent", sentAt: now } : { ...i, status: "unknown", error: INTERRUPTED_MESSAGE }
  );
  return { ...state, items, updatedAt: now };
}
