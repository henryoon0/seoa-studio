// 답글 발송 대기줄 행동 테스트. 인스타 Graph API 는 fetch 가짜로 대신한다 (실제 호출 없음).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLedger, markSent, upsertFetched, type IgCommentLedger } from "@/lib/instagram-comments/model";
import { HOURLY_REPLY_CAP, QueueConflictError } from "@/lib/instagram-comments/queue-model";
import {
  CHECK_NOT_FOUND_MESSAGE,
  checkUnknownReply,
  enqueueAndStart,
  removeFromQueue,
  resendAfterCheck,
  resumeSendQueueIfRunning,
  sendQueueIdle,
  setSendQueueDepsForTest,
} from "@/lib/instagram-comments/send-queue";
import {
  readLedger,
  readSendQueue,
  tokenPath,
  updateSendQueue,
  updateLedger as updateLedgerForTest,
  writeLedger,
  writeSendQueue,
} from "@/lib/instagram-comments/storage";

const ME = { user_id: "me-1", username: "seoa" };
let posts: { target: string; message: string }[] = [];
let existingReplies: { id: string; text: string; from: { id: string; username: string }; timestamp: string }[] = [];
let postBehavior: "ok" | "timeout-after-commit" | "timeout-no-commit" | "hang" | "reject-400" = "ok";
let repliesBehavior: "ok" | "hang" | "endless-pages" = "ok";

/** 연결만 붙잡고 응답하지 않는 요청 — signal 이 끊어야만 끝난다. */
function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    if (!signal) return; // 시간 제한이 없으면 영원히 멈춘다 (그러면 테스트가 실패한다)
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/me")) return Promise.resolve(json(ME));
  const m = url.pathname.match(/\/([^/]+)\/replies$/);
  if (m && init?.method === "POST") {
    const message = new URLSearchParams(String(init.body)).get("message") ?? "";
    if (postBehavior === "reject-400") return Promise.resolve(json({ error: { message: "bad" } }, 400));
    if (postBehavior === "timeout-no-commit") {
      // 요청은 나갔지만 인스타에 등록되지 않은 채 응답이 끊긴 상황
      return Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
    }
    posts.push({ target: m[1], message });
    const id = `reply-${posts.length}`;
    existingReplies.push({ id, text: message, from: { id: ME.user_id, username: ME.username }, timestamp: new Date().toISOString() });
    if (postBehavior === "hang") return hang(init.signal);
    if (postBehavior === "timeout-after-commit") {
      // 인스타는 등록했는데 응답이 안 온 상황
      return Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
    }
    return Promise.resolve(json({ id }));
  }
  if (m && repliesBehavior === "hang") return hang(init?.signal);
  if (m && repliesBehavior === "endless-pages") {
    // 매 페이지가 다음 페이지를 가리킨다 — 우리 답글은 읽지 못한 뒤쪽 페이지에 있다고 본다.
    return Promise.resolve(json({ data: [], paging: { next: `${url.origin}${url.pathname}?after=x` } }));
  }
  if (m) return Promise.resolve(json({ data: existingReplies }));
  return Promise.reject(new Error(`예상 못 한 호출: ${url.pathname}`));
}

function seedComment(ledger: IgCommentLedger, id: string): IgCommentLedger {
  ledger.comments[id] = {
    id,
    mediaId: "m1",
    username: "fan",
    text: "질문 있어요",
    timestamp: new Date().toISOString(),
    draft: "답글입니다",
  } as IgCommentLedger["comments"][string];
  return ledger;
}

beforeEach(async () => {
  process.env.INSTAGRAM_COMMENTS_DIR = await mkdtemp(path.join(tmpdir(), "ig-queue-"));
  process.env.IG_ACCESS_TOKEN = "test-token-not-real";
  posts = [];
  existingReplies = [];
  postBehavior = "ok";
  repliesBehavior = "ok";
  globalThis.fetch = fakeFetch as typeof fetch;
  setSendQueueDepsForTest({ sleep: async () => {}, gapMs: () => 0 });
  await writeLedger(seedComment(createLedger(), "c1"));
});

