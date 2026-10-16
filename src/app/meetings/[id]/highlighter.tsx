"use client";
import { Icon } from "@/components/icon";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TextHighlight } from "@/lib/meetings/highlights";
import { splitByHighlights } from "@/lib/meetings/highlights";
import { applyMarksToHtml } from "@/lib/meetings/html-marks";
import { captureSelection } from "@/lib/highlight-selection";

// 형광펜 하이라이트 + 공유 제외 — 요약·스크립트 어디든 드래그로 긁으면
// [형광펜 | 공유에서 빼기] 팝오버가 뜬다. 형광펜은 긁은 글자 범위만 색칠,
// 공유 제외는 그 범위가 걸친 블록(불릿·발화)을 공개 페이지에서 통째로 뺀다.
// 색칠된 부분 클릭 = 해제, 빠진 블록 클릭 = 되돌리기. 둘 다 자동 저장(PATCH).
//
// 배선: 텍스트 블록은 <HighlightText blockKey text> 로 그린다(data-hl 속성이
// 선택 영역 → 블록·오프셋 계산의 앵커). MeetingHighlighter 가 컨텍스트 제공 +
// 드래그 캡처 래퍼를 겸한다. 컨텍스트가 없으면 HighlightText 는 평문 렌더.

interface HighlighterCtx {
  highlightsFor: (blockKey: string) => TextHighlight[];
  isHidden: (blockKey: string) => boolean;
  add: (entries: Omit<TextHighlight, "id">[]) => void;
  remove: (id: string) => void;
  hide: (blockKeys: string[]) => void;
  unhide: (blockKey: string) => void;
}

const Ctx = createContext<HighlighterCtx | null>(null);

