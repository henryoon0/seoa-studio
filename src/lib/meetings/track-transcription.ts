import path from "node:path";
import { normalizeTranscript } from "./transcript";
import { readMeetingAudioTrack } from "./audio-store";
import type {
  Meeting,
  MeetingAi,
  MeetingTranscript,
  Speaker,
  TranscriptProgress,
  TranscriptQuality,
  TranscriptSegment,
  TranscriptEngine,
  TranscriptSourceTrack,
  TranscriptTrackResult,
} from "./types";

type NativeTrack = Exclude<TranscriptSourceTrack, "mixed">;

type PartialTranscriptUpdate = {
  readonly transcript: MeetingTranscript;
  readonly progress: TranscriptProgress;
};

type TrackTranscriptionOptions = {
  readonly ai: Pick<MeetingAi, "transcribeAudio">;
  readonly keyterms?: readonly string[];
  readonly onPartial?: (update: PartialTranscriptUpdate) => Promise<void>;
};

export class TrackTranscriptionError extends Error {
  readonly name = "TrackTranscriptionError";

  readonly trackResults: readonly TranscriptTrackResult[];

  // 매개변수 프로퍼티는 node --test(strip-only)가 못 읽어서 필드를 직접 선언한다.
  constructor(trackResults: readonly TranscriptTrackResult[]) {
    const failures = trackResults
      .filter((result) => result.state === "failed")
      .map((result) => `${result.track}: ${result.error ?? "전사 실패"}`)
      .join(", ");
    super(failures || "전사 가능한 오디오 트랙이 없습니다");
    this.trackResults = trackResults;
  }
}

function trackSpeaker(meeting: Meeting, track: NativeTrack): Speaker {
  if (meeting.mode === "inperson") return "";
  return track === "mic" ? "나" : "상대";
}

/** 화자 분리가 몇 명까지 찾을지. 원격 mic 는 henry 한 명이라 분리하지 않는다. */
function trackMaxSpeakers(meeting: Meeting, track: NativeTrack): number | undefined {
  const others = meeting.people.length;
  if (meeting.mode === "inperson") return others > 0 ? others + 1 : undefined;
  if (track === "system") return others > 0 ? others : undefined;
  return 1;
}

/**
 * 트랙 라벨과 엔진의 화자 분리 결과를 합친다. 원격 system 트랙에서 엔진이
 * 여러 명을 찾았으면 "상대 1", "상대 2"로 남긴다(전엔 전부 "상대"로 덮였다).
 */
export function resolveSpeaker(trackLabel: Speaker, engineLabel: Speaker): Speaker {
  if (!trackLabel) return engineLabel;
  const n = /^화자 (\d+)$/.exec(engineLabel)?.[1];
  return trackLabel === "상대" && n ? `상대 ${n}` : trackLabel;
}

function canonicalSegments(
  raw: string,
  track: TranscriptSourceTrack,
  speaker: Speaker,
  offsetMs: number
): TranscriptSegment[] {
  const offsetSec = offsetMs / 1000;
  return normalizeTranscript(raw).segments.map((segment, index) => {
    const startSec = (segment.t ?? 0) + offsetSec;
    return {
      ...segment,
      id: `seg-${track}-${Math.round(startSec * 1000)}-${index}`,
      speaker: resolveSpeaker(speaker, segment.speaker),
      t: startSec,
      ...(segment.endT === undefined
        ? {}
        : { endT: segment.endT + offsetSec }),
      sourceTrack: track,
    };
  });
}

/** 근사 중복 판정용 정규화 — 공백·문장부호를 걷어낸다(local-asr dedupeKey 와 같은 규칙). */
function bleedKey(text: string): string {
  return text.replace(/[\s.,!?~…·'"“”‘’()\-]/g, "");
}

/** 바이그램 Dice 유사도. 흐릿한 bleed 전사는 오탈자가 많아 완전 일치로는 못 잡는다. */
function bigramSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      shared++;
      grams.set(g, n - 1);
    }
  }
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

/**
 * bleed 전사는 여러 문장이 한 세그먼트로 뭉치며 타임스탬프가 수 초씩 밀린다
 * (08-01 실측: ±3초는 71개, ±8초는 248개 검출). 따라 말하기 오검출은
 * 유사도·최소 길이 가드가 막는다.
 */
const BLEED_WINDOW_SEC = 8;
const BLEED_SIMILARITY = 0.6;
/** 이보다 짧은 발화("네", "맞아요")는 양쪽이 진짜로 같이 말했을 수 있어 건드리지 않는다. */
const BLEED_MIN_CHARS = 6;
/** 세그먼트 분할이 어긋나도 잡히게 앞부분만 비교한다. */
const BLEED_PREFIX_CHARS = 20;

/**
 * 스피커 bleed 중복 제거 — 이어폰 없이 통화하면 상대 목소리(system 트랙)가
 * 스피커→마이크로 새어 들어가 mic 트랙에도 흐릿하게 전사된다(라벨은 "나"로
 * 잘못 붙는다). 시작이 ±3초 안이고 정규화 앞 20자의 바이그램 유사도가 0.6
 * 이상이면 mic 쪽을 버리고 system 쪽(깨끗한 디지털 원음)을 남긴다.
 */
