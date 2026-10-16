import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { collapseRepeats } from "./transcript";
import type { AudioInput } from "./types";

const exec = promisify(execFile);

// ── 회의 전사 Transport: 로컬 whisper.cpp ───────────────────────────────────
//
// 회의 녹음은 길다(2시간+ = 100MB+). 이걸 Gemini 에 base64 inlineData 로 인라인
// 업로드하면 요청 본문이 inline 한도(20MB)를 한참 넘겨, 거대한 본문을 수 분간
// 올리다 네트워크가 끊기며 "fetch failed" 로 죽었다(실측: 103MB m4a → ~6분 뒤 실패).
//
// 그래서 전사는 로컬 whisper.cpp 로 돌린다(자막 기능과 동일 바이너리·모델):
// - 업로드 자체가 없다 → 네트워크 실패가 구조적으로 불가능.
// - per-token 과금 없음(오프라인).
// 단점: 화자 분리(나/상대)를 안 한다. 회의 분석 단계가 내용으로 역할을 추정하므로
//   전사 라벨은 비워 둔다(transcript.ts 가 빈 라벨을 허용).

function whisperBin(): string {
  return process.env.WHISPER_CLI_PATH || "whisper-cli";
}

function whisperModel(): string {
  return (
    process.env.WHISPER_MODEL_PATH ||
    path.join(
      os.homedir(),
      "recordings",
      "models",
      "ggml-large-v3-turbo-q5_0.bin"
    )
  );
}

function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

const FFMPEG_TIMEOUT_MS = 15 * 60 * 1000;
const WHISPER_TIMEOUT_MS = 90 * 60 * 1000; // 2시간+ 오디오 대비 넉넉히.

/** whisper.cpp -oj JSON 의 transcription 행(우리가 쓰는 필드만). */
interface WhisperRow {
  offsets?: { from?: number; to?: number };
  text?: string;
}

/** "[음악]", "(박수)", "♪" 같은 발화가 아닌 행. */
const NON_SPEECH_RE = /^[\s♪♫_-]*(\[[^\]]*\]|\([^)]*\)|<\|[^|]*\|>)?[\s♪♫_-]*$/;

/** 전사 세그먼트 행(정규화 전). */
export interface SegmentRow {
  speaker: string;
  text: string;
  t: number;
  endT?: number;
}

/** whisper -oj JSON → 세그먼트 행 배열. speaker 라벨은 호출처가 정한다. */
export function rowsFromWhisperJson(raw: string, speaker = ""): SegmentRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("whisper JSON 파싱 실패");
  }
  const rows = (parsed as { transcription?: unknown }).transcription;
  if (!Array.isArray(rows)) {
    throw new Error("whisper JSON 에 transcription 배열이 없습니다");
  }

  const segments: SegmentRow[] = [];
  for (const row of rows as WhisperRow[]) {
    if (!row || typeof row !== "object") continue;
    const text = collapseRepeats((row.text ?? "").trim()).trim();
    if (!text || NON_SPEECH_RE.test(text)) continue;
    const fromMs = row.offsets?.from;
    const toMs = row.offsets?.to;
    segments.push({
      speaker,
      text,
      t: typeof fromMs === "number" ? Math.round(fromMs / 1000) : 0,
      ...(typeof toMs === "number"
        ? { endT: Math.round(toMs / 1000) }
        : {}),
    });
  }
  return segments;
}

/** whisper -oj JSON 을 회의 전사 세그먼트(JSON 배열 문자열)로 변환한다. */
export function whisperJsonToSegments(raw: string): string {
  // 화자 미상(단일 패스 whisper 는 분리 안 함) → 빈 라벨.
  // normalizeTranscript(fromJsonArray) 가 다시 받아 정규화한다.
  return JSON.stringify(rowsFromWhisperJson(raw, ""));
}

