import type { Meeting, MeetingAnalysis } from "@/lib/meetings/types";

const OWNER_LABEL: Record<string, string> = { 나: "나", 상대: "상대" };

export function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function buildCopyText(
  analysis: MeetingAnalysis,
  title?: string
): string {
  const lines: string[] = [
    title?.trim() || analysis.headline,
    "",
    analysis.summary,
  ];
  const block = (heading: string, items: string[]) => {
    lines.push("", `[${heading}]`, ...items.map((item) => `- ${item}`));
  };
  if (analysis.topics?.length) {
    for (const topic of analysis.topics) block(topic.title, topic.points);
  }
  if (analysis.keyPoints.length) block("핵심", analysis.keyPoints);
  if (analysis.decisions?.length) block("결정", analysis.decisions);
  if (analysis.actionItems?.length) {
    lines.push("", "[할 일]");
    for (const item of analysis.actionItems) {
      const owner = OWNER_LABEL[item.owner] ?? item.owner;
      lines.push(
        `- (${owner}) ${item.task}${item.due ? ` · ${item.due}` : ""}`
      );
    }
  }
  if (analysis.nextSteps?.length) block("다음 단계", analysis.nextSteps);
  if (analysis.openQuestions?.length) block("남은 질문", analysis.openQuestions);
  if (analysis.automationLeads?.length) {
    block(
      "자동화 거리",
      analysis.automationLeads.map(
        (lead) => `${lead.title}: ${lead.evidence}`
      )
    );
  }
  return lines.join("\n");
}

export function durationLabel(meeting: Meeting): string {
  let max = meeting.durationSec ?? 0;
  if (!max) {
    for (const segment of meeting.transcript?.segments ?? []) {
      if (typeof segment.t === "number" && segment.t > max) max = segment.t;
    }
  }
  if (max < 60) return "";
  const hours = Math.floor(max / 3600);
  const minutes = Math.round((max % 3600) / 60);
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}
