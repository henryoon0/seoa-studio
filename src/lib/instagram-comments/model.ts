// 인스타 댓글 검토함 — 순수 상태 로직 (wayfinder #65)
// 원장(ledger)은 디스크 JSON 1개. 수집·발송·건너뛰기가 전부 이 모델을 거친다.
import { pruneSentTimes } from "./queue-model";

export interface IgMedia {
  id: string;
  captionFirstLine: string;
  permalink: string;
  timestamp: string;
  commentsCount: number;
  /** IMAGE | VIDEO | CAROUSEL_ALBUM. 이미지는 프록시(/post-image)로 표시. */
  mediaType?: string;
}

export interface IgLedgerComment {
  id: string;
  mediaId: string;
  username: string;
  /** 작성자 IG user id (from{id}). 내 답글 판정·본인 제외에 username 대신 이걸 쓴다. */
  authorId?: string;
  text: string;
  timestamp: string;
  parentId?: string;
  /** 내 계정이 이 댓글에 답글을 달았는가 (parent_id·@멘션·발송 기록으로 판정) */
  repliedByMe: boolean;
  myReplyId?: string;
  myReplyText?: string;
  repliedAt?: string;
  skipped?: boolean;
  /** 실제로 보낼 글. henry 가 고친 글도 여기에 산다. */
  draft?: string;
  /** AI 후보 3개 (짧게 · 따뜻하게 · 안내 포함). 고르면 draft 로 들어간다. */
  draftOptions?: DraftOption[];
}

export type DraftTone = "short" | "warm" | "guide";

export interface DraftOption {
  tone: DraftTone;
  text: string;
}

export interface IgPerson {
  username: string;
  firstSeenAt: string;
  commentIds: string[];
}

export interface IgSyncState {
  lastSyncAt?: string;
  lastError?: string;
  /** 마지막 동기화가 댓글을 끝까지 읽지 못했으면 그 안내 문구. 끝까지 읽으면 지운다. */
  incomplete?: string;
  lastSentAt?: string;
  /** 지난 1시간 발송 시각 (시간당 상한 판정용, queue-model.pruneSentTimes 로 잘린다) */
  recentSentAt?: string[];
  myUsername?: string;
}

export interface IgCommentLedger {
  media: Record<string, IgMedia>;
  comments: Record<string, IgLedgerComment>;
  people: Record<string, IgPerson>;
  sync: IgSyncState;
  /**
   * 내가 쓴 댓글 id 들. 내 댓글 자체는 큐 대상이 아니라 comments 에 저장하지 않지만,
   * "이 답글의 부모가 내 댓글인가"(= 나에게 온 말인가) 를 판정하려면 id 는 알아야 한다.
   */
  myCommentIds?: string[];
}

export function createLedger(): IgCommentLedger {
  return { media: dict(), comments: dict(), people: dict(), sync: {}, myCommentIds: [] };
}

// 원장 사전은 인스타가 준 사용자명·id 를 키로 쓴다. 사용자명이 `__proto__`·`constructor` 면
// 보통 객체에선 상속 속성이 읽히고(`__proto__` 대입은 프로토타입을 바꾼다) 동기화가 통째로 깨진다.
// 그래서 쓰기는 프로토타입 없는 사전에, 읽기는 own() 으로 자기 속성만 본다.

/** 프로토타입 없는 사전. 주어진 사전의 자기 속성을 복사한다. */
export function dict<T>(src?: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, src);
}

/** 사전에서 자기 속성만 읽는다. 상속 속성(constructor 등)은 없는 것으로 본다. */
export function own<T>(rec: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined;
}

export interface FetchedComment {
  id: string;
  mediaId: string;
  /** 표시용 실제 아이디 (from.username). 타인은 username 이 null 이라 from 을 쓴다. */
  username: string;
  /** 작성자 IG user id (from.id) */
  authorId: string;
  text: string;
  timestamp: string;
  parentId?: string;
}

/** 아이디 끝에 붙은 문장부호(마침표)를 떼고 소문자로. "@foo.bar." → "foo.bar" */
function normalizeMention(raw: string): string {
  return raw.replace(/\.+$/, "").toLowerCase();
}

/**
 * 텍스트에 등장하는 모든 @멘션 아이디. 맨 앞만 보면 "감사해요 @aicoffeechat 님"처럼
 * 중간에서 나를 부르는 말을 놓친다 (놓치면 화면에서 사라진다).
 */
