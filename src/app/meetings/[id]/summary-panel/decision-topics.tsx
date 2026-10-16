"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import type { MeetingAnalysis } from "@/lib/meetings/types";
import { HighlightText } from "../highlighter";
import { EvidenceButton } from "./evidence-button";
import { evidenceFor } from "./summary-utils";

// 10-16 henry: 결정·회의 맥락도 할 일과 같은 결(제목 · 개수 → 흰 카드 → 줄 단위)로, 글씨는 15~16px.
const CARD = "rounded-2xl bg-white shadow-[0px_0px_0px_1px_rgba(0,0,0,0.07),0px_1px_2px_rgba(0,0,0,0.04)]";
const ROW_LINE = "shadow-[inset_0_1px_0_0_rgba(0,0,0,0.06)]";

function Heading({ title, sub, count }: { title: string; sub: string; count: number }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
      <h2 className="text-[17px] font-semibold text-neutral-950">
        {title} <span className="font-normal text-neutral-500">· {sub}</span>
      </h2>
      <span className="text-[14px] text-neutral-600 tabular-nums">{count}개</span>
    </div>
  );
}

export function DecisionList({ analysis }: { readonly analysis: MeetingAnalysis }) {
  const decisions = analysis.decisions ?? [];
  if (!decisions.length) return null;
  return (
    <section>
      <Heading title="결정" sub="회의에서 합의한 것" count={decisions.length} />
      <ol className={`${CARD} overflow-hidden`}>
        {decisions.map((text, index) => (
          <li key={`${index}-${text}`} className={`flex items-start gap-4 px-5 py-3.5 ${index ? ROW_LINE : ""}`}>
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[12px] font-semibold text-emerald-700 tabular-nums">
              {index + 1}
            </span>
            <p className="min-w-0 flex-1 text-pretty text-[16px] leading-relaxed text-neutral-900">
              <HighlightText blockKey={`decision:${index}`} text={text} />
            </p>
            <EvidenceButton evidence={evidenceFor(analysis, "decision", index)} label={`결정 ${index + 1}`} />
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TopicGrid({ analysis }: { readonly analysis: MeetingAnalysis }) {
  const topics = analysis.topics ?? [];
  if (!topics.length) return null;
  return (
    <section>
      <Heading title="회의 내용" sub="주제별 결론과 이야기" count={topics.length} />
      <div className="space-y-3">
        {topics.map((topic, topicIndex) => (
          <TopicCard key={topicIndex} analysis={analysis} topicIndex={topicIndex} />
        ))}
      </div>
    </section>
  );
}

/** 결론 문장 → 서술 문단 → 근거(접힘). 옛 회의처럼 summary 가 없으면 근거를 펼친 채로 둔다. */
function TopicCard({ analysis, topicIndex }: { readonly analysis: MeetingAnalysis; readonly topicIndex: number }) {
  const topic = analysis.topics?.[topicIndex];
  const [open, setOpen] = useState(!topic?.summary);
  if (!topic) return null;
  return (
    <article className={`${CARD} px-6 py-5`}>
      <p className="text-[13px] font-medium text-neutral-500 tabular-nums">{String(topicIndex + 1).padStart(2, "0")}</p>
      <h3 className="mt-1 text-pretty text-[18px] font-semibold leading-snug text-neutral-950">{topic.title}</h3>
      {topic.summary && (
        <p className="mt-2 max-w-[68ch] text-pretty text-[16px] leading-[1.75] text-neutral-800">{topic.summary}</p>
      )}
      {topic.summary && (
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="mt-3 inline-flex items-center gap-1 text-[14px] text-neutral-600 hover:text-neutral-950"
        >
          <Icon name="chevron-right" className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
          근거 {topic.points.length}개
        </button>
      )}
      {open && <TopicPoints analysis={analysis} topicIndex={topicIndex} />}
    </article>
  );
}

function TopicPoints({ analysis, topicIndex }: { readonly analysis: MeetingAnalysis; readonly topicIndex: number }) {
  const topic = analysis.topics?.[topicIndex];
  if (!topic) return null;
  return (
    <ul className="mt-3 space-y-2.5 rounded-xl bg-neutral-50 px-4 py-3">
      {topic.points.map((point, index) => (
        <li key={`${index}-${point}`} className="flex items-start gap-2.5">
          <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-neutral-400" />
          <p className="min-w-0 flex-1 text-pretty text-[15px] leading-relaxed text-neutral-800">
            <HighlightText blockKey={`topic:${topicIndex}:${index}`} text={point} />
          </p>
          <EvidenceButton evidence={evidenceFor(analysis, "topicPoint", index, topicIndex)} label={`${topic.title} ${index + 1}`} />
        </li>
      ))}
    </ul>
  );
}
