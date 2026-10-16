import type { MeetingSummaryItem } from "@/lib/meetings/types";

export interface MeetingSignals {
  /** Todo로 아직 보내지 않은 내 할 일. */
  readonly myActions: number;
  readonly decisions: number;
}

export function meetingSignals(meeting: MeetingSummaryItem): MeetingSignals {
  const actions = meeting.analysis?.actionItems ?? [];
  return {
    myActions: actions.filter(
      (action) => action.owner === "나" && action.todo === undefined
    ).length,
    decisions: meeting.analysis?.decisions?.length ?? 0,
  };
}

function haystack(meeting: MeetingSummaryItem): string {
  const a = meeting.analysis;
  return [
    meeting.title,
    a?.headline,
    a?.summary,
    ...meeting.people,
    ...(a?.decisions ?? []),
    ...(a?.actionItems ?? []).map((action) => action.task),
  ]
    .filter(Boolean)
    .join("\n")
    .normalize("NFC")
    .toLowerCase();
}

/** 제목·사람·요약·결정·할 일에서 모든 단어가 들어간 회의만 남긴다. */
export function searchMeetings(
  meetings: MeetingSummaryItem[],
  query: string
): MeetingSummaryItem[] {
  const words = query.normalize("NFC").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return meetings;
  return meetings.filter((meeting) => {
    const text = haystack(meeting);
    return words.every((word) => text.includes(word));
  });
}