export function dedupeBleedSegments(
  segments: readonly TranscriptSegment[]
): TranscriptSegment[] {
  const systemRows = segments
    .filter((segment) => segment.sourceTrack === "system")
    .map((segment) => ({
      t: segment.t ?? 0,
      key: bleedKey(segment.text).slice(0, BLEED_PREFIX_CHARS),
    }))
    .sort((left, right) => left.t - right.t);
  if (systemRows.length === 0) return [...segments];

  let windowStart = 0;
  return segments.filter((segment) => {
    if (segment.sourceTrack !== "mic") return true;
    const key = bleedKey(segment.text).slice(0, BLEED_PREFIX_CHARS);
    if (key.length < BLEED_MIN_CHARS) return true;
    const t = segment.t ?? 0;
    while (
      windowStart < systemRows.length &&
      systemRows[windowStart].t < t - BLEED_WINDOW_SEC
    ) {
      windowStart++;
    }
    for (let i = windowStart; i < systemRows.length; i++) {
      const row = systemRows[i];
      if (row.t > t + BLEED_WINDOW_SEC) break;
      // system 세그먼트가 더 짧게 쪼개진 경우가 흔해, 같은 길이로 잘라 비교한다
      // (길이 차이만으로 유사도가 깎여 bleed 를 놓치는 것을 막는다).
      const n = Math.min(key.length, row.key.length);
      if (n < BLEED_MIN_CHARS) continue;
      if (
        bigramSimilarity(key.slice(0, n), row.key.slice(0, n)) >=
        BLEED_SIMILARITY
      ) {
        return false;
      }
    }
    return true;
  });
}

function buildPlain(segments: readonly TranscriptSegment[]): string {
  return segments
    .map((segment) =>
      segment.speaker
        ? `${segment.speaker}: ${segment.text}`
        : segment.text
    )
    .join("\n");
}

const WHISPER_ENGINE: TranscriptEngine = {
  engine: "whisper.cpp",
  model: path.basename(
    process.env.WHISPER_MODEL_PATH ?? "ggml-large-v3-turbo-q5_0.bin"
  ),
};

function canonicalTranscript(
  segments: readonly TranscriptSegment[],
  quality: TranscriptQuality,
  engine: TranscriptEngine = WHISPER_ENGINE
): MeetingTranscript {
  const sorted = dedupeBleedSegments(
    [...segments].sort((left, right) => (left.t ?? 0) - (right.t ?? 0))
  );
  return {
    segments: sorted,
    plain: buildPlain(sorted),
    provenance: {
      schemaVersion: 1,
      engine: engine.engine,
      model: engine.model,
      language: "ko",
      createdAt: new Date().toISOString(),
    },
    quality,
  };
}

function qualityFor(results: readonly TranscriptTrackResult[]): TranscriptQuality {
  return {
    completeness: results.every((result) => result.state === "ready")
      ? "complete"
      : "partial",
    tracks: [...results],
  };
}

export function canonicalizeLegacyTranscript(
  raw: string,
  engine?: TranscriptEngine
): MeetingTranscript {
  const segments = canonicalSegments(raw, "mixed", "", 0);
  return canonicalTranscript(
    segments,
    { completeness: "complete", tracks: [{ track: "mixed", state: "ready" }] },
    engine
  );
}

export async function transcribeNativeTracks(
  meeting: Meeting,
  options: TrackTranscriptionOptions
): Promise<MeetingTranscript> {
  const requiredTracks: readonly NativeTrack[] =
    meeting.mode === "remote" ? ["mic", "system"] : ["mic"];
  const completedSegments: TranscriptSegment[] = [];
  const results: TranscriptTrackResult[] = [];
  const previousReadyTracks = new Set(
    meeting.retryTranscriptionRequested
      ? meeting.transcript?.quality?.tracks
          .filter((result) => result.state === "ready")
          .map((result) => result.track) ?? []
      : []
  );

  let engine: TranscriptEngine | undefined;
  for (const track of requiredTracks) {
    if (previousReadyTracks.has(track)) {
      completedSegments.push(
        ...(meeting.transcript?.segments.filter(
          (segment) => segment.sourceTrack === track
        ) ?? [])
      );
      results.push({ track, state: "ready" });
      continue;
    }
    const stored = meeting.audioTracks?.[track];
    const audio = await readMeetingAudioTrack(stored);
    if (!stored || !audio) {
      results.push({ track, state: "missing" });
      continue;
    }
    try {
      const raw = await options.ai.transcribeAudio(audio, {
        channelSeparated: false,
        keyterms: options.keyterms,
        maxSpeakers: trackMaxSpeakers(meeting, track),
        durationSec: meeting.durationSec,
        onEngine(used) {
          engine = used;
        },
        async onPartial(partialRaw, progress) {
          if (!options.onPartial) return;
          const partialSegments = canonicalSegments(
            partialRaw,
            track,
            trackSpeaker(meeting, track),
            stored.startOffsetMs
          );
          const partialResults: TranscriptTrackResult[] = [
            ...results,
            { track, state: "ready" },
          ];
          await options.onPartial({
            transcript: canonicalTranscript(
              [...completedSegments, ...partialSegments],
              qualityFor(partialResults),
              engine
            ),
            progress,
          });
        },
      });
      completedSegments.push(
        ...canonicalSegments(
          raw,
          track,
          trackSpeaker(meeting, track),
          stored.startOffsetMs
        )
      );
      results.push({ track, state: "ready" });
    } catch (error) {
      results.push({
        track,
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (completedSegments.length === 0) throw new TrackTranscriptionError(results);
  return canonicalTranscript(completedSegments, qualityFor(results), engine);
}
