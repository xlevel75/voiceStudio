"use client";

import { Spinner } from "../ui";
import type { SyncStatus } from "./useProjectSync";

const STORAGE_LABELS = {
  file: "data/podcasts 폴더",
  blob: "Vercel Blob",
} as const;

function clock(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(
    new Date(iso),
  );
}

/** 자동 저장 상태 한 줄. 실패하면 이유를 보여 주고, 브라우저 사본이 있다는 걸 알린다. */
export function SyncIndicator({
  status,
  onDismissNotice,
}: {
  status: SyncStatus;
  onDismissNotice: () => void;
}) {
  const where = status.storage ? ` · ${STORAGE_LABELS[status.storage]}` : "";
  const base = "flex items-center gap-1.5 text-[11px]";

  return (
    <div className="flex flex-col items-end gap-1">
      {status.state === "loading" ? (
        <span className={`${base} text-ink-400`}>
          <Spinner className="h-3 w-3" /> 저장된 주제 불러오는 중…
        </span>
      ) : status.state === "saving" ? (
        <span className={`${base} text-ink-300`}>
          <Spinner className="h-3 w-3 text-accent-300" /> 저장 중…{where}
        </span>
      ) : status.state === "pending" ? (
        <span className={`${base} text-ink-400`} title="고치기를 멈추면 2초 뒤, 늦어도 10초 안에 저장합니다">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> 변경 사항 자동 저장 대기
        </span>
      ) : status.state === "error" ? (
        <span className={`${base} max-w-md text-amber-300`} title={status.error}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
          <span className="truncate">저장 실패 — {status.error}</span>
        </span>
      ) : (
        <span className={`${base} text-emerald-300/90`}>
          ✓ 자동 저장됨{status.lastSavedAt ? ` ${clock(status.lastSavedAt)}` : ""}
          <span className="text-ink-400">{where}</span>
        </span>
      )}
      {status.notice ? (
        <button onClick={onDismissNotice} className="text-[11px] text-sky-300 hover:underline" title="닫기">
          {status.notice} ✕
        </button>
      ) : null}
    </div>
  );
}
