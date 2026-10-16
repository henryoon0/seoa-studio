import { NextResponse, type NextRequest } from "next/server";

// 모든 요청(화면 + /api)의 검문. 화면도 회의 내용을 담으므로 리바인딩으로 읽히면 안 된다. 서아님이 연 아무 웹페이지가 이 앱에 몰래 요청을 보내
// 답글을 발송하거나 토큰을 바꾸지 못하게 한다(CSRF·DNS 리바인딩).
//   1) Host 가 이 컴퓨터 주소가 아니면 막는다(리바인딩).
//   2) 쓰기 요청에 Origin 이 있으면 Host 와 같아야 한다. 브라우저는 쓰기 요청에 Origin 을
//      항상 붙인다. Origin 이 없는 쓰기는 녹음 스크립트(curl) 같은 이 컴퓨터의 프로그램이다.

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

function localHost(raw: string | null, isUrl: boolean): string | null {
  if (!raw) return null;
  try {
    const url = new URL(isUrl ? raw : `http://${raw}`);
    return LOCAL.has(url.hostname.toLowerCase()) ? url.host : null;
  } catch {
    return null;
  }
}

const forbidden = () =>
  NextResponse.json({ error: "이 앱 화면에서 보낸 요청만 받습니다." }, { status: 403 });

export function proxy(req: NextRequest) {
  const host = localHost(req.headers.get("host"), false);
  if (!host) return forbidden();
  if (req.method === "GET" || req.method === "HEAD") return NextResponse.next();
  const origin = req.headers.get("origin");
  if (origin !== null && localHost(origin, true) !== host) return forbidden();
  return NextResponse.next();
}

// 정적 파일(빌드 산출물·이미지 최적화·파비콘)만 빼고 전부 검문한다.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
