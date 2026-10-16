// 발송 대기줄 러너 (#81, GLOSSARY.md D11) — henry 가 체크로 승인한 답글을
// 서버 백그라운드에서 하나씩, 무작위 15~30초 간격으로 내보낸다.
// 인스타 답글 발송은 전부 여기 한 곳을 지난다 (/reply 라우트도 이 줄에 담는다).
//
// 중복 발송 방지:
//   ① 대기줄 파일은 updateSendQueue(파일별 잠금 + 원자적 쓰기)로만 고친다.
//      담기·회수·발송권 확보가 같은 잠금을 지나서, 회수한 항목을 러너가 되살리지 못한다.
//   ② 러너는 잠금 안에서 최신 줄을 다시 읽고 항목을 sending 으로 바꾼 뒤에만 인스타를 부른다.
//   ③ 결과를 모르는 발송(시간 초과·연결 끊김·5xx)은 unknown. 한 번이라도 요청한 항목은 회수·문구 변경이
//      안 된다(queue-model hasAttempt). 다시 담으면 보내지 않고 인스타에서 확인만 한다: 첫 시도 뒤 우리 계정이
//      같은 문구로 단 답글이 정확히 하나면 sent, 아니면 unknown 유지. 다시 보내기는 henry 의 확인 승인으로만.
//   ④ 간격(15~30초)과 시간당 상한(HOURLY_REPLY_CAP)을 매 발송 직전에 검사하고, 요청 전에 자리를 예약한다
//      (결과 불명 발송도 센다).
//   ⑤ 모든 Graph 호출에 시간 제한을 건다. 어떤 예외가 나도 항목을 sending 에 남기지 않는다(unknown).
//
// 안전 규칙: 여기서 나가는 발송은 전부 henry 가 검토·체크한 메시지뿐이다.
import { fetchMe, fetchReplies, isDefiniteFailure, postReply, resolveAccessToken } from "./graph";
import { markSent, own, replyTargetId, reserveSendSlot, sendWaitMs, type IgCommentLedger } from "./model";
import {
  approveResend,
  enqueue,
  hasAttempt,
  messageConflicts,
  ATTEMPTED_MESSAGE_LOCKED,
  QueueConflictError,
  hourlyCapState,
  markItem,
  nextQueued,
  randomGapMs,
  removeQueued,
  settleInterruptedSends,
  settleStatus,
  stopIfFailing,
  type SendQueueItem,
  type SendQueueState,
} from "./queue-model";
import { readLedger, readSendQueue, updateLedger, updateSendQueue } from "./storage";

const POST_TIMEOUT_MS = 30_000;
// heartbeat 겸 취소 반응성: 긴 대기도 이 단위로 쪼갠다.
const WAIT_SLICE_MS = 5_000;

interface RunnerDeps {
  sleep: (ms: number) => Promise<void>;
  gapMs: () => number;
  postTimeoutMs: number;
  /** 테스트 전용: 러너가 빈 줄을 보고 끝나기 직전에 부른다 (늦게 담긴 항목 재현용). */
  onIdle?: () => Promise<void>;
}

const defaultDeps: RunnerDeps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  gapMs: () => randomGapMs(),
  postTimeoutMs: POST_TIMEOUT_MS,
};

interface RunnerState {
  running: boolean;
  done: Promise<void>;
  deps: RunnerDeps;
}

function runnerState(): RunnerState {
  const g = globalThis as typeof globalThis & { __igSendQueue?: RunnerState };
  g.__igSendQueue ??= { running: false, done: Promise.resolve(), deps: defaultDeps };
  g.__igSendQueue.deps ??= defaultDeps;
  g.__igSendQueue.done ??= Promise.resolve();
  return g.__igSendQueue;
}

/** 테스트 전용: 대기·간격·타임아웃을 바꾼다. 인자 없이 부르면 기본값으로 되돌린다. */
export function setSendQueueDepsForTest(deps?: Partial<RunnerDeps>): void {
  runnerState().deps = { ...defaultDeps, ...deps };
}