afterEach(async () => {
  await sendQueueIdle();
  globalThis.fetch = realFetch;
  setSendQueueDepsForTest();
});

test("같은 댓글을 동시에 두 번 담아도 인스타 발송은 1번", async () => {
  await Promise.all([
    enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]),
    enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]),
  ]);
  await sendQueueIdle();
  assert.equal(posts.length, 1);
  const q = await readSendQueue();
  assert.deepEqual(q.items.map((i) => i.status), ["sent"]);
  assert.equal((await readLedger()).comments.c1.repliedByMe, true);
});

test("러너가 간격을 기다리는 동안 회수하면 발송 0번", async () => {
  const ledger = await readLedger();
  ledger.sync.lastSentAt = new Date().toISOString(); // 방금 보냄 → 러너가 대기
  await writeLedger(ledger);
  let recalled = false;
  setSendQueueDepsForTest({
    gapMs: () => 60_000,
    sleep: async () => {
      if (!recalled) {
        recalled = true;
        await removeFromQueue("c1");
      }
    },
  });
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  assert.equal(recalled, true);
  assert.equal(posts.length, 0);
  assert.equal((await readSendQueue()).items.length, 0);
});

test("응답 시간 초과는 unknown, 재시도 때 이미 달린 답글을 찾으면 다시 보내지 않는다", async () => {
  postBehavior = "timeout-after-commit";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  assert.equal(posts.length, 1);
  assert.equal((await readSendQueue()).items[0].status, "unknown");

  postBehavior = "ok";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]); // henry 가 재시도
  await sendQueueIdle();
  assert.equal(posts.length, 1, "두 번째 POST 가 나가면 안 된다");
  const item = (await readSendQueue()).items[0];
  assert.equal(item.status, "sent");
  const c1 = (await readLedger()).comments.c1;
  assert.equal(c1.repliedByMe, true);
  assert.equal(c1.myReplyId, "reply-1");
});

test("시간당 상한이 차면 보내지 않고 기다린다", async () => {
  const ledger = await readLedger();
  const now = Date.now();
  ledger.sync.recentSentAt = Array.from({ length: HOURLY_REPLY_CAP }, (_, k) =>
    new Date(now - 10 * 60_000 + k * 1000).toISOString()
  );
  await writeLedger(ledger);
  const waits: number[] = [];
  setSendQueueDepsForTest({
    gapMs: () => 0,
    sleep: async (ms) => {
      waits.push(ms);
      await updateSendQueue((s) => ({ ...s, status: "stopped" })); // 테스트를 끝내려고 정지
    },
  });
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  assert.equal(posts.length, 0);
  assert.ok(waits.length > 0 && waits[0] > 0);
});

test("상한 아래면 보내고 발송 시각을 기록한다", async () => {
  const ledger = await readLedger();
  ledger.sync.recentSentAt = Array.from({ length: HOURLY_REPLY_CAP - 1 }, () => new Date(Date.now() - 60_000).toISOString());
  await writeLedger(ledger);
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  assert.equal(posts.length, 1);
  assert.equal((await readLedger()).sync.recentSentAt?.length, HOURLY_REPLY_CAP);
});

test("token.json 은 0600, 저장 폴더는 0700", async () => {
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  assert.equal((await stat(tokenPath())).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(tokenPath()))).mode & 0o777, 0o700);
});

// ── 2차 검토 (#3 #4 #6 #7 #8) ─────────────────────────────

