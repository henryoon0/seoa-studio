import type {
  AnalysisEvidenceRef,
  AnalysisEvidenceSection,
  MeetingAnalysis,
  MeetingTranscript,
  TranscriptSegment,
} from "./types";

type EvidenceCandidate = {
  readonly section: AnalysisEvidenceSection;
  readonly itemIndex: number;
  readonly topicIndex?: number;
  readonly text: string;
  /** AI가 복사한 원문 발언. 있으면 먼저 이걸로 찾는다. */
  readonly quote?: string;
};

/** 짧은 발언이 많아 한 문장만으로는 맞추기 어렵다. 이어진 세 문장을 한 묶음으로 본다. */
const WINDOW = 3;

function compactText(value: string): string {
  return value
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function bigrams(value: string): ReadonlySet<string> {
  const compact = compactText(value);
  if (compact.length < 2) return new Set(compact ? [compact] : []);
  const grams = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.add(compact.slice(index, index + 2));
  }
  return grams;
}

interface TextProfile {
  readonly compact: string;
  readonly grams: ReadonlySet<string>;
}

function profile(value: string): TextProfile {
  const compact = compactText(value);
  return { compact, grams: bigrams(compact) };
}

function similarity(left: TextProfile, right: TextProfile): number {
  const leftCompact = left.compact;
  const rightCompact = right.compact;
  if (!leftCompact || !rightCompact) return 0;
  if (
    Math.min(leftCompact.length, rightCompact.length) >= 4 &&
    (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact))
  ) {
    return 1;
  }
  let overlap = 0;
  for (const gram of left.grams) {
    if (right.grams.has(gram)) overlap += 1;
  }
  return overlap / Math.max(1, Math.max(left.grams.size, right.grams.size));
}

function segmentId(segment: TranscriptSegment, index: number): string {
  if (segment.id) return segment.id;
  const track = segment.sourceTrack ?? "mixed";
  const startMs = Math.round((segment.t ?? 0) * 1000);
  return `seg-${track}-${startMs}-${index}`;
}

function structureCandidates(analysis: MeetingAnalysis): EvidenceCandidate[] {
  return [
    ...(analysis.highlights ?? []).map((h, itemIndex) => ({
      section: "highlight" as const,
      itemIndex,
      text: `${h.title} ${h.detail}`,
    })),
    ...(analysis.flow ?? []).map((stage, itemIndex) => ({
      section: "flowStage" as const,
      itemIndex,
      text: [stage.name, stage.owner, stage.rule].filter(Boolean).join(" "),
      quote: stage.quote,
    })),
    ...(analysis.roles ?? []).map((role, itemIndex) => ({
      section: "role" as const,
      itemIndex,
      text: `${role.name} ${role.role}`,
    })),
    ...(analysis.glossary ?? []).map((term, itemIndex) => ({
      section: "term" as const,
      itemIndex,
      text: `${term.term} ${term.definition}`,
    })),
  ];
}

function candidates(analysis: MeetingAnalysis): EvidenceCandidate[] {
  const values: EvidenceCandidate[] = [
    { section: "summary", itemIndex: 0, text: analysis.summary },
    ...analysis.keyPoints.map((text, itemIndex) => ({
      section: "keyPoint" as const,
      itemIndex,
      text,
    })),
    ...(analysis.decisions ?? []).map((text, itemIndex) => ({
      section: "decision" as const,
      itemIndex,
      text,
    })),
    ...(analysis.actionItems ?? []).map((item, itemIndex) => ({
      section: "actionItem" as const,
      itemIndex,
      text: [item.task, item.context].filter(Boolean).join(" "),
      quote: item.quote,
    })),
    ...(analysis.nextSteps ?? []).map((text, itemIndex) => ({
      section: "nextStep" as const,
      itemIndex,
      text,
    })),
    ...(analysis.openQuestions ?? []).map((text, itemIndex) => ({
      section: "openQuestion" as const,
      itemIndex,
      text,
    })),
    ...structureCandidates(analysis),
  ];
  for (const [topicIndex, topic] of (analysis.topics ?? []).entries()) {
    for (const [itemIndex, text] of topic.points.entries()) {
      values.push({ section: "topicPoint", topicIndex, itemIndex, text });
    }
  }
  return values;
}

interface Profiles {
  readonly one: TextProfile;
  readonly many: TextProfile;
}

interface Match {
  readonly segment: TranscriptSegment;
  readonly index: number;
  readonly last: TranscriptSegment;
}

function bestSegment(
  text: string,
  segments: readonly TranscriptSegment[],
  windows: readonly Profiles[]
): Match | null {
  let best: { index: number; score: number } | null = null;
  const candidateProfile = profile(text);
  for (const [index, { one, many }] of windows.entries()) {
    const score = one.compact.length < 4 ? 0 : Math.max(similarity(candidateProfile, one), similarity(candidateProfile, many));
    if (!best || score > best.score) best = { index, score };
  }
  if (!best || best.score < 0.18) return null;
  // 묶음 안에서 가장 닮은 한 문장을 시작점으로 삼는다(같은 점수면 앞 묶음이 이기는 걸 바로잡음).
  const end = Math.min(segments.length - 1, best.index + WINDOW - 1);
  let start = best.index;
  let startScore = -1;
  for (let i = best.index; i <= end; i += 1) {
    const { one } = windows[i];
    const score = one.compact.length < 4 ? 0 : similarity(candidateProfile, one);
    if (score > startScore) {
      start = i;
      startScore = score;
    }
  }
  return { segment: segments[start], index: start, last: segments[end] };
}

function findMatch(
  candidate: EvidenceCandidate,
  segments: readonly TranscriptSegment[],
  windows: readonly Profiles[]
): Match | null {
  const byQuote = candidate.quote ? bestSegment(candidate.quote, segments, windows) : null;
  return byQuote ?? bestSegment(candidate.text, segments, windows);
}

export function attachAnalysisEvidence(
  analysis: MeetingAnalysis,
  transcript: MeetingTranscript
): MeetingAnalysis {
  if (transcript.segments.length === 0) return analysis;
  const evidence: AnalysisEvidenceRef[] = [];
  const segments = transcript.segments;
  const windows = segments.map((segment, index) => ({
    one: profile(segment.text),
    many: profile(segments.slice(index, index + WINDOW).map((s) => s.text).join(" ")),
  }));
  for (const candidate of candidates(analysis)) {
    const match = findMatch(candidate, segments, windows);
    if (!match) continue;
    const startSec = match.segment.t ?? 0;
    evidence.push({
      section: candidate.section,
      itemIndex: candidate.itemIndex,
      ...(candidate.topicIndex === undefined
        ? {}
        : { topicIndex: candidate.topicIndex }),
      segmentId: segmentId(match.segment, match.index),
      startSec,
      ...(match.last.endT === undefined
        ? {}
        : { endSec: match.last.endT }),
    });
  }
  return evidence.length > 0 ? { ...analysis, evidence } : analysis;
}
