// 회의 문서 템플릿 시스템 — 전사·분석을 재료로 목적별 문서(마크다운)를 생성한다.
// 레퍼런스 UX: 문서 탭 드롭다운에서 템플릿을 고르면 그 자리에서 문서가 생긴다.
//
// 백그라운드 잡 계약(fire-and-forget 3종 세트):
//   ① 고아(generating 인데 안 도는) → 폴링 GET·sweep 이 maybeResumeDocs 로 재개
//   ② 문서 단위 저장(성공 시 한 번에 content 채움 + job 제거) — 부분 저장 자연 충족
//   ③ runClaudeCLI 하드 타임아웃(DOC_TIMEOUT_MS)
//
// 긴 문서라 effort 는 high 명시(CLAUDE.md ④: 명시하지 않으면 medium 캡에 깎인다).

import { runClaudeCLI } from "@/lib/ai/claude-cli";
import { isRunning, runPhase } from "@/lib/jobs/run";
import { getMeeting, updateMeeting } from "./store";
import { buildContextText } from "./context-sources";
import { CONTEXT_USAGE_RULES } from "./prompts";
import type {
  Meeting,
  MeetingDoc,
  MeetingDocTemplateId,
} from "./types";

const DOC_TIMEOUT_MS = 600_000; // 10분 — 2시간+ 회의 전사 + effort high 헤드룸
const DOC_EFFORT = process.env.MEETING_DOC_EFFORT || "high";
/**
 * 전사가 아주 길 때 프롬프트에 넣는 상한(자). 실측 한국어 회의 ~500자/분이라
 * 180k ≈ 6시간 분량 — 실제 회의는 다 들어간다. 예전 60k(≈딱 2시간)는 2시간
 * 넘는 회의의 뒷부분을 문서에서 통째로 버렸다(2026-07-24 henry 신고).
 */
const TRANSCRIPT_CAP = 180_000;

export interface DocTemplate {
  id: MeetingDocTemplateId;
  title: string;
  /** 드롭다운에 보이는 한 줄 설명. */
  description: string;
  /** 본문 지시(공통 지시 뒤에 붙는다). */
  instructions: string;
  /** true면 회의 노트 공유 발행에서 제외(상대 심리 분석 등 당사자에게 새면 안 되는 문서). */
  shareExcluded?: true;
}