// 3차 검토에서 의미를 바꿨다: 문구를 바꿔 다시 담으면 조용히 첫 문구를 쓰지 않고 거절(409)한다.
// 인스타 글이 보낸 문구와 다르면 sent 로 치지 않고 unknown 을 유지한다 (#5 와 같은 규칙).
test("#3 결과 불명 뒤 다른 문구로 다시 담으면 거절, 같은 문구여도 인스타 글이 다르면 unknown 유지", async () => {
  postBehavior = "timeout-after-commit";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  assert.equal((await readSendQueue()).items[0].status, "unknown");

  postBehavior = "ok";
  await assert.rejects(enqueueAndStart([{ commentId: "c1", message: "고친 새 문구" }]), QueueConflictError);
  assert.equal((await readSendQueue()).items[0].message, "답글입니다");

  existingReplies[0].text = "인스타에서 보이는 글이 조금 다름";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  assert.equal(posts.length, 1, "확인이 안 되면 다시 보내지 않는다");
  assert.equal((await readSendQueue()).items[0].status, "unknown");
});

// 3차 검토에서 의미를 바꿨다: 예전엔 우리 답글이 없으면 자동으로 다시 보냈다. 이제는 unknown 을 유지하고
// henry 가 인스타에서 확인한 뒤 "확인했어요, 다시 보내기"(resendAfterCheck)를 눌러야만 다시 보낸다.
test("#3 첫 시도 전에 달린 우리 예전 답글은 이미 보낸 것으로 치지 않고, 다시 보내기는 henry 확인 뒤에만", async () => {
  existingReplies.push({ id: "old", text: "답글입니다", from: { id: ME.user_id, username: ME.username }, timestamp: new Date(Date.now() - 3_600_000).toISOString() });
  postBehavior = "timeout-after-commit";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  existingReplies = existingReplies.filter((r) => r.id === "old"); // 실제로는 안 달린 경우
  postBehavior = "ok";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  assert.equal(posts.length, 1, "자동으로 다시 보내지 않는다");
  assert.equal((await readSendQueue()).items[0].status, "unknown");

  await resendAfterCheck("c1");
  await sendQueueIdle();
  assert.equal(posts.length, 2);
  assert.equal((await readSendQueue()).items[0].status, "sent");
  assert.equal((await readLedger()).comments.c1.myReplyId, "reply-2");
});

test("#4 결과 불명 발송도 시간당 상한과 간격에 센다", async () => {
  postBehavior = "timeout-after-commit";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  const sync = (await readLedger()).sync;
  assert.equal(sync.recentSentAt?.length, 1);
  assert.ok(sync.lastSentAt);
});

test("#4 결과 불명이 연달아 나면 자동 정지한다", async () => {
  let ledger = await readLedger();
  for (const id of ["c2", "c3", "c4", "c5", "c6"]) ledger = seedComment(ledger, id);
  await writeLedger(ledger);
  postBehavior = "timeout-after-commit";
  await enqueueAndStart(["c1", "c2", "c3", "c4", "c5", "c6"].map((commentId) => ({ commentId, message: "답글입니다" })));
  await sendQueueIdle();
  const q = await readSendQueue();
  assert.equal(q.status, "stopped");
  assert.ok(posts.length < 6, `정지 전까지만 보내야 한다 (보낸 수 ${posts.length})`);
});

test("#6 같은 사람의 다른 게시물 댓글은 사용자명만으로 답함 처리하지 않는다", () => {
  const t0 = new Date(Date.now() - 600_000).toISOString();
  const t1 = new Date(Date.now() - 60_000).toISOString();
  const fetched = [
    { id: "a1", mediaId: "m1", username: "fan", authorId: "fan-1", text: "질문1", timestamp: t0 },
    { id: "b1", mediaId: "m2", username: "fan", authorId: "fan-1", text: "질문2", timestamp: t0 },
    { id: "r1", mediaId: "m1", username: ME.username, authorId: ME.user_id, text: "@fan 답이에요", timestamp: t1, parentId: "a1" },
    { id: "r2", mediaId: "m2", username: ME.username, authorId: ME.user_id, text: "@fan 멘션만 있는 셀프 댓글", timestamp: t1 },
  ];
  const next = upsertFetched(createLedger(), [], fetched as never, ME.username, ME.user_id, new Date().toISOString());
  assert.equal(next.comments.a1.repliedByMe, true);
  assert.equal(next.comments.a1.myReplyId, "r1");
  assert.equal(next.comments.b1.repliedByMe, false, "사용자명만 같은 다른 게시물 댓글은 그대로 대기");
});