/** 근사 중복 판정용 정규화 — 공백·문장부호를 걷어낸다. */
function dedupeKey(text: string): string {
  return text.replace(/[\s.,!?~…·'"“”‘’()\-]/g, "");
}

/**
 * L/R 채널 전사를 시간순으로 병합한다. 이어폰 없이 통화하면 상대 목소리가
 * 스피커→마이크로 새어 들어가(bleed) 마이크 채널에도 흐릿하게 전사되는데,
 * 정규화 텍스트가 같고 시작이 ±3초 안이면 나중 것을 버려 이중 표기를 막는다.
 */
export function mergeChannelRows(
  left: SegmentRow[],
  right: SegmentRow[]
): SegmentRow[] {
  const all = [...left, ...right].sort((a, b) => a.t - b.t);
  const out: SegmentRow[] = [];
  const recent: Array<{ key: string; t: number }> = [];
  for (const row of all) {
    const key = dedupeKey(row.text);
    if (key && recent.some((r) => r.key === key && Math.abs(r.t - row.t) <= 3)) {
      continue;
    }
    recent.push({ key, t: row.t });
    while (recent.length > 8) recent.shift();
    out.push(row);
  }
  return out;
}

function describeExecError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("ENOENT")) {
    if (/whisper/i.test(msg)) {
      return `whisper-cli 를 찾을 수 없습니다 (WHISPER_CLI_PATH 확인): ${msg}`;
    }
    return `ffmpeg 를 찾을 수 없습니다 (FFMPEG_PATH 확인): ${msg}`;
  }
  return msg;
}

/** 임의 오디오를 whisper 입력 규격(16kHz mono pcm wav)으로 변환한다. */
async function toWav(srcPath: string, wavPath: string): Promise<void> {
  await exec(
    ffmpegBin(),
    ["-y", "-i", srcPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath],
    { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }
  );
}

/** 스테레오 소스에서 한쪽 채널만 뽑아 16kHz mono wav 로 만든다. */
async function toChannelWav(
  srcPath: string,
  wavPath: string,
  channel: 0 | 1
): Promise<void> {
  await exec(
    ffmpegBin(),
    [
      "-y",
      "-i",
      srcPath,
      "-vn",
      "-af",
      `pan=mono|c0=c${channel}`,
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      wavPath,
    ],
    { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }
  );
}

/** ffmpeg volumedetect stderr 에서 max_volume(dB)을 뽑는다. 없으면 null. */
export function parseMaxVolumeDb(stderr: string): number | null {
  const m = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(stderr);
  if (!m) return null;
  const v = Number.parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

/**
 * 죽은 채널 판정 문턱. 실측(2026-07-18, meeting_remote_2026-07-17):
 * BlackHole 라우팅이 안 잡힌 R 채널은 전 구간 max -91dB(완전한 디지털 무음),
 * 실제 발화 채널은 max -20dB 이상. -50dB 는 그 사이의 넉넉한 경계다.
 */
const DEAD_CHANNEL_MAX_DB = -50;

/** 채널 wav 가 사실상 무음(라우팅 실패)인지 — volumedetect 1패스. */
async function isDeadChannel(wavPath: string): Promise<boolean> {
  try {
    const { stderr } = await exec(
      ffmpegBin(),
      ["-i", wavPath, "-af", "volumedetect", "-f", "null", "-"],
      { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }
    );
    const max = parseMaxVolumeDb(stderr);
    return max !== null && max < DEAD_CHANNEL_MAX_DB;
  } catch {
    return false; // 판정 실패 시 살아있다고 보고 2패스 진행(보수적)
  }
}

/** 16k mono pcm wav 의 길이(초). ffprobe 실패 시 파일 크기로 계산(32,000B/s). */
async function wavDurationSec(wavPath: string): Promise<number> {
  const bin = process.env.FFPROBE_PATH || "ffprobe";
  try {
    const { stdout } = await exec(
      bin,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath],
      { timeout: 30_000 }
    );
    const sec = Number.parseFloat(stdout.trim());
    if (Number.isFinite(sec) && sec > 0) return sec;
  } catch {
    /* 폴백으로 */
  }
  const { size } = await fs.stat(wavPath);
  return Math.max(0, (size - 44) / 32_000);
}

