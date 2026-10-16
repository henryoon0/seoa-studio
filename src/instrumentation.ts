// 서버가 켜질 때 설정 화면에서 저장한 키를 적용한다.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // 이전 버전이 남긴 토큰·설정 파일의 공개 권한을 먼저 고친다 (파일 0600, 폴더 0700).
  const path = await import("node:path");
  const { hardenPrivatePaths, instagramCommentsDir, tokenPath } = await import("@/lib/instagram-comments/storage");
  const dataDir = path.join(process.cwd(), "data");
  const failed = await hardenPrivatePaths({
    dirs: [dataDir, instagramCommentsDir()],
    files: [
      tokenPath(),
      path.join(instagramCommentsDir(), "ledger.json"),
      path.join(instagramCommentsDir(), "send-queue.json"),
      path.join(dataDir, "settings.json"),
      path.resolve(process.env.YOUTUBE_TOKEN_PATH || "./youtube-token.json"),
      path.join(process.cwd(), ".env.local"),
    ],
  });
  if (failed.length) console.warn("[permissions] 권한을 고치지 못한 경로:", failed.join(", "));
  const recFailed = await (await import("@/lib/meetings/recording")).hardenRecordingPaths();
  if (recFailed.length) console.warn("[permissions] 녹음 권한을 고치지 못한 경로:", recFailed.join(", "));

  const { applySettings } = await import("@/lib/settings");
  applySettings();
  // 끊긴 발송(sending)은 unknown 으로 정리하고, 돌던 답글 발송 대기줄을 이어서 돌린다 (GET 조회는 재개하지 않는다).
  const { resumeSendQueueIfRunning } = await import("@/lib/instagram-comments/send-queue");
  await resumeSendQueueIfRunning().catch((e) =>
    console.warn("[ig-send-queue] 재개 실패:", e instanceof Error ? e.message : e)
  );
}
