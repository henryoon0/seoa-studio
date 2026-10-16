"use client";

// 녹음 중 실시간 요약(Tiro 식). 1분마다 서버 루프가 갱신한 요약을 10초마다 읽는다.
// 3초 안에 읽히게: 지금 주제 한 줄 + 결정·내 할 일·열린 질문 3칸 + 최근 말 2줄.

import { useCallback, useState } from "react";
import { Icon, type IconName } from "@/components/icon";
import { usePolling } from "@/hooks/use-polling";
import type { LiveSession } from "@/lib/meetings/live/types";

interface LiveResponse {
  recording: boolean;
  elapsedSec?: number;
  live?: LiveSession | null;
}

const COLUMNS = [
  { key: "decisions", label: "결정", icon: "check" },
  { key: "myActions", label: "내 할 일", icon: "arrow-right" },
  { key: "openQuestions", label: "열린 질문", icon: "help" },
] as const;

function agoLabel(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const sec = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return sec < 60 ? `${sec}초 전` : `${Math.floor(sec / 60)}분 전`;
}

function MinuteDots({ live }: { live: LiveSession }) {
  return (
    <div className="flex items-center gap-1" aria-label={`갱신 ${live.updates.length}번`}>
      {live.updates.slice(-12).map((u) => (
        <span
          key={u.at}
          title={u.ok ? `${Math.round(u.processedSec / 60)}분까지 반영` : u.error}
          className={`size-1.5 rounded-full ${u.ok ? "bg-emerald-500" : "bg-red-500"}`}
        />
      ))}
      {live.runningSince ? <span className="size-1.5 animate-pulse rounded-full bg-neutral-400" /> : null}
    </div>
  );
}

function Column({ label, icon, items }: { label: string; icon: IconName; items: string[] }) {
  return (
    <div className="min-w-0 rounded-xl bg-neutral-950/[0.03] p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-neutral-500">
        <Icon name={icon} className="size-3.5" />
        {label}
        <span className="tnum ml-auto text-[15px] font-semibold text-neutral-900">{items.length}</span>
      </p>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item} className="text-[13px] leading-snug text-neutral-800">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LiveBody({ live, now }: { live: LiveSession; now: number }) {
  const lastOk = [...live.updates].reverse().find((u) => u.ok);
  const recent = live.segments.slice(-2);
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[12px] font-medium text-neutral-500">실시간 요약</span>
        <MinuteDots live={live} />
        <span className="ml-auto text-[11px] text-neutral-500">
          {Math.floor(live.processedSec / 60)}분 반영 · {agoLabel(lastOk?.at, now)}
        </span>
      </div>
      <p className="mb-3 text-[17px] font-semibold text-neutral-900">{live.summary.topic || "주제를 듣는 중"}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {COLUMNS.map((c) => (
          <Column key={c.key} label={c.label} icon={c.icon} items={live.summary[c.key]} />
        ))}
      </div>
      {recent.length ? (
        <div className="mt-3 space-y-0.5 text-[12px] text-neutral-500">
          {recent.map((r) => (
            <p key={`${r.t}-${r.text}`} className="truncate">
              {r.speaker ? `${r.speaker}: ` : ""}
              {r.text}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function LiveSummaryCard() {
  const [data, setData] = useState<LiveResponse | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/meetings/live", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as LiveResponse);
      setNow(Date.now());
    } catch {
      /* 다음 폴링에 */
    }
  }, []);

  usePolling(refresh, { label: "meeting-live-summary", activeMs: 10_000, active: true });

  if (!data?.recording) return null;
  return (
    <section className="card mb-5 p-4" aria-live="polite">
      {data.live ? (
        <LiveBody live={data.live} now={now} />
      ) : (
        <p className="text-[13px] text-neutral-500">녹음 1분이 쌓이면 첫 요약이 나옵니다.</p>
      )}
    </section>
  );
}