test("#7 러너가 빈 줄을 보고 끝나는 사이에 담긴 항목도 보낸다", async () => {
  await writeLedger(seedComment(await readLedger(), "c2"));
  let injected = false;
  setSendQueueDepsForTest({
    sleep: async () => {},
    gapMs: () => 0,
    onIdle: async () => {
      if (injected) return;
      injected = true;
      await enqueueAndStart([{ commentId: "c2", message: "늦게 담긴 답글" }]); // 러너가 아직 running 이라 기동은 no-op
    },
  });
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  assert.equal(injected, true);
  assert.deepEqual(posts.map((p) => p.message), ["답글입니다", "늦게 담긴 답글"]);
  assert.deepEqual((await readSendQueue()).items.map((i) => i.status), ["sent", "sent"]);
});

test("#8 발송 응답이 멈추면 시간 제한 뒤 unknown (sending 에 남지 않음)", async () => {
  postBehavior = "hang";
  setSendQueueDepsForTest({ sleep: async () => {}, gapMs: () => 0, postTimeoutMs: 50 });
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  assert.equal((await readSendQueue()).items[0].status, "unknown");
});

test("#8 재시도 확인(답글 조회)이 멈춰도 시간 제한 뒤 unknown, 다시 보내지 않는다", async () => {
  postBehavior = "timeout-after-commit";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  repliesBehavior = "hang";
  postBehavior = "ok";
  setSendQueueDepsForTest({ sleep: async () => {}, gapMs: () => 0, postTimeoutMs: 50 });
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  const item = (await readSendQueue()).items[0];
  assert.equal(item.status, "unknown");
  assert.match(item.error ?? "", /기존 답글 확인 실패/);
  assert.equal(posts.length, 1);
});

test("#8 서버 시작 때 남은 sending 은 줄이 멈춰 있어도 unknown 으로 정리한다", async () => {
  const now = new Date().toISOString();
  await writeSendQueue({
    items: [{ commentId: "c1", message: "답글입니다", status: "sending", queuedAt: now, attempts: 1 }],
    status: "stopped",
    updatedAt: now,
  });
  await resumeSendQueueIfRunning();
  await sendQueueIdle();
  assert.equal((await readSendQueue()).items[0].status, "unknown");
  assert.equal(posts.length, 0);
});

// ── 3차 검토 (#3 #4 #5 #6) ─────────────────────────────

test("3차 #3 재시도 대기 중 회수하려 해도 시도 이력이 있으면 거절하고 이력·문구를 지킨다", async () => {
  postBehavior = "timeout-after-commit";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  postBehavior = "ok";
  const ledger = await readLedger();
  ledger.sync.lastSentAt = new Date().toISOString(); // 러너가 간격을 기다리게 한다
  await writeLedger(ledger);
  let recallError: unknown = null;
  setSendQueueDepsForTest({
    gapMs: () => 60_000,
    sleep: async () => {
      if (recallError) return;
      recallError = await removeFromQueue("c1").then(() => "회수됨", (e) => e);
      await updateSendQueue((st) => ({ ...st, status: "stopped" })); // 테스트를 끝내려고 정지
    },
  });
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  assert.ok(recallError instanceof QueueConflictError);
  const item = (await readSendQueue()).items[0];
  assert.equal(item.message, "답글입니다");
  assert.equal(item.attempts, 1);
  assert.ok(item.firstAttemptAt);
  assert.equal(posts.length, 1);
});

