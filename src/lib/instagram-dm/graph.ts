// 인스타 DM Graph API (Instagram Login 경로, graph.instagram.com).
// 읽기(/me/conversations)는 2026-08-04 실측으로, 발송(/me/messages)은 공식 문서
// (instagram-platform/instagram-api-with-instagram-login/messaging-api)로 확인한 것만 쓴다.
// 토큰은 댓글 작업대와 같은 것을 공유한다 (data/instagram-comments/token.json).
import { IG_GRAPH_BASE, igFetch } from "../instagram-comments/graph";
import type { DmMessage, FetchedDmConversation } from "./model";

interface RawParticipant {
  id: string;
  username?: string;
}

interface RawMessage {
  id: string;
  from?: RawParticipant;
  message?: string;
  created_time: string;
  // 스토리 언급/답장. 스토리가 만료(24시간)되면 link 가 빈 문자열로 온다 (2026-08-04 실측).
  story?: {
    mention?: { link?: string };
    reply_to?: { link?: string };
  };
  attachments?: {
    data?: {
      image_data?: { url?: string; preview_url?: string };
      video_data?: { url?: string; preview_url?: string };
      file_url?: string;
    }[];
  };
}

interface RawConversation {
  id: string;
  updated_time: string;
  participants?: { data?: RawParticipant[] };
  messages?: { data?: RawMessage[] };
}

/**
 * 대화 목록 + 각 대화의 최근 메시지를 한 번에 조회한다 (중첩 필드로 왕복 절약).
 * 페이지를 따라가되, 마지막 동기화 이전에 멈춘 대화가 나오면 끊는다 — updated_time 은
 * 새 메시지가 올 때만 갱신되므로 그보다 오래된 대화엔 놓친 메시지가 없다.
 * (2026-08-04 사고: 첫 페이지 20개만 보다가, 동기화 사이에 20위 밖으로 밀린 DM 을 영영 놓침. 실측 대화 200+개.)
 */
export async function fetchConversations(
  token: string,
  me: { userId: string; username: string },
  options: { limit?: number; messagesPerConversation?: number; sinceIso?: string; maxPages?: number } = {}
): Promise<FetchedDmConversation[]> {
  const { limit = 25, messagesPerConversation = 20, sinceIso, maxPages = 8 } = options;
  // 여유 1시간: 동기화 시각과 메시지 도착 시각의 경계 오차를 흡수한다
  const cutoffMs = sinceIso ? Date.parse(sinceIso) - 60 * 60 * 1000 : null;
  const fields = `id,updated_time,participants,messages.limit(${messagesPerConversation}){id,from,message,created_time,story,attachments{image_data,video_data,file_url}}`;

  const raw: RawConversation[] = [];
  // 토큰은 URL 이 아니라 헤더로 — URL 은 에러 메시지(sync.lastError, 화면 표시)에 섞일 수 있다 (2026-08-04 보안 리뷰).
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  let url = `${IG_GRAPH_BASE}/me/conversations?platform=instagram&fields=${encodeURIComponent(fields)}&limit=${limit}`;
  for (let page = 0; page < maxPages && url; page++) {
    const data = (await igFetch(url, auth)) as { data?: RawConversation[]; paging?: { next?: string } };
    const batch = data.data ?? [];
    raw.push(...batch);
    const oldest = batch[batch.length - 1];
    if (!oldest || (cutoffMs !== null && Date.parse(oldest.updated_time) < cutoffMs)) break;
    // 방어: API 가 next 에 토큰을 되돌려줘도 지우고 헤더로만 인증한다
    url = (data.paging?.next ?? "").replace(/([?&])access_token=[^&]*&?/, "$1").replace(/[?&]$/, "");
  }

  return raw.map((c) => {
    const peer = (c.participants?.data ?? []).find(
      (p) => p.id !== me.userId && p.username !== me.username
    );
    const messages: DmMessage[] = (c.messages?.data ?? []).map((m) => {
      const story = m.story?.mention
        ? { kind: "mention" as const, link: m.story.mention.link ?? "" }
        : m.story?.reply_to
          ? { kind: "reply_to" as const, link: m.story.reply_to.link ?? "" }
          : undefined;
      const attachments = (m.attachments?.data ?? [])
        .map((a) => ({
          imageUrl: a.image_data?.url || a.image_data?.preview_url || undefined,
          videoUrl: a.video_data?.url || a.video_data?.preview_url || undefined,
          fileUrl: a.file_url || undefined,
        }))
        .filter((a) => a.imageUrl || a.videoUrl || a.fileUrl);
      return {
        id: m.id,
        fromMe: m.from?.id === me.userId || m.from?.username === me.username,
        text: m.message ?? "",
        createdTime: m.created_time,
        ...(story ? { story } : {}),
        ...(attachments.length ? { attachments } : {}),
      };
    });
    return {
      id: c.id,
      updatedTime: c.updated_time,
      peerId: peer?.id ?? "",
      peerUsername: peer?.username ?? "(알 수 없음)",
      messages,
    };
  });
}

