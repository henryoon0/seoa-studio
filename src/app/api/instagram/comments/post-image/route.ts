import { NextRequest, NextResponse } from "next/server";
import { fetchMediaImageUrl, resolveAccessToken } from "@/lib/instagram-comments/graph";
import { readCachedMediaImage, writeCachedMediaImage } from "@/lib/instagram-comments/storage";

// 게시물 이미지 프록시 (+ 디스크 캐시).
// CDN 서명 URL 은 만료되므로 표시 직전에 신선한 URL 을 받되, 받은 이미지 바이트는 디스크에
// 저장해두고 재사용한다 (이미지 내용은 안 변하므로). 캐시 히트면 인스타를 아예 안 부른다.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일
const BROWSER_MAX_AGE_S = 24 * 60 * 60; // 브라우저도 하루 캐시

function imageResponse(bytes: Buffer, cache: "HIT" | "MISS") {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": `private, max-age=${BROWSER_MAX_AGE_S}`,
      "X-Cache": cache,
    },
  });
}

export async function GET(request: NextRequest) {
  const mediaId = request.nextUrl.searchParams.get("mediaId");
  if (!mediaId || !/^\d+$/.test(mediaId)) {
    return NextResponse.json({ error: "mediaId가 필요합니다" }, { status: 400 });
  }
  try {
    const cached = await readCachedMediaImage(mediaId, CACHE_TTL_MS);
    if (cached) return imageResponse(cached, "HIT");

    const token = await resolveAccessToken();
    const url = await fetchMediaImageUrl(token, mediaId);
    if (!url) return NextResponse.json({ error: "이미지가 없습니다" }, { status: 404 });
    const img = await fetch(url);
    if (!img.ok) return NextResponse.json({ error: "이미지 로드 실패" }, { status: 502 });
    const bytes = Buffer.from(await img.arrayBuffer());
    await writeCachedMediaImage(mediaId, bytes);
    return imageResponse(bytes, "MISS");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