test("3차 #4 시도 이력이 있는 항목의 문구 변경은 라우트가 409 와 한국어 문구로 거절한다", async () => {
  postBehavior = "timeout-after-commit";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  const { POST } = await import("@/app/api/instagram/comments/queue/route");
  const req = new Request("http://localhost/api/instagram/comments/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ commentId: "c1", message: "고친 새 문구" }] }),
  });
  const res = await POST(req as never);
  assert.equal(res.status, 409);
  assert.match(((await res.json()) as { error: string }).error, /문구를 바꿀 수 없어요/);
  assert.equal((await readSendQueue()).items[0].message, "답글입니다");
});

test("3차 #5 같은 스레드에서 다른 사람에게 단 우리 답글로 완료 처리하지 않는다", async () => {
  await writeLedger(seedComment(await readLedger(), "c2"));
  await enqueueAndStart([{ commentId: "c1", message: "A님께 답" }]);
  await sendQueueIdle();
  postBehavior = "timeout-after-commit";
  await enqueueAndStart([{ commentId: "c2", message: "B님께 답" }]);
  await sendQueueIdle();
  existingReplies = existingReplies.filter((r) => r.text === "A님께 답"); // B 는 실제로 안 달림
  postBehavior = "ok";
  await enqueueAndStart([{ commentId: "c2", message: "B님께 답" }]);
  await sendQueueIdle();
  const b = (await readSendQueue()).items.find((i) => i.commentId === "c2");
  assert.equal(b?.status, "unknown");
  assert.notEqual((await readLedger()).comments.c2.myReplyId, "reply-1");
  assert.equal(posts.length, 2, "확인 단계에서 다시 보내지 않는다");
});

test("3차 #5 같은 문구의 우리 답글이 여럿이면 모호하니 unknown", async () => {
  postBehavior = "timeout-after-commit";
  await enqueueAndStart([{ commentId: "c1", message: "감사해요" }]);
  await sendQueueIdle();
  existingReplies.push({ ...existingReplies[0], id: "other" });
  postBehavior = "ok";
  await enqueueAndStart([{ commentId: "c1", message: "감사해요" }]);
  await sendQueueIdle();
  assert.equal((await readSendQueue()).items[0].status, "unknown");
  assert.equal(posts.length, 1);
});

test("3차 #6 답글 조회가 페이지 한도를 넘으면 확인 실패로 보고 다시 보내지 않는다", async () => {
  postBehavior = "timeout-after-commit";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  postBehavior = "ok";
  repliesBehavior = "endless-pages";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  const item = (await readSendQueue()).items[0];
  assert.equal(item.status, "unknown");
  assert.match(item.error ?? "", /끝까지 확인하지 못했어요/);
  assert.equal(posts.length, 1);
});

test("4xx 로 확실히 거절된 첫 시도는 이력을 지워 문구를 고쳐 다시 보낼 수 있다", async () => {
  postBehavior = "reject-400";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  const failed = (await readSendQueue()).items[0];
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts, undefined);
  postBehavior = "ok";
  await enqueueAndStart([{ commentId: "c1", message: "고친 문구" }]);
  await sendQueueIdle();
  assert.deepEqual(posts.map((p) => p.message), ["고친 문구"]);
});

// ── 4차 검토 (#2 #4) ─────────────────────────────

test("4차 #2 아직 시도 전인 대기 항목을 다른 문구로 다시 승인하면 새 문구로 바꿔 보낸다", async () => {
  const ledger = await readLedger();
  ledger.sync.lastSentAt = new Date().toISOString(); // 러너가 간격을 기다리게 한다
  await writeLedger(ledger);
  let confirmed: string | undefined;
  let edited = false;
  setSendQueueDepsForTest({
    gapMs: () => 60_000,
    sleep: async () => {
      if (edited) return;
      edited = true;
      const state = await enqueueAndStart([{ commentId: "c1", message: "고친 새 문구" }]);
      confirmed = state.items.find((i) => i.commentId === "c1")?.message;
      await updateLedgerForTest((l) => ({ ...l, sync: { ...l.sync, lastSentAt: undefined } }));
    },
  });
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  assert.equal(confirmed, "고친 새 문구", "서버가 확정한 문구를 돌려준다");
  assert.deepEqual(posts.map((p) => p.message), ["고친 새 문구"]);
  assert.equal((await readLedger()).comments.c1.myReplyText, "고친 새 문구");
});

