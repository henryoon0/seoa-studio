import { randomUUID } from "node:crypto";
import { dirStore } from "@/lib/json-store";
import { localDateKey } from "@/lib/date";
import type {
  Meeting,
  MeetingHomeSummaryItem,
  MeetingStatus,
  MeetingSummaryItem,
  MeetingTranscript,
  MeetingUpdate,
  NewMeetingInput,
} from "./types";
import { isValidMeetingId } from "./validate";
import { parseAnalysis } from "./analysis";
import { attachAnalysisEvidence } from "./evidence";
import {
  deleteMeetingAudio,
  deleteMeetingAudioTracks,
} from "./audio-store";
import { deleteTimeline } from "./timeline/store";

// 회의 레코드 스토어 — 파일 배선(경로·원자적 쓰기·깨진 파일 방어)은 dirStore.
const store = dirStore<Meeting>({ dir: "meetings", envVar: "MEETINGS_DATA_DIR" });
const evidenceCache = new Map<string, Meeting>();

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * updatedAt 은 시각일 뿐 아니라 **버전 표식**으로도 쓰인다(아래 evidence 캐시 키).
 * 그런데 ISO 문자열은 밀리초 해상도라, 한 밀리초 안에 두 번 쓰면 서로 다른 상태가
 * 같은 키를 갖는다 — 캐시가 낡은 스냅샷을 계속 돌려주고 화면은 끝난 회의를 영영
 * "전사됨"으로 본다(실측: 디스크 ready / API transcribed, updatedAt 동일).
 * 그래서 레코드마다 단조 증가시킨다.
 */
function nextUpdatedAt(previous: string): string {
  const now = Date.now();
  const prev = Date.parse(previous);
  return new Date(
    Number.isFinite(prev) && prev >= now ? prev + 1 : now
  ).toISOString();
}

async function write(m: Meeting): Promise<void> {
  await store.put(m.id, m);
}

function normalizeMeeting(meeting: Meeting): Meeting {
  const storedAnalysis = meeting.analysis as Meeting["analysis"] & {
    automationIdeas?: unknown;
  };
  const migratedAnalysis =
    storedAnalysis?.automationIdeas && !storedAnalysis.automationLeads
      ? parseAnalysis(JSON.stringify(storedAnalysis))
      : storedAnalysis;
  const transcript = meeting.transcript
    ? {
        ...meeting.transcript,
        segments: meeting.transcript.segments.map((segment, index) => ({
          ...segment,
          id:
            segment.id ??
            `seg-${segment.sourceTrack ?? "mixed"}-${Math.round(
              (segment.t ?? 0) * 1000
            )}-${index}`,
        })),
      }
    : undefined;
  return {
    ...meeting,
    ...(transcript ? { transcript } : {}),
    ...(migratedAnalysis ? { analysis: migratedAnalysis } : {}),
  };
}

function withCachedEvidence(meeting: Meeting): Meeting {
  if (!meeting.analysis || !meeting.transcript || meeting.analysis.evidence) {
    return meeting;
  }
  const cacheKey = `${process.env.MEETINGS_DATA_DIR ?? "default"}:${meeting.id}:${meeting.updatedAt}`;
  const cached = evidenceCache.get(cacheKey);
  if (cached) return cached;
  const enriched = {
    ...meeting,
    analysis: attachAnalysisEvidence(meeting.analysis, meeting.transcript),
  };
  evidenceCache.set(cacheKey, enriched);
  return enriched;
}

export async function createMeeting(
  input: NewMeetingInput = {}
): Promise<Meeting> {
  const id = randomUUID();
  const ts = nowIso();
  const meeting: Meeting = {
    id,
    shareId: randomUUID().replace(/-/g, ""),
    status: "recorded",
    createdAt: ts,
    updatedAt: ts,
    date: input.date ?? localDateKey(),
    title: input.title,
    people: [],
    mode: input.mode ?? "remote",
    ...(input.source ? { source: input.source } : {}),
    ...(input.voiceIngestKey ? { voiceIngestKey: input.voiceIngestKey } : {}),
  };
  await write(meeting);
  return meeting;
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  if (!isValidMeetingId(id)) return null;
  const meeting = await store.get(id);
  return meeting ? withCachedEvidence(normalizeMeeting(meeting)) : null;
}

