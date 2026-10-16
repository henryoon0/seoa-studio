"use client";
import { Icon } from "@/components/icon";

import type {
  FlowStage,
  MeetingAnalysis,
} from "@/lib/meetings/types";
import { useSourceNavigation } from "../source-navigation";
import { EvidenceButton } from "./evidence-button";
import { FlowDiagram, type DiagramStage } from "./flow-diagram";
import { Section } from "./section";
import { evidenceFor, timeLabel } from "./summary-utils";

const CARD =
  "rounded-2xl bg-white p-5 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0px_1px_2px_-1px_rgba(0,0,0,0.06),0px_2px_4px_rgba(0,0,0,0.04)] sm:p-6";

/** 같은 lane 끼리 처음 나온 순서대로 묶는다(단계 순서와 원래 위치는 유지). */
function lanes(flow: readonly FlowStage[]): Array<[string, DiagramStage[]]> {
  const map = new Map<string, DiagramStage[]>();
  flow.forEach((stage, index) => {
    map.set(stage.lane, [...(map.get(stage.lane) ?? []), { stage, index }]);
  });
  return [...map.entries()];
}

function withTimes(analysis: MeetingAnalysis, stages: DiagramStage[]): DiagramStage[] {
  return stages.map((s) => {
    const ev = evidenceFor(analysis, "flowStage", s.index);
    return ev ? { ...s, time: timeLabel(ev.startSec) } : s;
  });
}

/** 10-16 henry: 절차마다 담당자별 가로줄 다이어그램, 넓게. 상자를 누르면 원문 맥락. */
export function FlowCard({ analysis }: { readonly analysis: MeetingAnalysis }) {
  const navigation = useSourceNavigation();
  if (!analysis.flow?.length) return null;
  const open = (lane: string) => (item: DiagramStage) => {
    const ev = evidenceFor(analysis, "flowStage", item.index);
    if (!ev || !navigation) return;
    const label = `${item.stage.owner ?? "담당 미정"} · ${item.stage.name}`;
    if (navigation.openContext) navigation.openContext(ev, `${lane} · ${label}`);
    else navigation.jumpToSegment(ev.segmentId);
  };
  return (
    <div className="space-y-6 xl:-mx-8 [@media(min-width:1440px)]:-mx-36">
      {lanes(analysis.flow).map(([lane, stages]) => (
        <section key={lane} className={CARD}>
          <h2 className="text-balance text-[20px] font-bold leading-snug text-neutral-950">{lane}</h2>
          <p className="mt-1 text-[14px] text-neutral-600">
            담당자마다 한 줄입니다. 상자를 누르면 그 단계가 나온 원문을 볼 수 있습니다.
          </p>
          <div className="mt-4">
            <FlowDiagram stages={withTimes(analysis, stages)} onOpen={open(lane)} />
          </div>
        </section>
      ))}
    </div>
  );
}

export function GlossaryCard({ analysis }: { readonly analysis: MeetingAnalysis }) {
  if (!analysis.glossary?.length) return null;
  return (
    <Section title="용어" icon={<Icon name="book" className="size-4 text-neutral-600" />}>
      <ul className="space-y-3">
        {analysis.glossary.map((item, index) => (
          <li key={item.term} className="flex items-start gap-3 text-sm leading-relaxed">
            <span className="w-24 shrink-0 font-semibold text-neutral-900 sm:w-32">{item.term}</span>
            <span className="min-w-0 flex-1">
              <span className="text-neutral-800">{item.definition}</span>
              {item.distinction && (
                <span className="mt-0.5 block text-[14px] text-neutral-700">{item.distinction}</span>
              )}
            </span>
            <EvidenceButton evidence={evidenceFor(analysis, "term", index)} label={`용어 ${item.term}`} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
