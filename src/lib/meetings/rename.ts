import { mutateMeeting, transcriptEditPatch } from "./store";
import type { FlowStage, GlossaryTerm, Meeting, MeetingAnalysis, MeetingUpdate } from "./types";

/**
 * 회의 레코드 전체에서 특정 단어(주로 잘못 전사된 사람 이름)를 일괄 치환한다.
 * 대상: 제목·사람 태그·전사(화자/본문)·분석·생성 문서(docs, 회의록 등)의 모든
 * 문자열. 비대상: id/shareId/날짜/상태 등 식별·메타 필드.
 *
 * 순수 함수 — 원본을 변경하지 않고 새 Meeting 과 치환 횟수를 돌려준다.
 * 한글 이름엔 단어 경계(\b)가 없어 단순 부분 문자열 치환을 쓴다. "나" 같은
 * 한 글자 치환은 본문을 망가뜨리므로 호출 측(라우트)에서 2글자 이상을 강제한다.
 */
export interface RenameResult {
  meeting: Meeting;
  count: number;
}

export function renameInMeeting(
  meeting: Meeting,
  from: string,
  to: string
): RenameResult {
  let count = 0;

  function sub(s: string): string {
    if (!s || !s.includes(from)) return s;
    const parts = s.split(from);
    count += parts.length - 1;
    return parts.join(to);
  }

  const next: Meeting = {
    ...meeting,
    title: meeting.title === undefined ? undefined : sub(meeting.title),
    people: meeting.people.map(sub),
  };

  if (meeting.transcript) {
    next.transcript = {
      ...meeting.transcript,
      segments: meeting.transcript.segments.map((seg) => ({
        ...seg,
        speaker: sub(seg.speaker),
        text: sub(seg.text),
      })),
      plain: sub(meeting.transcript.plain),
    };
  }

  if (meeting.docs) {
    // 생성 문서(회의록·강의노트 등)의 본문도 함께 교정한다 — 문서만 옛 이름으로
    // 남던 구멍(2026-07-24 실사고). title 은 템플릿 표시명이라 제외.
    next.docs = meeting.docs.map((d) => ({ ...d, content: sub(d.content) }));
  }

  if (meeting.analysis) {
    const a = meeting.analysis;
    next.analysis = {
      ...a,
      headline: sub(a.headline),
      summary: sub(a.summary),
      keyPoints: a.keyPoints.map(sub),
      ...(a.topics && {
        topics: a.topics.map((t) => ({
          title: sub(t.title),
          ...(t.summary && { summary: sub(t.summary) }),
          points: t.points.map(sub),
        })),
      }),
      ...(a.decisions && { decisions: a.decisions.map(sub) }),
      ...(a.actionItems && {
        actionItems: a.actionItems.map((it) => ({
          ...it,
          owner: sub(it.owner),
          task: sub(it.task),
          ...(it.context && { context: sub(it.context) }),
          ...(it.doneWhen && { doneWhen: sub(it.doneWhen) }),
          ...(it.goal && { goal: sub(it.goal) }),
          ...(it.why && { why: sub(it.why) }),
          ...(it.inputs && { inputs: sub(it.inputs) }),
          ...(it.how && { how: sub(it.how) }),
          ...(it.caution && { caution: sub(it.caution) }),
        })),
      }),
      ...(a.nextSteps && { nextSteps: a.nextSteps.map(sub) }),
      ...(a.openQuestions && { openQuestions: a.openQuestions.map(sub) }),
      ...renameStructure(a, sub),
    };
  }

  return { meeting: next, count };
}

type Sub = (text: string) => string;

/** 흐름·역할·용어 안의 이름도 같이 바꾼다. */
function renameStructure(a: MeetingAnalysis, sub: Sub): Partial<MeetingAnalysis> {
  return {
    ...(a.purpose && { purpose: sub(a.purpose) }),
    ...(a.schedule && {
      schedule: a.schedule.map((s) => ({ when: sub(s.when), what: sub(s.what) })),
    }),
    ...(a.highlights && {
      highlights: a.highlights.map((h) => ({ title: sub(h.title), detail: sub(h.detail) })),
    }),
    ...(a.followUps && { followUps: a.followUps.map(sub) }),
    ...(a.flow && { flow: a.flow.map((s) => renameStage(s, sub)) }),
    ...(a.roles && {
      roles: a.roles.map((r) => ({
        ...r,
        name: sub(r.name),
        role: sub(r.role),
        ...(r.responsibilities && { responsibilities: r.responsibilities.map(sub) }),
        ...(r.decides && { decides: sub(r.decides) }),
      })),
    }),
    ...(a.glossary && { glossary: a.glossary.map((g) => renameTerm(g, sub)) }),
  };
}

function renameStage(s: FlowStage, sub: Sub): FlowStage {
  return {
    ...s,
    name: sub(s.name),
    ...(s.owner && { owner: sub(s.owner) }),
    ...(s.rule && { rule: sub(s.rule) }),
  };
}

function renameTerm(g: GlossaryTerm, sub: Sub): GlossaryTerm {
  return {
    term: sub(g.term),
    definition: sub(g.definition),
    ...(g.distinction && { distinction: sub(g.distinction) }),
  };
}

export type RenameMeetingOutcome =
  | { readonly kind: "not-found" }
  | { readonly kind: "no-match" }
  | { readonly kind: "renamed"; readonly count: number; readonly meeting: Meeting };

/**
 * 읽기·치환·저장을 회의 줄 하나 안에서 한다. 그래야 동시에 온 발화 삭제를 옛 전사본으로
 * 덮어써 되살리지 않는다. 전사본이 바뀌므로 버전을 올리고 타임라인을 지운다.
 */
export async function renameMeeting(
  id: string,
  from: string,
  to: string
): Promise<RenameMeetingOutcome> {
  const mutation = await mutateMeeting<number>(id, async (existing) => {
    const { meeting: renamed, count } = renameInMeeting(existing, from, to);
    if (count === 0) return { result: 0 };
    const patch: MeetingUpdate = {
      title: renamed.title,
      people: renamed.people,
      analysis: renamed.analysis,
      docs: renamed.docs,
    };
    const transcript = renamed.transcript;
    if (transcript && transcript.plain !== existing.transcript?.plain) {
      Object.assign(patch, await transcriptEditPatch(existing, () => transcript));
    }
    return { result: count, patch };
  });
  if (!mutation) return { kind: "not-found" };
  if (mutation.result === 0) return { kind: "no-match" };
  return { kind: "renamed", count: mutation.result, meeting: mutation.meeting };
}
