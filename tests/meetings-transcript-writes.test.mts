// 전사본을 바꾸는 모든 쓰기가 회의별 한 줄(버전 검사)을 거치는지 보는 행동 테스트.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createMeeting, deleteMeeting, getMeeting, updateMeeting } from "@/lib/meetings/store";
import { deleteTranscriptSegments, setDeleteSegmentsAiForTest } from "@/lib/meetings/delete-transcript-segments";
import { renameMeeting } from "@/lib/meetings/rename";
import { reanalyzeMeeting } from "@/lib/meetings/reanalyze";
import { readTimeline, writeTimeline } from "@/lib/meetings/timeline/store";
import { writeTimelineIfCurrent } from "@/lib/meetings/timeline/run";
import { GET as timelineGet, POST as timelinePost } from "@/app/api/meetings/[id]/timeline/route";
import { waitForJobsToDrain } from "@/lib/jobs/run";
import { buildTranscriptPlain } from "@/lib/meetings/transcript";
import type { MeetingTranscript, TranscriptSegment } from "@/lib/meetings/types";

let dir: string;
const keys = ["MEETINGS_DATA_DIR", "MEETINGS_AUDIO_DIR", "MEETINGS_TIMELINE_DIR"] as const;
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

const fakeAi = {
  async transcribeAudio(): Promise<string> {
    throw new Error("테스트에서 전사는 불리지 않는다");
  },
  async analyzeMeeting(plain: string) {
    return JSON.stringify({ headline: "h", summary: plain.includes("비밀") ? "비밀 포함" : "비밀 없음" });
  },
};

beforeEach(async () => {
  setDeleteSegmentsAiForTest(fakeAi);
  dir = await mkdtemp(path.join(tmpdir(), "meetings-writes-"));
  process.env.MEETINGS_DATA_DIR = path.join(dir, "data");
  process.env.MEETINGS_AUDIO_DIR = path.join(dir, "audio");
  process.env.MEETINGS_TIMELINE_DIR = path.join(dir, "timeline");
});

afterEach(async () => {
  setDeleteSegmentsAiForTest();
  await waitForJobsToDrain();
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await rm(dir, { recursive: true, force: true });
});

const SEGMENTS = [
  { id: "a", speaker: "S1", text: "첫째 발화", t: 0 },
  { id: "b", speaker: "S1", text: "비밀 발화", t: 5 },
  { id: "c", speaker: "S1", text: "셋째 발화", t: 10 },
] as TranscriptSegment[];

async function seed() {
  return seedWith({});
}

async function seedWith(extra: Partial<MeetingTranscript>) {
  const m = await createMeeting({ title: "테스트" });
  await updateMeeting(m.id, {
    status: "ready",
    transcript: { segments: SEGMENTS, plain: buildTranscriptPlain(SEGMENTS), ...extra },
  });
  return m.id;
}

