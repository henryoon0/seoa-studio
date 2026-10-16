import { spawn } from "node:child_process";

function escapeAppleScript(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/** macOS 로컬 실행일 때만 보내는 best-effort 완료 알림. 파이프라인은 알림 실패와 무관하다. */
export function notifyMeetingResult(
  state: "ready" | "failed",
  meetingId: string,
  detail?: string
): void {
  if (process.platform !== "darwin" || process.env.NODE_ENV === "test") return;
  const title = state === "ready" ? "회의록 준비 완료" : "회의록 처리 실패";
  const body =
    state === "ready"
      ? `회의록을 확인할 수 있습니다: /meetings/${meetingId}`
      : detail ?? "회의록 상세 화면에서 오류를 확인해 주세요.";
  const script = `display notification "${escapeAppleScript(body)}" with title "${title}"`;
  try {
    const child = spawn("/usr/bin/osascript", ["-e", script], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // 알림은 부가 기능이므로 회의 처리 결과를 바꾸지 않는다.
  }
}
