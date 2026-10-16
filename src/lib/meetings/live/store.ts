import { promises as fs } from "node:fs";
import path from "node:path";
import { EMPTY_SUMMARY, type LiveSession } from "./types";

export function liveDir(): string {
  return process.env.MEETINGS_LIVE_DIR || path.join(process.cwd(), "data", "meetings", "live");
}

function fileFor(id: string): string {
  return path.join(liveDir(), `${path.basename(id)}.json`);
}

export function newLiveSession(sessionDir: string, mode: LiveSession["mode"]): LiveSession {
  return {
    id: path.basename(sessionDir),
    sessionDir,
    mode,
    processedSec: 0,
    summarizedSec: 0,
    segments: [],
    summary: { ...EMPTY_SUMMARY },
    updates: [],
  };
}

/** 녹음 상태 파일의 마이크 경로 → 세션 id(세션 폴더 이름). */
export function liveIdFromRecordingFile(file: string): string {
  return path.basename(path.dirname(file));
}

export async function readLiveSession(id: string): Promise<LiveSession | null> {
  try {
    return JSON.parse(await fs.readFile(fileFor(id), "utf-8")) as LiveSession;
  } catch {
    return null;
  }
}

export async function writeLiveSession(session: LiveSession): Promise<void> {
  await fs.mkdir(liveDir(), { recursive: true });
  const file = fileFor(session.id);
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(session, null, 2));
  await fs.rename(tmp, file);
}
