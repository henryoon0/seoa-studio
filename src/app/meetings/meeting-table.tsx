import { Icon } from "@/components/icon";
// 클라이언트 전용 디렉티브 없음: 유일한 소비자가 client 인 /meetings 목록이라
// 이미 client 그래프에 포함된다. 디렉티브를 빼야 함수 prop 경계 경고가 사라진다.
import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import type { MeetingSummaryItem } from "@/lib/meetings/types";
import { dividerLabel, timeLabel, groupByDate } from "./format";
import { meetingSignals } from "./meeting-operations";

const STATUS_LABEL: Record<MeetingSummaryItem["status"], string> = {
  recorded: "녹음됨",
  transcribed: "전사됨",
  analyzed: "분석됨",
  ready: "완료",
  failed: "실패",
};

/** 시간 | 회의 | 결정 | 내 할 일 — 열 정의는 헤더·행이 공유한다. */
const GRID = "grid-cols-[72px_minmax(0,1fr)_56px_64px]";

function NumCell({
  value,
  tone = "neutral",
}: {
  value: number;
  tone?: "neutral" | "emerald" | "amber";
}) {
  if (!value) return <span className="text-right text-[12px] text-neutral-300">—</span>;
  const toneClass =
    tone === "emerald"
      ? "font-semibold text-emerald-700"
      : tone === "amber"
        ? "font-semibold text-amber-700"
        : "text-neutral-600";
  return <span className={`tnum text-right text-[13px] ${toneClass}`}>{value}</span>;
}

function MeetingRow({
  meeting,
  onDelete,
}: {
  meeting: MeetingSummaryItem;
  onDelete?: (m: MeetingSummaryItem) => void;
}) {
  const pending = meeting.status !== "ready";
  const failed = meeting.status === "failed";
  const headline =
    meeting.title?.trim() ||
    (meeting.analysis?.headline ??
      (failed ? "처리하지 못한 녹음" : "처리 중인 회의록"));
  const people = meeting.people.length ? meeting.people.join(", ") : null;
  const signals = meetingSignals(meeting);

  return (
    <div className="group/row relative transition-colors duration-100 hover:bg-neutral-950/[0.025]">
      <Link
        href={`/meetings/${meeting.id}`}
        className={`grid min-h-11 items-center px-4 py-2.5 ${GRID} ${onDelete ? "pr-12" : ""}`}
      >
        <span className="tnum text-[12px] text-neutral-500">
          {timeLabel(meeting.createdAt)}
        </span>
        <span className="min-w-0 pr-4">
          <span className="line-clamp-1 text-[13px] font-medium text-neutral-900 group-hover/row:text-neutral-950">
            {headline}
          </span>
          {pending ? (
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] ${
                failed ? "text-red-600" : "text-neutral-500"
              }`}
            >
              {!failed && (
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              )}
              {STATUS_LABEL[meeting.status]}
            </span>
          ) : (
            people && <span className="text-[11px] text-neutral-400">{people}</span>
          )}
        </span>
        <NumCell value={signals.decisions} />
        <NumCell value={signals.myActions} tone="emerald" />
      </Link>

      {onDelete && (
        <ConfirmButton
          type="button"
          onConfirm={() => onDelete(meeting)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          aria-label="삭제"
          title="한 번 더 누르면 삭제합니다"
          confirmLabel={<Icon name="trash" className="size-4" />}
          className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-neutral-300 opacity-0 transition-[opacity,background-color,color,scale] duration-150 active:scale-[0.96] hover:bg-neutral-950/5 hover:text-rose-600 group-hover/row:opacity-100 focus:opacity-100 max-sm:size-11 max-sm:opacity-100"
          confirmClassName="text-rose-600 bg-rose-50"
        >
          <Icon name="trash" className="size-4" />
        </ConfirmButton>
      )}
    </div>
  );
}

/**
 * 날짜별로 묶인 회의 테이블 — /meetings 목록이 사용.
 * 열: 시간 · 회의 · 결정 · 내 할 일. 0은 —로 눌러 신호만 남긴다.
 * onDelete 를 주면 각 행에 hover 삭제가 붙는다. 좁은 화면은 가로 스크롤.
 */
export function MeetingTable({
  meetings,
  onDelete,
}: {
  meetings: MeetingSummaryItem[];
  onDelete?: (m: MeetingSummaryItem) => void;
}) {
  const groups = groupByDate(meetings);
  return (
    <div className="overflow-x-auto bg-white">
      <div className="min-w-[480px]">
        <div
          className={`grid items-center px-4 py-2 text-[11px] font-semibold text-neutral-400 shadow-[0_1px_0_0_rgba(10,10,10,0.05)] ${GRID}`}
        >
          <span>시간</span>
          <span>회의</span>
          <span className="text-right">결정</span>
          <span className="text-right">내 할 일</span>
        </div>
        {groups.map(({ date, items }) => {
          const { date: dlabel, weekday } = dividerLabel(date);
          return (
            <section key={date}>
              <h2 className="bg-neutral-50 px-4 py-1.5 text-[11px] font-semibold text-neutral-500 shadow-[0_1px_0_0_rgba(10,10,10,0.04),0_-1px_0_0_rgba(10,10,10,0.04)]">
                <span className="tnum">{dlabel}</span>{" "}
                <span className="text-neutral-400">{weekday}</span>
              </h2>
              {items.map((m) => (
                <MeetingRow key={m.id} meeting={m} onDelete={onDelete} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