/** wav 에서 [startSec, startSec+lenSec) 구간을 잘라낸다(pcm 재인코딩, 즉시 수준). */
async function cutWav(
  srcWav: string,
  outWav: string,
  span: ChunkSpan
): Promise<void> {
  await exec(
    ffmpegBin(),
    [
      "-y",
      "-ss",
      String(span.startSec),
      "-t",
      String(span.lenSec),
      "-i",
      srcWav,
      "-c:a",
      "pcm_s16le",
      outWav,
    ],
    { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }
  );
}

/**
 * 1분 청크 프로그레시브 전사. wavs 는 1개(모노·라벨 없음) 또는 2개(L=나, R=상대).
 * 청크마다 누적 결과를 onPartial 로 내보낸다 — 콜백 실패는 전사를 막지 않는다.
 */
async function transcribeWavsProgressive(
  wavs: Array<{ wav: string; speaker: string }>,
  workDir: string,
  onPartial: NonNullable<TranscribeOpts["onPartial"]>
): Promise<SegmentRow[]> {
  const totals = await Promise.all(wavs.map((w) => wavDurationSec(w.wav)));
  const totalSec = Math.max(...totals);
  const spans = chunkPlan(totalSec);
  let acc: SegmentRow[] = [];

  for (const [i, span] of spans.entries()) {
    const perChannel: SegmentRow[][] = [];
    for (const [j, src] of wavs.entries()) {
      const chunkWav = path.join(workDir, `ck-${i}-${j}.wav`);
      await cutWav(src.wav, chunkWav, span);
      const jsonPath = await runWhisper(
        chunkWav,
        path.join(workDir, `ck-${i}-${j}`)
      );
      const rows = rowsFromWhisperJson(
        await fs.readFile(jsonPath, "utf-8"),
        src.speaker
      ).map((row) => ({
        ...row,
        t: row.t + span.startSec,
        ...(row.endT === undefined
          ? {}
          : { endT: row.endT + span.startSec }),
      }));
      perChannel.push(rows);
      // 청크 산출물은 바로 정리(긴 회의에서 tmp 가 불어나지 않게).
      await fs.rm(chunkWav, { force: true }).catch(() => {});
      await fs.rm(jsonPath, { force: true }).catch(() => {});
    }
    const chunkRows =
      perChannel.length === 2
        ? mergeChannelRows(perChannel[0], perChannel[1])
        : perChannel[0];
    acc = appendRowsDeduped(acc, chunkRows);

    const processedSec = Math.round(Math.min(span.startSec + span.lenSec, totalSec));
    try {
      await onPartial(JSON.stringify(acc), {
        processedSec,
        totalSec: Math.round(totalSec),
      });
    } catch {
      /* 부분 저장 실패가 전사를 죽이면 안 된다 */
    }
  }
  return acc;
}