/**
 * Private Reply — 댓글 단 사람에게 DM 1건 발송. recipient 를 user id 대신
 * comment_id 로 지정하는 공식 경로 (instagram-platform messaging-api, 댓글 후 7일 안,
 * 시간당 750콜 한도는 docs/research/instagram-comments-api.md). 자동화 엔진 전용:
 * 계정 주인이 켠 규칙에 걸린 댓글에만 호출된다.
 */
export async function sendPrivateReply(
  token: string,
  commentId: string,
  text: string,
  signal?: AbortSignal
): Promise<{ message_id?: string }> {
  return (await igFetch(`${IG_GRAPH_BASE}/me/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
    signal,
  })) as { message_id?: string };
}

/**
 * Private Reply + 퀵 리플라이 버튼 — 자료 잠금의 1단 DM. 버튼을 누르면 버튼 문구가
 * 상대의 메시지로 대화에 남아, 웹훅 없이 폴링으로 클릭을 감지할 수 있다.
 * (버튼 문구는 메타 제한 20자 — sanitize 가 자른다.)
 */
export async function sendGatePrivateReply(
  token: string,
  commentId: string,
  text: string,
  buttonLabel: string,
  signal?: AbortSignal
): Promise<{ message_id?: string }> {
  return (await igFetch(`${IG_GRAPH_BASE}/me/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: {
        text,
        quick_replies: [{ content_type: "text", title: buttonLabel, payload: "inbox-gate" }],
      },
    }),
    signal,
  })) as { message_id?: string };
}

/**
 * 메시징 상대 프로필 — 팔로우 여부 확인 (2026-08-13 실측: 우리 토큰으로
 * is_user_follow_business 정상 반환). 상대가 먼저 메시지/버튼 상호작용을 했을 때만 조회된다.
 */
export async function fetchPeerProfile(
  token: string,
  peerId: string,
  signal?: AbortSignal
): Promise<{ username?: string; is_user_follow_business?: boolean }> {
  return (await igFetch(
    `${IG_GRAPH_BASE}/${peerId}?fields=username,is_user_follow_business`,
    { headers: { Authorization: `Bearer ${token}` }, signal }
  )) as { username?: string; is_user_follow_business?: boolean };
}

/**
 * DM 1건 발송. 계정 주인이 화면에서 [보내기]를 눌렀을 때, 또는 자동화 관문(자료 잠금)을
 * 통과한 상대에게 엔진이 자료를 전할 때 호출된다.
 * 메타 정책상 상대의 마지막 메시지 후 24시간 안에만 성공한다 (밖이면 API 가 거부) —
 * 관문 클릭 직후는 항상 이 창 안이다.
 */
export async function sendDm(
  token: string,
  recipientId: string,
  text: string,
  signal?: AbortSignal
): Promise<{ message_id?: string }> {
  return (await igFetch(`${IG_GRAPH_BASE}/me/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    signal,
  })) as { message_id?: string };
}
