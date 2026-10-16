"use client";

import type { MeetingAnalysis } from "@/lib/meetings/types";
import { HighlightText } from "../highlighter";
import { EvidenceButton } from "./evidence-button";
import { evidenceFor } from "./summary-utils";

const CARD =
  "rounded-2xl bg-white p-5 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0px_1px_2px_-1px_rgba(0,0,0,0.06),0px_2px_4px_rgba(0,0,0,0.04)] sm:p-6";

/** 한눈 요약 — 목적 · 일정 · 핵심 내용 · 후속 회의 (10-16 henry 예시 레이아웃). */
export function BriefCard({ analysis }: { readonly analysis: MeetingAnalysis }) {
  const schedule = analysis.schedule ?? [];
  return (
    <section className={CARD}>
      <div className={schedule.length ? "grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]" : ""}>
        <div>
          <h2 className="text-[15px] font-bold text-neutral-900">회의 목적</h2>
          <p className="mt-2 text-pretty text-[15px] leading-relaxed text-neutral-800">
            <HighlightText blockKey="summary" text={analysis.purpose ?? analysis.summary} />
          </p>
        </div>
        {schedule.length > 0 && (
          <div>
            <h2 className="text-[15px] font-bold text-neutral-900">일정</h2>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-[15px] leading-snug">
              {schedule.map((item) => (
                <div key={`${item.when}-${item.what}`} className="contents">
                  <dt className="whitespace-nowrap font-semibold text-neutral-900">{item.when}</dt>
                  <dd className="text-neutral-800">{item.what}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      <h2 className="mt-7 text-[15px] font-bold text-neutral-900">핵심 내용</h2>
      <ul className="mt-2 space-y-3">
        {(analysis.highlights ?? []).map((item, index) => (
          <li key={item.title} className="flex items-start gap-2 text-[15px] leading-relaxed">
            <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-neutral-800" />
            <p className="min-w-0 flex-1 text-pretty text-neutral-800">
              <strong className="font-semibold text-neutral-950">{item.title}</strong> {item.detail}
            </p>
            <EvidenceButton evidence={evidenceFor(analysis, "highlight", index)} label={`핵심 ${index + 1}`} />
          </li>
        ))}
      </ul>

      {Boolean(analysis.followUps?.length) && (
        <p className="mt-6 pt-4 text-[14px] leading-relaxed text-neutral-600 shadow-[inset_0_1px_0_0_rgba(0,0,0,0.08)]">
          후속 회의: {analysis.followUps?.join(" · ")}
        </p>
      )}
    </section>
  );
}
