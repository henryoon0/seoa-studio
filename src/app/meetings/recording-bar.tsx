"use client";
import { Icon } from "@/components/icon";

import { useCallback, useState } from "react";
import { usePolling } from "@/hooks/use-polling";

// /meetings 상단 녹음 상태 바 — Raycast 토글과 같은 상태 파일을 보므로
// 어디서 시작했든 여기 보인다. 오래 돌면 경고(6시간 방치 사고 재발 방지).

interface Status {
  recording: boolean;
  mode?: "remote" | "inperson";
  elapsedSec?: number;
  /** 종료 실패 사유 — 녹음은 계속 켜진 상태로 남는다. */
  stopError?: string;
  /** 시작 실패 사유(덮개 닫힘·마이크 무음 등) — 토글 응답에만 실린다. */
  error?: string;
  /** 시작은 됐지만 알아야 할 경고(출력 자동전환 실패 등). */
  warnings?: string[];
}

const WARN_SEC = 90 * 60; // 90분: "끄는 걸 잊지 않았나" 주의
const ALARM_SEC = 3 * 60 * 60; // 3시간: 강한 경고

function elapsedLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분`;
  return `${sec}초`;
}

export function RecordingBar({ onStopped }: { onStopped?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<"remote" | "inperson">("remote");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "error" | "warn";
    text: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/meetings/recording", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as Status;
      setStatus((prev) => {
        // 녹음 → 종료 전환 감지 시 목록 갱신(업로드가 새 회의를 만든다)
        if (prev?.recording && !json.recording) onStopped?.();
        return json;
      });
    } catch {
      /* 다음 폴링에 */
    }
  }, [onStopped]);

  // 상시 폴러 — 숨은 탭에선 쉬고, 돌아오면 즉시 한 번 확인한다(훅이 첫 틱을 맡는다).
  usePolling(refresh, { label: "meeting-recording-bar", activeMs: 5000, active: true });

  async function send(action: "start" | "stop") {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/meetings/recording", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, mode }),
      });
      if (res.ok) {
        const json = (await res.json()) as Status;
        setStatus(json);
        if (json.error) {
          setNotice({ kind: "error", text: json.error });
        } else if (json.warnings?.length) {
          setNotice({ kind: "warn", text: json.warnings.join(" · ") });
        }
      }
    } catch {
      /* 폴링이 수렴 */
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  // 종료 실패는 폴링으로도 들어오므로, 녹음 중일 때 상태에 실린 사유를 항상 보여 준다.
  const shownNotice =
    status.recording && status.stopError
      ? { kind: "error" as const, text: status.stopError }
      : notice;

  const noticeLine = shownNotice && (
    <p
      className={`mt-1.5 text-[12px] ${
        shownNotice.kind === "error" ? "text-red-600" : "text-amber-700"
      }`}
    >
      {shownNotice.text}
    </p>
  );

  if (!status.recording) {
    return (
      <div className="mb-5">
      <div className="card flex flex-col items-stretch gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start justify-between gap-2.5 sm:justify-start">
          <Icon name="mic" className="size-4 text-neutral-500" />
          <div>
            <p className="text-[13px] font-medium text-neutral-800">회의 녹음</p>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              {mode === "remote"
                ? "원격 · 내 마이크와 상대 시스템 소리를 별도 트랙으로 저장"
                : "대면 · 같은 공간의 소리를 마이크 한 트랙으로 저장"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="inline-flex rounded-lg bg-neutral-950/[0.04] p-0.5">
            {(
              [
                ["remote", "원격"],
                ["inperson", "대면"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={`min-h-11 whitespace-nowrap rounded-md px-3 py-1 text-[12px] transition-colors sm:min-h-0 sm:px-2.5 ${
                  mode === key
                    ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-950/5"
                    : "text-neutral-500 hover:text-neutral-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => send("start")}
            disabled={busy}
            className="btn-secondary min-h-11 whitespace-nowrap disabled:opacity-50 sm:min-h-0"
          >
            <Icon name="mic" className="size-3.5" />
            {busy ? "시작 중..." : "녹음 시작"}
          </button>
        </div>
      </div>
      {noticeLine}
      </div>
    );
  }

  const sec = status.elapsedSec ?? 0;
  const level = sec >= ALARM_SEC ? "alarm" : sec >= WARN_SEC ? "warn" : "ok";

  return (
    <div className="mb-5">
    <div
      className={`card flex flex-col items-stretch gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between ${
        level === "alarm" ? "bg-red-50" : level === "warn" ? "bg-amber-50" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
        </span>
        <span className="text-[13px] font-medium text-neutral-900">
          녹음 중 · <span className="tnum">{elapsedLabel(sec)}</span> ·{" "}
          {status.mode === "inperson" ? "대면" : "원격"}
        </span>
        {level === "warn" && (
          <span className="text-[12px] text-amber-700">
            90분을 넘었어요. 긴 회의도 끝까지 녹음·전사되니 그대로 두세요.
            회의가 끝났을 때만 종료하면 됩니다.
          </span>
        )}
        {level === "alarm" && (
          <span className="text-[12px] font-medium text-red-700">
            3시간째 녹음 중입니다. 회의가 진행 중이면 괜찮아요. 끝났는데 켜져
            있다면 종료해 주세요.
          </span>
        )}
      </div>
      <button
        onClick={() => send("stop")}
        disabled={busy}
        className="btn-secondary min-h-11 whitespace-nowrap disabled:opacity-50 sm:min-h-0"
      >
        <Icon name="stop" className="size-3.5 text-red-600" />
        {busy ? "종료 중..." : "종료하고 올리기"}
      </button>
    </div>
    {noticeLine}
    </div>
  );
}
