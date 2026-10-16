// 타임라인 만들기 잡. 배치(15분)마다 저장하고, 끊겨도 남은 분만 이어 쓴다.
// 고아 판정: running 인데 하트비트가 ORPHAN_MS 넘게 멈췄으면 다시 시작해도 된다.
import { generateText } from "@/lib/ai/generate";
import { getMeeting, runIfTranscriptVersion, transcriptVersionOf } from "../store";
import { batchPrompt, bucketByMinute, parseItems, pendingBatches } from "./minutes";
import { readTimeline, writeTimeline, type TimelineState } from "./store";

const BATCH = 15;
const CALL_TIMEOUT_MS = 180_000;
/** 호출 상한(3분)보다 여유 있게 길게 */
const ORPHAN_MS = 6 * 60_000;

const running = ((globalThis as { __meetingTimelineJobs?: Set<string> }).__meetingTimelineJobs ??= new Set<string>());

export function isOrphan(s: TimelineState, nowMs = Date.now()): boolean {
  return s.status === "running" && (!s.heartbeatAt || nowMs - Date.parse(s.heartbeatAt) > ORPHAN_MS);
}

/**
 * 회의가 있고 전사본 버전이 그대로일 때만 쓴다(회의 줄 안에서 검사와 쓰기).
 * 회의 삭제·발화 삭제 뒤에 늦게 끝난 배치가 타임라인을 되살리지 않게 한다.
 */
export async function writeTimelineIfCurrent(state: TimelineState, transcriptVersion: number): Promise<boolean> {
  const outcome = await runIfTranscriptVersion(state.meetingId, transcriptVersion, () => writeTimeline(state));
  return outcome === "done";
}

class TimelineSuperseded extends Error {}

async function runJob(id: string, version: number): Promise<void> {
  const meeting = await getMeeting(id);
  if (!meeting || transcriptVersionOf(meeting) !== version) return;
  const save = async (next: TimelineState) => {
    if (!(await writeTimelineIfCurrent(next, version))) throw new TimelineSuperseded();
  };
  const chunks = bucketByMinute(meeting.transcript?.segments ?? []);
  let state = await readTimeline(id);
  const done = new Set(state.items.map((i) => i.minute));
  const context = meeting.analysis?.headline || meeting.title || "회의";
  state = { ...state, status: "running", totalMinutes: chunks.length, heartbeatAt: new Date().toISOString(), error: undefined };
  await save(state);
  for (const batch of pendingBatches(chunks, done, BATCH)) {
    const raw = await generateText({ tier: "reasoning", prompt: batchPrompt(batch, context), json: true, noTools: true, timeoutMs: CALL_TIMEOUT_MS });
    const items = parseItems(raw, new Set(batch.map((c) => c.minute)));
    state = { ...state, items: [...state.items, ...items].sort((a, b) => a.minute - b.minute), heartbeatAt: new Date().toISOString() };
    await save(state);
  }
  await save({ ...state, status: "done" });
}

/** 없거나 멈췄으면 시작한다. 이미 도는 중이면 그대로 둔다. 회의가 없으면 null */
export async function ensureTimeline(id: string): Promise<TimelineState | null> {
  const meeting = await getMeeting(id);
  if (!meeting) return null;
  const version = transcriptVersionOf(meeting);
  const state = await readTimeline(id);
  const fresh = state.status === "running" && !isOrphan(state);
  if (running.has(id) || fresh || state.status === "done") return state;
  running.add(id);
  void runJob(id, version)
    .catch(async (e) => {
      // 회의가 지워졌거나 전사본이 바뀌었으면 이 잡의 결과는 버린다.
      if (e instanceof TimelineSuperseded) return;
      const failed: TimelineState = { ...(await readTimeline(id)), status: "error", error: e instanceof Error ? e.message.slice(0, 300) : "실패" };
      await writeTimelineIfCurrent(failed, version);
    })
    .finally(() => running.delete(id));
  return { ...state, status: "running" };
}
