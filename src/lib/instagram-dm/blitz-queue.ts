// DM 쳐내기 발송 대기줄 — 순수 상태 로직 (I/O 없음).
// 계정 주인이 ⏎ 로 승인한 말풍선들이 서버 뒤에서 하나씩 나간다. 화면은 기다리지 않고 다음 사람으로 넘어간다.
//
// 간격 (계정 정지가 가장 큰 위험):
//   Meta 공식 발송 한도는 계정당 초당 300건이라 닿을 일이 없다. 위험은 공개되지 않은 스팸 판정 쪽이라
//   사람이 손으로 보내는 속도에 맞춘다 — 같은 사람에게 이어 치는 말풍선은 2초, 다음 사람은 12초(수동 발송과 같은 값).
// 실패: 24시간 창이 닫힌 대화는 그 사람 것만 실패 처리하고 계속, 그 밖의 오류는 줄 전체를 멈춘다(재시도 반복이 스팸처럼 보인다).


export type BlitzItemStatus = "queued" | "sending" | "sent" | "failed";

export interface BlitzItem {
  id: string;
  conversationId: string;
  text: string;
  status: BlitzItemStatus;
  error?: string;
  queuedAt: string;
  sentAt?: string;
}

export type BlitzQueueStatus = "idle" | "running" | "stopped" | "done";

export interface BlitzQueueState {
  items: BlitzItem[];
  status: BlitzQueueStatus;
  stopReason?: string;
  /** heartbeat */
  updatedAt: string;
}

/** 앱이 꺼져 보내던 중 끊긴 건 — 실제로 나갔는지 모르니 다시 보내지 않는다 */
export const INTERRUPTED_MESSAGE = "앱이 꺼져 보냈는지 확인하지 못했어요. 인스타 앱에서 확인해 주세요";

export const BUBBLE_GAP_MS = 2_000;
export const PERSON_GAP_MS = 12_000;
/** 완료된 항목은 이만큼만 남긴다 — 파일이 무한히 커지지 않게 */
const KEEP_DONE = 200;

export function createBlitzQueue(now = new Date().toISOString()): BlitzQueueState {
  return { items: [], status: "idle", updatedAt: now };
}

/** 한 사람의 답장(말풍선 여러 개)을 줄 끝에 붙인다. 빈 말풍선은 버린다. */
export function enqueueReply(state: BlitzQueueState, conversationId: string, bubbles: readonly string[], now: string): BlitzQueueState {
  const texts = bubbles.map((b) => b.trim()).filter(Boolean);
  if (texts.length === 0) return state;
  const added = texts.map((text, k) => ({ id: `${conversationId}:${now}:${k}`, conversationId, text, status: "queued" as const, queuedAt: now }));
  const done = state.items.filter((i) => i.status === "sent" || i.status === "failed");
  const live = state.items.filter((i) => i.status === "queued" || i.status === "sending");
  return {
    items: [...done.slice(-KEEP_DONE), ...live, ...added],
    status: "running",
    stopReason: undefined,
    updatedAt: now,
  };
}

export function nextBlitzItem(state: BlitzQueueState): BlitzItem | null {
  return state.items.find((i) => i.status === "queued") ?? null;
}

/** 마지막으로 실제 나간 항목 */
function lastSent(state: BlitzQueueState): BlitzItem | null {
  for (let k = state.items.length - 1; k >= 0; k--) if (state.items[k].status === "sent") return state.items[k];
  return null;
}

/**
 * 다음 항목까지 기다릴 시간. 기준 시각은 원장의 마지막 발송(수동 발송 포함)이다.
 * 바로 앞에 나간 것이 같은 사람이면 말풍선 간격, 아니면 사람 간격.
 */
export function blitzWaitMs(state: BlitzQueueState, next: BlitzItem, ledgerLastSentAt: string | undefined, nowMs: number): number {
  const last = Date.parse(ledgerLastSentAt ?? "");
  if (!Number.isFinite(last)) return 0;
  const prev = lastSent(state);
  const sameWave = prev?.conversationId === next.conversationId && prev.sentAt === ledgerLastSentAt;
  return Math.max(0, last + (sameWave ? BUBBLE_GAP_MS : PERSON_GAP_MS) - nowMs);
}

export function markBlitzItem(state: BlitzQueueState, id: string, patch: Partial<Pick<BlitzItem, "status" | "error" | "sentAt">>, now: string): BlitzQueueState {
  return { ...state, items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)), updatedAt: now };
}

/** 한 사람의 남은 말풍선을 모두 실패로 (창이 닫혀 그 사람에게는 더 보낼 수 없을 때) */
export function failConversation(state: BlitzQueueState, conversationId: string, error: string, now: string): BlitzQueueState {
  return {
    ...state,
    items: state.items.map((i) => (i.conversationId === conversationId && (i.status === "queued" || i.status === "sending") ? { ...i, status: "failed", error } : i)),
    updatedAt: now,
  };
}

/** 줄 전체 정지: 남은 항목은 그대로 두고(계정 주인이 다시 시작할 수 있게) 상태만 멈춘다. */
export function stopBlitz(state: BlitzQueueState, reason: string, now: string): BlitzQueueState {
  return { ...state, status: "stopped", stopReason: reason, updatedAt: now };
}

/** 다시 시작 */
export function resumeBlitz(state: BlitzQueueState, now: string): BlitzQueueState {
  const failedRetry = state.items.map((i) => (i.status === "failed" && i.error === state.stopReason ? { ...i, status: "queued" as const, error: undefined } : i));
  const hasQueued = failedRetry.some((i) => i.status === "queued");
  return { items: failedRetry, status: hasQueued ? "running" : "done", stopReason: undefined, updatedAt: now };
}

/** 남은 게 없으면 done */
export function settleBlitz(state: BlitzQueueState, now: string): BlitzQueueState {
  if (state.status !== "running") return state;
  return state.items.some((i) => i.status === "queued" || i.status === "sending") ? state : { ...state, status: "done", updatedAt: now };
}

/** 앱이 꺼져 보내던 중 끊긴 건: 두 번 달리지 않게 다시 보내지 않는다. */
export function settleInterruptedBlitz(state: BlitzQueueState, alreadySent: (i: BlitzItem) => boolean, now: string): BlitzQueueState {
  return {
    ...state,
    items: state.items.map((i) =>
      i.status !== "sending" ? i : alreadySent(i) ? { ...i, status: "sent", sentAt: i.sentAt ?? now } : { ...i, status: "failed", error: INTERRUPTED_MESSAGE }
    ),
    updatedAt: now,
  };
}

/** 화면용 요약: 대화별 상태. 남은 말풍선이 있으면 pending, 아니면 그 대화의 마지막 항목 결과. */
export function blitzConversationStatus(state: BlitzQueueState): Record<string, { status: "pending" | "sent" | "failed"; error?: string }> {
  const out: Record<string, { status: "pending" | "sent" | "failed"; error?: string }> = {};
  for (const i of state.items) {
    if (out[i.conversationId]?.status === "pending") continue;
    out[i.conversationId] =
      i.status === "queued" || i.status === "sending" ? { status: "pending" } : i.status === "failed" ? { status: "failed", error: i.error } : { status: "sent" };
  }
  return out;
}