export const DOC_TEMPLATES: DocTemplate[] = [
  {
    id: "minutes",
    title: "회의록",
    description: "Recap · 결정 · 할 일 · 다음 단계",
    instructions: `회의록을 작성하세요. 구성:
- 첫 문단: 이 회의를 처음 보는 사람도 이해할 한 문단 요약(3문장 이내).
- "## Recap": 논의 흐름을 주제별 소제목(###)과 짧은 문단으로. 실제 발언의 구체적 표현을 따옴표로 1~2개 살릴 것.
- "## 결정된 것": 명확히 합의된 항목만 불릿으로. 없으면 섹션 생략.
- "## 할 일": "담당 · 할 일 · 기한(있으면)" 형태 불릿. 담당은 대화 내용으로 추정하되 불확실하면 "(확인 필요)".
- "## 다음 단계": 다음 회의·후속 흐름.`,
  },
  {
    id: "onepage",
    title: "한페이지 문서",
    description: "결론 먼저, A4 반 장",
    instructions: `한 페이지 요약 문서를 작성하세요. 결론부터 씁니다.
- 첫 줄: 이 회의의 결론 한 문장(굵게).
- "## 왜": 배경과 문제를 3불릿 이내.
- "## 무엇을": 합의된 방향·선택지를 3불릿 이내.
- "## 지금 할 것": 당장 움직일 액션 3개 이내.
전체 분량은 A4 반 장(공백 포함 1,200자 이내). 넘치면 덜 중요한 것을 버리세요.`,
  },
  {
    id: "lecture-note",
    title: "강의노트",
    description: "커리큘럼 · 실습 아이디어로 재구성",
    instructions: `이 대화를 강의 준비 노트로 재구성하세요. 독자는 회의를 녹음한 본인입니다.
- "## 다룰 내용": 대화에서 나온 주제를 강의 목차 후보로(### 소제목 + 다룰 포인트 불릿).
- "## 실습 아이디어": 수강생이 바로 따라할 실습 형태로 변환(재료·순서 포함).
- "## 수강생 반응 예상": 대화에서 드러난 눈높이·우려를 근거로.
- "## 준비물": 시연 자료·계정·링크 등 준비할 것.`,
  },
  {
    id: "sales-followup",
    title: "후속 메일 초안",
    description: "상담 후 고객에게 보낼 메일",
    instructions: `이 회의 상대에게 보낼 후속 메일 초안을 작성하세요.
- 수신자는 회의 상대, 발신자는 회의를 녹음한 본인.
- 구성: 인사(회의 감사) → 논의 요약 2~3문장 → 우리가 할 일과 시점 → 상대에게 부탁할 것 → 다음 스텝 제안.
- 존댓말, 정중하되 간결하게. 영업 티 나는 과장 없이 논의된 사실만.
- 제목 줄을 "제목: ..." 형태로 맨 위에 포함.`,
  },
  {
    id: "content-seeds",
    title: "콘텐츠 소재",
    description: "스레드 · 블로그 글감 추출",
    instructions: `이 대화에서 콘텐츠 글감을 3~5개 추출하세요. 독자는 AI로 업무를 잘하고 싶은 직장인 실무자.
각 글감은 "### 글감 제목" 아래에:
- 훅(첫 줄 후보): 구체적 숫자·경험이 담긴 한 문장.
- 핵심 내용: 무엇을 말할지 3불릿.
- 근거가 된 대화 대목: 실제 발언 인용 1개.
회의의 민감한 사실(금액·고객사명 등)은 글감에서 익명화하거나 제외하세요.`,
  },
  {
    id: "person-read",
    title: "상대 읽기",
    description: "숨은 니즈 · 전문성 지도 · 접근법",
    shareExcluded: true,
    instructions: `이 대화의 상대방을 깊게 읽는 문서를 작성하세요. 회의를 녹음한 본인은 분석 대상에서 제외합니다.
독자는 녹음한 본인입니다. 목적은 2가지: ① 그 자리에서 못 따라간 상대의 전문성과 대화 깊이를 사후에 이해하기 ② 다음 만남에서 상대를 만족시키는 접근을 준비하기.

상대가 여럿이면 사람마다 "## [이름] 님" 섹션을 반복합니다. 발언량이 적어 분석이 어려운 사람은 한 줄로 "발언이 적어 깊은 분석이 어렵습니다"라고만 쓰고 넘어갑니다.

각 사람 섹션의 구성:

"### 전문성 지도"
- 첫 문단: 이 사람이 어떤 전문 영역 위에서 말하는지를 비전문가가 이해할 수 있는 쉬운 말로 2~4문장. 직함이 아니라 대화에서 실제로 드러난 지식으로 판단할 것.
- "짚고 넘어갈 발언" 소목록: 녹음한 본인이 그 자리에서 깊이를 못 따라갔을 법한 발언 2~4개. 각 항목은 [실제 발언 인용] → 그 발언이 전제하는 지식·업계 맥락을 2~3문장으로 쉽게 해설 → "이 말의 무게: ..." 한 줄(이 발언이 왜 가볍게 지나칠 말이 아닌지). 전문용어가 나오면 첫 등장에서 괄호로 쉬운 설명을 답니다.

"### 표면 요청 vs 숨은 니즈"
- 이 사람이 말로 한 요청·제안을 항목별로 나열하고, 각 항목마다:
  - 표면 요청: 실제로 뭐라고 말했는지 (인용 포함)
  - 숨은 니즈: 그 요청을 하게 만든 진짜 사정. 업무적 사정(예산 소진, 상사 보고, 성과 압박, 일정)과 심리적 사정(인정 욕구, 불안 해소, 리스크 회피, 체면)을 구분해서 씁니다.
  - 근거: 그렇게 추정한 근거가 된 대화 대목 인용 1개 이상. 인용할 근거가 없는 추정은 쓰지 않습니다.

"### 왜 나에게 왔나"
- 이 사람이 다른 사람이 아니라 녹음한 본인에게 이 이야기를 하는 이유를 2~4문장. 본인의 무엇(전문성·채널·위치·관계)을 필요로 하는지 명시.
- 이 사람이 본인에게 기대하는 역할을 한 줄로: 예) "검증자", "실행 파트너", "지렛대", "청중", "보증인". 대화 근거와 함께.

"### 만족시키는 접근"
- 다음 접촉에서 쓸 접근 2~3개. 각각 "무엇을(내용) + 어떻게(화법·순서) + 왜(위 니즈와의 연결)"이 다 담긴 실행 가능한 문장으로. 막연한 조언("신뢰를 쌓으세요") 금지.
- "하지 말 것" 1~2개: 이 사람의 니즈·심리를 고려할 때 역효과가 날 행동. 근거 포함.

[확신 수준 규칙 — 반드시 지킬 것]
- 모든 판단 문장 앞에 [명시] 또는 [추정] 태그를 답니다. [명시] = 상대가 대화에서 직접 말한 것. [추정] = 발언·정황에서 유추한 것.
- [추정]은 반드시 근거 인용이 같은 항목 안에 있어야 합니다. 인용을 못 붙이면 그 추정은 버립니다. 대화에 근거가 없는 일반론·성격 유형화(MBTI 류)는 금지.
- 분석이 빈약해도 채우지 않습니다. 근거가 있는 만큼만 씁니다.`,
  },
];

