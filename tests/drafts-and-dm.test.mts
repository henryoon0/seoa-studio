// 초안 대상 고르기(최신 게시물 3개)와 DM 쳐내기의 순수 규칙 테스트. AI·인스타 호출 없음.
import { test } from "node:test";
import assert from "node:assert/strict";

import { latestMedia, mediaScope, scopeTargets } from "@/lib/instagram-comments/draft-job";
import { createLedger, type IgCommentLedger } from "@/lib/instagram-comments/model";
import { createBlitzQueue, enqueueReply } from "@/lib/instagram-dm/blitz-queue";
import { triageDm } from "@/lib/instagram-dm/triage";
import type { DmConversation } from "@/lib/instagram-dm/model";

function ledgerWithPosts(): IgCommentLedger {
  const l = createLedger();
  for (const [id, day] of [["p1", "01"], ["p2", "02"], ["p3", "03"], ["p4", "04"]]) {
    l.media[id] = { id, captionFirstLine: `글 ${id}`, permalink: "", timestamp: `2026-10-${day}T00:00:00Z`, commentsCount: 1 };
    l.comments[`c-${id}`] = { id: `c-${id}`, mediaId: id, username: "danbi", text: "궁금해요", timestamp: `2026-10-${day}T01:00:00Z`, repliedByMe: false };
  }
  return l;
}

test("고를 수 있는 게시물은 최신 3개뿐이다", () => {
  assert.deepEqual(latestMedia(ledgerWithPosts()).map((m) => m.id), ["p4", "p3", "p2"]);
});

test("최신 3개 밖의 게시물 id 는 버린다", () => {
  const l = ledgerWithPosts();
  assert.equal(mediaScope(l, ["p4", "p1"]), "media:p4");
  assert.equal(mediaScope(l, ["p1"]), null);
});

test("고른 게시물의 남은 댓글만 초안 대상이다", () => {
  const l = ledgerWithPosts();
  l.comments["c-p3"].repliedByMe = true;
  const ids = scopeTargets(l, "media:p4,p3").map((c) => c.id);
  assert.deepEqual(ids, ["c-p4"]);
});

function convo(texts: string[]): DmConversation {
  return {
    id: "t1", peerId: "u1", peerUsername: "danbi", updatedTime: "2026-10-17T00:00:00Z",
    messages: texts.map((text, k) => ({ id: `m${k}`, fromMe: false, text, createdTime: "2026-10-17T00:00:00Z" })),
  };
}

test("물음표가 있는 DM 은 답장 칸, 이모지만 온 DM 은 정리 칸", () => {
  assert.equal(triageDm(convo(["공구 언제 열어요?"])).triage, "reply");
  assert.equal(triageDm(convo([""])).triage, "done");
});

test("DM 대기줄은 말풍선마다 하나씩 담고 빈 말풍선은 버린다", () => {
  const s = enqueueReply(createBlitzQueue("2026-10-17T00:00:00Z"), "t1", ["안녕하세요", " ", "다음 주에 열어요🤍"], "2026-10-17T00:00:00Z");
  assert.deepEqual(s.items.map((i) => i.text), ["안녕하세요", "다음 주에 열어요🤍"]);
});