function mentionedUsernames(text: string): string[] {
  return [...text.matchAll(/@([A-Za-z0-9_.]+)/g)].map((m) => normalizeMention(m[1]));
}

interface DetectedReply {
  id: string;
  text: string;
  timestamp: string;
}

/** a 가 b 보다 앞선 시각인가. IG 포맷(+0000)과 ISO(Z)가 섞여 있어 파싱해서 비교한다. */
function isBefore(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return ta < tb;
}

/**
 * 원댓글 id → 내가 단 답글(있으면) 을 복원한다.
 * Instagram Login 경로에선 내 답글도 최상위 댓글로 내려오고(parent_id 로 원댓글 지목),
 * nested replies[] 의 from 은 채워지지 않는다. 그래서 내 댓글(authorId=me)들의
 * parent_id 로 "원댓글 → 내 답글" 관계를 잇는다. 여러 개면 최신 답글.
 */
function computeMyReplies(
  fetched: FetchedComment[],
  myUserId: string,
  taken: ReadonlyMap<string, string>,
  heldRoots: ReadonlySet<string> = new Set()
): Map<string, DetectedReply> {
  const map = new Map<string, DetectedReply>();
  const byId = new Map<string, FetchedComment>();
  for (const c of fetched) {
    if (c.authorId === myUserId) continue;
    byId.set(c.id, c);
  }
  const assign = (commentId: string, reply: DetectedReply) => {
    // 내 답글보다 나중에 달린 댓글에는 배정하지 않는다 (시각이 뒤섞인 데이터 방어).
    const target = byId.get(commentId);
    if (target && isBefore(reply.timestamp, target.timestamp)) return;
    // 이미 다른 댓글(예: 대댓글)의 답글로 기록된 번호는 다시 배정하지 않는다.
    const owner = taken.get(reply.id);
    if (owner && owner !== commentId) return;
    const ex = map.get(commentId);
    if (!ex || ex.timestamp < reply.timestamp) map.set(commentId, reply);
  };
  for (const c of fetched) {
    if (c.authorId !== myUserId) continue;
    const reply: DetectedReply = { id: c.id, text: c.text, timestamp: c.timestamp };
    // 원댓글 관계(parent_id)로만 잇는다. 사용자명(@멘션)만으로 잇으면 같은 사람이
    // 다른 게시물에 남긴 댓글까지 "답함"으로 덮인다.
    // 발송 결과를 아직 모르는 항목이 있는 스레드의 답글은 그 항목 것일 수 있어 배정을 보류한다.
    if (c.parentId && !heldRoots.has(c.parentId)) assign(c.parentId, reply);
  }
  return map;
}