/** 블록 텍스트 렌더러 — 하이라이트는 <mark>, 공유 제외 블록은 흐림+취소선. */
export function HighlightText({
  blockKey,
  text,
  className,
}: {
  blockKey: string;
  text: string;
  className?: string;
}) {
  const ctx = useContext(Ctx);
  if (!ctx) return <span className={className}>{text}</span>;
  if (ctx.isHidden(blockKey)) {
    return (
      <span
        data-hl={blockKey}
        title="공유에서 빠져요. 클릭하면 되돌립니다"
        onClick={(e) => {
          e.stopPropagation();
          ctx.unhide(blockKey);
        }}
        className={`cursor-pointer text-neutral-400 line-through decoration-neutral-300 transition-colors hover:text-neutral-500 ${className ?? ""}`}
      >
        {text}
      </span>
    );
  }
  const parts = splitByHighlights(text, ctx.highlightsFor(blockKey));
  return (
    <span data-hl={blockKey} className={className}>
      {parts.map((p, i) =>
        p.highlightId ? (
          <mark
            key={i}
            className="cursor-pointer rounded-[3px] bg-amber-200/70 px-0.5 py-0.5 text-inherit transition-colors hover:bg-amber-300/70"
            title="클릭해서 하이라이트 해제"
            onClick={(e) => {
              e.stopPropagation();
              ctx.remove(p.highlightId!);
            }}
          >
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  );
}

/**
 * 통짜 HTML 블록(문서 탭의 마크다운 렌더) 렌더러 — 형광펜 구간을 인라인
 * <mark> 로 끼워 넣는다. 마크 클릭 해제는 이벤트 위임(data-hl-id).
 */
export function HighlightHtml({
  blockKey,
  html,
  className,
}: {
  blockKey: string;
  html: string;
  className?: string;
}) {
  const ctx = useContext(Ctx);
  const marked = ctx
    ? applyMarksToHtml(
        html,
        ctx.highlightsFor(blockKey).map((h) => ({
          id: h.id,
          start: h.start,
          end: h.end,
        }))
      )
    : html;
  return (
    <div
      data-hl={ctx ? blockKey : undefined}
      className={className}
      onClick={(e) => {
        if (!ctx) return;
        const mark = (e.target as HTMLElement).closest?.("mark[data-hl-id]");
        const id = mark instanceof HTMLElement ? mark.dataset.hlId : undefined;
        if (id) {
          e.stopPropagation();
          ctx.remove(id);
        }
      }}
      dangerouslySetInnerHTML={{ __html: marked }}
    />
  );
}

interface PendingSelection {
  entries: Omit<TextHighlight, "id">[];
  /** 팝오버 위치(뷰포트 좌표). */
  x: number;
  y: number;
}

export function MeetingHighlighter({
  meetingId,
  initialHighlights,
  initialHiddenBlocks,
  children,
}: {
  meetingId: string;
  initialHighlights?: TextHighlight[];
  initialHiddenBlocks?: string[];
  children: React.ReactNode;
}) {
  const [highlights, setHighlights] = useState<TextHighlight[]>(
    initialHighlights ?? []
  );
  const [hidden, setHidden] = useState<string[]>(initialHiddenBlocks ?? []);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [saveError, setSaveError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback(
    (nextHighlights: TextHighlight[], nextHidden: string[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/meetings/${meetingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              highlights: nextHighlights,
              hiddenBlocks: nextHidden,
            }),
          });
          if (!res.ok) throw new Error();
          const json = (await res.json()) as {
            highlights?: TextHighlight[];
            hiddenBlocks?: string[];
          };
          // 서버가 병합·재앵커링한 결과로 동기화한다.
          if (Array.isArray(json.highlights)) setHighlights(json.highlights);
          if (Array.isArray(json.hiddenBlocks)) setHidden(json.hiddenBlocks);
          setSaveError(false);
        } catch {
          setSaveError(true);
        }
      }, 500);
    },
    [meetingId]
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  const add = useCallback(
    (entries: Omit<TextHighlight, "id">[]) => {
      setHighlights((prev) => {
        const next = [
          ...prev,
          ...entries.map((e) => ({ ...e, id: crypto.randomUUID() })),
        ];
        scheduleSave(next, hidden);
        return next;
      });
    },
    [scheduleSave, hidden]
  );

  const remove = useCallback(
    (id: string) => {
      setHighlights((prev) => {
        const next = prev.filter((h) => h.id !== id);
        scheduleSave(next, hidden);
        return next;
      });
    },
    [scheduleSave, hidden]
  );

  const hide = useCallback(
    (blockKeys: string[]) => {
      setHidden((prev) => {
        const next = [...new Set([...prev, ...blockKeys])];
        scheduleSave(highlights, next);
        return next;
      });
    },
    [scheduleSave, highlights]
  );

  const unhide = useCallback(
    (blockKey: string) => {
      setHidden((prev) => {
        const next = prev.filter((k) => k !== blockKey);
        scheduleSave(highlights, next);
        return next;
      });
    },
    [scheduleSave, highlights]
  );

  const highlightsFor = useCallback(
    (blockKey: string) => highlights.filter((h) => h.key === blockKey),
    [highlights]
  );
  const isHidden = useCallback(
    (blockKey: string) => hidden.includes(blockKey),
    [hidden]
  );

  const ctx = useMemo(
    () => ({ highlightsFor, isHidden, add, remove, hide, unhide }),
    [highlightsFor, isHidden, add, remove, hide, unhide]
  );

  function onMouseUp() {
    const container = containerRef.current;
    if (!container) return;
    // click 핸들러(mark 해제)와의 경합을 피해 한 틱 뒤에 검사한다.
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setPending(null);
        return;
      }
      const entries = captureSelection(container);
      if (!entries) {
        setPending(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      setPending({ entries, x: rect.left + rect.width / 2, y: rect.bottom });
    }, 0);
  }

  function clearSelection() {
    setPending(null);
    window.getSelection()?.removeAllRanges();
  }

  const popoverButton =
    "inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-neutral-800";

  return (
    <Ctx.Provider value={ctx}>
      <div ref={containerRef} onMouseUp={onMouseUp} className="relative">
        {children}
        {pending && (
          <div
            style={{
              position: "fixed",
              left: pending.x,
              top: pending.y + 8,
              transform: "translateX(-50%)",
              zIndex: 40,
            }}
            className="flex overflow-hidden rounded-full bg-neutral-900 shadow-lg"
            // mousedown 에서 처리해야 selection 이 사라지기 전에 잡는다.
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              className={popoverButton}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                add(pending.entries);
                clearSelection();
              }}
            >
              <Icon name="edit" className="size-3 text-amber-300" />
              형광펜
            </button>
            {/* 문서(doc:)는 통짜 블록이라 항목 단위 "빼기"가 없다 — 형광펜만. */}
            {pending.entries.some((en) => !en.key.startsWith("doc:")) && (
              <>
                <span className="my-1.5 w-px bg-white/20" />
                <button
                  className={popoverButton}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    hide([
                      ...new Set(
                        pending.entries
                          .map((en) => en.key)
                          .filter((k) => !k.startsWith("doc:"))
                      ),
                    ]);
                    clearSelection();
                  }}
                >
                  <Icon name="eye-off" className="size-3 text-neutral-400" />
                  공유에서 빼기
                </button>
              </>
            )}
          </div>
        )}
        {saveError && (
          <p className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full bg-red-50 px-4 py-2 text-[12px] text-red-700 shadow-lg ring-1 ring-red-600/10">
            저장에 실패했어요. 잠시 후 다시 시도해 주세요.
          </p>
        )}
      </div>
    </Ctx.Provider>
  );
}