/** 테스트 전용: 러너가 (재기동까지 포함해) 완전히 멈출 때까지 기다린다. */
export async function sendQueueIdle(): Promise<void> {
  const state = runnerState();
  while (true) {
    const done = state.done;
    await done;
    if (state.done === done && !state.running) return;
  }
}

const nowIso = () => new Date().toISOString();

/** 항목 담기 + 러너 기동. 초안이 빈 항목은 호출부에서 걸러 보낸다. */
export async function enqueueAndStart(
  entries: { commentId: string; message: string }[]
): Promise<SendQueueState> {
  let conflict = false;
  const state = await updateSendQueue((s) => {
    if (messageConflicts(s, entries).length > 0) {
      conflict = true;
      return s;
    }
    return enqueue(s, entries, nowIso());
  });
  if (conflict) throw new QueueConflictError(ATTEMPTED_MESSAGE_LOCKED);
  startSendQueueRunner();
  return state;
}

/** henry 가 인스타에서 직접 확인한 뒤 누르는 "확인했어요, 다시 보내기". unknown 만 받는다. */
export async function resendAfterCheck(commentId: string): Promise<SendQueueState> {
  const state = await updateSendQueue((s) => approveResend(s, commentId, nowIso()));
  startSendQueueRunner();
  return state;
}

/** 발송 전(queued) 항목 회수. 이미 sending 이면 못 뺀다. 시도 이력이 있으면 QueueConflictError. */
export async function removeFromQueue(commentId: string): Promise<SendQueueState> {
  return updateSendQueue((s) => {
    const now = nowIso();
    const removed = removeQueued(s, commentId, now);
    return removed === s ? s : settleStatus(removed, now);
  });
}

/**
 * 서버 시작 때(instrumentation) 한 번: 줄 상태와 무관하게 sending 으로 남은 항목을 먼저
 * unknown(또는 원장에 답이 있으면 sent)으로 정리하고, running 으로 남은 줄을 이어서 돌린다.
 */
export async function resumeSendQueueIfRunning(): Promise<void> {
  await settleOnStart();
  const state = await readSendQueue();
  if (state.status === "running") startSendQueueRunner();
}

/** 러너 기동 — 이미 돌고 있으면 no-op (멱등). */
export function startSendQueueRunner(): void {
  const state = runnerState();
  if (state.running) return;
  state.running = true;
  let crashed = false;
  state.done = runLoop()
    .catch((e) => {
      crashed = true; // 오류로 멈춘 러너는 다시 띄우지 않는다 (같은 오류로 헛도는 것 방지)
      console.warn("[ig-send-queue] 러너 중단:", e instanceof Error ? e.message : e);
    })
    .finally(async () => {
      runnerState().running = false;
      if (crashed) return;
      // 러너가 빈 줄을 읽고 끝나는 사이에 담긴 항목은 startSendQueueRunner 가 no-op 이라
      // 아무도 안 보낸다. 실행 표시를 내린 뒤 한 번 더 보고 남았으면 다시 띄운다.
      try {
        const after = await readSendQueue();
        if (after.status === "running" && nextQueued(after)) startSendQueueRunner();
      } catch (e) {
        console.warn("[ig-send-queue] 재확인 실패:", e instanceof Error ? e.message : e);
      }
    });
}

/** 시작할 때 한 번: 앞선 러너가 보내던 중 끊긴 건을 정리한다 (다시 보내지 않는다). */
async function settleOnStart(): Promise<void> {
  const ledger = await readLedger();
  await updateSendQueue((s) => {
    if (!s.items.some((i) => i.status === "sending")) return s;
    const now = nowIso();
    const settled = settleInterruptedSends(s, (id) => Boolean(own(ledger.comments, id)?.repliedByMe), now);
    return stopIfFailing(settleStatus(settled, now), now);
  });
}

