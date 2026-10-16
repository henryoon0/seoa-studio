import { localDateKey } from "./date";

export const config = {
  obsidian: {
    vaultPath: process.env.OBSIDIAN_VAULT_PATH || "",
    dailyNotesDir: "30_Daily_Notes",
    get dailyNotesPath() {
      return `${this.vaultPath}/${this.dailyNotesDir}`;
    },
    dailyNoteTemplateFile: "60_Template/Daily Note Template.md",
    get dailyNoteTemplatePath() {
      return `${this.vaultPath}/${this.dailyNoteTemplateFile}`;
    },
    get lecturesPath() {
      return `${this.vaultPath}/70_Base/lectures`;
    },
    get modulesPath() {
      return `${this.vaultPath}/70_Base/modules`;
    },
    get studyPath() {
      return `${this.vaultPath}/70_Base/study`;
    },
  },
  gmail: {
    credentialsPath: process.env.GMAIL_CREDENTIALS_PATH || "",
    callbackUrl:
      process.env.GMAIL_CALLBACK_URL ||
      "http://localhost:3000/api/gmail/callback",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ],
  },
  // 구글 계정·토큰 경로는 계정마다 다르다 → src/lib/google-accounts.ts (GOOGLE_ACCOUNTS)
  calendar: {
    callbackUrl:
      process.env.CALENDAR_CALLBACK_URL ||
      "http://localhost:3000/api/calendar/callback",
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  },
  youtube: {
    // Gmail 과 같은 구글 클라우드 프로젝트의 OAuth 클라이언트를 재사용한다.
    credentialsPath:
      process.env.YOUTUBE_CREDENTIALS_PATH ||
      process.env.GMAIL_CREDENTIALS_PATH ||
      "",
    tokenPath: process.env.YOUTUBE_TOKEN_PATH || "./youtube-token.json",
    callbackUrl:
      process.env.YOUTUBE_CALLBACK_URL ||
      "http://localhost:3000/api/youtube/callback",
    // force-ssl 하나로 videos.insert + captions.insert 둘 다 커버 (공식 문서 확인).
    scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"],
  },
  synapse: {
    ledgerPath:
      process.env.SYNAPSE_LEDGER_PATH ||
      `${process.cwd()}/data/synapse-ledger.json`,
  },
  instagram: {
    appId: process.env.META_APP_ID || "",
    appSecret: process.env.META_APP_SECRET || "",
    pageId: process.env.META_PAGE_ID || "",
    professionalAccountId: process.env.INSTAGRAM_PROFESSIONAL_ACCOUNT_ID || "",
    pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || "",
    webhookVerifyToken: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "",
    webhookCallbackUrl:
      process.env.INSTAGRAM_WEBHOOK_CALLBACK_URL ||
      "http://localhost:3000/api/instagram/webhook",
  },
};

export function localDateStr(): string {
  return localDateKey();
}
