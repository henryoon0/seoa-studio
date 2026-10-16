/** 회의록(미팅) 도메인 타입 — 슬라이스 1: 회의록 스파인. */

export type MeetingStatus =
  | "recorded"
  | "transcribed"
  | "analyzed"
  | "ready"
  | "failed";

/** "나" / "상대" 가 표준 라벨이지만, 화자명이 따로 잡히면 임의 문자열도 허용. */
export type Speaker = "나" | "상대" | string;

export type TranscriptSourceTrack = "mic" | "system" | "mixed";

export interface TranscriptSegment {
  /** canonical transcript 안에서 근거 링크가 참조하는 안정 ID. */
  id?: string;
  speaker: Speaker;
  text: string;
  /** 초 단위 시작 시각(있으면). */
  t?: number;
  /** 초 단위 종료 시각(있으면). */
  endT?: number;
  /** 이 발화를 만든 원본 오디오 트랙. */
  sourceTrack?: TranscriptSourceTrack;
}

export interface ActionTodoLink {
  readonly date: string;
  readonly createdAt: string;
  readonly href: string;
}

export interface ActionItem {
  owner: "나" | "상대" | string;
  task: string;
  due?: string;
  /** 이 할 일이 생긴 맥락 1문장(누가 무엇을 묻다가 맡았는지). */
  context?: string;
  /** 끝났다고 볼 기준 1문장. */
  doneWhen?: string;
  /** 이 일을 맡은 원문 발언 그대로(근거 찾기용). */
  quote?: string;
  /** 같은 결과물을 위한 할 일을 묶는 상위 목표(예: "상품 255개 업로드 자료 완성"). */
  goal?: string;
  /** 왜 하는지 1~2문장. */
  why?: string;
  /** 쓰는 자료·대상. */
  inputs?: string;
  /** 어떻게 하는지. */
  how?: string;
  /** 주의할 점·바뀐 사정. */
  caution?: string;
  /** 이 일을 끝내기까지의 구체 단계(하위 체크리스트). */
  steps?: string[];
  /** 원문 검사에서 애매하다고 본 이유. 있으면 "확인 필요"로 표시한다. 사람이 고치면 지운다. */
  unsure?: string;
  /** 사용자가 검토 후 Todo로 보낸 경우에만 존재한다. */
  todo?: ActionTodoLink;
}

/** 대화 흐름 순서의 주제별 상세 정리 — "전체 내용이 잘 정리됐다"는 느낌의 핵심. */
export interface TopicSection {
  title: string;
  /** 결론·결정·담당을 담은 3~5문장 서술. 옛 회의에는 없다. */
  summary?: string;
  points: string[];
}

export interface AutomationLead {
  readonly title: string;
  readonly evidence: string;
}

export interface MeetingAnalysisOptions {
  readonly includeAutomationLeads?: boolean;
  /** 참고 자료 본문(용어집·노션 페이지 등). buildContextText 가 조립한다. */
  readonly contextText?: string;
}

/**
 * 회의록 분석에 같이 넣는 참고 자료 1건 — 노션·웹 페이지 링크.
 * 링크만이 아니라 **읽어온 본문을 같이 저장**한다. 페이지가 바뀌거나 사라져도
 * 그때 읽은 내용으로 재분석할 수 있다.
 */
export interface MeetingContextSource {
  readonly url: string;
  readonly title: string;
  /** 추출한 본문(문자 수 상한 적용). 추출 실패면 빈 문자열. */
  readonly content: string;
  readonly fetchedAt: string;
  /** 어떤 경로로 읽었는지 — 노션 API(통합 토큰) 또는 일반 웹 추출. */
  readonly via?: "notion-api" | "web";
  /** 추출 실패 사유 — 있으면 분석에 넣지 않고 화면에 표시한다. */
  readonly error?: string;
}

/**
 * 적응형 분석 결과. 존재하지 않는 선택 섹션은 빈 배열이 아니라
 * 아예 키를 생략한다(렌더 단계에서 "없으면 안 보임"을 보장).
 */
