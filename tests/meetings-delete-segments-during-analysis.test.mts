// 분석이 도는 중에 발화를 지우는 경우의 행동 테스트. 분석기는 가짜(게이트로 멈춤)로 대신한다.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createMeeting, getMeeting, updateMeeting } from "@/lib/meetings/store";
import { processMeetingUntilSettled, startMeetingProcessing } from "@/lib/meetings/ingest";
import { deleteTranscriptSegments, setDeleteSegmentsAiForTest } from "@/lib/meetings/delete-transcript-segments";
import { waitForJobsToDrain } from "@/lib/jobs/run";
import { buildTranscriptPlain } from "@/lib/meetings/transcript";
import type { MeetingAi, TranscriptSegment } from "@/lib/meetings/types";

let dir: string;
const saved = { data: process.env.MEETINGS_DATA_DIR, audio: process.env.MEETINGS_AUDIO_DIR };

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "meetings-del-"));
  process.env.MEETINGS_DATA_DIR = path.join(dir, "data");
  process.env.MEETINGS_AUDIO_DIR = path.join(dir, "audio");
});

afterEach(async () => {
  setDeleteSegmentsAiForTest();
  await waitForJobsToDrain();
  if (saved.data === undefined) delete process.env.MEETINGS_DATA_DIR;
  else process.env.MEETINGS_DATA_DIR = saved.data;
  if (saved.audio === undefined) delete process.env.MEETINGS_AUDIO_DIR;
  else process.env.MEETINGS_AUDIO_DIR = saved.audio;
  await rm(dir, { recursive: true, force: true });
});

const SEGMENTS: TranscriptSegment[] = [
  { id: "a", speaker: "S1", text: "첫째 발화", t: 0 },
  { id: "b", speaker: "S1", text: "비밀 발화", t: 5 },
  { id: "c", speaker: "S1", text: "셋째 발화", t: 10 },
] as TranscriptSegment[];

async function seedTranscribedMeeting() {
  const m = await createMeeting({ title: "테스트" });
  await updateMeeting(m.id, {
    status: "transcribed",
    transcript: { segments: SEGMENTS, plain: buildTranscriptPlain(SEGMENTS) },
  });
  return m.id;
}

function gatedAnalyzer() {
  const calls: string[] = [];
  const gates: Array<() => void> = [];
  const entered: Array<() => void> = [];
  const ai: Pick<MeetingAi, "transcribeAudio" | "analyzeMeeting"> = {
    async transcribeAudio() {
      throw new Error("전사는 이 테스트에서 불리지 않는다");
    },
    async analyzeMeeting(plain) {
      calls.push(plain);
      const n = calls.length;
      entered[n - 1]?.();
      if (n === 1) await new Promise<void>((resolve) => gates.push(resolve));
      return JSON.stringify({
        headline: "헤드라인",
        summary: plain.includes("비밀") ? "요약: 비밀 포함" : "요약: 비밀 없음",
      });
    },
  };
  const firstEntered = new Promise<void>((resolve) => entered.push(resolve));
  return { ai, calls, release: () => gates[0]?.(), firstEntered };
}

test("분석 도중 발화를 지우면 옛 전사본 요약은 버려지고 현재 전사본으로 다시 분석한다", async () => {
  const id = await seedTranscribedMeeting();
  const { ai, calls, release, firstEntered } = gatedAnalyzer();
  setDeleteSegmentsAiForTest(ai);

  startMeetingProcessing(id, { ai });
  await firstEntered; // 분석기가 옛 전사본(3발화)을 받고 멈춘 상태

  const outcome = await deleteTranscriptSegments(id, ["b"]);
  assert.equal(outcome.kind, "success");
  release();

  const done = await processMeetingUntilSettled(id, 10_000);

  assert.equal(done.status, "ready");
  assert.equal(calls.length, 2, "옛 결과는 버리고 한 번 더 분석해야 한다");
  assert.ok(calls[0].includes("비밀"));
  assert.ok(!calls[1].includes("비밀"), "재분석은 삭제 뒤 전사본을 받아야 한다");
  assert.equal(done.analysis?.summary, "요약: 비밀 없음");
  assert.equal(done.transcriptVersion, 1);
  assert.deepEqual(done.transcript?.segments.map((s) => s.id), ["a", "c"]);
});

test("지움이 없으면 분석은 한 번만 돌고 버전은 그대로다", async () => {
  const id = await seedTranscribedMeeting();
  const { ai, calls, release, firstEntered } = gatedAnalyzer();
  setDeleteSegmentsAiForTest(ai);

  startMeetingProcessing(id, { ai });
  await firstEntered;
  release();
  const done = await processMeetingUntilSettled(id, 10_000);

  assert.equal(done.status, "ready");
  assert.equal(calls.length, 1);
  assert.equal(done.analysis?.summary, "요약: 비밀 포함");
  assert.equal(done.transcriptVersion, undefined);
});

test("분석 도중 모든 발화를 지우면 옛 요약을 저장하지 않고 빈 회의록으로 끝난다", async () => {
  const id = await seedTranscribedMeeting();
  const { ai, calls, release, firstEntered } = gatedAnalyzer();
  setDeleteSegmentsAiForTest(ai);

  startMeetingProcessing(id, { ai });
  await firstEntered;
  await deleteTranscriptSegments(id, ["a", "b", "c"]);
  release();
  const done = await processMeetingUntilSettled(id, 10_000);

  assert.equal(calls.length, 1, "빈 전사본은 다시 분석하지 않는다");
  assert.equal(done.status, "ready");
  assert.equal(done.analysis?.summary, "");
  assert.equal(done.transcript?.segments.length, 0);
});