test("4차 #4 다른 댓글에 이미 배정된 같은 문구 답글로 결과 불명을 완료 처리하지 않는다", async () => {
  await writeLedger(seedComment(await readLedger(), "c2"));
  await enqueueAndStart([{ commentId: "c1", message: "감사해요" }]);
  await sendQueueIdle();
  assert.equal((await readSendQueue()).items[0].replyId, "reply-1", "보낸 답글 번호를 대기줄에도 남긴다");
  postBehavior = "timeout-no-commit";
  await enqueueAndStart([{ commentId: "c2", message: "감사해요" }]);
  await sendQueueIdle();
  postBehavior = "ok";
  await enqueueAndStart([{ commentId: "c2", message: "감사해요" }]); // 재확인
  await sendQueueIdle();
  const b = (await readSendQueue()).items.find((i) => i.commentId === "c2");
  assert.equal(b?.status, "unknown");
  assert.notEqual((await readLedger()).comments.c2.repliedByMe, true);
  assert.equal(posts.length, 1, "확인 단계에서 다시 보내지 않는다");
});

test("5차 #4 대댓글에 배정된 답글 번호는 동기화가 원댓글에 다시 배정하지 않는다", () => {
  const t0 = new Date(Date.now() - 600_000).toISOString();
  const t1 = new Date(Date.now() - 60_000).toISOString();
  const fetched = [
    { id: "A", mediaId: "m1", username: "fan", authorId: "fan-1", text: "원댓글", timestamp: t0 },
    { id: "B", mediaId: "m1", username: "fan2", authorId: "fan-2", text: "대댓글", timestamp: t0, parentId: "A" },
    { id: "R", mediaId: "m1", username: ME.username, authorId: ME.user_id, text: "@fan2 답", timestamp: t1, parentId: "A" },
  ];
  const base = upsertFetched(createLedger(), [], [fetched[0], fetched[1]] as never, ME.username, ME.user_id, t0);
  base.comments.B = { ...base.comments.B, repliedByMe: true, myReplyId: "R", repliedAt: t1 };
  const next = upsertFetched(base, [], fetched as never, ME.username, ME.user_id, t1);
  assert.equal(next.comments.B.myReplyId, "R");
  assert.equal(next.comments.A.repliedByMe, false, "원댓글 A는 대기 그대로");
  assert.equal(next.comments.A.myReplyId, undefined);
  // 원장에는 없고 대기줄에만 기록된 답글 번호도 제외한다
  const fresh = upsertFetched(createLedger(), [], fetched as never, ME.username, ME.user_id, t1, new Map([["R", "B"]]));
  assert.equal(fresh.comments.A.repliedByMe, false);
});

test("6차 #2 대댓글 발송 중 동기화는 그 스레드의 우리 답글을 원댓글에 배정하지 않는다", () => {
  const t0 = new Date(Date.now() - 600_000).toISOString();
  const t1 = new Date(Date.now() - 60_000).toISOString();
  const fetched = [
    { id: "A", mediaId: "m1", username: "fan", authorId: "fan-1", text: "원댓글", timestamp: t0 },
    { id: "B", mediaId: "m1", username: "fan2", authorId: "fan-2", text: "대댓글", timestamp: t0, parentId: "A" },
    { id: "R", mediaId: "m1", username: ME.username, authorId: ME.user_id, text: "@fan2 답", timestamp: t1, parentId: "A" },
  ];
  const next = upsertFetched(createLedger(), [], fetched as never, ME.username, ME.user_id, t1, new Map(), new Set(["B"]));
  assert.equal(next.comments.A.repliedByMe, false, "발송 중인 B의 스레드 답글은 보류");
  assert.equal(next.comments.A.myReplyId, undefined);
});

