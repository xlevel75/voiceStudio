"use client";

import { useEffect, useRef, useState } from "react";
import { segmentLabel } from "@/lib/podcast/audio";
import { AUDIO_TAG_GROUPS, hasTags, stripTags } from "@/lib/podcast/tags";
import { assetUrl, subtitleChunks } from "@/lib/podcast/visual";
import { EMOTIONS, type Script, type Speaker, type Utterance, type VerifyFlag } from "@/lib/podcast/types";
import { Badge, Spinner } from "../ui";
import { Lightbox } from "./Lightbox";

export interface SceneState {
  assetId?: string;
  /** 대사·화자·연출 설정이 이미지를 만든 뒤 바뀌었음 */
  stale: boolean;
  busy: boolean;
  error?: string;
  /** 관련 사진 올리는 중 / 실패 */
  refBusy?: boolean;
  refError?: string;
}

export interface ClipState {
  status: "loading" | "done" | "error";
  blob?: Blob;
  url?: string;
  durationMs?: number;
  error?: string;
}

const SPEAKER_COLORS = [
  "text-sky-300",
  "text-amber-300",
  "text-emerald-300",
  "text-rose-300",
  "text-violet-300",
  "text-teal-300",
];

const FLAG_LABELS: Record<VerifyFlag["type"], string> = {
  unsupported_number: "근거 없는 숫자",
  unsupported_name: "근거 없는 이름",
  tone: "표현 주의",
};

const cell =
  "rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs outline-none transition hover:border-ink-700 focus:border-accent-500/60 focus:bg-ink-850";

