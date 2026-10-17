// 인스타 DM 원장 모델 — 순수 함수만. 저장은 storage.ts, API 호출은 graph.ts.
// 댓글 원장(instagram-comments/model.ts)과 같은 문법: 대화별 메시지를 병합 누적하고
// "마지막 말이 상대 것인가"로 답장 대기를 판정한다.

/** 스토리 언급(mention)·스토리 답장(reply_to). 스토리 만료 후엔 link 가 빈 문자열로 온다. */
export interface DmStoryRef {
  kind: "mention" | "reply_to";
  link: string;
}

/** 사진·영상·파일 첨부 (CDN URL — 서명이 만료될 수 있어 UI 는 로드 실패를 감춘다) */
export interface DmAttachment {
  imageUrl?: string;
  videoUrl?: string;
  fileUrl?: string;
}

export interface DmMessage {
  id: string;
  fromMe: boolean;
  text: string;
  createdTime: string;
  story?: DmStoryRef;
  attachments?: DmAttachment[];
}

/** 대화 목적 — 어떤 답장이 필요한지가 여기서 갈린다 */
export type DmPurpose = "inquiry" | "collab" | "student" | "thanks" | "other";

export const DM_PURPOSE_LABELS: Record<DmPurpose, string> = {
  inquiry: "문의",
  collab: "협업 제안",
  student: "팔로워 질문",
  thanks: "감사·응원",
  other: "기타",
};

export interface DmConversation {
  id: string;
  peerId: string;
  peerUsername: string;
  updatedTime: string;
  /** 오래된 것 → 최신 순 */
  messages: DmMessage[];
  skipped?: boolean;
  draft?: string;
  purpose?: DmPurpose;
  /** 마지막 분류 시각 — 이후에 새 인바운드가 오면 재분류 대상 */
  purposeAt?: string;
}

export interface DmLedger {
  conversations: Record<string, DmConversation>;
  sync: { lastSyncAt?: string; lastError?: string; lastSentAt?: string };
  me?: { userId: string; username: string };
}

export function createDmLedger(): DmLedger {
  return { conversations: {}, sync: {} };
}

export interface FetchedDmConversation {
  id: string;
  updatedTime: string;
  peerId: string;
  peerUsername: string;
  messages: DmMessage[];
}

/**
 * 수집분 병합. 메시지는 id 기준 합집합(재수집이 로컬 발송 기록을 지우지 않게),
 * 초안·건너뜀 같은 로컬 상태는 유지한다.
 */
export function upsertConversations(
  ledger: DmLedger,
  fetched: FetchedDmConversation[],
  me: { userId: string; username: string },
  nowIso: string
): DmLedger {
  const conversations = { ...ledger.conversations };
  for (const f of fetched) {
    const prev = conversations[f.id];
    const byId = new Map<string, DmMessage>();
    for (const m of prev?.messages ?? []) byId.set(m.id, m);
    for (const m of f.messages) {
      // 스토리가 만료되면 재수집 때 link 가 빈 값으로 온다 — 살아있을 때 저장한 링크를 지키기 위한 병합
      const old = byId.get(m.id);
      const story =
        m.story && !m.story.link && old?.story?.link ? { ...m.story, link: old.story.link } : m.story;
      byId.set(m.id, { ...m, ...(story ? { story } : {}) });
    }
    const messages = [...byId.values()].sort(
      (a, b) => Date.parse(a.createdTime) - Date.parse(b.createdTime)
    );
    conversations[f.id] = {
      id: f.id,
      peerId: f.peerId || prev?.peerId || "",
      peerUsername: f.peerUsername || prev?.peerUsername || "(알 수 없음)",
      updatedTime: f.updatedTime,
      messages,
      skipped: prev?.skipped,
      draft: prev?.draft,
      purpose: prev?.purpose,
      purposeAt: prev?.purposeAt,
    };
  }
  return {
    ...ledger,
    conversations,
    me,
    sync: { ...ledger.sync, lastSyncAt: nowIso, lastError: undefined },
  };
}

/** 텍스트 없는 메시지의 정체 라벨 — 목록 미리보기·말풍선 공용 */
export function dmMessageKindLabel(m: DmMessage): string | null {
  if (m.story) {
    if (m.story.kind === "mention")
      return m.fromMe ? "스토리에서 상대를 언급했어요" : "스토리에서 나를 언급했어요";
    return m.fromMe ? "상대 스토리에 답장했어요" : "내 스토리에 답장했어요";
  }
  if (m.attachments?.some((a) => a.imageUrl)) return "사진을 보냈어요";
  if (m.attachments?.some((a) => a.videoUrl)) return "영상을 보냈어요";
  if (m.attachments?.length) return "파일을 보냈어요";
  return null;
}

export function lastMessage(c: DmConversation): DmMessage | null {
  return c.messages[c.messages.length - 1] ?? null;
}

/** 마지막 말이 상대 것이면 답장 대기 */
export function needsReply(c: DmConversation): boolean {
  const last = lastMessage(c);
  return !!last && !last.fromMe;
}

/** 메타 정책: 상대의 마지막 메시지 후 24시간 안에만 API 발송 가능 */
export const DM_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function canReplyNow(c: DmConversation, nowMs: number): boolean {
  const lastInbound = [...c.messages].reverse().find((m) => !m.fromMe);
  if (!lastInbound) return false;
  return nowMs - Date.parse(lastInbound.createdTime) < DM_REPLY_WINDOW_MS;
}

