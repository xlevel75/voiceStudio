"use client";

import { useState } from "react";
import { downloadAssetAs } from "@/lib/podcast/image-client";
import type { Thumbnail } from "@/lib/podcast/projects";
import { assetUrl } from "@/lib/podcast/visual";
import { ErrorNote, Spinner } from "../ui";
import { Lightbox } from "./Lightbox";

const field =
  "w-full rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-2 text-sm text-ink-100 outline-none transition focus:border-accent-500/60";
const btn =
  "flex items-center gap-2 rounded-lg border border-ink-700 px-3 py-2 text-xs text-ink-300 transition hover:border-accent-500/50 hover:text-accent-300 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * 만들어진 썸네일. 문구를 고쳐 다시 그리거나, 유튜브 규격(1280×720 JPEG)으로 내려받는다.
 * key={thumbnail.assetId}로 쓰면 새 썸네일이 나올 때마다 입력칸이 그 문구로 초기화된다.
 */
export function ThumbnailBox({
  thumbnail,
  fileName,
  busy,
  error,
  onRedraw,
  onNewText,
}: {
  thumbnail: Thumbnail;
  fileName: string;
  busy: boolean;
  error?: string;
  /** 지금 입력칸의 문구로 다시 그리기 */
  onRedraw: (title: string, subtitle: string) => void;
  /** AI가 문구부터 새로 만들기 */
  onNewText: () => void;
}) {
  const [title, setTitle] = useState(thumbnail.title);
  const [subtitle, setSubtitle] = useState(thumbnail.subtitle);
  const [open, setOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const edited = title.trim() !== thumbnail.title || subtitle.trim() !== thumbnail.subtitle;
  const src = assetUrl(thumbnail.assetId);

  async function download() {
    setDownloadError(null);
    try {
      await downloadAssetAs(thumbnail.assetId, 1280, 720, fileName);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "다운로드에 실패했습니다.");
    }
  }

  return (
    <div className="mt-5 grid gap-4 rounded-xl border border-ink-700/70 bg-ink-850/50 p-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <button
        onClick={() => setOpen(true)}
        title="크게 보기"
        className="relative block aspect-video w-full overflow-hidden rounded-lg border border-ink-700"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="유튜브 썸네일" className="h-full w-full object-cover" />
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center bg-ink-950/70">
            <Spinner className="h-5 w-5 text-accent-300" />
          </span>
        ) : null}
      </button>

      <div className="flex min-w-0 flex-col gap-3">
        <label>
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
            메인 문구 ({title.length}/20)
          </span>
          <input value={title} maxLength={20} onChange={(e) => setTitle(e.target.value)} className={field} />
        </label>
        <label>
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
            보조 문구 ({subtitle.length}/28)
          </span>
          <input
            value={subtitle}
            maxLength={28}
            onChange={(e) => setSubtitle(e.target.value)}
            className={field}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onRedraw(title.trim(), subtitle.trim())}
            disabled={busy || !title.trim()}
            className={btn}
            title="입력한 문구 그대로 썸네일을 다시 그립니다"
          >
            {edited ? "이 문구로 다시 그리기" : "같은 문구로 다시 그리기"}
          </button>
          <button onClick={onNewText} disabled={busy} className={btn} title="AI가 문구부터 새로 만듭니다">
            문구 새로 만들기
          </button>
          <button
            onClick={() => void download()}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-accent-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-accent-400 disabled:opacity-40"
          >
            ↓ 썸네일 다운로드
          </button>
        </div>
        <p className="text-[10px] leading-relaxed text-ink-400">
          유튜브 규격 1280×720 JPEG로 저장됩니다. 문구가 짧을수록 글자가 정확하게 그려집니다.
        </p>
        {error ? <ErrorNote message={error} /> : null}
        {downloadError ? <ErrorNote message={downloadError} /> : null}
      </div>

      {open ? <Lightbox src={src} alt="유튜브 썸네일" onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
