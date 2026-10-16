"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionItem, MeetingAnalysis } from "@/lib/meetings/types";
import {
  ActionFields,
  EditCard,
  LineArea,
  TopicFields,
} from "./summary-editor-fields";
import { fromLines, toLines, type ActionDraft, type TopicDraft } from "./summary-utils";

export function SummaryEditor({
  meetingId,
  analysis,
  onCancel,
  onSaved,
}: {
  readonly meetingId: string;
  readonly analysis: MeetingAnalysis;
  readonly onCancel: () => void;
  readonly onSaved: (analysis: MeetingAnalysis) => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [summary, setSummary] = useState(analysis.summary);
  const [topics, setTopics] = useState<TopicDraft[]>(
    (analysis.topics ?? []).map((topic) => ({
      title: topic.title,
      points: toLines(topic.points),
    }))
  );
  const [keyPoints, setKeyPoints] = useState(toLines(analysis.keyPoints));
  const [decisions, setDecisions] = useState(toLines(analysis.decisions));
  const [actions, setActions] = useState<ActionDraft[]>(
    (analysis.actionItems ?? []).map((action) => ({
      owner: action.owner,
      task: action.task,
      due: action.due ?? "",
    }))
  );
  const [nextSteps, setNextSteps] = useState(toLines(analysis.nextSteps));
  const [openQuestions, setOpenQuestions] = useState(toLines(analysis.openQuestions));

  async function save() {
    setSaving(true);
    setError(undefined);
    const nextAnalysis: MeetingAnalysis = {
      ...analysis,
      summary: summary.trim(),
      keyPoints: fromLines(keyPoints),
      topics: topics
        .map((topic) => ({ title: topic.title.trim(), points: fromLines(topic.points) }))
        .filter((topic) => topic.title && topic.points.length),
      decisions: fromLines(decisions),
      actionItems: actions
        .map((action, index) => {
          return {
            owner: action.owner.trim() || "함께",
            task: action.task.trim(),
            ...(action.due.trim() ? { due: action.due.trim() } : {}),
            ...keptFields(analysis.actionItems?.[index], action.task.trim()),
          };
        })
        .filter((action) => action.task),
      nextSteps: fromLines(nextSteps),
      openQuestions: fromLines(openQuestions),
    };
    try {
      const response = await fetch(`/api/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis: nextAnalysis }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "저장 실패");
      onSaved(nextAnalysis);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        {error && <p className="mr-auto text-[12px] text-red-600">{error}</p>}
        <button onClick={onCancel} disabled={saving}
          className="min-h-8 rounded px-2.5 py-1 text-[12px] text-neutral-600 ring-1 ring-neutral-950/10 hover:ring-neutral-950/20 disabled:opacity-40">
          취소
        </button>
        <button onClick={save} disabled={saving}
          className="min-h-8 rounded bg-neutral-900 px-2.5 py-1 text-[12px] text-white hover:bg-neutral-800 disabled:opacity-40">
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
      <EditCard title="요약">
        <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={5}
          className="w-full resize-y rounded bg-white p-2 text-[13px] leading-6 text-neutral-700 ring-1 ring-neutral-950/10 outline-none focus:ring-neutral-950/25" />
      </EditCard>
      <TopicFields topics={topics} onChange={setTopics} />
      <EditCard title="핵심 (한 줄에 하나씩)"><LineArea value={keyPoints} onChange={setKeyPoints} /></EditCard>
      <EditCard title="결정 (한 줄에 하나씩)"><LineArea value={decisions} onChange={setDecisions} /></EditCard>
      <ActionFields actions={actions} onChange={setActions} />
      <EditCard title="다음 단계 (한 줄에 하나씩)"><LineArea value={nextSteps} onChange={setNextSteps} /></EditCard>
      <EditCard title="남은 질문 (한 줄에 하나씩)"><LineArea value={openQuestions} onChange={setOpenQuestions} /></EditCard>
    </div>
  );
}

/** 할 일 문장을 안 바꿨으면 화면에 없는 칸(맥락·완료 기준·인용·Todo 링크)을 그대로 둔다. */
function keptFields(before: ActionItem | undefined, task: string): Partial<ActionItem> {
  if (!before || before.task !== task) return {};
  const rest: Partial<ActionItem> = { ...before };
  delete rest.owner;
  delete rest.task;
  delete rest.due;
  return rest;
}