export async function listMeetings(): Promise<Meeting[]> {
  const out = (await store.list())
    // 같은 폴더의 비회의 JSON(name-aliases.json 등)이 회의로 섞이지 않게 거른다.
    .filter((m) => isValidMeetingId(m.id))
    .map(normalizeMeeting);
  // newest first by updatedAt
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

export async function findMeetingByVoiceIngestKey(
  key: string
): Promise<Meeting | null> {
  const meetings = await listMeetings();
  return meetings.find((meeting) => meeting.voiceIngestKey === key) ?? null;
}

/** 목록 화면용 — 무거운 필드(transcript·문서·상세 analysis)를 뗀 요약 목록. */
export async function listMeetingSummaries(): Promise<MeetingSummaryItem[]> {
  const all = await listMeetings();
  return all.map((m) => {
    const analysis = m.analysis;
    const rest = { ...m };
    delete rest.transcript;
    delete rest.docs;
    delete rest.mentor;
    delete rest.analysis;
    return {
      ...rest,
      ...(analysis
        ? {
            analysis: {
              headline: analysis.headline,
              summary: analysis.summary,
              ...(analysis.decisions ? { decisions: analysis.decisions } : {}),
              ...(analysis.actionItems ? { actionItems: analysis.actionItems } : {}),
              ...(analysis.nextSteps ? { nextSteps: analysis.nextSteps } : {}),
              ...(analysis.openQuestions
                ? { openQuestions: analysis.openQuestions }
                : {}),
            },
          }
        : {}),
      ...(m.docs?.length
        ? { docTemplateIds: m.docs.map((doc) => doc.templateId) }
        : {}),
    };
  });
}

/** 홈 화면용 — 최근 회의 제목 줄에 필요한 최소 필드만 반환한다. */
export async function listMeetingHomeSummaries(
  limit = 3
): Promise<MeetingHomeSummaryItem[]> {
  const all = await listMeetings();
  return all.slice(0, limit).map((m) => ({
    id: m.id,
    date: m.date,
    ...(m.title ? { title: m.title } : {}),
    ...(m.people?.length ? { people: m.people } : {}),
  }));
}

// 회의별 쓰기 직렬화 — 읽고(getMeeting) 합쳐서 쓰는(write) 사이에 다른 갱신이 끼면
// 한쪽이 덮어써진다. 같은 회의의 갱신은 한 줄로 세운다(이 프로세스 안에서).
const writeChains = new Map<string, Promise<unknown>>();

function serialized<T>(id: string, task: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(id) ?? Promise.resolve();
  const run = prev.then(task, task);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  writeChains.set(id, tail);
  void tail.then(() => {
    if (writeChains.get(id) === tail) writeChains.delete(id);
  });
  return run;
}

async function applyUpdate(
  id: string,
  patch: MeetingUpdate
): Promise<Meeting | null> {
  const existing = await getMeeting(id);
  if (!existing) return null;
  const merged: Meeting = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    shareId: existing.shareId,
    updatedAt: nextUpdatedAt(existing.updatedAt),
  };
  await write(merged);
  return merged;
}

export async function updateMeeting(
  id: string,
  patch: MeetingUpdate
): Promise<Meeting | null> {
  return serialized(id, () => applyUpdate(id, patch));
}

export function transcriptVersionOf(meeting: Pick<Meeting, "transcriptVersion">): number {
  return meeting.transcriptVersion ?? 0;
}

/**
 * 전사본 버전이 expected 와 같을 때만 저장한다(검사와 쓰기가 한 줄 안에서 일어난다).
 * 분석처럼 오래 걸리는 작업이 시작 때의 전사본 위에서 만든 결과를, 그 사이 전사본이
 * 바뀌었다면 버리기 위한 장치다. "stale" 이면 아무것도 쓰지 않는다.
 */
