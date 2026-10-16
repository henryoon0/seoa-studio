import type { ComponentType, ReactNode, SVGProps } from "react";

// 빈 상태 SSOT. "없습니다" 한 줄짜리 막다른 벽 대신
// 무엇이 없고, 다음에 뭘 하면 되는지(action)까지 안내한다.
// 아이콘은 인라인(16px)과 구분되게 size-8로 키워 빈 화면임을 전달한다.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-12 text-center ${className}`}
    >
      {Icon ? <Icon className="mb-3 size-8 text-neutral-300" /> : null}
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      {description ? (
        <p className="mt-1 max-w-[40ch] text-xs leading-relaxed text-neutral-500">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
