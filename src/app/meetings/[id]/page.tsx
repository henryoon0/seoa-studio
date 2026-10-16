import { Icon } from "@/components/icon";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMeeting } from "@/lib/meetings/store";
import { isShareableDocTemplate } from "@/lib/meetings/docs";
import { PeopleEditor } from "./people-editor";
import { DeleteMeetingButton } from "./delete-button";
import { TitleEditor } from "./title-editor";
import { ReanalyzeButton } from "./reanalyze-button";
import { SummaryPanel } from "./summary-panel";
import { RenamePanel } from "./rename-panel";
import { SourcePanel } from "./source-panel";
import { TranscriptView } from "./transcript-view";
import { ProcessingPoller } from "./processing-poller";
import { BorderBeam } from "@/components/border-beam";
import { MeetingStatusBanner } from "./meeting-status-banner";
import {
  buildCopyText,
  durationLabel,
  timeLabel,
} from "./meeting-detail-utils";

interface PageProps {
  params: Promise<{ id: string }>;
}

/** 3시간 넘는 녹음 = 정지를 잊었을 가능성 — 상세 화면 상단 경고. */
const LONG_RECORDING_SEC = 3 * 60 * 60;

export default async function MeetingDetailPage({ params }: PageProps) {
  const { id } = await params;
  const meeting = await getMeeting(id);
  if (!meeting) notFound();

  const a = meeting.analysis;
  const time = timeLabel(meeting.createdAt);
  const duration = durationLabel(meeting);
  const transcript = meeting.transcript;
  const hasTranscript = (transcript?.segments.length ?? 0) > 0;

  return (
    <div className="min-h-screen">
      <header className="px-6 pb-2 pt-6">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between">
            <Link
              href="/meetings"
              className="text-[12px] text-neutral-600 hover:text-neutral-800"
            >
              ← 회의
            </Link>
          </div>
          <TitleEditor
            meetingId={meeting.id}
            title={meeting.title}
            fallback={
              a?.headline ??
              (meeting.status === "failed"
                ? "처리하지 못한 녹음"
                : "처리 중인 회의록")
            }
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-neutral-600">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="users" className="size-3.5 text-neutral-500" />
              {meeting.people.length ? (
                meeting.people.map((p, i) => (
                  <span key={p}>
                    {i > 0 && ", "}
                    {p}
                  </span>
                ))
              ) : (
                <span className="text-neutral-600">미태깅</span>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5 tnum">
              <Icon name="calendar" className="size-3.5 text-neutral-500" />
              {meeting.date.replace(/-/g, ".")}
              {time && <span className="text-neutral-600">{time}</span>}
            </span>
            {duration && (
              <span className="inline-flex items-center gap-1.5 tnum">
                <Icon name="clock" className="size-3.5 text-neutral-500" />
                {duration}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
        {(meeting.durationSec ?? 0) >= LONG_RECORDING_SEC && (
          <div className="card flex items-start gap-2 bg-amber-50 p-4">
            <Icon name="warning" className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p className="text-[13px] text-amber-800">
              녹음이 {duration}입니다. 회의 후 정지를 잊지 않았는지 확인해 보세요.
              무음 구간은 전사에서 자동으로 걸러냅니다.
            </p>
          </div>
        )}
        {meeting.status === "ready" &&
          meeting.transcript?.quality?.completeness === "partial" && (
            <MeetingStatusBanner meeting={meeting} />
          )}
        {meeting.status !== "ready" || !a ? (
          <>
            <ProcessingPoller
              status={meeting.status}
              processedSec={meeting.transcribeProgress?.processedSec}
              processingMark={`${meeting.processing?.stage ?? ""}:${meeting.processing?.queuePosition ?? ""}`}
            />
            <div className="flex justify-end">
              <DeleteMeetingButton meetingId={meeting.id} />
            </div>
            <MeetingStatusBanner meeting={meeting} />
            {hasTranscript && meeting.status === "recorded" && (
              <section className="card relative overflow-hidden rounded-2xl p-5">
                <BorderBeam radius={16} />
                <p className="mb-4 text-[11px] font-medium text-neutral-500">
                  실시간 전사 — 처리되는 대로 이어집니다
                </p>
                <TranscriptView segments={transcript?.segments ?? []} />
              </section>
            )}
            <PeopleEditor
              meetingId={meeting.id}
              initialPeople={meeting.people}
              canWriteVault={false}
            />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
              {hasTranscript && <ReanalyzeButton meetingId={meeting.id} />}
              <DeleteMeetingButton meetingId={meeting.id} />
            </div>
            <SourcePanel
              copySummary={buildCopyText(a, meeting.title)}
              copyTranscript={meeting.transcript?.plain}
              segments={transcript?.segments}
              summary={
                <div className="space-y-8">
                  <SummaryPanel meetingId={meeting.id} analysis={a} />
                  <PeopleEditor
                    meetingId={meeting.id}
                    initialPeople={meeting.people}
                    canWriteVault
                  />
                  <RenamePanel meetingId={meeting.id} />
                </div>
              }
              transcript={
                hasTranscript ? (
                  <TranscriptView
                    meetingId={meeting.id}
                    segments={transcript?.segments ?? []}
                  />
                ) : undefined
              }
            />
          </>
        )}
      </main>
    </div>
  );
}