/** 소스의 오디오 채널 수(ffprobe). 실패 시 1(모노 취급 → 단일 패스 폴백). */
async function probeChannels(srcPath: string): Promise<number> {
  const bin = process.env.FFPROBE_PATH || "ffprobe";
  try {
    const { stdout } = await exec(
      bin,
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=channels",
        "-of",
        "csv=p=0",
        srcPath,
      ],
      { timeout: 30_000 }
    );
    const n = Number.parseInt(stdout.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

/** 16kHz wav 를 whisper-cli(한국어)로 전사하고 -oj JSON 경로를 반환한다. */
async function runWhisper(wavPath: string, outBase: string): Promise<string> {
  const model = whisperModel();
  try {
    await fs.access(model);
  } catch {
    throw new Error(`whisper 모델이 없습니다: ${model} (WHISPER_MODEL_PATH 확인)`);
  }
  await exec(
    whisperBin(),
    [
      "-m",
      model,
      "-l",
      "ko",
      "-oj",
      "-of",
      outBase,
      // 이전 텍스트를 조건으로 물지 않는다. 무음/저음량 구간에서 환각 문구가
      // 자기조건화로 폭주하는 루프를 끊는다(발화 품질 무손실 실측: 동일 슬라이스
      // 1,303자 vs 1,319자, 문장 동일). ※ --vad 는 조용한 원격회의 발화를
      // 뭉개는 품질 저하 실측(1,303→1,042자)으로 기각.
      "-mc",
      "0",
      "-t",
      String(Math.max(2, os.cpus().length - 2)),
      wavPath,
    ],
    { timeout: WHISPER_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024 }
  );
  return `${outBase}.json`;
}

export interface TranscribeProgress {
  processedSec: number;
  totalSec: number;
}

export interface TranscribeOpts {
  /**
   * 원격 녹음(회의-입력 Aggregate)은 스크립트가 L=내 마이크 / R=시스템(상대)으로
   * 나눠 담는다 — true 면 채널별 2패스 전사로 나/상대 화자 라벨을 붙인다.
   */
  channelSeparated?: boolean;
  /**
   * 부분 결과 콜백 — 있으면 1분 청크 단위로 전사하며 청크마다 누적 세그먼트
   * (JSON 배열 문자열)와 진행률을 전달한다. 회의가 끝나길 기다리지 않고
   * 화면에 전사가 자라나게 하는 용도. 콜백이 던지는 에러는 무시된다.
   */
  onPartial?: (
    accJson: string,
    progress: TranscribeProgress
  ) => void | Promise<void>;
}

// ── 1분 청크 프로그레시브 전사 ─────────────────────────────────────────────
//
// -mc 0 이라 청크 사이에 잃을 문맥이 없다. 경계에서 단어가 잘리는 것만 문제라
// 청크 머리에 3초 오버랩을 두고, 오버랩 구간의 이중 전사는 "정규화 텍스트 동일
// + 시작 ±3초" 근사 중복 제거로 접는다(채널 병합 dedup 과 같은 규칙).
// 비용: 청크마다 whisper 프로세스 기동(모델 로드 ~1-2초) ≈ 전체 +5% 안팎.

const CHUNK_SEC = 60;
const CHUNK_OVERLAP_SEC = 3;

export interface ChunkSpan {
  startSec: number;
  lenSec: number;
}

/** [0,total) 을 1분 경계 기준으로 자른다. 첫 청크 외엔 머리에 3초 오버랩. */
export function chunkPlan(totalSec: number): ChunkSpan[] {
  const out: ChunkSpan[] = [];
  for (let b = 0; b < totalSec; b += CHUNK_SEC) {
    const start = b === 0 ? 0 : b - CHUNK_OVERLAP_SEC;
    const end = Math.min(b + CHUNK_SEC, totalSec);
    out.push({ startSec: start, lenSec: end - start });
  }
  return out;
}

/** 누적 rows 에 새 rows 를 붙인다. 오버랩 이중 전사는 ±3초 근사 중복으로 버린다. */
export function appendRowsDeduped(
  acc: SegmentRow[],
  rows: SegmentRow[]
): SegmentRow[] {
  const out = [...acc];
  for (const row of rows) {
    const key = dedupeKey(row.text);
    const tail = out.slice(-12);
    if (key && tail.some((r) => dedupeKey(r.text) === key && Math.abs(r.t - row.t) <= 3)) {
      continue;
    }
    out.push(row);
  }
  return out;
}

/**
 * 디스크의 오디오 파일을 로컬 whisper 로 전사한다.
 * 반환: normalizeTranscript 가 소비하는 세그먼트 JSON 배열 문자열.
 */
export async function transcribeAudioFile(
  srcPath: string,
  opts: TranscribeOpts = {}
): Promise<string> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "meet-asr-"));
  try {
    if (opts.channelSeparated && (await probeChannels(srcPath)) >= 2) {
      return await transcribeStereo(srcPath, workDir, opts);
    }
    const wavPath = path.join(workDir, "audio.wav");
    await toWav(srcPath, wavPath);
    if (opts.onPartial) {
      const rows = await transcribeWavsProgressive(
        [{ wav: wavPath, speaker: "" }],
        workDir,
        opts.onPartial
      );
      return JSON.stringify(rows);
    }
    const jsonPath = await runWhisper(wavPath, path.join(workDir, "whisper"));
    const raw = await fs.readFile(jsonPath, "utf-8");
    return whisperJsonToSegments(raw);
  } catch (e) {
    throw new Error(describeExecError(e));
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 채널 분리 2패스 전사 — L(나)·R(상대)을 각각 whisper 로 돌리고 t 기준 병합.
 * 전사 시간이 단일 패스의 약 2배지만, ingest 가 백그라운드라 감내 가능하고
 * 화자 라벨이 스크립트 뷰·분석·편지의 재료가 된다.
 * 순차 실행이다 — whisper 가 이미 코어를 다 쓰므로 병렬은 이득이 없다.
 */
async function transcribeStereo(
  srcPath: string,
  workDir: string,
  opts: TranscribeOpts = {}
): Promise<string> {
  const leftWav = path.join(workDir, "left.wav");
  const rightWav = path.join(workDir, "right.wav");
  await toChannelWav(srcPath, leftWav, 0);
  await toChannelWav(srcPath, rightWav, 1);

  // 라우팅이 안 잡혀 한쪽이 통무음인 녹음(실측: BlackHole 미연결 → R 전구간 -91dB,
  // 다음 날엔 반대로 마이크 채널이 -91dB — Aggregate 구성이 날마다 흔들림) 방어:
  // 죽은 채널은 whisper 를 아예 태우지 않는다 — 시간 절반 절약 + 무음 환각이
  // "상대" 라벨로 오염되는 것 차단. 이때 산 채널엔 양쪽 목소리가 섞여 있을 수
  // 있으므로(스피커→마이크) 화자 라벨 없이 전사한다.
  const [leftDead, rightDead] = await Promise.all([
    isDeadChannel(leftWav),
    isDeadChannel(rightWav),
  ]);
  if (leftDead || rightDead) {
    const liveWav = leftDead ? rightWav : leftWav;
    if (opts.onPartial) {
      const rows = await transcribeWavsProgressive(
        [{ wav: liveWav, speaker: "" }],
        workDir,
        opts.onPartial
      );
      return JSON.stringify(rows);
    }
    const json = await runWhisper(liveWav, path.join(workDir, "live"));
    return JSON.stringify(
      rowsFromWhisperJson(await fs.readFile(json, "utf-8"), "")
    );
  }

  if (opts.onPartial) {
    const rows = await transcribeWavsProgressive(
      [
        { wav: leftWav, speaker: "나" },
        { wav: rightWav, speaker: "상대" },
      ],
      workDir,
      opts.onPartial
    );
    return JSON.stringify(rows);
  }

  const leftJson = await runWhisper(leftWav, path.join(workDir, "left"));
  const left = rowsFromWhisperJson(await fs.readFile(leftJson, "utf-8"), "나");
  const rightJson = await runWhisper(rightWav, path.join(workDir, "right"));
  const right = rowsFromWhisperJson(
    await fs.readFile(rightJson, "utf-8"),
    "상대"
  );
  return JSON.stringify(mergeChannelRows(left, right));
}

/**
 * 메모리 버퍼(ingest 라우트가 넘기는 형태)를 임시 파일로 떨군 뒤 전사한다.
 * mimeType 으로 확장자를 추정해 ffmpeg 가 컨테이너를 알아보게 한다.
 */
export async function transcribeAudioBuffer(
  audio: AudioInput,
  opts: TranscribeOpts = {}
): Promise<string> {
  const ext = extFromMime(audio.mimeType);
  const tmp = path.join(os.tmpdir(), `meet-src-${randomUUID()}${ext}`);
  await fs.writeFile(tmp, audio.data);
  try {
    return await transcribeAudioFile(tmp, opts);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("m4a") || m.includes("mp4") || m.includes("aac")) return ".m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
  if (m.includes("wav")) return ".wav";
  if (m.includes("webm")) return ".webm";
  if (m.includes("ogg")) return ".ogg";
  return ".m4a";
}
