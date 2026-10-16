// 저장된 전사로 분석을 다시 돌린다(재분석).
import { refineTasks } from "./task-extract";
import { taggedMeetingTitle } from "./tags";
import { getMeeting, transcriptVersionOf, updateMeetingIfTranscriptVersion } from "./store";
import { parseAnalysis } from "./analysis";
import { buildContextText } from "./context-sources";
import { attachAnalysisEvidence } from "./evidence";
import { applyCurrentAliases } from "./name-aliases";
import type { MeetingAi, MeetingAnalysis } from "./types";

export type ReanalyzeAi = Pick<MeetingAi, "analyzeMeeting"> & {
  extractTasks(prompt: string): Promise<string>;
};

export type ReanalyzeOutcome =
  | { readonly kind: "updated"; readonly analysis: MeetingAnalysis | undefined }
  | { readonly kind: "missing" }
  | { readonly kind: "no-transcript" }
  | { readonly kind: "stale" };

/** 분석 중 전사본이 바뀌면 결과를 버리고 다시 돈다. 이 횟수를 넘으면 "stale". */
const MAX_ATTEMPTS = 3;

/**
 * 분석은 시작 때 읽은 전사본 버전 위에서만 저장한다(updateMeetingIfTranscriptVersion).
 * 그 사이 발화가 지워졌다면 옛 전사본·요약을 쓰지 않고 지금 전사본으로 다시 분석한다.
 */
export async function reanalyzeMeeting(id: string, ai: ReanalyzeAi): Promise<ReanalyzeOutcome> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const meeting = await getMeeting(id);
    if (!meeting) return { kind: "missing" };
    const version = transcriptVersionOf(meeting);
    const transcript = meeting.transcript ? await applyCurrentAliases(meeting.transcript) : undefined;
    if (!transcript?.plain) return { kind: "no-transcript" };
    const contextText = buildContextText(meeting.contextSources);
    const raw = await ai.analyzeMeeting(transcript.plain, {
      includeAutomationLeads: true,
      ...(contextText ? { contextText } : {}),
    });
    // ingest 와 같은 순서: 근거를 다시 붙여야 재분석 후에도 대본 위치 링크가 남는다.
    const refined = await refineTasks(parseAnalysis(raw), transcript, ai.extractTasks);
    const analysis = attachAnalysisEvidence(refined, transcript);
    const title = taggedMeetingTitle(meeting.title, analysis);
    const saved = await updateMeetingIfTranscriptVersion(id, version, {
      analysis,
      // 이름 별칭·용어집이 표기를 바꿨을 때만 전사본도 쓴다.
      ...(transcript === meeting.transcript ? {} : { transcript }),
      ...(title ? { title } : {}),
    });
    if (saved === "missing") return { kind: "missing" };
    if (saved === "updated") return { kind: "updated", analysis };
  }
  return { kind: "stale" };
}
