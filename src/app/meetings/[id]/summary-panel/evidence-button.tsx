"use client";
import { Icon } from "@/components/icon";

import type { AnalysisEvidenceRef } from "@/lib/meetings/types";
import { useSourceNavigation } from "../source-navigation";
import { timeLabel } from "./summary-utils";

export function EvidenceButton({
  evidence,
  label,
}: {
  readonly evidence?: AnalysisEvidenceRef;
  readonly label: string;
}) {
  const navigation = useSourceNavigation();
  if (!evidence || !navigation) return null;
  const time = timeLabel(evidence.startSec);
  return (
    <button
      onClick={() =>
        navigation.openContext
          ? navigation.openContext(evidence, label)
          : navigation.jumpToSegment(evidence.segmentId)
      }
      aria-label={`${label} 원문 ${time} 보기`}
      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 sm:min-h-8"
    >
      <Icon name="play" className="size-3" />
      <span>원문</span>
      <span className="tnum">{time}</span>
    </button>
  );
}