/** 공유 발행에 포함해도 되는 문서 템플릿인가. */
export function isShareableDocTemplate(id: string): boolean {
  const t = getDocTemplate(id);
  return Boolean(t && !t.shareExcluded);
}

export function getDocTemplate(id: string): DocTemplate | undefined {
  return DOC_TEMPLATES.find((t) => t.id === id);
}

/** 공통 지시 + 회의 재료로 템플릿 프롬프트를 조립한다. */
export function buildDocPrompt(template: DocTemplate, meeting: Meeting): string {
  const analysis = meeting.analysis
    ? JSON.stringify(meeting.analysis, null, 1)
    : "(분석 없음)";
  let transcript = meeting.transcript?.plain ?? "(전사 없음)";
  if (transcript.length > TRANSCRIPT_CAP) {
    transcript =
      transcript.slice(0, TRANSCRIPT_CAP) +
      "\n\n(…전사가 길어 여기서 잘랐습니다. 뒷부분 맥락은 위 분석 JSON을 참고하세요.)";
  }
  const people = meeting.people.length ? meeting.people.join(", ") : "미상";
  const contextText = buildContextText(meeting.contextSources);
  const contextBlock = contextText
    ? `
[참고 자료 사용 규칙]
${CONTEXT_USAGE_RULES}

[참고 자료]
${contextText}
`
    : "";

  return `당신은 회의 기록을 목적별 문서로 옮기는 전문 에디터입니다.

[회의 정보]
- 날짜: ${meeting.date}
- 참석: ${people}
- 제목: ${meeting.title ?? meeting.analysis?.headline ?? "(없음)"}

[분석 JSON]
${analysis}

[전사 전문]
${transcript}
${contextBlock}
[작성 규칙]
- 한국어 존댓말. em dash(—) 금지. 숫자는 아라비아 숫자.
- 대화에 없는 사실·수치를 지어내지 않습니다. 불확실하면 "(확인 필요)"로 표시.
- 마크다운 본문만 출력합니다. 코드펜스로 감싸지 말고, 문서 제목(h1)은 넣지 않습니다(## 부터 시작).

[이 문서의 목적]
${template.instructions}`;
}

