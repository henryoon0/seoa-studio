import type {
  MeetingTranscript,
  Speaker,
  TranscriptSegment,
  TranscriptSourceTrack,
} from "./types";

/**
 * 화자가 앞에 붙은 줄(`나: …`, `상대: …`, `김대표: …`)을 파싱한다.
 * 한국어 콜론(：)도 허용. 화자명 길이는 과하게 잡지 않도록 제한한다.
 */
const SPEAKER_LINE = /^([^:：\n]{1,20})[:：]\s*(.*)$/;

export function buildTranscriptPlain(
  segments: readonly TranscriptSegment[]
): string {
  // 화자 라벨이 없으면(로컬 whisper 전사 — 화자 분리 안 됨) 콜론 prefix 없이 본문만.
  return segments
    .map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
    .join("\n");
}

/**
 * 전사 모델이 같은 토큰/짧은 구를 폭주하듯 반복하는 환각을 접는다.
 * (실측: flash-lite 가 한 발화 끝에서 "하" 를 61,000회 반복 → 130KB 전사)
 *
 * 공백 기준 토큰화 후, 1~3 토큰 단위가 MAX_RUN 회를 초과해 연속 반복되면
 * MAX_RUN 회만 남기고 나머지를 버린다. 자기표적적이라 안전하다:
 *   정상 발화의 짧은 반복("네 네", "맞아 맞아")은 임계치 이하라 그대로 보존되고,
 *   수백~수만 회 폭주만 잘려나간다.
 */
const MAX_RUN = 4;

export function collapseRepeats(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length <= MAX_RUN) return text.trim();

  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let handled = false;
    // 짧은 단위(1토큰)부터: "하 하 하 …" 같은 단일 토큰 폭주를 먼저 잡는다.
    for (let unit = 1; unit <= 3; unit++) {
      if (i + unit > tokens.length) break;
      const block = tokens.slice(i, i + unit);
      let reps = 1;
      while (
        i + unit * (reps + 1) <= tokens.length &&
        block.every((tok, k) => tokens[i + unit * reps + k] === tok)
      ) {
        reps++;
      }
      if (reps > MAX_RUN) {
        for (let r = 0; r < MAX_RUN; r++) out.push(...block);
        i += unit * reps;
        handled = true;
        break;
      }
    }
    if (!handled) {
      out.push(tokens[i]);
      i++;
    }
  }
  return out.join(" ");
}

/**
 * 세그먼트 "사이"의 반복 환각을 접는다.
 * (실측: whisper 가 회의 후 방치된 무음 몇 시간을 "유익을 늘려줄 거에요." x5,277
 *  같은 학습데이터 상투구로 채움 — collapseRepeats 는 세그먼트 안만 다뤄 못 잡는다.)
 *
 * 규칙 2겹, 둘 다 자기표적적:
 * 1) 동일 텍스트 연속 런은 MAX_SEG_RUN 개만 남긴다. 정상 맞장구("네." 2연속)는
 *    임계치 이하라 보존되고, 수십~수천 연속 폭주만 잘린다.
 * 2) WINDOW_MIN_LEN 자 이상의 문장이 직전 WINDOW 개(살아남은 기준) 안에서 이미
 *    WINDOW_MAX_OCCUR 회 나왔으면 버린다. 무음 환각은 "거의 연속 + 사이에 한 줄
 *    변형" 패턴으로 흩어져 연속 런 붕괴만으론 수백 개가 남는다(실측 패턴).
 *    실제 대화에서 같은 "긴 문장"이 좁은 창 안에 3회 등장할 일은 없다.
 *    짧은 맞장구("네.", "응.")는 길이 문턱으로 보호한다.
 */
const MAX_SEG_RUN = 2;
const WINDOW = 12;
const WINDOW_MIN_LEN = 6;
const WINDOW_MAX_OCCUR = 2;

export function collapseSegmentRuns(
  segments: TranscriptSegment[]
): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let runText = "";
  let runLen = 0;
  for (const s of segments) {
    const text = s.text.trim();
    if (text === runText) {
      runLen++;
      if (runLen > MAX_SEG_RUN) continue;
    } else {
      runText = text;
      runLen = 1;
    }
    if (text.length >= WINDOW_MIN_LEN) {
      const recent = out.slice(-WINDOW);
      const seen = recent.filter((p) => p.text.trim() === text).length;
      if (seen >= WINDOW_MAX_OCCUR) continue;
    }
    out.push(s);
  }
  return out;
}

