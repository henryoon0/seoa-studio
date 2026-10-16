import { NextResponse } from "next/server";
import { readRecordingStatus } from "@/lib/meetings/recording";
import { liveIdFromRecordingFile, readLiveSession } from "@/lib/meetings/live/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 녹음 중 상태. 실시간 요약(whisper 필요)은 서아님 스튜디오에서 끈다. */
export async function GET() {
  const status = await readRecordingStatus();
  if (!status.recording || !status.file) return NextResponse.json({ recording: false });
  const live = await readLiveSession(liveIdFromRecordingFile(status.file));
  return NextResponse.json({ recording: true, elapsedSec: status.elapsedSec, live });
}
