"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * 이미지를 크게 본다. Esc나 바깥을 누르면 닫힌다.
 * 패널의 backdrop-blur가 position:fixed의 기준을 패널로 바꿔 버려서(긴 대본 패널 한가운데에 떠
 * 화면 밖으로 나감) body에 포털로 그려 항상 지금 보이는 화면 위에 뜨게 한다.
 */
export function Lightbox({
  src,
  alt,
  caption,
  actions,
  onClose,
}: {
  src: string;
  alt: string;
  /** 이미지 아래쪽에 겹쳐 보여줄 자막 */
  caption?: { speaker: string; text: string };
  actions?: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
    >
      <figure
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-6xl flex-col gap-3"
      >
        <div className="relative overflow-hidden rounded-xl bg-ink-950">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-[80vh] w-full object-contain" />
          {caption ? (
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-6 pb-5 pt-12 text-center">
              <span className="mb-1.5 inline-block rounded-full bg-accent-500 px-3 py-0.5 text-xs font-semibold text-white">
                {caption.speaker}
              </span>
              <p className="text-base font-semibold leading-snug text-white [text-shadow:0_1px_3px_rgba(0,0,0,.9)] sm:text-lg">
                {caption.text}
              </p>
            </figcaption>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2">
          {actions}
          <button
            onClick={onClose}
            className="rounded-lg border border-ink-600 px-4 py-2 text-sm text-ink-100 transition hover:bg-ink-800"
          >
            닫기
          </button>
        </div>
      </figure>
    </div>,
    document.body,
  );
}
