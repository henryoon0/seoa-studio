// 업로드 오디오 영속화 — 비동기 ingest 의 재개(resume) 재료.
// 서버가 전사 중에 죽어도 여기 사본으로 sweep 이 이어서 처리한다.
// 처리 성공 시 사본은 지운다(2시간 회의 100MB+ — 원본은 Raycast 가
// ~/Recordings/meetings 에 보존하므로 사본을 쌓아둘 이유가 없다).

import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AudioInput,
  MeetingAudioTrackFile,
  MeetingAudioTracks,
  TranscriptSourceTrack,
} from "./types";

const exec = promisify(execFile);

export function meetingsAudioDir(): string {
  return (
    process.env.MEETINGS_AUDIO_DIR ||
    path.join(process.cwd(), "data", "meetings", "audio")
  );
}

const EXT_BY_MIME: Array<[RegExp, string]> = [
  [/m4a|mp4|aac/, ".m4a"],
  [/mpeg|mp3/, ".mp3"],
  [/wav/, ".wav"],
  [/webm/, ".webm"],
  [/ogg/, ".ogg"],
  [/caf/, ".caf"],
];
const MIME_BY_EXT: Record<string, string> = {
  ".m4a": "audio/m4a",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".caf": "audio/x-caf",
};

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  for (const [re, ext] of EXT_BY_MIME) if (re.test(m)) return ext;
  return ".m4a";
}

/** 오디오를 저장하고 파일명(basename)을 돌려준다. */
export async function saveMeetingAudio(
  meetingId: string,
  audio: AudioInput
): Promise<string> {
  const dir = meetingsAudioDir();
  await fs.mkdir(dir, { recursive: true });
  const file = `${meetingId}${extFromMime(audio.mimeType)}`;
  await fs.writeFile(path.join(dir, file), audio.data);
  return file;
}

export async function saveMeetingAudioTrack(
  meetingId: string,
  track: Exclude<TranscriptSourceTrack, "mixed">,
  audio: AudioInput,
  startOffsetMs: number
): Promise<MeetingAudioTrackFile> {
  const dir = meetingsAudioDir();
  await fs.mkdir(dir, { recursive: true });
  const file = `${meetingId}.${track}${extFromMime(audio.mimeType)}`;
  await fs.writeFile(path.join(dir, file), audio.data);
  return { file, startOffsetMs };
}

/** 저장된 오디오를 AudioInput 으로 읽는다. 없으면 null. */
export async function readMeetingAudio(
  audioFile: string | undefined
): Promise<AudioInput | null> {
  if (!audioFile) return null;
  try {
    const data = await fs.readFile(path.join(meetingsAudioDir(), audioFile));
    const mimeType = MIME_BY_EXT[path.extname(audioFile)] ?? "audio/m4a";
    return { data, mimeType };
  } catch {
    return null;
  }
}

export async function readMeetingAudioTrack(
  track: MeetingAudioTrackFile | undefined
): Promise<AudioInput | null> {
  return readMeetingAudio(track?.file);
}

/** 사본 삭제(best-effort). */
export async function deleteMeetingAudio(
  audioFile: string | undefined
): Promise<void> {
  if (!audioFile) return;
  await fs
    .rm(path.join(meetingsAudioDir(), audioFile), { force: true })
    .catch(() => {});
}

export async function deleteMeetingAudioTracks(
  tracks: MeetingAudioTracks | undefined
): Promise<void> {
  await Promise.all([
    deleteMeetingAudio(tracks?.mic?.file),
    deleteMeetingAudio(tracks?.system?.file),
  ]);
}

/** ffprobe 로 길이(초)를 잰다. 실패 시 undefined(경고만 못 띄울 뿐 처리엔 지장 없음). */
export async function probeAudioDurationSec(
  audioFile: string
): Promise<number | undefined> {
  const bin = process.env.FFPROBE_PATH || "ffprobe";
  try {
    const { stdout } = await exec(
      bin,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        path.join(meetingsAudioDir(), audioFile),
      ],
      { timeout: 30_000 }
    );
    const sec = Number.parseFloat(stdout.trim());
    return Number.isFinite(sec) && sec > 0 ? Math.round(sec) : undefined;
  } catch {
    return undefined;
  }
}