export function lastInboundMessage(c: DmConversation): DmMessage | null {
  return [...c.messages].reverse().find((m) => !m.fromMe) ?? null;
}

/** 24시간 응답 창이 닫히는 시각. 인바운드가 없으면 null. */
export function windowClosesAt(c: DmConversation): string | null {
  const inbound = lastInboundMessage(c);
  if (!inbound) return null;
  return new Date(Date.parse(inbound.createdTime) + DM_REPLY_WINDOW_MS).toISOString();
}

/** 분류가 없거나, 분류 이후 새 인바운드가 온 답장 대기 대화 */
export function needsClassification(c: DmConversation): boolean {
  if (!needsReply(c) || c.skipped) return false;
  if (!c.purpose || !c.purposeAt) return true;
  const inbound = lastInboundMessage(c);
  return !!inbound && Date.parse(inbound.createdTime) > Date.parse(c.purposeAt);
}

/** 돈·관계가 걸린 순서. 미분류는 문의·협업 다음에 둔다 (놓치면 안 되니 위쪽). */
const PURPOSE_PRIORITY: Record<DmPurpose, number> = {
  inquiry: 0,
  collab: 1,
  student: 3,
  thanks: 4,
  other: 5,
};

export function dmPurposePriority(purpose: DmPurpose | undefined): number {
  return purpose ? PURPOSE_PRIORITY[purpose] : 2;
}

function sorted(list: DmConversation[]): DmConversation[] {
  return [...list].sort((a, b) => Date.parse(b.updatedTime) - Date.parse(a.updatedTime));
}

/**
 * 답장 대기 정렬: 지금 보낼 수 있는 것(24시간 창 안) → 목적 우선순위 → 창 마감 임박 순.
 * 창이 닫힌 대화는 아래로 (앱에서 답할 것들이라 급한 축이 다르다).
 */
export function pendingConversations(ledger: DmLedger): DmConversation[] {
  const list = Object.values(ledger.conversations).filter((c) => needsReply(c) && !c.skipped);
  return list.sort((a, b) => {
    const nowMs = Date.now();
    const aCan = canReplyNow(a, nowMs) ? 0 : 1;
    const bCan = canReplyNow(b, nowMs) ? 0 : 1;
    if (aCan !== bCan) return aCan - bCan;
    const aP = dmPurposePriority(a.purpose);
    const bP = dmPurposePriority(b.purpose);
    if (aP !== bP) return aP - bP;
    const aW = windowClosesAt(a);
    const bW = windowClosesAt(b);
    if (aW && bW && aW !== bW) return Date.parse(aW) - Date.parse(bW);
    return Date.parse(b.updatedTime) - Date.parse(a.updatedTime);
  });
}

export function repliedConversations(ledger: DmLedger): DmConversation[] {
  return sorted(
    Object.values(ledger.conversations).filter((c) => !needsReply(c) && !c.skipped && c.messages.length > 0)
  );
}

export function skippedConversations(ledger: DmLedger): DmConversation[] {
  return sorted(Object.values(ledger.conversations).filter((c) => !!c.skipped));
}

export function setDmPurpose(
  ledger: DmLedger,
  conversationId: string,
  purpose: DmPurpose,
  atIso: string
): DmLedger {
  const c = ledger.conversations[conversationId];
  if (!c) return ledger;
  return {
    ...ledger,
    conversations: { ...ledger.conversations, [conversationId]: { ...c, purpose, purposeAt: atIso } },
  };
}

export function setDmDraft(ledger: DmLedger, conversationId: string, draft: string): DmLedger {
  const c = ledger.conversations[conversationId];
  if (!c) return ledger;
  return { ...ledger, conversations: { ...ledger.conversations, [conversationId]: { ...c, draft } } };
}

export function setDmSkipped(ledger: DmLedger, conversationId: string, skipped: boolean): DmLedger {
  const c = ledger.conversations[conversationId];
  if (!c) return ledger;
  return {
    ...ledger,
    conversations: { ...ledger.conversations, [conversationId]: { ...c, skipped: skipped || undefined } },
  };
}

/**
 * 발송 성공 직후 로컬 반영. 다음 동기화 때 진짜 메시지 id 로 다시 수집돼도
 * 합집합 병합이라 중복 표시는 다음 수집의 updatedTime 갱신으로 자연 정리된다.
 */
export function markDmSent(ledger: DmLedger, conversationId: string, text: string, nowIso: string): DmLedger {
  const c = ledger.conversations[conversationId];
  if (!c) return ledger;
  const sent: DmMessage = { id: `local-${nowIso}-${conversationId}`, fromMe: true, text, createdTime: nowIso };
  return {
    ...ledger,
    conversations: {
      ...ledger.conversations,
      [conversationId]: { ...c, messages: [...c.messages, sent], updatedTime: nowIso, draft: undefined },
    },
    sync: { ...ledger.sync, lastSentAt: nowIso },
  };
}

/** 발송 최소 간격 가드 (댓글과 같은 계정 안전 규칙) */
export function dmSendWaitMs(lastSentAt: string | undefined, nowMs: number, minGapMs: number): number {
  if (!lastSentAt) return 0;
  const elapsed = nowMs - Date.parse(lastSentAt);
  return elapsed >= minGapMs ? 0 : minGapMs - elapsed;
}
