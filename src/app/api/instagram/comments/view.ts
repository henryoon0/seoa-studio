import {
  interactionCount,
  otherComments,
  personHistory,
  pendingComments,
  repliedComments,
  repliedToday,
  skippedComments,
  type IgCommentLedger,
  type IgLedgerComment,
  own,
} from "@/lib/instagram-comments/model";
import { localDateKey } from "@/lib/date";

function decorate(ledger: IgCommentLedger, c: IgLedgerComment) {
  // 스레드 답글이면 뿌리 댓글과 내 답글을 같이 실어 보낸다 (무슨 대화 끝에 온 말인지 보이게).
  const root = c.parentId ? own(ledger.comments, c.parentId) : undefined;
  return {
    ...c,
    profileUrl: c.username && c.username !== "(알 수 없음)" ? `https://www.instagram.com/${c.username}/` : null,
    interactionCount: interactionCount(ledger, c.username),
    totalComments: own(ledger.people, c.username)?.commentIds.length ?? 1,
    history: personHistory(ledger, c.username, c.id),
    thread: root
      ? {
          username: root.username,
          text: root.text,
          timestamp: root.timestamp,
          myReplyText: root.myReplyText,
        }
      : null,
  };
}

export function view(ledger: IgCommentLedger) {
  return {
    pending: pendingComments(ledger).map((c) => decorate(ledger, c)),
    replied: repliedComments(ledger).map((c) => decorate(ledger, c)),
    skipped: skippedComments(ledger).map((c) => decorate(ledger, c)),
    others: otherComments(ledger).map((c) => decorate(ledger, c)),
    media: ledger.media,
    repliedToday: repliedToday(ledger, localDateKey(new Date())),
    sync: ledger.sync,
  };
}
