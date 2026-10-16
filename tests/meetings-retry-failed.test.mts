// failed 회의 "다시 시도": 저장된 오디오·전사에서 이어 돌고, 두 번 눌러도 한 번만 돈다.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createMeeting, getMeeting, updateMeeting } from "@/lib/meetings/store";
import { retryFailedMeeting, processMeetingUntilSettled } from "@/lib/meetings/ingest";
import { POST as retryPost } from "@/app/api/meetings/[id]/retry-failed/route";
import { waitForJobsToDrain } from "@/lib/jobs/run";
import { buildTranscriptPlain } from "@/lib/meetings/transcript";
import type { TranscriptSegment } from "@/lib/meetings/types";

let dir: string;
const keys = ["MEETINGS_DATA_DIR", "MEETINGS_AUDIO_DIR", "MEETINGS_TIMELINE_DIR"] as const;
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "meetings-retry-failed-"));
  process.env.MEETINGS_DATA_DIR = path.join(dir, "data");
  process.env.MEETINGS_AUDIO_DIR = path.join(dir, "audio");
  process.env.MEETINGS_TIMELINE_DIR = path.join(dir, "timeline");
});

afterEach(async () => {
  await waitForJobsToDrain();
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await rm(dir, { recursive: true, force: true });
});

const SEGMENTS = [{ id: "a", speaker: "S1", text: "완성된 발화", t: 0 }] as TranscriptSegment[];

function fakeAi() {
  const calls = { transcribe: 0, analyze: 0 };
  return {
    calls,
    ai: {
      async transcribeAudio(): Promise<string> {
        calls.transcribe++;
        return JSON.stringify({ segments: SEGMENTS });
      },
      async analyzeMeeting() {
        calls.analyze++;
        return JSON.stringify({ headline: "h", summary: "s" });
      },
      async extractTasks() {
        return "[]";
      },
    },
  };
}

test("전사 끊김으로 failed 된 회의는 다시 시도하면 recorded 로 되돌려 재전사를 요청한다", async () => {
  const m = await createMeeting({ title: "끊김" });
  await updateMeeting(m.id, {
    status: "failed",
    error: "network",
    audioFile: "nonexistent.webm",
    transcript: { segments: SEGMENTS, plain: buildTranscriptPlain(SEGMENTS) },
    transcribeProgress: { processedSec: 5, totalSec: 60 },
  });
  const { outcome, meeting } = await retryFailedMeeting(m.id, { ai: fakeAi().ai });
  assert.equal(outcome, "restarted");
  assert.equal(meeting?.status, "recorded");
  assert.equal(meeting?.retryTranscriptionRequested, true);
  assert.equal(meeting?.error, undefined);
  await waitForJobsToDrain();
});

test("완성된 전사가 있는 failed 회의는 재전사 없이 분석부터 이어 ready 가 되고, 두 번 눌러도 한 번만 돈다", async () => {
  const m = await createMeeting({ title: "분석 실패" });
  await updateMeeting(m.id, {
    status: "failed",
    error: "analysis crashed",
    audioFile: "x.webm",
    transcript: { segments: SEGMENTS, plain: buildTranscriptPlain(SEGMENTS) },
  });
  const { ai, calls } = fakeAi();
  const [a, b] = await Promise.all([retryFailedMeeting(m.id, { ai }), retryFailedMeeting(m.id, { ai })]);
  assert.deepEqual([a.outcome, b.outcome].sort(), ["not-failed", "restarted"]);
  const done = await processMeetingUntilSettled(m.id, 10_000);
  assert.equal(done.status, "ready");
  assert.equal(calls.transcribe, 0);
  assert.equal(calls.analyze, 1);
  // ready 가 된 뒤 다시 눌러도 아무것도 바꾸지 않는다.
  const again = await retryFailedMeeting(m.id, { ai });
  assert.equal(again.outcome, "not-failed");
  assert.equal((await getMeeting(m.id))?.status, "ready");
});

test("재료가 없는 failed 회의는 409, 없는 회의는 400/404", async () => {
  const none = await createMeeting({ title: "재료 없음" });
  await updateMeeting(none.id, { status: "failed", error: "x" });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const r1 = await retryPost(new Request("http://t", { method: "POST" }), ctx(none.id));
  assert.equal(r1.status, 409);
  assert.equal((await getMeeting(none.id))?.status, "failed");
  const r2 = await retryPost(new Request("http://t", { method: "POST" }), ctx("00000000-0000-4000-8000-000000000000"));
  assert.ok([400, 404].includes(r2.status));
});