const exists = (p: string) => access(p).then(() => true, () => false);
const timelineFile = (id: string) => path.join(dir, "timeline", `${id}.json`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

test("재분석 도중 발화를 지우면 옛 전사본·요약을 저장하지 않고 현재 전사본으로 다시 분석한다", async () => {
  const id = await seed();
  const calls: string[] = [];
  let release!: () => void;
  let entered!: () => void;
  const firstEntered = new Promise<void>((r) => (entered = r));
  const ai = {
    async analyzeMeeting(plain: string) {
      calls.push(plain);
      if (calls.length === 1) {
        entered();
        await new Promise<void>((r) => (release = r));
      }
      return JSON.stringify({ headline: "h", summary: plain.includes("비밀") ? "비밀 포함" : "비밀 없음" });
    },
    async extractTasks() {
      return "[]";
    },
  };
  const running = reanalyzeMeeting(id, ai);
  await firstEntered;
  assert.equal((await deleteTranscriptSegments(id, ["b"])).kind, "success");
  release();
  const outcome = await running;
  await waitForJobsToDrain();

  assert.equal(outcome.kind, "updated");
  const after = await getMeeting(id);
  assert.deepEqual(after?.transcript?.segments.map((s) => s.id), ["a", "c"]);
  assert.ok(!calls.at(-1)!.includes("비밀"));
  assert.equal(after?.analysis?.summary, "비밀 없음");
});

test("동시에 다른 발화를 지우면 두 삭제가 모두 남고 버전이 두 번 오른다", async () => {
  const id = await seed();
  const [x, y] = await Promise.all([
    deleteTranscriptSegments(id, ["a"]),
    deleteTranscriptSegments(id, ["b"]),
  ]);
  await waitForJobsToDrain();
  assert.equal(x.kind, "success");
  assert.equal(y.kind, "success");
  const after = await getMeeting(id);
  assert.deepEqual(after?.transcript?.segments.map((s) => s.id), ["c"]);
  assert.equal(after?.transcriptVersion, 2);
});

test("회의를 지우면 타임라인 파일도 지워지고 늦게 온 타임라인 쓰기는 버려진다", async () => {
  const id = await seed();
  await writeTimeline({ meetingId: id, status: "done", items: [], totalMinutes: 1 });
  assert.ok(await exists(timelineFile(id)));
  await deleteMeeting(id);
  assert.ok(!(await exists(timelineFile(id))));
  const late = await writeTimelineIfCurrent({ meetingId: id, status: "running", items: [], totalMinutes: 1 }, 0);
  assert.equal(late, false);
  assert.ok(!(await exists(timelineFile(id))));
});

test("없는 회의의 타임라인 GET·POST 는 404 다", async () => {
  const id = await seed();
  await deleteMeeting(id);
  assert.equal((await timelineGet(new Request("http://x"), ctx(id))).status, 404);
  assert.equal((await timelinePost(new Request("http://x"), ctx(id))).status, 404);
});

test("발화를 지우면 타임라인이 지워지고 옛 버전 기준 타임라인 쓰기는 버려진다", async () => {
  const id = await seed();
  await writeTimeline({ meetingId: id, status: "done", items: [], totalMinutes: 1 });
  await deleteTranscriptSegments(id, ["b"]);
  await waitForJobsToDrain();
  assert.equal((await readTimeline(id)).status, "idle");
  assert.equal(await writeTimelineIfCurrent({ meetingId: id, status: "running", items: [], totalMinutes: 1 }, 0), false);
  assert.equal((await readTimeline(id)).status, "idle");
});

test("이름 변경은 전사본의 다른 필드(quality 등)를 지우지 않는다", async () => {
  const quality = { completeness: "partial", tracks: [] } as never;
  const m = await renameMeeting(await seedWith({ quality }), "발화", "말");
  assert.equal(m.kind, "renamed");
  const after = await getMeeting(m.kind === "renamed" ? m.meeting.id : "");
  assert.deepEqual(after?.transcript?.quality, quality);
  assert.equal(after?.transcript?.segments[0].text, "첫째 말");
});

test("이름 변경은 회의 줄 안에서 일어나 동시 삭제를 되살리지 않고 버전을 올리며 타임라인을 지운다", async () => {
  const id = await seed();
  await writeTimeline({ meetingId: id, status: "done", items: [], totalMinutes: 1 });
  const [r, d] = await Promise.all([renameMeeting(id, "발화", "말"), deleteTranscriptSegments(id, ["b"])]);
  await waitForJobsToDrain();
  assert.equal(r.kind, "renamed");
  assert.equal(d.kind, "success");
  const after = await getMeeting(id);
  assert.deepEqual(after?.transcript?.segments.map((s) => s.id), ["a", "c"]);
  assert.ok(after?.transcript?.segments.every((s) => s.text.endsWith("말")));
  assert.equal(after?.transcriptVersion, 2);
  assert.equal((await readTimeline(id)).status, "idle");
});

test("바꿀 단어가 없으면 아무것도 쓰지 않는다", async () => {
  const id = await seed();
  assert.equal((await renameMeeting(id, "없는말", "x")).kind, "no-match");
  assert.equal((await getMeeting(id))?.transcriptVersion, undefined);
});
