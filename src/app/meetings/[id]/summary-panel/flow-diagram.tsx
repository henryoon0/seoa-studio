"use client";

import type { FlowStage } from "@/lib/meetings/types";

// diagram-design swimlane(Axiom × brand-green): 담당자마다 가로줄 하나, 단계는 시간 순서로
// 한 칸씩 오른쪽으로. 핵심 단계(core)만 초록, 선을 상자보다 먼저 그린다. 4px 격자.
const M = 24;
const LABEL_W = 112;
const NW = 160;
const NH = 64;
const GAP = 28;
const ROW_H = 88;
const LEGEND_H = 56;
const LINE_CHARS = 10;
const RULE_CHARS = 14;

const INK = "#0a0a0a";
const MUTED = "#525252";
const RULE = "rgba(10,10,10,0.10)";
const ACCENT = "#00BD7D";
const ACCENT_TINT = "#EBFDF4";
const UNASSIGNED = "담당 미정";

export interface DiagramStage {
  readonly stage: FlowStage;
  /** analysis.flow 안의 위치(근거 조회용). */
  readonly index: number;
  /** 근거 시각 라벨(mm:ss). */
  readonly time?: string;
}

/** 상자 폭(한글 16px 기준 11자)에 맞춰 단어 단위로 최대 두 줄. */
export function wrapLabel(text: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= LINE_CHARS || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  const out = lines.slice(0, 2).map((l) => (l.length > LINE_CHARS + 2 ? `${l.slice(0, LINE_CHARS + 1)}…` : l));
  if (lines.length > 2) out[1] = `${out[1].replace(/…$/, "").slice(0, LINE_CHARS)}…`;
  return out;
}

/** 등장 순서대로 담당자 줄을 만든다. 담당 없는 단계는 "담당 미정" 줄로. */
export function laneRows(stages: readonly DiagramStage[]): string[] {
  return [...new Set(stages.map((s) => s.stage.owner || UNASSIGNED))];
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function nodePos(col: number, row: number) {
  return { x: M + LABEL_W + col * (NW + GAP), y: M + row * ROW_H + (ROW_H - NH) / 2 };
}

function Connector({ from, to, accent }: { from: { x: number; y: number }; to: { x: number; y: number }; accent: boolean }) {
  const stroke = accent ? ACCENT : MUTED;
  const ay = from.y + NH / 2;
  const by = to.y + NH / 2;
  const midX = from.x + NW + GAP / 2;
  const d = ay === by ? `M ${from.x + NW} ${ay} H ${to.x - 4}` : `M ${from.x + NW} ${ay} H ${midX} V ${by} H ${to.x - 4}`;
  return <path d={d} fill="none" stroke={stroke} strokeWidth="1.2" markerEnd={`url(#${accent ? "sw-arrow-accent" : "sw-arrow"})`} />;
}

function pressable(item: DiagramStage, col: number, onOpen?: (item: DiagramStage) => void) {
  if (!onOpen) return {};
  const { name, owner } = item.stage;
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": `${col + 1}. ${name}, ${owner || UNASSIGNED} 원문 보기`,
    onClick: () => onOpen(item),
    onKeyDown: (event: React.KeyboardEvent) => (event.key === "Enter" || event.key === " ") && onOpen(item),
    className: "cursor-pointer outline-none [&:focus-visible>rect:nth-child(3)]:stroke-[2.4]",
  };
}