/** 다음 발송까지 남은 ms: 무작위 간격과 시간당 상한 중 긴 쪽. */
function waitBeforeSend(ledger: IgCommentLedger, gapMs: number): number {
  const nowMs = Date.now();
  const gapWait = sendWaitMs(ledger.sync.lastSentAt, nowMs, gapMs);
  const cap = hourlyCapState(ledger.sync.recentSentAt, nowMs);
  return Math.max(gapWait, cap.remaining > 0 ? 0 : Math.max(1, cap.retryInMs));
}

type Claim = { kind: "send"; item: SendQueueItem } | { kind: "skip" } | { kind: "stop" };

/**
 * 잠금 안에서 최신 줄을 읽고 발송권을 확보한다. 회수됐거나 중지됐으면 아무것도 안 한다.
 * 원장에 이미 답이 있으면 보내지 않고 sent 로 닫는다.
 */
async function claimNext(ledger: IgCommentLedger): Promise<Claim> {
  let claim: Claim = { kind: "stop" };
  await updateSendQueue((s) => {
    if (s.status !== "running") {
      claim = { kind: "stop" };
      return s;
    }
    const next = nextQueued(s);
    const now = nowIso();
    if (!next) {
      claim = { kind: "stop" };
      return settleStatus(s, now);
    }
    const comment = own(ledger.comments, next.commentId);
    if (!comment) {
      claim = { kind: "skip" };
      const failed = markItem(s, next.commentId, { status: "failed", error: "원장에 없는 댓글" }, now);
      return stopIfFailing(settleStatus(failed, now), now);
    }
    if (comment.repliedByMe) {
      claim = { kind: "skip" };
      return settleStatus(markItem(s, next.commentId, { status: "sent", sentAt: now }, now), now);
    }
    claim = { kind: "send", item: next };
    return markItem(s, next.commentId, { status: "sending" }, now);
  });
  return claim;
}

// 인스타 timestamp 는 초 단위라 첫 시도 시각보다 살짝 앞서 찍힐 수 있다.
const ATTEMPT_CLOCK_SLACK_MS = 60_000;

/**
 * 결과 불명이던 발송이 실제로 달렸는지. 답글은 스레드 맨 위 댓글에 모이므로 같은 스레드의
 * 다른 사람에게 단 우리 답글도 섞여 있다. 그래서 세 조건을 모두 본다:
 * 우리 계정 · 보낸 문구와 같은 글 · 첫 시도 뒤(시각을 모르면 제외).
 * 다른 댓글에 이미 배정된 답글 번호(원장 myReplyId, 대기줄 replyId)는 후보에서 뺀다.
 * 같은 스레드에 같은 문구로 아직 확인 안 된 다른 항목이 있으면 누구 답글인지 가릴 수 없으니 null.
 * 정확히 하나일 때만 그 답글 번호를 돌려준다. 0개나 여러 개면 null (확인 불가 → unknown 유지).
 */
async function findExistingReply(
  token: string,
  targetId: string,
  item: SendQueueItem,
  signal: AbortSignal
): Promise<string | null> {
  const sentText = item.message.trim();
  const ledger = await readLedger();
  const queue = await readSendQueue();
  const taken = new Set<string>();
  for (const c of Object.values(ledger.comments)) {
    if (c.id !== item.commentId && c.myReplyId) taken.add(c.myReplyId);
  }
  for (const i of queue.items) if (i.commentId !== item.commentId && i.replyId) taken.add(i.replyId);
  const rival = queue.items.some(
    (i) =>
      i.commentId !== item.commentId &&
      i.status !== "sent" &&
      hasAttempt(i) &&
      i.message.trim() === sentText &&
      replyTargetId(ledger, i.commentId) === targetId
  );
  if (rival) return null;

  const me = await fetchMe(token, signal);
  const replies = await fetchReplies(token, targetId, signal);
  const floor = item.firstAttemptAt ? Date.parse(item.firstAttemptAt) - ATTEMPT_CLOCK_SLACK_MS : Number.NaN;
  const matches = replies.filter((r) => {
    const ours = r.from?.id === me.user_id || r.from?.username === me.username || r.username === me.username;
    const at = r.timestamp ? Date.parse(r.timestamp) : Number.NaN;
    return ours && !taken.has(r.id) && (r.text ?? "").trim() === sentText && at >= floor;
  });
  return matches.length === 1 ? matches[0].id : null;
}

