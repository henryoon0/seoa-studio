// DM 쳐내기 발송 러너 — blitz-queue 의 말풍선을 서버 뒤에서 하나씩 보낸다.
// fire-and-forget 세트: ① 고아 재개(GET /blitz/queue 가 running 이면 다시 기동) ② 건별 저장 ③ 발송 하드 타임아웃.
// 여기서 나가는 건 전부 계정 주인이 화면에서 ⏎ 로 승인한 말풍선뿐이다.
// 앱 스케줄러(1분)도 running 인 줄을 깨운다 — 화면을 닫아도 줄은 끝까지 나간다.

import { resolveAccessToken } from "../instagram-comments/graph";
import {
  blitzWaitMs,
  enqueueReply,
  failConversation,
  markBlitzItem,
  nextBlitzItem,
  resumeBlitz,
  settleBlitz,
  settleInterruptedBlitz,
  stopBlitz,
  type BlitzQueueState,
} from "./blitz-queue";
import { sendDm } from "./graph";
import { canReplyNow, markDmSent } from "./model";
import { readBlitzQueue, readDmLedger, writeBlitzQueue, writeDmLedger } from "./storage";

const SEND_TIMEOUT_MS = 20_000;
const WAIT_SLICE_MS = 2_000;
const WINDOW_CLOSED = "24시간이 지나 앱에서 보내야 해요";

function runner(): { running: boolean } {
  const g = globalThis as typeof globalThis & { __igDmBlitz?: { running: boolean } };
  g.__igDmBlitz ??= { running: false };
  return g.__igDmBlitz;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 대기줄 파일 읽기-고치기-쓰기를 한 줄로 세운다. 화면의 ⏎(담기)와 러너의 발송 기록이 동시에
 * 파일을 고치면 늦게 쓴 쪽이 먼저 담긴 말풍선을 지운다 — 늘 최신 파일 위에서 고치게 한다.
 */
function updateQueue(fn: (s: BlitzQueueState) => BlitzQueueState): Promise<BlitzQueueState> {
  const g = globalThis as typeof globalThis & { __igDmBlitzLock?: Promise<unknown> };
  const run = (g.__igDmBlitzLock ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = fn(await readBlitzQueue());
    await writeBlitzQueue(next);
    return next;
  });
  g.__igDmBlitzLock = run;
  return run;
}
const nowIso = () => new Date().toISOString();

export async function enqueueBlitzReply(conversationId: string, bubbles: readonly string[]): Promise<BlitzQueueState> {
  const state = await updateQueue((s) => enqueueReply(s, conversationId, bubbles, nowIso()));
  startBlitzRunner();
  return state;
}

export async function resumeBlitzQueue(): Promise<BlitzQueueState> {
  const state = await updateQueue((s) => resumeBlitz(s, nowIso()));
  startBlitzRunner();
  return state;
}

/** 스케줄러용: 줄이 running 인데 러너가 없으면(앱 재시작) 다시 기동 */
export async function wakeBlitzRunner(): Promise<void> {
  if ((await readBlitzQueue()).status === "running") startBlitzRunner();
}

/** 멱등 기동 */
export function startBlitzRunner(): void {
  const r = runner();
  if (r.running) return;
  r.running = true;
  void loop()
    .catch((e) => console.warn("[ig-dm-blitz] 러너 오류:", e instanceof Error ? e.message : e))
    .finally(() => {
      runner().running = false;
    });
}

async function settleOnStart(): Promise<void> {
  if (!(await readBlitzQueue()).items.some((i) => i.status === "sending")) return;
  const ledger = await readDmLedger();
  const sentTexts = (id: string) => new Set((ledger.conversations[id]?.messages ?? []).filter((m) => m.fromMe).map((m) => m.text.trim()));
  await updateQueue((s) => settleBlitz(settleInterruptedBlitz(s, (i) => sentTexts(i.conversationId).has(i.text.trim()), nowIso()), nowIso()));
}

async function loop(): Promise<void> {
  await settleOnStart();
  while (true) {
    const state = await readBlitzQueue();
    if (state.status !== "running") return;
    const next = nextBlitzItem(state);
    if (!next) {
      const settled = await updateQueue((s) => settleBlitz(s, nowIso()));
      if (settled.status === "running") continue; // 그 사이 새로 담겼다
      return;
    }
    const ledger = await readDmLedger();
    const wait = blitzWaitMs(state, next, ledger.sync.lastSentAt, Date.now());
    if (wait > 0) {
      await sleep(Math.min(wait, WAIT_SLICE_MS));
      continue;
    }
    const convo = ledger.conversations[next.conversationId];
    if (!convo?.peerId || !canReplyNow(convo, Date.now())) {
      // 그 사람만 실패, 줄은 계속
      await updateQueue((s) => settleBlitz(failConversation(s, next.conversationId, convo ? WINDOW_CLOSED : "원장에 없는 대화", nowIso()), nowIso()));
      continue;
    }

    if (!(await sendOne(next.id, convo.peerId, next.conversationId, next.text))) return;
  }
}

/** 말풍선 1개 발송. 실패하면 줄 전체를 멈추고 false — 같은 오류로 계속 두드리면 스팸처럼 보인다. */
async function sendOne(itemId: string, peerId: string, conversationId: string, text: string): Promise<boolean> {
  await updateQueue((s) => markBlitzItem(s, itemId, { status: "sending" }, nowIso()));
  try {
    const token = await resolveAccessToken();
    const sent = await sendDm(token, peerId, text, AbortSignal.timeout(SEND_TIMEOUT_MS));
    // "접수됨"≠"보내짐": message_id 없으면 성공으로 기록하지 않는다
    if (!sent?.message_id) throw new Error("발송이 확인되지 않았어요 (message_id 없음)");
    const at = nowIso();
    await writeDmLedger(markDmSent(await readDmLedger(), conversationId, text, at));
    await updateQueue((s) => settleBlitz(markBlitzItem(s, itemId, { status: "sent", sentAt: at }, at), at));
    return true;
  } catch (error) {
    const at = nowIso();
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    const message = (timedOut ? `발송 응답이 ${SEND_TIMEOUT_MS / 1000}초 안에 오지 않았어요` : error instanceof Error ? error.message : String(error)).slice(0, 300);
    await updateQueue((s) => stopBlitz(markBlitzItem(s, itemId, { status: "failed", error: message }, at), message, at));
    return false;
  }
}
