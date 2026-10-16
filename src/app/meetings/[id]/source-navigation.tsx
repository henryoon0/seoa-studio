"use client";

import { createContext, useContext } from "react";
import type { AnalysisEvidenceRef } from "@/lib/meetings/types";

interface SourceNavigation {
  readonly targetSegmentId?: string;
  readonly targetRequestId: number;
  readonly jumpToSegment: (segmentId: string) => void;
  /** 원문 맥락 패널을 연다. 전사가 없으면 없다. */
  readonly openContext?: (evidence: AnalysisEvidenceRef, label: string) => void;
}

const SourceNavigationContext = createContext<SourceNavigation | null>(null);

export const SourceNavigationProvider = SourceNavigationContext.Provider;

export function useSourceNavigation(): SourceNavigation | null {
  return useContext(SourceNavigationContext);
}
