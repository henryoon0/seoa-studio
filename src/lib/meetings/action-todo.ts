import { normalizeMeetingTag, tagFromTitle, withTagPrefix, type MeetingTag } from "./tags";
import type {
  ActionItem,
  ActionTodoLink,
  Meeting,
  MeetingAnalysis,
} from "./types";

type CreatedTodo = {
  readonly date: string;
  readonly createdAt: string;
};

export function meetingTodoTag(meeting: Meeting): MeetingTag | undefined {
  return tagFromTitle(meeting.title) ?? normalizeMeetingTag(meeting.analysis?.tag);
}

/** 할 일 끝에 붙는 회의록 링크. */
export function meetingLinkSuffix(meeting: Meeting): string {
  const title =
    meeting.title?.trim() ||
    meeting.analysis?.headline.trim() ||
    meeting.date;
  return ` · [회의록: ${title}](/meetings/${meeting.id})`;
}

export function buildActionTodoText(
  meeting: Meeting,
  action: ActionItem
): string {
  return `${withTagPrefix(action.task, meetingTodoTag(meeting))}${meetingLinkSuffix(meeting)}`;
}

export function markActionTodoCreated(
  meeting: Meeting,
  actionIndex: number,
  created: CreatedTodo
): MeetingAnalysis {
  const analysis = meeting.analysis;
  const actions = analysis?.actionItems;
  if (!analysis || !actions || !actions[actionIndex]) {
    throw new RangeError(`회의 할 일 인덱스가 범위를 벗어났습니다: ${actionIndex}`);
  }
  const todo: ActionTodoLink = {
    date: created.date,
    createdAt: created.createdAt,
    href: `/todos?date=${created.date}`,
  };
  return {
    ...analysis,
    actionItems: actions.map((action, index) =>
      index === actionIndex ? { ...action, todo } : action
    ),
  };
}
