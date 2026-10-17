"use client";

// 왼쪽 아이콘 줄 — 인스타 웹 왼쪽 줄처럼 아이콘 + 짧은 이름 + 빨간 숫자 배지.
// 이 앱은 인스타 하나만 다루므로 채널 고르기 칸 없이 메뉴(댓글 · DM · 기록)만 둔다.

import { Icon, type IconName } from "@/components/icon";

const IG_RED = "#FF3040";

export interface RailEntry {
  key: string;
  label: string;
  icon: IconName;
  n?: number;
}

function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="absolute -right-2 -top-1.5 min-w-[18px] rounded-full px-1 text-center text-[10px] font-semibold leading-[18px] text-white ring-2 ring-white" style={{ background: IG_RED }}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function RailButton({ e, active, onClick }: { e: RailEntry; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined}
      className={`flex w-full flex-col items-center gap-1 rounded-xl py-2.5 transition-colors active:scale-[0.96] ${active ? "text-neutral-950" : "text-neutral-500 hover:bg-neutral-950/[0.04] hover:text-neutral-900"}`}>
      <span className="relative">
        <Icon name={e.icon} className={`size-6 ${active ? "" : "opacity-80"}`} />
        <Badge n={e.n} />
      </span>
      <span className={`text-[11px] ${active ? "font-semibold" : ""}`}>{e.label}</span>
    </button>
  );
}

export function IgRail({ entries, active, go }: { entries: RailEntry[]; active: string; go: (key: string) => void }) {
  return (
    <nav aria-label="인스타" className="flex h-[var(--inbox-h,100dvh)] w-[76px] shrink-0 flex-col items-center gap-1 bg-white px-2 py-4 shadow-[1px_0_0_0_rgba(10,10,10,0.08)]">
      {entries.map((e) => <RailButton key={e.key} e={e} active={active === e.key} onClick={() => go(e.key)} />)}
    </nav>
  );
}