const NOT_CONFIRMED_MESSAGE =
  "인스타에서 이 답글을 하나로 확인하지 못했어요. 인스타에서 직접 본 뒤, 안 달렸으면 '확인했어요, 다시 보내기'를 누르세요.";

async function recordSent(item: SendQueueItem, replyId: string): Promise<void> {
  const now = nowIso();
  await updateLedger((l) => markSent(l, item.commentId, replyId, item.message, now));
  await updateSendQueue((s) =>
    settleStatus(markItem(s, item.commentId, { status: "sent", sentAt: now, error: undefined, replyId }, now), now)
  );
}

export const CHECK_NOT_FOUND_MESSAGE =
  "인스타에서 이 답글을 찾지 못했어요. 직접 확인한 뒤 다시 보내기를 눌러 주세요.";

const CHECK_TIMEOUT_MS = 30_000;

/**
 * "인스타에서 다시 확인" — 결과 불명(unknown) 항목을 인스타에서 조회만 한다. 절대 보내지 않는다.
 * 우리 답글이 정확히 하나 보이면 sent(+답글 번호), 아니면 unknown 을 유지하고 안내 문구를 남긴다.
 * 조회 사이에 상태가 바뀌었으면(다시 보내기 승인 등) 아무것도 고치지 않는다.
 */
export async function checkUnknownReply(commentId: string): Promise<SendQueueState> {
  const item = (await readSendQueue()).items.find((i) => i.commentId === commentId);
  if (!item || item.status !== "unknown") return readSendQueue();
  let replyId: string | null = null;
  let note = CHECK_NOT_FOUND_MESSAGE;
  try {
    const token = await resolveAccessToken();
    const ledger = await readLedger();
    replyId = await findExistingReply(token, replyTargetId(ledger, commentId), item, AbortSignal.timeout(CHECK_TIMEOUT_MS));
  } catch (error) {
    note = `인스타 확인에 실패했어요: ${error instanceof Error ? error.message : String(error)}`;
  }
  const now = nowIso();
  let found = false;
  const state = await updateSendQueue((s) => {
    const latest = s.items.find((i) => i.commentId === commentId);
    if (!latest || latest.status !== "unknown" || latest.resendApproved || latest.message !== item.message) return s;
    if (!replyId) return markItem(s, commentId, { error: note.slice(0, 300) }, now);
    found = true;
    return settleStatus(markItem(s, commentId, { status: "sent", sentAt: now, error: undefined, replyId }, now), now);
  });
  if (found && replyId) {
    const id = replyId;
    await updateLedger((l) => markSent(l, commentId, id, item.message, now));
  }
  return state;
}

/** 동기화 때 한 번: unknown 항목을 전부 조회만 해서 확인되면 sent 로 닫는다 (발송 없음). */
export async function checkAllUnknownReplies(): Promise<void> {
  const ids = (await readSendQueue()).items.filter((i) => i.status === "unknown").map((i) => i.commentId);
  for (const id of ids) await checkUnknownReply(id);
}

async function recordFailure(item: SendQueueItem, status: "failed" | "unknown", message: string): Promise<void> {
  await updateSendQueue((s) => {
    const now = nowIso();
    const marked = markItem(s, item.commentId, { status, error: message.slice(0, 300) }, now);
    return stopIfFailing(settleStatus(marked, now), now);
  });
}

