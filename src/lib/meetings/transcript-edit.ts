import type { MeetingTranscript } from "./types";
import { buildTranscriptPlain } from "./transcript";

export interface RemoveTranscriptSegmentsResult {
  readonly transcript: MeetingTranscript;
  readonly removedIds: readonly string[];
}

/** 안정 ID로 고른 발화를 제거하고, 파생 plain을 남은 세그먼트에서 다시 만든다. */
export function removeTranscriptSegments(
  transcript: MeetingTranscript,
  segmentIds: readonly string[]
): RemoveTranscriptSegmentsResult {
  const requestedIds = new Set(segmentIds);
  const removedIds = transcript.segments
    .filter((segment) => segment.id && requestedIds.has(segment.id))
    .flatMap((segment) => (segment.id ? [segment.id] : []));
  const segments = transcript.segments.filter(
    (segment) => !segment.id || !requestedIds.has(segment.id)
  );

  return {
    transcript: {
      ...transcript,
      segments,
      plain: buildTranscriptPlain(segments),
    },
    removedIds,
  };
}
