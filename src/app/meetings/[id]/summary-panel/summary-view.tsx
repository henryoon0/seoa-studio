"use client";

import type {
  ActionTodoLink,
  MeetingAnalysis,
} from "@/lib/meetings/types";
import { EvidenceButton } from "./evidence-button";
import { evidenceFor } from "./summary-utils";
import { HighlightText } from "../highlighter";
import { BriefCard } from "./brief-card";
import { FlowCard, GlossaryCard } from "./structure-cards";
import { TaskBoard } from "./task-board";
import { DecisionList, TopicGrid } from "./decision-topics";

export function SummaryView({
  meetingId,
  analysis,
  onAnalysisChange,
  thread,
}: {
  readonly meetingId: string;
  readonly analysis: MeetingAnalysis;
  readonly onAnalysisChange: (analysis: MeetingAnalysis) => void;
  readonly thread?: React.ReactNode;
}) {
  function markTodo(index: number, todo: ActionTodoLink) {
    onAnalysisChange({
      ...analysis,
      actionItems: analysis.actionItems?.map((item, itemIndex) =>
        itemIndex === index ? { ...item, todo } : item
      ),
    });
  }

  async function editTask(index: number, patch: { task: string; owner: string }) {
    const next: MeetingAnalysis = {
      ...analysis,
      actionItems: analysis.actionItems?.map((item, i) => {
        if (i !== index) return item;
        const edited = { ...item, ...patch };
        delete edited.unsure;
        return edited;
      }),
    };
    const response = await fetch(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysis: next }),
    });
    const body = (await response.json()) as { analysis?: MeetingAnalysis; error?: string };
    if (!response.ok) throw new Error(body.error ?? "저장 실패");
    onAnalysisChange(body.analysis ?? next);
  }

  const indexedActions = (analysis.actionItems ?? []).map((item, index) => ({
    item,
    index,
  }));
  const myActions = indexedActions.filter(({ item }) => item.owner === "나");
  const counterpartActions = indexedActions.filter(
    ({ item }) => item.owner === "상대"
  );

  return (
    <>
      {analysis.highlights?.length ? (
        <BriefCard analysis={analysis} />
      ) : (
      <section className="rounded-2xl bg-white p-5 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0px_1px_2px_-1px_rgba(0,0,0,0.06),0px_2px_4px_rgba(0,0,0,0.04)] sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 max-w-2xl whitespace-pre-wrap text-pretty text-base leading-relaxed text-neutral-700">
              <HighlightText blockKey="summary" text={analysis.summary} />
            </p>
            <EvidenceButton evidence={evidenceFor(analysis, "summary", 0)} label="요약" />
          </div>
          <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
            <BriefStat label="결정" value={analysis.decisions?.length ?? 0} />
            <BriefStat label="내 할 일" value={myActions.length} />
            <BriefStat label="상대 약속" value={counterpartActions.length} />
            <BriefStat label="남은 질문" value={analysis.openQuestions?.length ?? 0} />
          </p>
        </section>
      )}

      {thread}

      {/* 10-16 henry: 흐름 다이어그램 → 사람별 역할·할 일. 1분 타임라인·근거 묶음은 뺐다 */}
      <FlowCard analysis={analysis} />
      <TaskBoard meetingId={meetingId} analysis={analysis} onTodo={markTodo} onEdit={editTask} />

      <DecisionList analysis={analysis} />
      <TopicGrid analysis={analysis} />
      <GlossaryCard analysis={analysis} />
    </>
  );
}

function BriefStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-neutral-600">
      {label}{" "}
      <span className={`font-bold tabular-nums ${value ? "text-neutral-900" : "text-neutral-600"}`}>
        {value}
      </span>
    </span>
  );
}
