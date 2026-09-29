"use client";

import { useState, type ReactNode } from "react";
import type { YoutubeMeta } from "@/lib/podcast/projects";
import type { FactSheet, Script, Timeline } from "@/lib/podcast/types";
import {
  HASHTAG_LIMIT,
  TAGS_CHAR_LIMIT,
  TITLE_LIMIT,
  allHashtags,
  buildDescription,
  chapterLines,
  composeTitle,
  tagsForCopy,
} from "@/lib/podcast/youtube";
import { ErrorNote, Spinner } from "../ui";

const TAG_GROUPS: { key: keyof YoutubeMeta["tags"]; label: string; hint: string }[] = [
  { key: "core", label: "핵심 키워드", hint: "이번 회 사건 — 맨 앞에" },
  { key: "entities", label: "인물·기관·지역", hint: "고유명사 검색 유입" },
  { key: "longtail", label: "롱테일 검색어", hint: "경쟁 적은 긴 검색어" },
  { key: "broad", label: "넓은 분야", hint: "추천·연관 영상 노출" },
  { key: "brand", label: "채널 브랜드", hint: "내 채널 영상끼리 묶기" },
];

function CopyButton({ text, label = "복사" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* 클립보드 권한이 없으면 무시 — 텍스트는 화면에서 직접 선택할 수 있다 */
        }
      }}
      className="shrink-0 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:border-accent-500/50 hover:text-accent-300"
    >
      {done ? "복사됨 ✓" : label}
    </button>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-ink-700/70 pt-3 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Strategy({ children }: { children: string }) {
  if (!children) return null;
  return (
    <p className="mt-2 rounded-lg bg-ink-900/70 px-3 py-2 text-[11px] leading-relaxed text-ink-300">
      <span className="mr-1 font-semibold text-accent-300">전략</span>
      {children}
    </p>
  );
}

/**
 * 유튜브 업로드 정보: 제목(날짜 + 썸네일 메인 문구) · 해시태그 · 태그 · 설명란.
 * 항목마다 복사 버튼이 있고, 전체를 .txt로 내려받을 수 있다.
 */