export interface MeetingAnalysis {
  headline: string;
  /** 하는 일 묶음(`tags.ts`의 MEETING_TAGS 중 하나). 맞는 게 없으면 없다. */
  tag?: string;
  summary: string;
  keyPoints: string[];
  topics?: TopicSection[];
  decisions?: string[];
  actionItems?: ActionItem[];
  nextSteps?: string[];
  openQuestions?: string[];
  automationLeads?: AutomationLead[];
  /** 회의 목적 1~2문장(누가 진행했고 무엇을 확인한 자리인지). */
  purpose?: string;
  /** 날짜·요일별로 정한 일정. */
  schedule?: ScheduleItem[];
  /** 핵심 내용: 굵은 결론 한 문장 + 뒷받침 설명. */
  highlights?: Highlight[];
  /** 회의 뒤에 잡기로 한 후속 회의. */
  followUps?: string[];
  /** 회의에서 정한 업무 절차. 흐름도로 그린다. */
  flow?: FlowStage[];
  /** 이름이 불려 책임을 맡은 사람별 역할. */
  roles?: PersonRole[];
  /** 이 회의에서 정의·구분한 용어. */
  glossary?: GlossaryTerm[];
  evidence?: AnalysisEvidenceRef[];
}

export interface ScheduleItem {
  when: string;
  what: string;
}

export interface Highlight {
  title: string;
  detail: string;
}

/** 업무 흐름의 한 단계. 같은 lane 끼리 한 줄로 이어 그린다. */
export interface FlowStage {
  lane: string;
  name: string;
  owner?: string;
  /** 기한·조건 한 줄. */
  rule?: string;
  /** 절차의 성패를 가르는 핵심 단계(절차마다 최대 2개). */
  core?: boolean;
  /** 이 단계가 나온 원문 발언 그대로(근거 찾기용). */
  quote?: string;
}

export interface PersonRole {
  name: string;
  role: string;
  /** 맡은 책임을 구체적으로 2~4개. */
  responsibilities?: string[];
  /** 이 사람이 최종 결정하는 일(있을 때만). */
  decides?: string;
}

export interface GlossaryTerm {
  term: string;
  definition: string;
  /** 헷갈리는 다른 용어와의 차이. */
  distinction?: string;
}

export type AnalysisEvidenceSection =
  | "summary"
  | "topicPoint"
  | "keyPoint"
  | "decision"
  | "actionItem"
  | "nextStep"
  | "openQuestion"
  | "highlight"
  | "flowStage"
  | "role"
  | "term";

export interface AnalysisEvidenceRef {
  readonly section: AnalysisEvidenceSection;
  readonly itemIndex: number;
  readonly topicIndex?: number;
  readonly segmentId: string;
  readonly startSec: number;
  readonly endSec?: number;
}

export interface AudioInput {
  data: Buffer | Uint8Array;
  mimeType: string;
}

export interface MeetingAi {
  transcribeAudio(
    audio: AudioInput,
    opts?: {
      channelSeparated?: boolean;
      /** 고유명사 표기 힌트(참석자·별칭 이름). 지원 안 하는 엔진은 무시. */
      keyterms?: readonly string[];
      /** 화자 수 상한(분리 전사가 아닐 때). 지원 안 하는 엔진은 무시. */
      maxSpeakers?: number;
      /** 오디오 길이(초). 클라우드 엔진의 크레딧 사전 확인용. 모르면 생략. */
      durationSec?: number;
      /** 실제로 전사한 엔진을 알린다(provenance 기록용). */
      onEngine?: (engine: TranscriptEngine) => void;
      /** 엔진이 전사를 시작할 때 알린다(진행 화면용). 폴백하면 다시 불린다. */
      onEngineStart?: (engine: TranscriptEngine) => void | Promise<void>;
      /** 1분 청크 부분 결과(누적 세그먼트 JSON + 진행률). 지원 안 하면 무시 가능. */
      onPartial?: (
        accJson: string,
        progress: { processedSec: number; totalSec: number }
      ) => void | Promise<void>;
    }
  ): Promise<string>;
  analyzeMeeting(
    plainTranscript: string,
    opts?: MeetingAnalysisOptions
  ): Promise<string>;
  /** 전사 구간 하나에서 할 일만 꼼꼼히 뽑는 호출. 없으면 전체 분석의 할 일을 그대로 쓴다. */
  extractTasks?(prompt: string): Promise<string>;
}

export interface TranscriptProgress {
  readonly processedSec: number;
  readonly totalSec: number;
}

export interface MeetingTranscript {
  segments: TranscriptSegment[];
  plain: string;
  provenance?: TranscriptProvenance;
  quality?: TranscriptQuality;
}

export interface TranscriptEngine {
  readonly engine: string;
  readonly model: string;
}

export interface TranscriptProvenance {
  readonly schemaVersion: 1;
  readonly engine: string;
  readonly model: string;
  readonly language: "ko";
  readonly createdAt: string;
}

export type TranscriptTrackState = "ready" | "missing" | "failed";

