// ElevenLabs Scribe 전사 어댑터. MeetingAi.transcribeAudio 와 같은 세그먼트 JSON
// ([{speaker,text,t,endT}], 초 단위)을 돌려줘서 whisper 경로와 같은 정규화를 탄다.
//
// 한국어 품질을 위해 고정하는 것(docs/research/meeting-transcription-ko.md):
// - language_code "ko": 언어 자동 감지 오판(영어 섞인 회의)을 막는다.
// - keyterms: 참석자·별칭 이름, 회사·제품명을 넘겨 고유명사 표기를 끌어온다.
// - num_speakers: 참석자 수 + 1(henry)을 "최대" 화자 수로. 정확한 수가 아니라 상한이다.
// - temperature 0: 같은 파일이면 같은 결과(재전사 비교가 가능해야 한다).
// - 원격 스테레오(L=나/R=상대)는 use_multi_channel 로 채널별 전사.
// 모델은 ELEVENLABS_STT_MODEL 로 바꾼다(2026-10 기준 STT 최신은 scribe_v2).

import type { AudioInput } from "./types";

const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const SUBSCRIPTION_ENDPOINT = "https://api.elevenlabs.io/v1/user/subscription";
/** 실측 8,214 크레딧 / 6,160초 ≈ 1.33. 키워드 힌트 등 덧붙는 몫까지 여유를 둔다. */
const CREDITS_PER_SEC = 1.5;
/** 한도 초과 거절을 받으면 이만큼 업로드를 건너뛴다. 결제 후엔 서버 재시작으로 풀린다. */
const QUOTA_COOLDOWN_MS = 6 * 60 * 60_000;
const DEFAULT_MODEL = "scribe_v2";
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const MAX_KEYTERMS = 1000;
const MAX_KEYTERM_CHARS = 50;
/** 이 이상 쉬면 같은 화자라도 문단을 끊는다(초). */
const PAUSE_SPLIT_SEC = 1.2;
/** 문장 끝 + 이 길이를 넘으면 끊는다. 긴 독백이 한 덩어리가 되지 않게. */
const SENTENCE_SPLIT_CHARS = 80;

export interface ElevenLabsWord {
  text: string;
  start?: number;
  end?: number;
  type?: "word" | "spacing" | "audio_event";
  speaker_id?: string;
  channel_index?: number;
  logprob?: number;
}

interface ElevenLabsChannel {
  words?: ElevenLabsWord[];
  channel_index?: number;
}

export interface ElevenLabsResponse extends ElevenLabsChannel {
  transcripts?: ElevenLabsChannel[];
}

export interface ElevenLabsOptions {
  channelSeparated?: boolean;
  keyterms?: readonly string[];
  maxSpeakers?: number;
}

interface RawSegment {
  speaker: string;
  text: string;
  t: number;
  endT: number;
}

export function elevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

export function elevenLabsModel(): string {
  return process.env.ELEVENLABS_STT_MODEL?.trim() || DEFAULT_MODEL;
}

export interface ElevenLabsSubscription {
  character_count?: number;
  character_limit?: number;
  can_extend_character_limit?: boolean;
  allowed_to_extend_character_limit?: boolean;
}

/** 사용량 과금이 켜져 있거나 남은 크레딧이 회의 길이를 덮으면 true. 모르면 true. */
export function creditsCover(
  sub: ElevenLabsSubscription,
  durationSec: number
): boolean {
  if (sub.can_extend_character_limit && sub.allowed_to_extend_character_limit) {
    return true;
  }
  const { character_count: used, character_limit: limit } = sub;
  if (typeof used !== "number" || typeof limit !== "number") return true;
  return limit - used >= durationSec * CREDITS_PER_SEC;
}

// hot reload 에도 살아남게 globalThis 에 둔다.
const quotaStore = globalThis as { __elevenLabsQuotaUntil?: number };

export function markElevenLabsQuotaExceeded(now = Date.now()): void {
  quotaStore.__elevenLabsQuotaUntil = now + QUOTA_COOLDOWN_MS;
}

export function resetElevenLabsQuotaMark(): void {
  quotaStore.__elevenLabsQuotaUntil = undefined;
}

/**
 * 큰 파일을 올리기 전에 크레딧이 될지 본다. 최근 한도 초과 거절이 있으면 false.
 * 조회 권한(user_read)이 없거나 조회가 실패하면 막지 않고 true(업로드가 판정).
 */
export async function elevenLabsHasCredits(
  durationSec: number | undefined,
  fetchImpl: typeof fetch = fetch,
  now = Date.now()
): Promise<boolean> {
  if (now < (quotaStore.__elevenLabsQuotaUntil ?? 0)) return false;
  if (!durationSec || durationSec <= 0) return true;
  const sub = await fetchSubscription(fetchImpl);
  return sub ? creditsCover(sub, durationSec) : true;
}

async function fetchSubscription(
  fetchImpl: typeof fetch
): Promise<ElevenLabsSubscription | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return null;
  try {
    const res = await fetchImpl(SUBSCRIPTION_ENDPOINT, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? ((await res.json()) as ElevenLabsSubscription) : null;
  } catch {
    return null;
  }
}