function docKey(meetingId: string, templateId: string): string {
  return `meeting:doc:${meetingId}:${templateId}`;
}

export function isGeneratingDoc(
  meetingId: string,
  templateId: string
): boolean {
  return isRunning(docKey(meetingId, templateId));
}

/** docs 배열에서 해당 템플릿 문서를 교체(없으면 추가)한 새 배열. */
function upsertDoc(docs: MeetingDoc[] | undefined, doc: MeetingDoc): MeetingDoc[] {
  const rest = (docs ?? []).filter((d) => d.templateId !== doc.templateId);
  return [...rest, doc];
}

/** 문서 생성 실행 — 전사가 있는 회의에서만. 실패해도 generating 에 갇히지 않는다. */
export async function runDocGeneration(
  meetingId: string,
  templateId: MeetingDocTemplateId
): Promise<void> {
  const template = getDocTemplate(templateId);
  if (!template) return;

  await runPhase({
    key: docKey(meetingId, templateId),
    async begin() {
      const meeting = await getMeeting(meetingId);
      if (!meeting || !meeting.transcript?.plain) return null;
      const existing = meeting.docs?.find((d) => d.templateId === templateId);
      await updateMeeting(meetingId, {
        docs: upsertDoc(meeting.docs, {
          templateId,
          title: template.title,
          content: existing?.content ?? "",
          generatedAt: existing?.generatedAt ?? "",
          job: { status: "generating", startedAt: new Date().toISOString() },
        }),
      });
      return { meeting };
    },
    async work({ meeting }) {
      const sourceTranscript = meeting.transcript?.plain;
      const raw = await runClaudeCLI(buildDocPrompt(template, meeting), {
        tmpPrefix: "meeting-doc-",
        timeoutMs: DOC_TIMEOUT_MS,
        effort: DOC_EFFORT,
      });
      const content = raw.trim();
      if (!content) throw new Error("빈 문서가 생성되었습니다");
      const fresh = await getMeeting(meetingId);
      if (!fresh) return;
      // 생성 중 발화가 삭제되면 이전 전사를 재료로 쓴 문서를 되살리지 않는다.
      if (fresh.transcript?.plain !== sourceTranscript) return;
      await updateMeeting(meetingId, {
        docs: upsertDoc(fresh.docs, {
          templateId,
          title: template.title,
          content,
          generatedAt: new Date().toISOString(),
          // terminal: job 제거
        }),
      });
    },
    async fail(message) {
      const fresh = await getMeeting(meetingId);
      if (!fresh) return;
      const existing = fresh.docs?.find((d) => d.templateId === templateId);
      await updateMeeting(meetingId, {
        docs: upsertDoc(fresh.docs, {
          templateId,
          title: template.title,
          content: existing?.content ?? "",
          generatedAt: existing?.generatedAt ?? "",
          job: {
            status: "error",
            startedAt: new Date().toISOString(),
            error: message.slice(0, 500),
          },
        }),
      });
    },
  });
}

/** 라우트용 fire-and-forget 진입점. */
export function startDocGeneration(
  meetingId: string,
  templateId: MeetingDocTemplateId
): void {
  void runDocGeneration(meetingId, templateId).catch((e) => {
    console.error("[meetings] runDocGeneration crashed", meetingId, templateId, e);
  });
}

/** 폴링 GET·sweep 훅 — generating 고아 문서 잡 자동 재개. */
export function maybeResumeDocs(meeting: Meeting): void {
  for (const doc of meeting.docs ?? []) {
    if (doc.job?.status !== "generating") continue;
    if (isGeneratingDoc(meeting.id, doc.templateId)) continue;
    startDocGeneration(meeting.id, doc.templateId);
  }
}
