"use client";

import { useState } from "react";
import { CommentsClient, type CommentsView } from "./comments-client";

const VIEWS: { key: CommentsView; label: string }[] = [
  { key: "pending", label: "남은 댓글" },
  { key: "history", label: "보낸 답글" },
];

/** dashboard 작업대에서 인스타 댓글 칸만 남겼다. Threads·DM·자동화는 없다. */
export function CommentsWorkbench() {
  const [view, setView] = useState<CommentsView>("pending");
  return (
    <div>
      <div className="flex gap-1 px-6 pt-5" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            onClick={() => setView(v.key)}
            className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
              view === v.key ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-950/5"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <CommentsClient key={view} view={view} />
    </div>
  );
}