/** 세그먼트별로 반복 환각을 접고, 그 결과 빈 텍스트가 된 세그먼트는 버린다. */
// 단독 감탄사(어, 음, 으흠…)는 앞뒤가 공백·끝일 때만 지운다("어디", "음식"은 안전).
const FILLER_WORD = /(^|\s)(?:어+|음+|으+음|으흠|흠+|에+|엄+)(?:\.{2,}|…|,)?(?=\s|$)/g;
// "그"는 뜻이 있는 지시어라 쉼표·말줄임이 붙은 머뭇거림만 지운다("그, 두 번째").
const FILLER_GEU = /(^|\s)그(?:,|\.{2,}|…)(?=\s|$)/g;
// 말 더듬기: "흐, 흐름" → "흐름". 1~2글자 조각이 다음 단어 머리와 같을 때만.
const STUTTER = /(^|\s)([가-힣]{1,2}),\s+(?=\2)/g;

/** 말버릇(감탄사·머뭇거림·더듬기)을 지운다. 뜻이 있는 말은 건드리지 않는다. */
export function stripFillers(text: string): string {
  return text
    .replace(STUTTER, "$1")
    .replace(FILLER_GEU, "$1")
    .replace(FILLER_WORD, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.…]+/, "")
    .trim();
}

function sanitizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const s of segments) {
    const text = stripFillers(collapseRepeats(s.text));
    if (!text) continue;
    out.push({ ...s, text });
  }
  return collapseSegmentRuns(out);
}

/** JSON 세그먼트 배열을 정규화한다(형식이 맞을 때만). */
function fromJsonArray(raw: string): TranscriptSegment[] | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const segments: TranscriptSegment[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) continue;
    // 화자가 비면 빈 라벨로 둔다(로컬 whisper 는 화자 분리를 안 하므로
    // 줄마다 "상대" 를 강제하면 오해를 부른다). 렌더는 빈 라벨이면 칼럼을 비운다.
    const speaker: Speaker =
      typeof r.speaker === "string" && r.speaker.trim()
        ? (r.speaker.trim() as Speaker)
        : "";
    let sourceTrack: TranscriptSourceTrack | undefined;
    if (
      r.sourceTrack === "mic" ||
      r.sourceTrack === "system" ||
      r.sourceTrack === "mixed"
    ) {
      sourceTrack = r.sourceTrack;
    }
    const seg: TranscriptSegment = {
      ...(typeof r.id === "string" && r.id.trim()
        ? { id: r.id.trim() }
        : {}),
      speaker,
      text,
      ...(sourceTrack ? { sourceTrack } : {}),
    };
    if (typeof r.t === "number") seg.t = r.t;
    if (typeof r.endT === "number") seg.endT = r.endT;
    segments.push(seg);
  }
  return segments;
}

/** 화자 라벨이 붙은 줄 기반 파싱. 라벨이 하나도 없으면 null. */
function fromLabeledLines(raw: string): TranscriptSegment[] | null {
  const lines = raw.split(/\r?\n/);
  const segments: TranscriptSegment[] = [];
  let last: Speaker | null = null;
  let sawLabel = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(SPEAKER_LINE);
    if (m) {
      sawLabel = true;
      const speaker = m[1].trim() as Speaker;
      const text = m[2].trim();
      last = speaker;
      if (text) segments.push({ speaker, text });
      continue;
    }
    // 연속(continuation) 줄: 직전 화자에 이어 붙인다.
    if (last) {
      const prev = segments[segments.length - 1];
      if (prev && prev.speaker === last) {
        prev.text = `${prev.text} ${trimmed}`.trim();
      } else {
        segments.push({ speaker: last, text: trimmed });
      }
    }
  }

  if (!sawLabel) return null;
  return segments.filter((s) => s.text);
}

/**
 * 원시 전사 텍스트를 표준 형태로 정규화한다.
 * - 화자 라벨 줄 → 세그먼트(연속 줄은 직전 화자에 이어 붙임)
 * - JSON 세그먼트 배열 → 그대로 정규화
 * - 라벨 없는 평문 → 하나의 세그먼트(기본 화자 "상대")
 */
export function normalizeTranscript(
  raw: string,
  opts?: { channelLabeled?: boolean }
): MeetingTranscript {
  void opts;
  const input = (raw ?? "").trim();
  if (!input) return { segments: [], plain: "" };

  let segments: TranscriptSegment[] | null = null;

  const json = fromJsonArray(input);
  if (json && json.length > 0) segments = json;

  if (!segments) {
    const labeled = fromLabeledLines(input);
    if (labeled && labeled.length > 0) segments = labeled;
  }

  if (!segments) {
    // 평문 폴백 — 빈 줄을 정리한 하나의 세그먼트.
    const text = input
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");
    segments = [{ speaker: "상대", text }];
  }

  // 어느 경로로 왔든 반복 환각을 접어 저장/분석 입력을 깨끗하게 만든다.
  segments = sanitizeSegments(segments);
  return { segments, plain: buildTranscriptPlain(segments) };
}