export function ScriptEditor({
  script,
  onChange,
  speakers,
  flags,
  segmentTitles,
  clipOf,
  onSynthesize,
  onTag,
  sceneOf,
  onScene,
  onVisualRef,
  relatedEnabled,
  taggingSeqs,
  activeSeq,
  tagsEnabled,
  onSeek,
}: {
  script: Script;
  onChange: (next: Script) => void;
  speakers: Speaker[];
  flags: VerifyFlag[];
  segmentTitles: Map<number, string>;
  clipOf: (u: Utterance) => ClipState | undefined;
  onSynthesize: (u: Utterance) => void;
  /** AI로 이 발화에 감정 태그 달기 */
  onTag: (u: Utterance) => void;
  sceneOf: (u: Utterance) => SceneState;
  /** 이 발화의 장면 이미지 만들기/다시 만들기 */
  onScene: (u: Utterance) => void;
  /** 장면에 넣을 관련 사진 올리기(file) / 빼기(null) */
  onVisualRef: (u: Utterance, file: File | null) => void;
  /** 연출 설정이 "내용 그림 없음"이 아닐 때만 관련 사진 칸을 보인다 */
  relatedEnabled: boolean;
  /** 태그를 다는 중인 발화 seq */
  taggingSeqs: Set<number>;
  /** 에피소드 재생 중인 발화 */
  activeSeq: number | null;
  /** 현재 TTS 모델이 오디오 태그를 해석하는지 (아니면 태그를 빼고 읽는다) */
  tagsEnabled: boolean;
  /** 합쳐진 에피소드가 있으면 해당 발화 위치로 이동 */
  onSeek?: (seq: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const textRefs = useRef(new Map<number, HTMLTextAreaElement>());

  useEffect(() => () => audioRef.current?.pause(), []);
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSeq]);

  const colorOf = (name: string) => {
    const i = speakers.findIndex((s) => s.name === name);
    return i >= 0 ? SPEAKER_COLORS[i % SPEAKER_COLORS.length] : "text-rose-400";
  };

  // 순서가 바뀌면 seq를 다시 매긴다. 대본 JSON의 seq는 항상 1..N 연속이다.
  const commit = (utterances: Utterance[]) =>
    onChange({ ...script, utterances: utterances.map((u, i) => ({ ...u, seq: i + 1 })) });
  const patch = (index: number, p: Partial<Utterance>) =>
    commit(script.utterances.map((u, i) => (i === index ? { ...u, ...p } : u)));
  const move = (index: number, delta: number) => {
    const next = [...script.utterances];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    commit(next);
  };
  const insertAfter = (index: number) => {
    const base = script.utterances[index];
    const next = [...script.utterances];
    next.splice(index + 1, 0, { ...base, text: "", emotion: "calm", fact_ids: [], scene: undefined });
    commit(next);
  };
  /** 마지막 커서 위치(포커스가 빠져도 selectionStart는 남는다)에 태그를 끼워 넣는다. */
  const insertTag = (index: number, tag: string) => {
    const el = textRefs.current.get(index);
    const text = script.utterances[index].text;
    const pos = el ? el.selectionStart : 0;
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    const glue = before && !before.endsWith(" ") ? " " : "";
    const next = `${before}${glue}${tag} ${after.trimStart()}`;
    patch(index, { text: next });
    const caret = before.length + glue.length + tag.length + 1;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };
  const remove = (index: number) => commit(script.utterances.filter((_, i) => i !== index));

  function play(clip: ClipState) {
    if (!clip.url) return;
    audioRef.current?.pause();
    audioRef.current = new Audio(clip.url);
    void audioRef.current.play();
  }

  return (
    <div className="flex flex-col">
      {script.utterances.map((u, index) => {
        const prev = script.utterances[index - 1];
        const showSegment = !prev || prev.segment_no !== u.segment_no;
        const rowFlags = flags.filter((f) => f.seq === u.seq);
        const clip = clipOf(u);
        const unknownSpeaker = !speakers.some((s) => s.name === u.speaker);
        const active = activeSeq === u.seq;

        return (
          <div key={index}>
            {showSegment ? (
              <div className="mb-1 mt-4 flex items-center gap-2 first:mt-0">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-300">
                  {segmentLabel(u.segment_no)}
                </span>
                <span className="truncate text-xs text-ink-400">
                  {u.segment_no !== 0 && u.segment_no !== 99 ? segmentTitles.get(u.segment_no) : ""}
                </span>
                <span className="h-px flex-1 bg-ink-700/70" />
              </div>
            ) : null}

            <div
              ref={active ? activeRowRef : undefined}
              className={[
                "group grid grid-cols-[2rem_7.5rem_1fr_auto_9rem] items-start gap-2 rounded-lg px-1 py-1.5 transition",
                active ? "bg-accent-500/15 ring-1 ring-accent-500/40" : "hover:bg-ink-850/60",
              ].join(" ")}
            >
              <button
                onClick={() => onSeek?.(u.seq)}
                disabled={!onSeek}
                title={onSeek ? "이 발화부터 재생" : undefined}
                className="pt-1.5 text-right text-[11px] tabular-nums text-ink-400 enabled:hover:text-accent-300"
              >
                {u.seq}
              </button>

              <div className="flex flex-col gap-0.5">
                <select
                  value={u.speaker}
                  onChange={(e) => patch(index, { speaker: e.target.value })}
                  className={`${cell} font-medium ${colorOf(u.speaker)}`}
                >
                  {unknownSpeaker ? <option value={u.speaker}>{u.speaker} (없음)</option> : null}
                  {speakers.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  value={u.emotion}
                  onChange={(e) => patch(index, { emotion: e.target.value as Utterance["emotion"] })}
                  className={`${cell} text-ink-400`}
                >
                  {EMOTIONS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
                <select
                  value=""
                  onChange={(e) => e.target.value && insertTag(index, e.target.value)}
                  title="커서 위치에 오디오 태그 넣기"
                  className={`${cell} ${tagsEnabled ? "text-accent-300" : "text-ink-400"}`}
                >
                  <option value="">+ 태그</option>
                  {AUDIO_TAG_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.tags.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="min-w-0">
                <textarea
                  ref={(el) => {
                    if (el) textRefs.current.set(index, el);
                    else textRefs.current.delete(index);
                  }}
                  value={u.text}
                  onChange={(e) => patch(index, { text: e.target.value })}
                  // field-sizing이 되는 브라우저(Chrome·Edge)는 내용만큼 늘어나고, 나머지는 rows 추정치를 쓴다.
                  rows={Math.max(2, Math.ceil(u.text.length / 30))}
                  className={`${cell} w-full resize-none text-sm leading-relaxed text-ink-100 [field-sizing:content]`}
                />
                {!tagsEnabled && hasTags(u.text) ? (
                  <p className="text-[10px] text-ink-400">현재 모델은 태그를 빼고 읽습니다.</p>
                ) : null}
                {rowFlags.length > 0 ? (
                  <div className="mt-1 flex flex-col gap-1">
                    {rowFlags.map((f, i) => (
                      <p key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-200">
                        <Badge tone="warn">{FLAG_LABELS[f.type]}</Badge>
                        <span>{f.detail}</span>
                      </p>
                    ))}
                  </div>
                ) : null}
                {clip?.status === "error" ? (
                  <p className="mt-1 text-[11px] text-rose-300">{clip.error}</p>
                ) : null}
              </div>

              <div className="flex items-center gap-1 pt-0.5">
                <button
                  onClick={() => onTag(u)}
                  disabled={!u.text.trim() || taggingSeqs.has(u.seq)}
                  title={hasTags(u.text) ? "감정 태그 다시 달기 (AI)" : "감정 태그 달기 (AI)"}
                  className="flex h-7 w-12 items-center justify-center rounded-md border border-ink-700 text-[11px] text-ink-400 transition hover:border-accent-500/50 hover:text-accent-300 disabled:opacity-40"
                >
                  {taggingSeqs.has(u.seq) ? <Spinner className="h-3 w-3 text-accent-300" /> : "태그"}
                </button>
                <ClipButton
                  clip={clip}
                  onPlay={play}
                  onSynthesize={() => onSynthesize(u)}
                  disabled={!u.text.trim()}
                />
                <div className="flex opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                  <RowAction title="위로" onClick={() => move(index, -1)} disabled={index === 0}>
                    ↑
                  </RowAction>
                  <RowAction
                    title="아래로"
                    onClick={() => move(index, 1)}
                    disabled={index === script.utterances.length - 1}
                  >
                    ↓
                  </RowAction>
                  <RowAction title="아래에 발화 추가" onClick={() => insertAfter(index)}>
                    +
                  </RowAction>
                  <RowAction
                    title="발화 삭제"
                    onClick={() => remove(index)}
                    disabled={script.utterances.length <= 1}
                  >
                    ✕
                  </RowAction>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-1">
                <SceneThumb utterance={u} scene={sceneOf(u)} onScene={() => onScene(u)} />
                {relatedEnabled ? (
                  <RelatedImage
                    utterance={u}
                    scene={sceneOf(u)}
                    query={
                      u.segment_no !== 0 && u.segment_no !== 99 && segmentTitles.get(u.segment_no)
                        ? segmentTitles.get(u.segment_no)!
                        : stripTags(u.text).slice(0, 40)
                    }
                    onPick={(file) => onVisualRef(u, file)}
                  />
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 발화 오른쪽의 장면 이미지. 누르면 크게, ↻로 다시 만든다. 자막 한 줄을 겹쳐 보여준다. */
function SceneThumb({
  utterance,
  scene,
  onScene,
}: {
  utterance: Utterance;
  scene: SceneState;
  onScene: () => void;
}) {
  const [open, setOpen] = useState(false);
  const firstLine = subtitleChunks(utterance.text)[0] ?? "";

  if (!scene.assetId) {
    return (
      <button
        onClick={onScene}
        disabled={scene.busy || !utterance.text.trim()}
        title={scene.error ?? "이 발화의 장면 이미지 만들기"}
        className={[
          "flex aspect-video w-full items-center justify-center rounded-md border border-dashed text-[11px] transition disabled:opacity-60",
          scene.error
            ? "border-rose-500/50 text-rose-300 hover:bg-rose-500/10"
            : "border-ink-600 text-ink-400 hover:border-accent-500/50 hover:text-accent-300",
        ].join(" ")}
      >
        {scene.busy ? (
          <Spinner className="h-4 w-4 text-accent-300" />
        ) : scene.error ? (
          "실패 · 다시"
        ) : (
          "장면 만들기"
        )}
      </button>
    );
  }

  const src = assetUrl(scene.assetId);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(true)}
        title="크게 보기"
        className={`relative block aspect-video w-full overflow-hidden rounded-md border ${
          scene.stale ? "border-amber-500/60" : "border-ink-700"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`${utterance.seq}번 장면`}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1 py-px text-[8px] leading-tight text-white">
          {firstLine}
        </span>
        {scene.busy ? (
          <span className="absolute inset-0 flex items-center justify-center bg-ink-950/70">
            <Spinner className="h-4 w-4 text-accent-300" />
          </span>
        ) : null}
      </button>
      {scene.stale ? (
        <span className="absolute left-1 top-1 rounded bg-amber-500/90 px-1 text-[9px] font-medium text-ink-950">
          대사 바뀜
        </span>
      ) : null}
      <button
        onClick={onScene}
        disabled={scene.busy}
        title="장면 다시 만들기"
        className="absolute right-1 top-1 rounded bg-ink-950/75 px-1.5 text-[11px] text-ink-100 transition hover:bg-accent-500 disabled:opacity-50"
      >
        ↻
      </button>
      {scene.error ? <p className="mt-0.5 text-[10px] leading-tight text-rose-300">{scene.error}</p> : null}
      {open ? (
        <Lightbox
          src={src}
          alt={`${utterance.seq}번 장면 — ${utterance.speaker}`}
          caption={{ speaker: utterance.speaker, text: stripTags(utterance.text) }}
          onClose={() => setOpen(false)}
          actions={
            <button
              onClick={onScene}
              disabled={scene.busy}
              className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-400 disabled:opacity-50"
            >
              {scene.busy ? <Spinner className="h-3.5 w-3.5" /> : null}
              재생성
            </button>
          }
        />
      ) : null}
    </div>
  );
}

/**
 * 장면 뒤에 띄울 관련 사진. 비워 두면 AI가 대사에 맞게 그리고,
 * 검색에서 찾은 사진을 올리면 그 사진을 장면 속 뉴스 화면에 넣는다.
 */
function RelatedImage({
  utterance,
  scene,
  query,
  onPick,
}: {
  utterance: Utterance;
  scene: SceneState;
  query: string;
  onPick: (file: File | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const link = "text-[10px] text-ink-400 transition hover:text-accent-300 disabled:opacity-40";

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {utterance.visualRef ? (
        <>
          <button onClick={() => setOpen(true)} title="관련 사진 크게 보기" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assetUrl(utterance.visualRef)}
              alt="관련 사진"
              className="h-6 w-10 rounded border border-ink-700 object-cover"
            />
          </button>
          <span className="truncate text-[10px] text-ink-300">관련 사진</span>
          <button onClick={() => onPick(null)} title="관련 사진 빼기 (AI가 그림)" className={link}>
            ✕
          </button>
        </>
      ) : (
        <>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={scene.refBusy}
            title="검색 등에서 찾은 사진을 올리면 장면 속 뉴스 화면에 넣습니다. 비워 두면 AI가 그립니다."
            className={link}
          >
            {scene.refBusy ? <Spinner className="h-3 w-3" /> : "+ 관련 사진"}
          </button>
          <a
            href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`}
            target="_blank"
            rel="noreferrer"
            title={`"${query}" 이미지 검색 (새 탭)`}
            className={link}
          >
            검색↗
          </a>
        </>
      )}
      {scene.refError ? (
        <span title={scene.refError} className="truncate text-[10px] text-rose-300">
          실패
        </span>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPick(file);
        }}
      />
      {open && utterance.visualRef ? (
        <Lightbox src={assetUrl(utterance.visualRef)} alt="관련 사진" onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}

function ClipButton({
  clip,
  onPlay,
  onSynthesize,
  disabled,
}: {
  clip: ClipState | undefined;
  onPlay: (clip: ClipState) => void;
  onSynthesize: () => void;
  disabled: boolean;
}) {
  if (clip?.status === "loading") {
    return (
      <span className="flex h-7 w-16 items-center justify-center text-accent-300">
        <Spinner className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (clip?.status === "done") {
    return (
      <span className="flex items-center">
        <button
          onClick={() => onPlay(clip)}
          title="발화 음성 듣기"
          className="h-7 rounded-l-md border border-emerald-500/30 bg-emerald-500/10 px-2 text-[11px] tabular-nums text-emerald-300 transition hover:bg-emerald-500/20"
        >
          ▶ {((clip.durationMs ?? 0) / 1000).toFixed(1)}s
        </button>
        <button
          onClick={onSynthesize}
          title="음성 다시 만들기"
          className="h-7 rounded-r-md border border-l-0 border-emerald-500/30 px-1.5 text-[11px] text-ink-400 transition hover:text-ink-100"
        >
          ↻
        </button>
      </span>
    );
  }
  return (
    <button
      onClick={onSynthesize}
      disabled={disabled}
      title={clip?.status === "error" ? "다시 시도" : "이 발화만 음성 만들기"}
      className={[
        "h-7 w-16 rounded-md border text-[11px] transition disabled:opacity-40",
        clip?.status === "error"
          ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
          : "border-ink-700 text-ink-400 hover:border-accent-500/50 hover:text-accent-300",
      ].join(" ")}
    >
      {clip?.status === "error" ? "재시도" : "음성"}
    </button>
  );
}

function RowAction({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="h-7 w-6 rounded text-xs text-ink-400 transition hover:bg-ink-700/60 hover:text-ink-100 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