export function YoutubeMetaBox({
  meta,
  mainTitle,
  script,
  factSheet,
  timeline,
  fileName,
  busy,
  error,
  onRegenerate,
}: {
  meta: YoutubeMeta;
  mainTitle: string;
  script: Script | null;
  factSheet: FactSheet | null;
  /** 최신 에피소드 타임라인. 있으면 설명란에 챕터가 들어간다. */
  timeline: Timeline | null;
  fileName: string;
  busy: boolean;
  error?: string;
  onRegenerate: () => void;
}) {
  const title = composeTitle(mainTitle, script, factSheet);
  const hashtags = allHashtags(meta);
  const tags = tagsForCopy(meta);
  const description = buildDescription({ meta, title, factSheet, timeline });
  const hasChapters = chapterLines(timeline).length > 0;

  function downloadTxt() {
    const text = [
      `[제목]\n${title}`,
      `[설명]\n${description}`,
      `[태그] (${tags.text.length}/${TAGS_CHAR_LIMIT}자)\n${tags.text}`,
      `[해시태그 전략]\n${meta.hashtagStrategy}`,
      `[태그 전략]\n${meta.tagStrategy}`,
    ].join("\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="mt-4 flex flex-col gap-4 rounded-xl border border-ink-700/70 bg-ink-850/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-ink-100">유튜브 업로드 정보</h2>
        <div className="flex gap-2">
          <button
            onClick={onRegenerate}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:border-accent-500/50 hover:text-accent-300 disabled:opacity-40"
          >
            {busy ? <Spinner className="h-3 w-3" /> : null}
            다시 만들기
          </button>
          <button
            onClick={downloadTxt}
            className="rounded-md bg-accent-500 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-accent-400"
          >
            ↓ 전체 .txt
          </button>
        </div>
      </div>
      {error ? <ErrorNote message={error} /> : null}

      <Section title={`제목 (${title.length}/${TITLE_LIMIT})`} aside={<CopyButton text={title} />}>
        <p className="text-sm font-medium text-ink-100">{title}</p>
        <p className="mt-1 text-[10px] text-ink-400">
          [날짜] + 썸네일 메인 문구 + 프로그램 이름. 썸네일 문구를 고쳐 다시 그리면 제목도 따라 바뀝니다.
        </p>
        {meta.altTitles.length ? (
          <ul className="mt-2 flex flex-col gap-1">
            {meta.altTitles.map((alt) => {
              const t = composeTitle(alt, script, factSheet);
              return (
                <li key={alt} className="flex items-center justify-between gap-2 text-xs text-ink-300">
                  <span className="min-w-0 truncate">
                    <span className="mr-1 text-ink-400">후보</span>
                    {t}
                  </span>
                  <CopyButton text={t} />
                </li>
              );
            })}
          </ul>
        ) : null}
      </Section>

      <Section
        title={`해시태그 (${hashtags.length}/${HASHTAG_LIMIT})`}
        aside={<CopyButton text={hashtags.join(" ")} label="전체 복사" />}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-ink-400">제목 위 노출</span>
          {meta.hashtagsTop.map((h) => (
            <span
              key={h}
              className="rounded-full bg-accent-500/20 px-2 py-0.5 text-xs font-medium text-accent-300 ring-1 ring-accent-500/40"
            >
              {h}
            </span>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-ink-400">설명란</span>
          {meta.hashtagsMore.map((h) => (
            <span key={h} className="rounded-full bg-ink-700/70 px-2 py-0.5 text-xs text-ink-300">
              {h}
            </span>
          ))}
        </div>
        <Strategy>{meta.hashtagStrategy}</Strategy>
      </Section>

      <Section
        title={`태그 입력 추천 (${tags.text.length}/${TAGS_CHAR_LIMIT}자)`}
        aside={<CopyButton text={tags.text} label="태그 칸에 붙여넣기용 복사" />}
      >
        <div className="flex flex-col gap-2">
          {TAG_GROUPS.map((g) =>
            meta.tags[g.key].length ? (
              <div key={g.key} className="grid gap-1 sm:grid-cols-[8.5rem_1fr]">
                <div>
                  <span className="block text-xs font-medium text-ink-100">{g.label}</span>
                  <span className="block text-[10px] text-ink-400">{g.hint}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {meta.tags[g.key].map((t) => (
                    <span
                      key={t}
                      className={`rounded-md px-1.5 py-0.5 text-[11px] ${
                        tags.dropped.includes(t)
                          ? "bg-ink-800 text-ink-400 line-through"
                          : "bg-ink-700/70 text-ink-100"
                      }`}
                      title={tags.dropped.includes(t) ? "500자를 넘어 복사에서 빠짐" : undefined}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
        {tags.dropped.length ? (
          <p className="mt-2 text-[10px] text-amber-300">
            유튜브 태그 칸 500자를 넘는 {tags.dropped.length}개는 복사에서 뺐습니다 (줄 그어진 태그).
          </p>
        ) : null}
        <Strategy>{meta.tagStrategy}</Strategy>
      </Section>

      <Section title={`설명란 (${description.length}자)`} aside={<CopyButton text={description} />}>
        <textarea
          readOnly
          value={description}
          rows={12}
          className="w-full resize-y rounded-lg border border-ink-700 bg-ink-900/70 px-3 py-2 text-xs leading-relaxed text-ink-100 outline-none"
        />
        {!hasChapters ? (
          <p className="mt-1 text-[10px] text-ink-400">
            음성을 만들고 &quot;에피소드 합치기&quot;를 하면 챕터 시간(00:00 오프닝…)이 설명란에 자동으로
            들어갑니다.
          </p>
        ) : null}
      </Section>
    </div>
  );
}
