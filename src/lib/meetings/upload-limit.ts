// 녹음 업로드 한도. 3시간 회의 m4a 도 넉넉히 들어가는 크기다.
// next.config.ts 의 proxyClientMaxBodySize 와 ingest 라우트가 같은 값을 쓴다.
// proxy(검문)가 모든 요청 본문을 복제하는데, 이 한도를 넘으면 Next 가 본문을 말없이 잘라 버린다.
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
