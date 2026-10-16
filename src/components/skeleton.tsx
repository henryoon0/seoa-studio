// 로딩 상태 SSOT. "로딩 중..." 맨텍스트 대신 자리를 잡아주는 스켈레톤.
// 데이터가 들어와도 레이아웃이 덜컹이지 않게(CLS 방지) 실제 콘텐츠 형태를 흉내 낸다.
// 색은 헌법 톤(neutral-950 저투명)만 쓴다.

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-neutral-950/[0.05] ${className}`}
    />
  );
}

// 텍스트 여러 줄 자리. 마지막 줄은 짧게 끊어 자연스럽게.
export function SkeletonText({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

// 리스트 행 자리 (회의록·메일·수익 행 등).
export function SkeletonRows({
  rows = 4,
  className = "",
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-3 ${className}`} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// 카드 자리 (그리드 뷰).
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`rounded-xl ring-1 ring-neutral-950/5 shadow-card bg-white p-4 space-y-3 ${className}`}
    >
      <Skeleton className="h-3 w-1/3" />
      <SkeletonText lines={2} />
    </div>
  );
}
