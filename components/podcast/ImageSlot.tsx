"use client";

import { useRef, useState } from "react";
import { assetUrl } from "@/lib/podcast/visual";
import { Spinner } from "../ui";
import { Lightbox } from "./Lightbox";

/**
 * 디자인시트·스튜디오처럼 "올리거나 AI로 만드는" 기준 이미지 한 칸.
 * 썸네일을 누르면 크게 본다.
 */
export function ImageSlot({
  assetId,
  label,
  emptyHint,
  busy,
  error,
  onUpload,
  onGenerate,
  onClear,
  compact = false,
}: {
  assetId?: string;
  label: string;
  emptyHint: string;
  busy: boolean;
  error?: string;
  onUpload: (file: File) => void;
  onGenerate: () => void;
  onClear: () => void;
  compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const btn =
    "rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:border-accent-500/50 hover:text-accent-300 disabled:opacity-40";

  return (
    <div className="flex items-start gap-3">
      <button
        onClick={() => assetId && setOpen(true)}
        disabled={!assetId}
        title={assetId ? "크게 보기" : undefined}
        className={`relative shrink-0 overflow-hidden rounded-lg border border-ink-700 bg-ink-850/60 ${
          compact ? "h-12 w-[85px]" : "h-[72px] w-32"
        }`}
      >
        {assetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(assetId)} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center px-1 text-center text-[10px] leading-tight text-ink-400">
            {emptyHint}
          </span>
        )}
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center bg-ink-950/70">
            <Spinner className="h-4 w-4 text-accent-300" />
          </span>
        ) : null}
      </button>

      <div className="flex min-w-0 flex-col gap-1">
        {!compact ? <span className="text-[11px] text-ink-300">{label}</span> : null}
        <div className="flex flex-wrap gap-1">
          <button onClick={() => fileRef.current?.click()} disabled={busy} className={btn}>
            올리기
          </button>
          <button onClick={onGenerate} disabled={busy} className={btn} title="AI로 만들기 (Nano Banana)">
            {assetId ? "AI 재생성" : "AI 생성"}
          </button>
          {assetId ? (
            <button onClick={onClear} disabled={busy} className={btn}>
              빼기
            </button>
          ) : null}
        </div>
        {error ? <p className="text-[10px] leading-snug text-rose-300">{error}</p> : null}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onUpload(file);
        }}
      />
      {open && assetId ? (
        <Lightbox src={assetUrl(assetId)} alt={label} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}
