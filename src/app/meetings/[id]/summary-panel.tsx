"use client";
import { Icon } from "@/components/icon";

import { useState } from "react";
import type { MeetingAnalysis } from "@/lib/meetings/types";
import { SummaryEditor } from "./summary-panel/summary-editor";
import { SummaryView } from "./summary-panel/summary-view";

export function SummaryPanel({
  meetingId,
  analysis: initialAnalysis,
  thread,
}: {
  readonly meetingId: string;
  readonly analysis: MeetingAnalysis;
  /** "이 사람과의 흐름" 패널(서버에서 렌더) — 이력이 없으면 안 넘어온다. */
  readonly thread?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [analysis, setAnalysis] = useState(initialAnalysis);

  if (editing) {
    return (
      <SummaryEditor
        meetingId={meetingId}
        analysis={analysis}
        onCancel={() => setEditing(false)}
        onSaved={(saved) => {
          setAnalysis(saved);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button
          onClick={() => setEditing(true)}
          className="inline-flex min-h-8 items-center gap-1 px-1 text-[12px] text-neutral-600 transition-colors hover:text-neutral-700"
        >
          <Icon name="edit" className="size-3.5" />
          내용 편집
        </button>
      </div>
      <SummaryView
        meetingId={meetingId}
        analysis={analysis}
        onAnalysisChange={setAnalysis}
        thread={thread}
      />
    </div>
  );
}
