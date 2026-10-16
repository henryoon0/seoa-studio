import { localAi } from "./local-ai";
import { startMeetingProcessing } from "./ingest";
import { mutateMeeting, transcriptEditPatch } from "./store";
import { removeTranscriptSegments } from "./transcript-edit";
import type { MeetingAi, MeetingTranscript } from "./types";

type RebuildAi = Pick<MeetingAi, "transcribeAudio" | "analyzeMeeting">;
let rebuildAi: RebuildAi = localAi;

/** 테스트 전용. 삭제 뒤 재분석에 쓸 분석기를 바꾼다. 인자 없이 부르면 원래대로. */
export function setDeleteSegmentsAiForTest(ai?: RebuildAi): void {
  rebuildAi = ai ?? localAi;
}

export type DeleteTranscriptSegmentsOutcome =
  | { readonly kind: "meeting-not-found" }
  | { readonly kind: "transcript-not-found" }
  | { readonly kind: "segments-not-found" }
  | { readonly kind: "share-unpublish-failed"; readonly message: string }
  | {
      readonly kind: "success";
      readonly transcript: MeetingTranscript;
      readonly removedIds: readonly string[];
      readonly rebuildingAnalysis: boolean;
    };

export function parseTranscriptSegmentIds(
  raw: unknown
): readonly string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) return null;
  const ids = raw.filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim())
  );
  return ids.length === raw.length ? ids : null;
}

export async function deleteTranscriptSegments(
  meetingId: string,
  segmentIds: readonly string[]
): Promise<DeleteTranscriptSegmentsOutcome> {
  // 읽기·삭제·버전 올리기·타임라인 무효화를 회의 줄 하나 안에서 한다.
  // 그래야 동시에 온 두 삭제가 같은 옛 전사본을 읽고 서로를 덮어쓰지 않는다.
  type Decision =
    | { readonly kind: "transcript-not-found" | "segments-not-found" }
    | {
        readonly kind: "success";
        readonly transcript: MeetingTranscript;
        readonly removedIds: readonly string[];
        readonly rebuildingAnalysis: boolean;
      };
  const mutation = await mutateMeeting<Decision>(meetingId, async (meeting) => {
    if (!meeting.transcript) return { result: { kind: "transcript-not-found" } };
    const removal = removeTranscriptSegments(meeting.transcript, segmentIds);
    if (removal.removedIds.length === 0) return { result: { kind: "segments-not-found" } };

    const removedKeys = new Set(
      removal.removedIds.map((segmentId) => `seg:${segmentId}`)
    );
    const highlights = meeting.highlights?.filter(
      (highlight) =>
        highlight.key.startsWith("seg:") && !removedKeys.has(highlight.key)
    );
    const hiddenBlocks = meeting.hiddenBlocks?.filter(
      (blockKey) => blockKey.startsWith("seg:") && !removedKeys.has(blockKey)
    );
    const rebuildingAnalysis = removal.transcript.segments.length > 0;
    // 버전 올리기·타임라인 지우기는 transcriptEditPatch 가 한다. 다시 만들기는 화면에서 요청한다.
    const edit = await transcriptEditPatch(meeting, () => removal.transcript);
    return {
      result: {
        kind: "success",
        transcript: edit.transcript!,
        removedIds: removal.removedIds,
        rebuildingAnalysis,
      },
      patch: {
        ...edit,
        analysis: rebuildingAnalysis
          ? undefined
          : {
              headline: meeting.title?.trim() || "내용이 없는 회의록",
              summary: "",
              keyPoints: [],
            },
        docs: undefined,
        notesShare: undefined,
        highlights: highlights?.length ? highlights : undefined,
        hiddenBlocks: hiddenBlocks?.length ? hiddenBlocks : undefined,
        status: rebuildingAnalysis ? "transcribed" : "ready",
        processing: rebuildingAnalysis ? { stage: "analyzing" } : undefined,
        error: undefined,
      },
    };
  });
  if (!mutation) return { kind: "meeting-not-found" };
  const outcome = mutation.result;
  if (outcome.kind !== "success") return outcome;

  const { rebuildingAnalysis } = outcome;
  if (rebuildingAnalysis) {
    startMeetingProcessing(meetingId, { ai: rebuildAi });
  }
  return outcome;
}
