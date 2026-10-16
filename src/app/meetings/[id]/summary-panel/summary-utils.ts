import type {
  AnalysisEvidenceRef,
  AnalysisEvidenceSection,
  MeetingAnalysis,
} from "@/lib/meetings/types";

export interface TopicDraft {
  readonly title: string;
  readonly points: string;
}

export interface ActionDraft {
  readonly owner: string;
  readonly task: string;
  readonly due: string;
}

export function toLines(items?: string[]): string {
  return (items ?? []).join("\n");
}

export function fromLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function evidenceFor(
  analysis: MeetingAnalysis,
  section: AnalysisEvidenceSection,
  itemIndex: number,
  topicIndex?: number
): AnalysisEvidenceRef | undefined {
  return analysis.evidence?.find(
    (item) =>
      item.section === section &&
      item.itemIndex === itemIndex &&
      item.topicIndex === topicIndex
  );
}

export function timeLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