/** 수집 결과를 원장에 병합. 기존 draft/skipped/발송 기록은 보존한다. */
export function upsertFetched(
  ledger: IgCommentLedger,
  media: IgMedia[],
  fetched: FetchedComment[],
  myUsername: string,
  myUserId: string,
  now: string,
  /** 대기줄에 기록된 답글 번호 → 그 답글을 보낸 댓글 id. 원장의 myReplyId 와 함께 자동 배정에서 뺀다. */
  queueReplies: ReadonlyMap<string, string> = new Map(),
  /** 발송 중이거나 시도 뒤 결과가 확정되지 않은 댓글 id. 그 스레드의 우리 답글은 자동 배정하지 않는다. */
  heldCommentIds: ReadonlySet<string> = new Set()
): IgCommentLedger {
  const myCommentIds = new Set(ledger.myCommentIds ?? []);
  for (const c of fetched) if (c.authorId === myUserId) myCommentIds.add(c.id);
  const next: IgCommentLedger = {
    media: dict(ledger.media),
    comments: dict(ledger.comments),
    people: dict(ledger.people),
    sync: { ...ledger.sync, lastSyncAt: now, lastError: undefined, myUsername },
    myCommentIds: [...myCommentIds],
  };
  for (const m of media) next.media[m.id] = m;
  const taken = new Map(queueReplies);
  for (const c of Object.values(ledger.comments)) if (c.myReplyId) taken.set(c.myReplyId, c.id);
  const fetchedById = new Map(fetched.map((c) => [c.id, c]));
  const heldRoots = new Set<string>();
  for (const id of heldCommentIds) {
    const known = fetchedById.get(id) ?? own(ledger.comments, id);
    heldRoots.add(known?.parentId ?? id);
  }
  const myReplies = computeMyReplies(fetched, myUserId, taken, heldRoots);
  for (const c of fetched) {
    if (c.authorId === myUserId) continue; // 내 셀프 댓글·답글은 큐 대상 아님
    const prev = own(next.comments, c.id);
    const detected = myReplies.get(c.id);
    // 이전에 저장된 "답함" 기록이 댓글보다 먼저 달린 답글이면 잘못 이어붙은 것이다
    // (과거 @멘션 팬아웃 버그). 그런 기록은 여기서 털어내고 다시 대기줄로 보낸다.
    const stale = Boolean(prev?.repliedAt && isBefore(prev.repliedAt, c.timestamp));
    const kept = prev && !stale ? prev : undefined;
    const repliedByMe = Boolean(detected) || Boolean(kept?.repliedByMe);
    next.comments[c.id] = {
      id: c.id,
      mediaId: c.mediaId,
      username: c.username,
      authorId: c.authorId,
      text: c.text,
      timestamp: c.timestamp,
      parentId: c.parentId,
      repliedByMe,
      myReplyId: kept?.myReplyId ?? detected?.id,
      myReplyText: kept?.myReplyText ?? detected?.text,
      repliedAt: kept?.repliedAt ?? detected?.timestamp,
      skipped: prev?.skipped,
      draft: prev?.draft,
      draftOptions: prev?.draftOptions,
    };
    const person = own(next.people, c.username) ?? {
      username: c.username,
      firstSeenAt: c.timestamp,
      commentIds: [],
    };
    if (!person.commentIds.includes(c.id)) {
      next.people[c.username] = {
        ...person,
        firstSeenAt: person.firstSeenAt < c.timestamp ? person.firstSeenAt : c.timestamp,
        commentIds: [...person.commentIds, c.id],
      };
    }
  }
  return next;
}

/**
 * 이 댓글이 답글 큐(남은 답글)에 올라올, "나에게 온 말"인가.
 * - 최상위 댓글: 항상 대상.
 * - 스레드 답글(대댓글): 나를 @멘션했거나(위치 무관), 내 댓글에 달렸거나,
 *   멘션 없이 내가 답글을 단 스레드에 달린 것.
 * 여기서 false 인 대댓글은 버리는 게 아니라 otherComments("다른 대화")로 간다.
 * 어떤 댓글도 네 목록(남은/완료/건너뜀/다른 대화) 밖으로 새면 안 된다 — 그게 "안 보인다" 사고의 뿌리다.
 */
export function isForMe(ledger: IgCommentLedger, c: IgLedgerComment): boolean {
  if (!c.parentId) return true;
  const me = ledger.sync.myUsername?.toLowerCase();
  const mentions = mentionedUsernames(c.text);
  if (me && mentions.includes(me)) return true;
  // 내가 쓴 최상위 댓글에 달린 답글. 내 댓글은 comments 에 없어서 아래 부모 조회로는 못 잡는다.
  if ((ledger.myCommentIds ?? []).includes(c.parentId)) return true;
  const parent = own(ledger.comments, c.parentId);
  if (!parent) return false; // 뿌리를 모르는 답글 — 판단 대신 "다른 대화"에 세워 눈에는 보이게 둔다
  if (mentions.length > 0) return false; // 다른 사람을 콕 집어 부른 대댓글 (@친구 부럽다)
  return Boolean(parent.repliedByMe);
}