export interface TranscriptTrackResult {
  readonly track: TranscriptSourceTrack;
  readonly state: TranscriptTrackState;
  readonly error?: string;
}

export interface TranscriptQuality {
  readonly completeness: "complete" | "partial";
  readonly tracks: TranscriptTrackResult[];
}

export interface MeetingAudioTrackFile {
  readonly file: string;
  readonly startOffsetMs: number;
}

export interface MeetingAudioTracks {
  readonly mic?: MeetingAudioTrackFile;
  readonly system?: MeetingAudioTrackFile;
}

export interface MeetingProcessingState {
  readonly stage: "queued" | "transcribing" | "analyzing";
  readonly queuePosition?: number;
  /** 지금 전사를 맡은 엔진. 화면이 엔진에 맞는 예상 시간을 고른다. */
  readonly engine?: TranscriptEngine["engine"];
}

/** 문서 템플릿 식별자 — 정의(제목·프롬프트)는 docs.ts TEMPLATES 가 SSOT. */
export type MeetingDocTemplateId =
  | "minutes"
  | "onepage"
  | "lecture-note"
  | "sales-followup"
  | "content-seeds"
  | "person-read";

/**
 * 문서 백그라운드 생성 잡 — "generating" 은 재개 가능(폴링 GET·sweep 이
 * 다시 띄움), 성공 시 job 제거.
 */
export interface MeetingDocJob {
  status: "generating" | "error";
  startedAt: string;
  error?: string;
}

/** 템플릿으로 생성한 문서 한 편. content 는 마크다운. */
export interface MeetingDoc {
  templateId: MeetingDocTemplateId;
  /** 생성 시점의 템플릿 표시명 스냅샷. */
  title: string;
  content: string;
  generatedAt: string;
  job?: MeetingDocJob;
}

/* ── 회의 멘토 ─────────────────────────────────────────────
 * 회의 전사에서 henry가 배울 점(주석)·놓친 순간·용어를 뽑은 결과.
 * 인용 문장은 저장하지 않고 segmentId 로만 가리킨다. 화면은 전사 원문에서 문장을 꺼낸다.
 * 설계: plans/meeting-mentor.md, 시안 픽: data/prototypes/mentor-margin-picks.json.
 */

export type MentorNoteKind = "나에 대한 코멘트" | "상대의 사고" | "내 행동 패턴";
export type MentorVerdict = "채택 권장" | "배울 점 아님" | "확인 필요";
export type MentorDecision = "adopt" | "ask" | "reject";
export type MentorKnown = "yes" | "fuzzy" | "no";

export interface MentorNote {
  id: string;
  kind: MentorNoteKind;
  /** 룰 한 문장(평어체). */
  rule: string;
  /** 멘토 메모(평어체 2~3문장). */
  note: string;
  verdict: MentorVerdict;
  /** 주석이 붙는 발화. */
  anchor: string;
  /** 다음 회의에서 이 룰을 지켰는지 채점할 질문. */
  check?: string;
  /** 협업 필터 장부에 이미 있는 기준이면 그 id(E6 등). */
  ledgerId?: string;
  /** 놓친 순간이면: 내(henry) 발화 id + 그때 했어야 할 말. */
  missed?: { segmentId: string; rewrite: string; why: string };
  /** henry의 판정. 없으면 아직 안 봄. */
  decision?: MentorDecision;
}

export interface MentorTerm {
  id: string;
  /** 바로잡은 표기. */
  term: string;
  /** 전사에 적힌 표기(다를 때만). */
  heardAs?: string;
  meaning: string;
  why: string;
  segmentId: string;
  known?: MentorKnown;
}

export interface MentorExcerpt {
  id: string;
  /** 목차에 쓸 주제 이름. */
  topic: string;
  /** 구간 발화 순서대로. who 는 멘토가 문맥으로 추정한 화자. */
  lines: { segmentId: string; who: "나" | "상대" }[];
  noteIds: string[];
  termIds: string[];
}

export interface MeetingMentor {
  excerpts: MentorExcerpt[];
  notes: MentorNote[];
  terms: MentorTerm[];
  generatedAt: string;
  job?: MeetingDocJob;
}

/**
 * 회의 노트 공유에 포함할 항목 — 발행 시점 스냅샷이자 팝오버 체크 상태.
 * 형광펜 하이라이트는 옵션이 아니라 항상 본문 위에 그대로 나간다.
 */
export interface MeetingNotesShareInclude {
  summary: boolean;
  transcript: boolean;
  docs: MeetingDocTemplateId[];
}

