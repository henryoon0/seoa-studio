import { NextResponse, type NextRequest } from "next/server";
import {
  readRecordingStatus,
  runRecordingExclusive,
  startRecordingCaptured,
  stopRecording,
} from "@/lib/meetings/recording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 현재 녹음 상태(/tmp 상태 파일 + PID 생존 기준). */
export async function GET() {
  return NextResponse.json(await readRecordingStatus());
}

/**
 * 녹음 시작·종료. body: { action: "start" | "stop", mode?: "remote" | "inperson" }.
 * action 은 필수다 — 서버가 현재 상태로 의도를 추측하면, 두 탭에서 연달아 누른 "종료"가
 * 새 녹음 시작으로 뒤집힌다. 서버는 종료 요청을 절대 시작으로 바꾸지 않는다.
 * 시작은 출력을 캡처해 실패 사유(덮개 닫힘·마이크 무음)와 경고(출력 전환 실패)를
 * 그대로 돌려준다 — 종료는 업로드까지 이어가므로 detached 로 두고 폴링이 수렴.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    mode?: unknown;
    action?: unknown;
  };
  const action =
    body.action === "start" || body.action === "stop" ? body.action : null;
  if (!action) {
    return NextResponse.json(
      { error: "action 은 start 또는 stop 이어야 합니다" },
      { status: 400 },
    );
  }
  const mode =
    body.mode === "inperson"
      ? "inperson"
      : body.mode === "remote"
        ? "remote"
        : undefined;

  // 시작과 종료는 같은 줄을 지난다. 시작 중에 온 종료는 시작이 끝난 뒤 반드시 실행한다.
  if (action === "stop") {
    return runRecordingExclusive(async () => {
      // 표시 상태와 관계없이 종료 스크립트를 부른다(녹음이 없으면 스크립트가 그냥 끝난다).
      stopRecording();
      // 스크립트가 상태 파일을 지울 시간을 잠깐 준 뒤 새 상태를 돌려준다.
      await new Promise((r) => setTimeout(r, 1500));
      return NextResponse.json(await readRecordingStatus(), { status: 202 });
    });
  }
  return runRecordingExclusive(async () => {
    const current = await readRecordingStatus();
    if (current.recording) {
      return NextResponse.json(current, { status: 200 });
    }

    const result = await startRecordingCaptured(mode);
    const status = await readRecordingStatus();
    if (!result.ok) {
      console.warn("[meetings] 녹음 시작 실패:\n" + result.output);
    }
    return NextResponse.json(
      {
        ...status,
        ...(result.error ? { error: result.error } : {}),
        ...(result.warnings.length ? { warnings: result.warnings } : {}),
      },
      { status: result.ok ? 202 : 200 },
    );
  });
}
