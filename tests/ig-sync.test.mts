// 인스타 댓글 수집·원장 병합 테스트 (4차 검토 #1 #6). Graph API 는 fetch 가짜로 대신한다 (실제 호출 없음).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLedger, interactionCount, upsertFetched, type FetchedComment } from "@/lib/instagram-comments/model";
import { readLedger, writeLedger } from "@/lib/instagram-comments/storage";
import { syncNow } from "@/lib/instagram-comments/sync";

const realFetch = globalThis.fetch;
let commentPages = 1;
let pagesServed = 0;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(input: string | URL | Request): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/me")) return Promise.resolve(json({ user_id: "me-1", username: "seoa" }));
  if (url.pathname.endsWith("/me/media")) {
    return Promise.resolve(json({ data: [{ id: "m1", caption: "글", permalink: "p", timestamp: "2026-10-01T00:00:00+0000", comments_count: 9999 }] }));
  }
  if (url.pathname.endsWith("/m1/comments")) {
    const page = Number(url.searchParams.get("page") ?? "1");
    pagesServed += 1;
    const next = page < commentPages ? `${url.origin}${url.pathname}?page=${page + 1}` : undefined;
    return Promise.resolve(
      json({
        data: [{ id: `c${page}`, text: "안녕", from: { id: `u${page}`, username: `fan${page}` }, timestamp: "2026-10-02T00:00:00+0000" }],
        paging: next ? { next } : {},
      })
    );
  }
  return Promise.reject(new Error(`예상 못 한 호출: ${url.pathname}`));
}

beforeEach(async () => {
  process.env.INSTAGRAM_COMMENTS_DIR = await mkdtemp(path.join(tmpdir(), "ig-sync-"));
  process.env.IG_ACCESS_TOKEN = "test-token-not-real";
  commentPages = 1;
  pagesServed = 0;
  globalThis.fetch = fakeFetch as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function comment(id: string, username: string): FetchedComment {
  return { id, mediaId: "m1", username, authorId: `id-${id}`, text: "hi", timestamp: "2026-10-02T00:00:00Z" };
}

test("4차 #1 사용자명이 __proto__·constructor 여도 병합·저장·조회가 깨지지 않는다", async () => {
  const fetched = [comment("a", "__proto__"), comment("b", "constructor"), comment("c", "toString")];
  const next = upsertFetched(createLedger(), [], fetched, "seoa", "me-1", "2026-10-02T01:00:00Z");
  assert.deepEqual(next.people["__proto__"]?.commentIds, ["a"]);
  assert.deepEqual(next.people["constructor"]?.commentIds, ["b"]);
  await writeLedger(next);
  const reread = await readLedger();
  assert.deepEqual(Object.keys(reread.people).sort(), ["__proto__", "constructor", "toString"]);
  // 다시 읽은 원장에 같은 댓글을 또 병합해도 중복·예외 없이 그대로다
  const again = upsertFetched(reread, [], fetched, "seoa", "me-1", "2026-10-02T02:00:00Z");
  assert.deepEqual(again.people["constructor"]?.commentIds, ["b"]);
  assert.equal(interactionCount(createLedger(), "constructor"), 0);
});

test("4차 #6 10페이지를 넘는 댓글도 끝까지 읽는다", async () => {
  commentPages = 11;
  const ledger = await syncNow();
  assert.equal(Object.keys(ledger.comments).length, 11);
  assert.equal(ledger.sync.lastError, undefined);
  assert.equal(ledger.sync.incomplete, undefined);
});

test("4차 #6 페이지 상한에 걸리면 성공이 아니라 미완료로 기록한다", async () => {
  commentPages = 1000;
  const ledger = await syncNow();
  assert.ok(pagesServed <= 100, `상한 안에서 멈춘다 (${pagesServed})`);
  assert.match(ledger.sync.incomplete ?? "", /끝까지 읽지 못했어요/);
});
