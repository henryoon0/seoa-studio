// 드래그 선택 영역을 [data-hl] 블록별 글자 오프셋으로 바꾼다.
// 회의록 형광펜과 캡처 도구가 같이 쓴다. DOM 전용(클라이언트에서만 호출).

export interface SelectionEntry {
  key: string;
  /** 블록 텍스트 안의 글자 오프셋(반열림 [start, end)). */
  start: number;
  end: number;
  exact: string;
}

export function captureSelection(container: HTMLElement): SelectionEntry[] | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const entries: SelectionEntry[] = [];
  const blocks = container.querySelectorAll<HTMLElement>("[data-hl]");
  for (const el of blocks) {
    if (!range.intersectsNode(el)) continue;
    const key = el.dataset.hl!;
    const blockRange = document.createRange();
    blockRange.selectNodeContents(el);
    // 블록 시작 → 선택 시작/끝까지의 텍스트 길이 = 오프셋.
    let start = 0;
    if (range.compareBoundaryPoints(Range.START_TO_START, blockRange) > 0) {
      const head = blockRange.cloneRange();
      head.setEnd(range.startContainer, range.startOffset);
      start = head.toString().length;
    }
    let end = blockRange.toString().length;
    if (range.compareBoundaryPoints(Range.END_TO_END, blockRange) < 0) {
      const head = blockRange.cloneRange();
      head.setEnd(range.endContainer, range.endOffset);
      end = head.toString().length;
    }
    const text = el.textContent ?? "";
    const exact = text.slice(start, end);
    if (!exact.trim()) continue;
    entries.push({ key, start, end, exact });
  }
  return entries.length ? entries : null;
}
