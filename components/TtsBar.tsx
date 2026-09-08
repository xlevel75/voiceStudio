"use client";

import { useEffect, useRef } from "react";
import type { Capabilities, Voice } from "@/lib/providers/types";
import type { SynthesisResult } from "./client-api";
import { Badge, ErrorNote, Spinner } from "./ui";

export interface ClovaOptions {
  speed: number;
  pitch: number;
}

export function TtsBar({
  capabilities,
  selectedVoice,
  text,
  onTextChange,
  modelId,
  onModelChange,
  clovaOptions,
  onClovaOptionsChange,
  onSynthesize,
  busy,
  error,
  result,
}: {
  capabilities: Capabilities;
  selectedVoice: Voice | null;
  text: string;
  onTextChange: (value: string) => void;
  modelId: string;
  onModelChange: (value: string) => void;
  clovaOptions: ClovaOptions;
  onClovaOptionsChange: (value: ClovaOptions) => void;
  onSynthesize: () => void;
  busy: boolean;
  error: string | null;
  result: (SynthesisResult & { voiceName: string; fileName: string }) | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const isClova = selectedVoice?.provider === "clova";

  // 새 결과가 오면 바로 재생 준비. (자동재생은 브라우저 정책상 강제하지 않는다)
  useEffect(() => {
    if (result && audioRef.current) audioRef.current.load();
  }, [result]);

  const overLimit = text.length > capabilities.maxTextLength;
  const chunkCount = Math.ceil(text.length / capabilities.maxTextLength) || 0;
  const canSynthesize = !!selectedVoice && text.trim().length > 0 && !busy;

  // 다운로드는 공급자 능력 + CLOVA 약관 조건을 모두 만족할 때만 노출한다.
  const showDownload =
    !!result && result.downloadable && capabilities.canDownload && !isClova;

  return (
    <section className="rounded-2xl border border-ink-700/70 bg-ink-900/70 p-5 backdrop-blur-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-ink-100">텍스트 → 음성</h2>
        <span
          className={`text-[11px] tabular-nums ${overLimit ? "text-amber-300" : "text-ink-400"}`}
        >
          {text.length.toLocaleString()} / {capabilities.maxTextLength.toLocaleString()}자
          {overLimit ? ` · ${chunkCount}회 분할 호출` : ""}
        </span>
      </div>

      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={5}
        placeholder="변환할 텍스트를 입력하세요. 공급자 탭을 바꿔도 이 텍스트는 유지됩니다."
        className="w-full resize-y rounded-xl border border-ink-700 bg-ink-850/60 px-4 py-3 text-sm leading-relaxed text-ink-100 outline-none transition placeholder:text-ink-400/70 focus:border-accent-500/60"
      />

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
            선택된 성우
          </span>
          <div className="flex h-[38px] items-center gap-2 rounded-xl border border-ink-700 bg-ink-850/60 px-3 text-sm">
            {selectedVoice ? (
              <>
                <span className="truncate text-ink-100">{selectedVoice.name}</span>
                {!capabilities.canDownload ? <Badge tone="warn">재생 전용</Badge> : null}
              </>
            ) : (
              <span className="text-ink-400">목록에서 선택하세요</span>
            )}
          </div>
        </div>

        {isClova ? (
          <>
            <NumberSelect
              label="속도"
              value={clovaOptions.speed}
              onChange={(speed) => onClovaOptionsChange({ ...clovaOptions, speed })}
              hint="느림 ← 0 → 빠름"
            />
            <NumberSelect
              label="톤"
              value={clovaOptions.pitch}
              onChange={(pitch) => onClovaOptionsChange({ ...clovaOptions, pitch })}
              hint="높음 ← 0 → 낮음"
            />
          </>
        ) : (
          <div className="min-w-[200px]">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
              모델
            </span>
            <select
              value={modelId}
              onChange={(e) => onModelChange(e.target.value)}
              className="h-[38px] w-full rounded-xl border border-ink-700 bg-ink-850/60 px-3 text-sm text-ink-100 outline-none transition focus:border-accent-500/60"
            >
              {capabilities.models.map((m) => (
                <option key={m.id} value={m.id} className="bg-ink-850">
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          onClick={onSynthesize}
          disabled={!canSynthesize}
          className="flex h-[38px] items-center gap-2 rounded-xl bg-accent-500 px-5 text-sm font-semibold text-white transition enabled:hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
        >
          {busy ? <Spinner /> : null}
          {busy ? "변환 중…" : "변환"}
        </button>
      </div>

      {error ? <div className="mt-3">{<ErrorNote message={error} />}</div> : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-ink-700/70 bg-ink-850/50 p-4">
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-300">
              결과 · <b className="text-ink-100">{result.voiceName}</b>
            </span>
            {result.downloadable ? (
              <Badge tone="ok">다운로드 가능</Badge>
            ) : (
              <Badge tone="warn">약관상 재생 전용</Badge>
            )}
          </div>
          <audio ref={audioRef} controls src={result.url} className="w-full">
            <track kind="captions" />
          </audio>
          <div className="mt-3 flex items-center gap-3">
            {showDownload ? (
              <a
                href={result.url}
                download={result.fileName}
                className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-ink-100 transition hover:border-accent-500/60 hover:text-accent-300"
              >
                ⬇ 다운로드
              </a>
            ) : (
              <p className="text-[11px] leading-relaxed text-ink-400">
                CLOVA Voice는 생성 음성의 저장·재사용이 약관상 금지되어 다운로드를 제공하지 않습니다.
                미리듣기만 가능합니다.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function NumberSelect({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  return (
    <div className="min-w-[110px]">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        title={hint}
        className="h-[38px] w-full rounded-xl border border-ink-700 bg-ink-850/60 px-3 text-sm text-ink-100 outline-none transition focus:border-accent-500/60"
      >
        {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n} className="bg-ink-850">
            {n === 0 ? "기본 (0)" : n > 0 ? `+${n}` : String(n)}
          </option>
        ))}
      </select>
    </div>
  );
}