/** 발행된 회의 노트 공유(문서 허브 페이지) 상태. 해제 시 필드 제거. */
export interface MeetingNotesShare {
  include: MeetingNotesShareInclude;
  url: string;
  publishedAt: string;
}

export interface Meeting {
  id: string;
  /** 추측 불가능한 공유용 식별자. */
  shareId: string;
  status: MeetingStatus;
  createdAt: string;
  updatedAt: string;
  /** YYYY-MM-DD. */
  date: string;
  title?: string;
  people: string[];
  mode: "remote" | "inperson";
  /**
   * 녹음 유입 경로. "voice-memo" = 아이폰 음성 메모→R2→대시보드 pull.
   * 없으면(undefined) Raycast/수동 업로드(기존 회의록). 자동화 거리 추출은
   * 유입 경로와 무관하게 모든 회의 분석에서 수행한다.
   */
  source?: "voice-memo";
  voiceIngestKey?: string;
  transcript?: MeetingTranscript;
  /**
   * 전사본이 사용자 편집(발화 삭제)으로 바뀔 때마다 1씩 오른다. 오래 걸리는 분석이
   * 시작 때의 버전과 저장 때의 버전이 다르면 결과를 버리고 다시 돌기 위한 표식.
   */
  transcriptVersion?: number;
  analysis?: MeetingAnalysis;
  /** 템플릿으로 생성한 문서들(문서 탭). templateId 당 최대 1편. */
  docs?: MeetingDoc[];
  /** 회의 멘토(배울 점·놓친 순간·용어). 만들기를 눌렀을 때만 생긴다. */
  mentor?: MeetingMentor;
  /**
   * 영속화된 오디오 파일명(data/meetings/audio/ 아래) — 백그라운드 처리·재개용.
   * 처리 성공(ready) 시 사본을 지우고 이 필드도 비운다(원본은 ~/Recordings 에 보존).
   */
  audioFile?: string;
  /** 네이티브 캡처가 만든 마이크/시스템 분리 트랙. 부분 실패 시 재시도용으로 보존. */
  audioTracks?: MeetingAudioTracks;
  /** 녹음 길이(초, ffprobe). 3시간 초과 시 상세 화면이 방치 의심 경고를 띄운다. */
  durationSec?: number;
  /** 전사 진행률(1분 청크 부분 저장) — 전사 완료 시 지워진다. */
  transcribeProgress?: { processedSec: number; totalSec: number };
  processing?: MeetingProcessingState;
  retryTranscriptionRequested?: boolean;
  /**
   * 형광펜 하이라이트 — 요약·스크립트 블록 안의 글자 범위 목록.
   * 구조와 키 체계는 highlights.ts(TextHighlight)가 SSOT.
   */
  highlights?: import("./highlights").TextHighlight[];
  /**
   * 공유에서 뺀 블록 키 목록(요약 불릿·발화 단위) — 공개 페이지 렌더에서
   * 통째로 생략된다. 키 체계는 highlights.ts 와 동일.
   */
  hiddenBlocks?: string[];
  /** 회의 노트 공유(요약·스크립트·문서 탭 공개 페이지) — 발행 중일 때만. */
  notesShare?: MeetingNotesShare;
  /** 분석에 같이 넣는 참고 자료(노션·웹 링크). url 기준 중복 없음. */
  contextSources?: MeetingContextSource[];
  error?: string;
}

export interface NewMeetingInput {
  date?: string;
  mode?: "remote" | "inperson";
  title?: string;
  source?: "voice-memo";
  voiceIngestKey?: string;
}

export type MeetingUpdate = Partial<
  Omit<Meeting, "id" | "createdAt" | "shareId">
>;

/**
 * 목록용 요약 투영. transcript(수십만 자)·문서 본문을 떼고 analysis 는 회의 작업대가
 * 실제로 쓰는 실행 신호만 남긴다. 긴 topics/evidence/keyPoints는 목록으로 보내지 않는다.
 */
export type MeetingSummaryItem = Omit<
  Meeting,
  "transcript" | "analysis" | "docs" | "mentor"
> & {
  analysis?: Pick<
    MeetingAnalysis,
    | "headline"
    | "summary"
    | "decisions"
    | "actionItems"
    | "nextSteps"
    | "openQuestions"
  >;
  docTemplateIds?: MeetingDocTemplateId[];
};

/** 홈 화면용 최소 투영. 최근 회의 줄은 제목만 렌더하므로 큰 목록 payload를 보내지 않는다. */
export type MeetingHomeSummaryItem = Pick<Meeting, "id" | "date" | "title"> & {
  people?: Meeting["people"];
};