/** 답글 대기 큐: 내게 온 것 + 내가 아직 답 안 함 + 건너뛰지 않음. 최신순. */
export function pendingComments(ledger: IgCommentLedger): IgLedgerComment[] {
  return Object.values(ledger.comments)
    .filter((c) => isForMe(ledger, c) && !c.repliedByMe && !c.skipped)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

/** 답글 완료: 내게 온 것 + 내가 답함. 답한 시각(없으면 댓글 시각) 최신순. */
export function repliedComments(ledger: IgCommentLedger): IgLedgerComment[] {
  return Object.values(ledger.comments)
    .filter((c) => isForMe(ledger, c) && c.repliedByMe)
    .sort((a, b) => ((a.repliedAt ?? a.timestamp) < (b.repliedAt ?? b.timestamp) ? 1 : -1));
}

/** 건너뛴: 내게 온 것 + 답 안 함 + 건너뜀. 최신순. */
export function skippedComments(ledger: IgCommentLedger): IgLedgerComment[] {
  return Object.values(ledger.comments)
    .filter((c) => isForMe(ledger, c) && !c.repliedByMe && c.skipped)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

/**
 * 다른 대화: 내 게시물에 달렸지만 나에게 온 말은 아닌 대댓글 (댓글끼리 주고받는 말).
 * 답할 일은 없어도 화면에서 사라지면 안 되므로 여기 모은다. 최신순.
 */
export function otherComments(ledger: IgCommentLedger): IgLedgerComment[] {
  return Object.values(ledger.comments)
    .filter((c) => !isForMe(ledger, c))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

/**
 * 실제로 답글을 POST 할 대상 id.
 * 인스타는 최상위 댓글에만 답글을 받는다(대댓글에 걸면 어차피 최상위 밑으로 붙는다,
 * docs/research/instagram-comments-api.md). 스레드 답글에 답할 땐 스레드 뿌리로 보낸다.
 */
export function replyTargetId(ledger: IgCommentLedger, commentId: string): string {
  return own(ledger.comments, commentId)?.parentId ?? commentId;
}

export function repliedToday(ledger: IgCommentLedger, todayPrefix: string): number {
  return Object.values(ledger.comments).filter(
    (c) => c.repliedByMe && c.repliedAt?.startsWith(todayPrefix)
  ).length;
}

/** 발송 간격 가드. 남은 대기 ms 를 돌려준다 (0이면 발송 가능). */
export function sendWaitMs(lastSentAt: string | undefined, nowMs: number, minGapMs: number): number {
  if (!lastSentAt) return 0;
  const elapsed = nowMs - Date.parse(lastSentAt);
  return Math.max(0, minGapMs - elapsed);
}

export function markSent(
  ledger: IgCommentLedger,
  commentId: string,
  replyId: string,
  message: string,
  now: string
): IgCommentLedger {
  const c = own(ledger.comments, commentId);
  if (!c) return ledger;
  // 같은 답글 번호가 다른 댓글에 잘못 배정돼 있으면(발송 중 동기화) 그 배정을 지운다.
  const comments = dict(ledger.comments);
  for (const other of Object.values(ledger.comments)) {
    if (other.id === commentId || other.myReplyId !== replyId) continue;
    comments[other.id] = { ...other, repliedByMe: false, myReplyId: undefined, myReplyText: undefined, repliedAt: undefined };
  }
  return {
    ...ledger,
    comments: {
      ...comments,
      [commentId]: {
        ...c,
        repliedByMe: true,
        myReplyId: replyId,
        myReplyText: message,
        repliedAt: now,
      },
    },
  };
}

/**
 * 발송 직전에 간격·시간당 상한 자리를 예약한다. 결과를 모르는 발송(unknown)도
 * 실제로 달렸을 수 있으니, 응답을 기다리지 않고 요청 전에 센다.
 */
export function reserveSendSlot(ledger: IgCommentLedger, now: string): IgCommentLedger {
  return {
    ...ledger,
    sync: {
      ...ledger.sync,
      lastSentAt: now,
      recentSentAt: pruneSentTimes([...(ledger.sync.recentSentAt ?? []), now], Date.parse(now)),
    },
  };
}

export function setSkipped(ledger: IgCommentLedger, commentId: string, skipped: boolean): IgCommentLedger {
  const c = own(ledger.comments, commentId);
  if (!c) return ledger;
  return { ...ledger, comments: { ...ledger.comments, [commentId]: { ...c, skipped } } };
}

export function setDraft(ledger: IgCommentLedger, commentId: string, draft: string): IgCommentLedger {
  const c = own(ledger.comments, commentId);
  if (!c) return ledger;
  return { ...ledger, comments: { ...ledger.comments, [commentId]: { ...c, draft } } };
}

/**
 * AI 후보 3개 저장. 보낼 글(draft)이 비어 있으면 따뜻하게 버전으로 채운다.
 * henry 가 고친 글은 지키고, 지시로 다시 쓴 경우(replaceDraft)만 바꾼다.
 */
export function setDraftOptions(
  ledger: IgCommentLedger,
  commentId: string,
  options: DraftOption[],
  opts: { replaceDraft?: boolean } = {}
): IgCommentLedger {
  const c = own(ledger.comments, commentId);
  if (!c || options.length === 0) return ledger;
  const preferred = options.find((o) => o.tone === "warm") ?? options[0];
  const draft = opts.replaceDraft || !c.draft?.trim() ? preferred.text : c.draft;
  return { ...ledger, comments: { ...ledger.comments, [commentId]: { ...c, draftOptions: options, draft } } };
}

/** 후보 3개가 아직 없는 남은 답글 — 화면을 열 때 자동으로 채울 대상 */
export function missingDraftOptions(ledger: IgCommentLedger): IgLedgerComment[] {
  return pendingComments(ledger).filter((c) => !c.draftOptions || c.draftOptions.length === 0);
}

/** 이 사람과의 과거 교류 횟수 (내가 답글 단 이 사람 댓글 수) — #67의 씨앗 */
export function interactionCount(ledger: IgCommentLedger, username: string): number {
  const person = own(ledger.people, username);
  if (!person) return 0;
  return person.commentIds.filter((id) => own(ledger.comments, id)?.repliedByMe).length;
}

// ── 교류 이력 카드 (#67) ──────────────────────────────────

export interface PersonHistoryItem {
  id: string;
  mediaId: string;
  text: string;
  timestamp: string;
  myReplyText?: string;
  repliedAt?: string;
}

export interface PersonHistory {
  /** 내가 답글 단 과거 교류 횟수 (현재 댓글 제외) */
  interactionCount: number;
  /** 이 사람의 과거 댓글 + 내 답글 타임라인, 최신순 (현재 댓글 제외) */
  items: PersonHistoryItem[];
  /** 카드 접힌 상태에 상시 노출할 한 줄 (없으면 첫 교류) */
  summary: string;
}

/**
 * 작성자 교류 이력 — 우리 원장만으로 결정론적으로 만든다 (LLM 없음).
 * excludeCommentId = 지금 보고 있는 댓글 (이력에서 제외).
 */
export function personHistory(
  ledger: IgCommentLedger,
  username: string,
  excludeCommentId?: string
): PersonHistory {
  const person = own(ledger.people, username);
  const items: PersonHistoryItem[] = (person?.commentIds ?? [])
    .filter((id) => id !== excludeCommentId)
    .map((id) => own(ledger.comments, id))
    .filter((c): c is IgLedgerComment => Boolean(c))
    .map((c) => ({
      id: c.id,
      mediaId: c.mediaId,
      text: c.text,
      timestamp: c.timestamp,
      myReplyText: c.myReplyText,
      repliedAt: c.repliedAt,
    }))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const replied = items.filter((i) => i.myReplyText);
  const count = items.filter(
    (i) => own(ledger.comments, i.id)?.repliedByMe
  ).length;
  const latest = replied[0] ?? items[0];
  const summary =
    items.length === 0
      ? "첫 교류예요"
      : `이전 교류 ${count}회 · ${latest.timestamp.slice(5, 10).replace("-", "/")} "${truncate(latest.text, 24)}"`;
  return { interactionCount: count, items, summary };
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// ── 답글 보이스 예시 자동 수확 (#61·#66) ──────────────────

/**
 * 원장에 쌓인 henry 의 실제 과거 답글을 톤 예시로 수확한다.
 * 한 마디짜리("감사합니다🙏")는 톤 근거가 안 되므로 제외하고, 중복 제거 후 최신순 max 개.
 */
export function harvestToneExamples(ledger: IgCommentLedger, max = 8): { comment: string; reply: string }[] {
  const seen = new Set<string>();
  return Object.values(ledger.comments)
    .filter((c) => c.repliedByMe && c.myReplyText)
    .sort((a, b) => ((a.repliedAt ?? a.timestamp) < (b.repliedAt ?? b.timestamp) ? 1 : -1))
    .filter((c) => {
      const reply = (c.myReplyText ?? "").replace(/^@\S+\s*/, "").trim();
      // 멘션 뗀 본문이 12자 미만이면 한 마디로 판정
      if (reply.length < 12) return false;
      if (seen.has(reply)) return false;
      seen.add(reply);
      return true;
    })
    .slice(0, max)
    .map((c) => ({ comment: c.text, reply: (c.myReplyText ?? "").trim() }));
}