function timeoutMs(): number {
  const n = Number(process.env.ELEVENLABS_STT_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/** API 한도(1000개·50자·5단어)에 맞춰 중복 없이 자른다. */
export function cleanKeyterms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.normalize("NFC").trim().replace(/\s+/g, " ");
    if (
      !term ||
      term.length > MAX_KEYTERM_CHARS ||
      term.split(" ").length > 5 ||
      seen.has(term)
    ) {
      continue;
    }
    seen.add(term);
    out.push(term);
    if (out.length >= MAX_KEYTERMS) break;
  }
  return out;
}

function speakerNamer(): (id: string | undefined) => string {
  const order = new Map<string, number>();
  return (id) => {
    if (!id) return "";
    if (!order.has(id)) order.set(id, order.size + 1);
    return `화자 ${order.get(id)}`;
  };
}

/**
 * 단어 목록 → 발화 세그먼트. spacing 토큰을 그대로 이어 붙여 한국어 띄어쓰기를
 * 모델 출력대로 보존한다. 화자 변경·긴 쉼·긴 문장 끝에서 끊는다.
 */
export function segmentsFromWords(
  words: readonly ElevenLabsWord[],
  label: (word: ElevenLabsWord) => string
): RawSegment[] {
  const segments: RawSegment[] = [];
  let current: RawSegment | null = null;
  for (const word of words) {
    if (word.type === "audio_event") continue;
    if (word.type === "spacing") {
      if (current) current.text += word.text;
      continue;
    }
    const speaker = label(word);
    const [start, end] = wordSpan(word, current);
    if (current && !shouldSplit(current, speaker, start)) {
      current.text += word.text;
      current.endT = end;
      continue;
    }
    if (current) pushSegment(segments, current);
    current = { speaker, text: word.text, t: start, endT: end };
  }
  if (current) pushSegment(segments, current);
  return segments;
}

/** 시각이 빠진 단어는 직전 끝 시각을 이어받는다. */
function wordSpan(word: ElevenLabsWord, current: RawSegment | null): [number, number] {
  const start = word.start ?? current?.endT ?? 0;
  return [start, word.end ?? start];
}

function shouldSplit(current: RawSegment, speaker: string, start: number): boolean {
  if (current.speaker !== speaker) return true;
  if (start - current.endT >= PAUSE_SPLIT_SEC) return true;
  return (
    /[.?!。？！]\s*$/.test(current.text) &&
    current.text.length >= SENTENCE_SPLIT_CHARS
  );
}

function pushSegment(segments: RawSegment[], segment: RawSegment): void {
  const text = segment.text.trim();
  if (text) segments.push({ ...segment, text });
}

/** 응답 → 세그먼트. 화자가 하나뿐이면 라벨을 비워 "화자 1" 소음을 없앤다. */
export function segmentsFromResponse(
  body: ElevenLabsResponse,
  channelSeparated: boolean
): RawSegment[] {
  if (channelSeparated && body.transcripts?.length) {
    const channelLabel = (index: number | undefined) =>
      index === 0 ? "나" : index === 1 ? "상대" : "";
    return body.transcripts
      .flatMap((channel) =>
        segmentsFromWords(channel.words ?? [], (word) =>
          channelLabel(word.channel_index ?? channel.channel_index)
        )
      )
      .sort((a, b) => a.t - b.t);
  }
  const words = body.words ?? body.transcripts?.flatMap((c) => c.words ?? []) ?? [];
  const name = speakerNamer();
  const segments = segmentsFromWords(words, (word) => name(word.speaker_id));
  const speakers = new Set(segments.map((s) => s.speaker));
  return speakers.size <= 1
    ? segments.map((s) => ({ ...s, speaker: "" }))
    : segments;
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("flac")) return "flac";
  return "mp3";
}

function buildForm(
  audio: AudioInput,
  opts: ElevenLabsOptions,
  channelSeparated: boolean
): FormData {
  const form = new FormData();
  form.append("model_id", elevenLabsModel());
  form.append(
    "file",
    new Blob([new Uint8Array(audio.data)], { type: audio.mimeType }),
    `meeting.${extensionFor(audio.mimeType)}`
  );
  form.append("language_code", "ko");
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  form.append("temperature", "0");
  // "어..", "그," 같은 말버릇·말 더듬기를 엔진에서 지운다(scribe_v2 전용).
  // 다른 모델로 바꿔 400이 나면 ELEVENLABS_NO_VERBATIM=false 로 끈다.
  if (process.env.ELEVENLABS_NO_VERBATIM !== "false") {
    form.append("no_verbatim", "true");
  }
  if (channelSeparated) {
    form.append("use_multi_channel", "true");
  } else {
    form.append("diarize", "true");
    if (opts.maxSpeakers && opts.maxSpeakers >= 1) {
      form.append("num_speakers", String(Math.min(32, Math.round(opts.maxSpeakers))));
    }
  }
  for (const term of cleanKeyterms(opts.keyterms ?? [])) {
    form.append("keyterms", term);
  }

  return form;
}

export async function transcribeWithElevenLabs(
  audio: AudioInput,
  opts: ElevenLabsOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY 가 없습니다");
  const channelSeparated = opts.channelSeparated === true;
  const form = buildForm(audio, opts, channelSeparated);

  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    if (detail.includes("quota_exceeded")) markElevenLabsQuotaExceeded();
    throw new Error(`ElevenLabs STT ${res.status}: ${detail}`);
  }
  const body = (await res.json()) as ElevenLabsResponse;
  return JSON.stringify(segmentsFromResponse(body, channelSeparated));
}
