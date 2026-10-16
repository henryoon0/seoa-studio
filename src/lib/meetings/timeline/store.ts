import { rm } from "node:fs/promises";
import path from "node:path";
import { readJsonAt, writeJsonAt } from "@/lib/json-store";
import type { TimelineItem } from "./minutes";

export interface TimelineState {
  meetingId: string;
  status: "idle" | "running" | "done" | "error";
  items: TimelineItem[];
  totalMinutes: number;
  /** 배치 하나가 끝날 때마다 찍는다 — 고아 판정용 */
  heartbeatAt?: string;
  error?: string;
}

function fileFor(id: string): string {
  const dir = process.env.MEETINGS_TIMELINE_DIR ?? path.join(process.cwd(), "data", "meetings", "timeline");
  return path.join(dir, `${path.basename(id)}.json`);
}

export function emptyTimeline(meetingId: string): TimelineState {
  return { meetingId, status: "idle", items: [], totalMinutes: 0 };
}

export async function readTimeline(id: string): Promise<TimelineState> {
  return readJsonAt<TimelineState>(fileFor(id), emptyTimeline(id));
}

export async function writeTimeline(state: TimelineState): Promise<void> {
  await writeJsonAt(fileFor(state.meetingId), state);
}

/** 회의 삭제·발화 삭제 때 부른다 — 옛 전사본으로 만든 타임라인을 남기지 않는다. */
export async function deleteTimeline(id: string): Promise<void> {
  await rm(fileFor(id), { force: true });
}