function StageNode({
  item,
  col,
  row,
  onOpen,
}: {
  item: DiagramStage;
  col: number;
  row: number;
  onOpen?: (item: DiagramStage) => void;
}) {
  const { x, y } = nodePos(col, row);
  const { stage } = item;
  const lines = wrapLabel(stage.name);
  const cx = x + NW / 2;
  const nameY = lines.length > 1 ? y + 32 : y + 38;
  return (
    <g {...pressable(item, col, onOpen)}>
      <title>{[stage.name, stage.owner, stage.rule].filter(Boolean).join(" · ")}</title>
      <rect x={x} y={y} width={NW} height={NH} rx="8" fill="#f5f5f5" />
      <rect
        x={x}
        y={y}
        width={NW}
        height={NH}
        rx="8"
        fill={stage.core ? ACCENT_TINT : "#ffffff"}
        stroke={stage.core ? ACCENT : INK}
        strokeWidth="1.2"
      />
      <text x={x + 12} y={y + 16} fill={MUTED} fontSize="11" className="tabular-nums">
        {String(col + 1).padStart(2, "0")}
        {item.time ? ` · ${item.time}` : ""}
      </text>
      {lines.map((line, i) => (
        <text key={line} x={cx} y={nameY + i * 18} fill={INK} fontSize="15" fontWeight="600" textAnchor="middle">
          {line}
        </text>
      ))}
      {stage.rule && lines.length === 1 && (
        <text x={cx} y={y + 56} fill={MUTED} fontSize="11" textAnchor="middle">
          {clip(stage.rule, RULE_CHARS)}
        </text>
      )}
    </g>
  );
}

/** 한 절차(lane)를 담당자별 가로줄 다이어그램으로 그린다. */
export function FlowDiagram({
  stages,
  onOpen,
}: {
  readonly stages: readonly DiagramStage[];
  readonly onOpen?: (item: DiagramStage) => void;
}) {
  const rows = laneRows(stages);
  const rowOf = (s: DiagramStage) => rows.indexOf(s.stage.owner || UNASSIGNED);
  const width = M * 2 + LABEL_W + stages.length * (NW + GAP) - GAP;
  const lanesH = rows.length * ROW_H;
  const height = M * 2 + lanesH + LEGEND_H;
  const legendY = M + lanesH + 24;
  return (
    <div className="overflow-x-auto rounded-2xl bg-[#f5f5f5]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full"
        style={{ minWidth: `${Math.min(width, stages.length * 120 + LABEL_W)}px`, fontFamily: "Pretendard, sans-serif" }}
        role="group"
        aria-label={stages.map((s, i) => `${i + 1}. ${s.stage.name} (${s.stage.owner || UNASSIGNED})`).join(", ")}
      >
        <defs>
          <pattern id="sw-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.9" fill="rgba(10,10,10,0.10)" />
          </pattern>
          <marker id="sw-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={MUTED} />
          </marker>
          <marker id="sw-arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={ACCENT} />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#sw-dots)" opacity="0.55" />
        {rows.map((name, r) => (
          <g key={name}>
            {r > 0 && <line x1={0} x2={width} y1={M + r * ROW_H} y2={M + r * ROW_H} stroke={RULE} />}
            <text x={M} y={M + r * ROW_H + ROW_H / 2 + 5} fill={INK} fontSize="14" fontWeight="500">
              {clip(name, 8)}
            </text>
          </g>
        ))}
        <line x1={M + LABEL_W - 16} x2={M + LABEL_W - 16} y1={M} y2={M + lanesH} stroke={RULE} />
        {stages.slice(1).map((s, i) => (
          <Connector
            key={`c${i}`}
            from={nodePos(i, rowOf(stages[i]))}
            to={nodePos(i + 1, rowOf(s))}
            accent={Boolean(s.stage.core)}
          />
        ))}
        {stages.map((s, i) => (
          <StageNode key={`${s.index}-${s.stage.name}`} item={s} col={i} row={rowOf(s)} onOpen={onOpen} />
        ))}
        <line x1={M} x2={width - M} y1={legendY - 12} y2={legendY - 12} stroke={RULE} />
        <text x={M} y={legendY + 12} fill={MUTED} fontSize="11" letterSpacing="0.08em">범례</text>
        <rect x={M + 56} y={legendY} width="28" height="16" rx="4" fill={ACCENT_TINT} stroke={ACCENT} />
        <text x={M + 92} y={legendY + 12} fill={INK} fontSize="13">핵심 단계</text>
        <rect x={M + 180} y={legendY} width="28" height="16" rx="4" fill="#ffffff" stroke={INK} />
        <text x={M + 216} y={legendY + 12} fill={INK} fontSize="13">일반 단계 · 누르면 원문</text>
      </svg>
    </div>
  );
}
