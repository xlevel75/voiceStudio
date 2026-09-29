/**
 * 유튜브 업로드 정보 조립 (제목·설명란·해시태그·태그·파일 이름). 클라이언트·서버 양쪽에서 쓴다.
 * 유튜브 제한: 제목 100자, 해시태그 15개 초과 시 전부 무시, 태그 칸 합계 500자.
 */
import type { YoutubeMeta } from "./projects";
import type { FactSheet, Script, Timeline } from "./types";

export const TITLE_LIMIT = 100;
export const HASHTAG_LIMIT = 15;
export const TAGS_CHAR_LIMIT = 500;

function episodeDate(factSheet: FactSheet | null): Date {
  const d = factSheet?.date ? new Date(`${factSheet.date}T00:00:00+09:00`) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function kstParts(d: Date) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** "9월 29일" */
export function shortDateLabel(factSheet: FactSheet | null): string {
  const { m, d } = kstParts(episodeDate(factSheet));
  return `${m}월 ${d}일`;
}

/** "2026년 9월 29일" */
export function longDateLabel(factSheet: FactSheet | null): string {
  const { y, m, d } = kstParts(episodeDate(factSheet));
  return `${y}년 ${m}월 ${d}일`;
}

/** 대본 제목의 앞부분(날짜 앞)을 프로그램 이름으로 쓴다. "뉴스 브리핑 오늘 · 2026년 9월 29일" → "뉴스 브리핑 오늘" */
export function showName(script: Script | null): string {
  const head = (script?.title ?? "").split(/[·|:\-–—]/)[0].trim();
  return head && !/\d+월/.test(head) ? head : "오늘의 뉴스";
}

/** 제목 = [날짜] 메인 문구 | 프로그램 — 100자를 넘으면 프로그램 이름을 뺀다. */
export function composeTitle(mainTitle: string, script: Script | null, factSheet: FactSheet | null): string {
  const base = `[${shortDateLabel(factSheet)}] ${mainTitle.trim()}`;
  const full = `${base} | ${showName(script)}`;
  return (full.length <= TITLE_LIMIT ? full : base).slice(0, TITLE_LIMIT);
}

/**
 * 내려받는 파일 이름. 대본 제목을 그대로 쓰되("뉴스_브리핑_오늘_2026년_9월_29일"),
 * 제목에 날짜가 없으면 날짜를 붙인다.
 */
export function fileBaseName(script: Script | null, factSheet: FactSheet | null): string {
  const clean = (s: string) =>
    s
      .replace(/[^\w가-힣.-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  const title = clean(script?.title ?? "") || clean(showName(script));
  return /\d{4}년/.test(title) ? title : `${title}_${clean(longDateLabel(factSheet))}`;
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${String(m).padStart(2, "0")}:${s}`;
}

/**
 * 유튜브 챕터 줄. 유튜브는 첫 챕터가 00:00이고 3개 이상, 각 10초 이상이어야 챕터로 인식한다.
 * 조건이 안 맞으면 빈 배열.
 */
export function chapterLines(timeline: Timeline | null | undefined): string[] {
  const chapters = timeline?.chapters ?? [];
  if (chapters.length < 3) return [];
  const lines = chapters.map((c, i) => {
    const title = c.segment_no === 0 ? "오프닝" : c.segment_no === 99 ? "클로징" : c.title;
    return `${clock(i === 0 ? 0 : c.start_ms)} ${title}`;
  });
  const tooShort = chapters.some((c, i) => {
    const next = chapters[i + 1]?.start_ms ?? timeline!.duration_ms;
    return next - (i === 0 ? 0 : c.start_ms) < 10_000;
  });
  return tooShort ? [] : lines;
}

/** 해시태그는 제목 위 3개 + 설명란 추가분을 합쳐 15개 이하. */
export function allHashtags(meta: YoutubeMeta): string[] {
  return [...new Set([...meta.hashtagsTop, ...meta.hashtagsMore])].slice(0, HASHTAG_LIMIT);
}

/** 태그 칸에 붙여넣을 문자열. 중요한 순서로 담고 쉼표 포함 500자에서 멈춘다. */
export function tagsForCopy(meta: YoutubeMeta): { text: string; used: string[]; dropped: string[] } {
  const ordered = [
    ...meta.tags.core,
    ...meta.tags.entities,
    ...meta.tags.longtail,
    ...meta.tags.broad,
    ...meta.tags.brand,
  ];
  const unique = [...new Set(ordered.map((t) => t.replace(/^#/, "").trim()).filter(Boolean))];
  const used: string[] = [];
  const dropped: string[] = [];
  let length = 0;
  for (const tag of unique) {
    const add = (used.length ? 1 : 0) + tag.length;
    if (length + add <= TAGS_CHAR_LIMIT) {
      used.push(tag);
      length += add;
    } else {
      dropped.push(tag);
    }
  }
  return { text: used.join(","), used, dropped };
}

/** 설명란 전체. 요약 → 챕터 → 출처 → AI 제작 고지 → 해시태그 순. */
export function buildDescription(input: {
  meta: YoutubeMeta;
  title: string;
  factSheet: FactSheet | null;
  timeline?: Timeline | null;
}): string {
  const { meta, factSheet } = input;
  const blocks: string[] = [];
  blocks.push(meta.summary.map((l) => `▶ ${l}`).join("\n"));

  const chapters = chapterLines(input.timeline);
  if (chapters.length) blocks.push(`📌 챕터\n${chapters.join("\n")}`);

  const sources = (factSheet?.sources ?? []).filter((s) => s.title);
  if (sources.length) {
    blocks.push(
      `📰 참고 기사\n${sources
        .map((s) => `- ${s.publisher ? `${s.publisher} · ` : ""}${s.title}${s.url ? ` ${s.url}` : ""}`)
        .join("\n")}`,
    );
  }

  blocks.push("※ 이 영상은 AI 음성·이미지로 제작되었습니다. 사실관계는 참고 기사 원문으로 확인해 주세요.");
  blocks.push(allHashtags(meta).join(" "));
  return blocks.join("\n\n");
}

/** 모델 출력 다듬기: 해시태그는 "#단어"(공백 없음), 태그는 "#" 없이. */
export function normalizeYoutubeMeta(raw: Partial<YoutubeMeta>): YoutubeMeta {
  const hashtag = (t: string) => `#${t.replace(/^#+/, "").replace(/\s+/g, "")}`;
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
  const tag = (t: string) => t.replace(/^#+/, "").trim();
  const top = [...new Set(list(raw.hashtagsTop).map(hashtag))].slice(0, 3);
  const more = [...new Set(list(raw.hashtagsMore).map(hashtag))].filter((h) => !top.includes(h));
  const t = raw.tags ?? ({} as Partial<YoutubeMeta["tags"]>);
  return {
    summary: list(raw.summary).slice(0, 3),
    hashtagsTop: top,
    hashtagsMore: more.slice(0, HASHTAG_LIMIT - top.length),
    hashtagStrategy: raw.hashtagStrategy ?? "",
    tags: {
      core: list(t.core).map(tag),
      entities: list(t.entities).map(tag),
      broad: list(t.broad).map(tag),
      longtail: list(t.longtail).map(tag),
      brand: list(t.brand).map(tag),
    },
    tagStrategy: raw.tagStrategy ?? "",
    altTitles: list(raw.altTitles).slice(0, 3),
  };
}