test("6차 #2 발송 확정 때 같은 답글 번호를 가진 다른 댓글의 배정을 지운다", () => {
  const t0 = new Date(Date.now() - 600_000).toISOString();
  const fetched = [
    { id: "A", mediaId: "m1", username: "fan", authorId: "fan-1", text: "원댓글", timestamp: t0 },
    { id: "B", mediaId: "m1", username: "fan2", authorId: "fan-2", text: "대댓글", timestamp: t0, parentId: "A" },
  ];
  const base = upsertFetched(createLedger(), [], fetched as never, ME.username, ME.user_id, t0);
  base.comments.A = { ...base.comments.A, repliedByMe: true, myReplyId: "R", myReplyText: "답", repliedAt: t0 };
  const next = markSent(base, "B", "R", "@fan2 답", t0);
  assert.equal(next.comments.B.myReplyId, "R");
  assert.equal(next.comments.A.repliedByMe, false);
  assert.equal(next.comments.A.myReplyId, undefined);
});

test("6차 #5 담기 응답이 끊겨도 서버에 담긴 항목은 추적 목록에 넣고 서버 문구를 따른다", async () => {
  const { recoverLostEnqueue } = await import("@/app/instagram-comments/queue-recovery");
  for (const status of ["queued", "sending", "sent"]) {
    const r = recoverLostEnqueue({ commentId: "c1", status, message: "서버 문구" });
    assert.equal(r?.track, true, `${status} 는 폴링이 결과를 계속 읽는다`);
    assert.equal(r?.message, "서버 문구");
    assert.equal(r?.error, null);
  }
  const failed = recoverLostEnqueue({ commentId: "c1", status: "failed", message: "서버 문구", error: "거절" });
  assert.equal(failed?.track, false);
  assert.match(failed?.error ?? "", /거절/);
  const unknown = recoverLostEnqueue({ commentId: "c1", status: "unknown", message: "서버 문구", attempts: 1 });
  assert.ok(unknown?.error, "결과 불명 안내를 보여 준다");
  assert.equal(unknown?.message, "서버 문구");
  assert.equal(recoverLostEnqueue(null), null, "서버에 없으면 담기 실패 그대로");
});

test("7차 #2 달렸지만 unknown 인 답글은 '인스타에서 다시 확인'으로 sent, 발송 0번", async () => {
  postBehavior = "timeout-after-commit";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  assert.equal((await readSendQueue()).items[0].status, "unknown");
  const before = posts.length;
  let postCalls = 0;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") postCalls += 1;
    return fakeFetch(input, init);
  }) as typeof fetch;
  await checkUnknownReply("c1");
  assert.equal(postCalls, 0);
  assert.equal(posts.length, before);
  const item = (await readSendQueue()).items[0];
  assert.equal(item.status, "sent");
  assert.equal(item.replyId, "reply-1");
  assert.equal((await readLedger()).comments.c1.repliedByMe, true);
});

test("7차 #2 인스타에 답글이 없으면 확인해도 unknown 유지, 안내 문구, 발송 0번", async () => {
  postBehavior = "timeout-no-commit";
  await enqueueAndStart([{ commentId: "c1", message: "답글입니다" }]);
  await sendQueueIdle();
  let postCalls = 0;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") postCalls += 1;
    return fakeFetch(input, init);
  }) as typeof fetch;
  await checkUnknownReply("c1");
  assert.equal(postCalls, 0);
  const item = (await readSendQueue()).items[0];
  assert.equal(item.status, "unknown");
  assert.equal(item.error, CHECK_NOT_FOUND_MESSAGE);
});