async function sendOne(item: SendQueueItem, ledger: IgCommentLedger, deps: RunnerDeps): Promise<void> {
  const targetId = replyTargetId(ledger, item.commentId);
  let token: string;
  try {
    token = await resolveAccessToken();
  } catch (error) {
    await recordFailure(item, "failed", error instanceof Error ? error.message : String(error));
    return;
  }

  // 전에 요청을 보낸 적이 있으면 보내지 않고 확인만 한다. henry 가 확인 후 승인한 경우만 건너뛴다.
  if (hasAttempt(item) && !item.resendApproved) {
    try {
      const existing = await findExistingReply(token, targetId, item, AbortSignal.timeout(deps.postTimeoutMs));
      if (existing) await recordSent(item, existing);
      else await recordFailure(item, "unknown", NOT_CONFIRMED_MESSAGE);
      return;
    } catch (error) {
      // 확인을 못 하면 보내지 않는다 — 확인 없이 보내면 두 번 달릴 수 있다.
      const reason = error instanceof Error ? error.message : String(error);
      await recordFailure(item, "unknown", `기존 답글 확인 실패: ${reason}`);
      return;
    }
  }

  // 요청 전에 시도 횟수와 간격·시간당 상한 자리를 먼저 기록한다 (결과 불명도 센다).
  const attemptAt = nowIso();
  await updateSendQueue((s) =>
    markItem(
      s,
      item.commentId,
      { attempts: (item.attempts ?? 0) + 1, firstAttemptAt: item.firstAttemptAt ?? attemptAt, resendApproved: undefined },
      attemptAt
    )
  );
  await updateLedger((l) => reserveSendSlot(l, attemptAt));
  try {
    const result = await postReply(token, targetId, item.message, AbortSignal.timeout(deps.postTimeoutMs));
    await recordSent(item, result.id);
  } catch (error) {
    if (isDefiniteFailure(error)) {
      await recordFailure(item, "failed", error instanceof Error ? error.message : String(error));
      // 4xx 로 거절된 첫 시도는 나간 적이 없다 — 이력을 지워 문구 수정·회수를 다시 허용한다.
      if (!hasAttempt(item)) {
        await updateSendQueue((s) => markItem(s, item.commentId, { attempts: undefined, firstAttemptAt: undefined }, nowIso()));
      }
      return;
    }
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? `발송 응답이 ${deps.postTimeoutMs / 1000}초 안에 오지 않았어요`
        : error instanceof Error
          ? error.message
          : String(error);
    await recordFailure(item, "unknown", `결과 불명 (달렸을 수 있어요): ${reason}`);
  }
}

async function runLoop(): Promise<void> {
  const deps = runnerState().deps;
  await settleOnStart().catch((e) =>
    console.warn("[ig-send-queue] 끊긴 발송 정리 실패:", e instanceof Error ? e.message : e)
  );
  // 간격은 항목마다 한 번 뽑는다 — 대기 조각마다 새로 뽑으면 짧은 쪽으로 쏠린다.
  let gap = deps.gapMs();
  while (true) {
    const peek = await readSendQueue();
    if (peek.status !== "running" || !nextQueued(peek)) {
      await updateSendQueue((s) => (s.status === "running" && !nextQueued(s) ? settleStatus(s, nowIso()) : s));
      await deps.onIdle?.();
      return;
    }

    const ledger = await readLedger();
    const wait = waitBeforeSend(ledger, gap);
    if (wait > 0) {
      await deps.sleep(Math.min(wait, WAIT_SLICE_MS));
      await updateSendQueue((s) => (s.status === "running" ? { ...s, updatedAt: nowIso() } : s));
      continue; // 다시 상태부터 판단 (회수·중지 반영)
    }

    const claim = await claimNext(ledger);
    if (claim.kind === "stop") {
      await deps.onIdle?.();
      return;
    }
    if (claim.kind === "skip") continue;
    try {
      await sendOne(claim.item, ledger, deps);
    } catch (error) {
      // 기록 중 예외 등 무엇이 나도 sending 에 남기지 않는다. 나갔을 수 있으니 unknown.
      const reason = error instanceof Error ? error.message : String(error);
      await recordFailure(claim.item, "unknown", `발송 처리 중 오류: ${reason}`).catch(() => undefined);
    }
    gap = deps.gapMs();
  }
}