export async function updateMeetingIfTranscriptVersion(
  id: string,
  expected: number,
  patch: MeetingUpdate
): Promise<"updated" | "stale" | "missing"> {
  return serialized(id, async () => {
    const existing = await getMeeting(id);
    if (!existing) return "missing";
    if (transcriptVersionOf(existing) !== expected) return "stale";
    await applyUpdate(id, patch);
    return "updated";
  });
}

/**
 * 회의 줄 안에서 지금 레코드를 읽고 고칠 내용을 정한다. 읽기와 쓰기 사이에 다른 갱신이
 * 끼지 못하므로, 지금 값에 기대는 변경(발화 삭제 + 버전 올리기)은 이 길로 쓴다.
 * decide 가 patch 없이 돌아오면 아무것도 쓰지 않는다.
 */
export async function mutateMeeting<T>(
  id: string,
  decide: (existing: Meeting) => Promise<{ patch?: MeetingUpdate; result: T }>
): Promise<{ result: T; meeting: Meeting } | null> {
  return serialized(id, async () => {
    const existing = await getMeeting(id);
    if (!existing) return null;
    const { patch, result } = await decide(existing);
    if (!patch) return { result, meeting: existing };
    const meeting = await applyUpdate(id, patch);
    return meeting ? { result, meeting } : null;
  });
}

/**
 * 사용자 편집(발화 삭제·이름 변경)으로 전사본을 바꿀 때 쓰는 유일한 patch 생성기.
 * mutateMeeting 의 decide 안에서만 부른다. 기존 전사본의 다른 필드(quality·provenance)는
 * 남기고, 버전을 올려 진행 중인 분석을 무효로 만들고, 옛 전사본으로 만든 타임라인을 지운다.
 */
export async function transcriptEditPatch(
  existing: Meeting,
  edit: (transcript: MeetingTranscript) => Pick<MeetingTranscript, "segments" | "plain">
): Promise<Pick<MeetingUpdate, "transcript" | "transcriptVersion">> {
  if (!existing.transcript) throw new Error("편집할 전사본이 없습니다");
  const transcript = { ...existing.transcript, ...edit(existing.transcript) };
  await deleteTimeline(existing.id);
  return { transcript, transcriptVersion: transcriptVersionOf(existing) + 1 };
}

/**
 * 회의가 있고 전사본 버전이 expected 일 때만 task 를 회의 줄 안에서 돌린다.
 * 회의 레코드 밖의 파일(타임라인)도 회의 삭제·발화 삭제와 엇갈려 되살아나지 않게 한다.
 */
export async function runIfTranscriptVersion(
  id: string,
  expected: number,
  task: () => Promise<void>
): Promise<"done" | "stale" | "missing"> {
  return serialized(id, async () => {
    const existing = await getMeeting(id);
    if (!existing) return "missing";
    if (transcriptVersionOf(existing) !== expected) return "stale";
    await task();
    return "done";
  });
}

export async function setStatus(
  id: string,
  status: MeetingStatus,
  errorMsg?: string
): Promise<Meeting | null> {
  const patch: MeetingUpdate = { status };
  if (errorMsg !== undefined) patch.error = errorMsg;
  return updateMeeting(id, patch);
}

export async function deleteMeeting(id: string): Promise<boolean> {
  if (!isValidMeetingId(id)) return false;
  // 회의 줄 안에서 지운다 — 진행 중인 분석·타임라인 쓰기는 뒤에서 "missing" 으로 버려진다.
  // 영속화된 오디오 사본과 타임라인도 같이 정리한다(고아 파일이 남지 않게).
  return serialized(id, async () => {
    const meeting = await getMeeting(id);
    await Promise.all([
      deleteMeetingAudio(meeting?.audioFile),
      deleteMeetingAudioTracks(meeting?.audioTracks),
      deleteTimeline(id),
    ]);
    return store.remove(id);
  });
}
