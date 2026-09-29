/**
 * 주제(프로젝트) 목록과 저장 파일 형식.
 * - 서버: 주제 하나 = JSON 파일 하나 (/api/podcast/projects, 자동 저장)
 * - 브라우저 localStorage: 서버에 닿지 않을 때를 위한 사본
 * 음성은 저장하지 않는다. (용량이 크고, 대본만 있으면 다시 만들 수 있다)
 * 클라이언트·서버 양쪽에서 쓰므로 localStorage는 함수 안에서만 만진다.
 */
import type { GroundingSource } from "@/lib/gemini";
import { stripTags } from "./tags";
import type { EpisodeSetup, FactSheet, Script, VerifyFlag } from "./types";
import { DEFAULT_VISUAL, isAssetId, normalizeVisual } from "./visual";

export interface Project {
  id: string;
  createdAt: string;
  /** 내용이 바뀔 때마다 갱신. 자동 저장과 기기 간 충돌 판정의 기준. */
  updatedAt: string;
  setup: EpisodeSetup;
  factSheet: FactSheet | null;
  groundingSources: GroundingSource[];
  script: Script | null;
  flags: VerifyFlag[];
  modelId: string;
  /** 유튜브 썸네일 (이미지 + 거기에 들어간 문구) */
  thumbnail?: Thumbnail | null;
  /** 유튜브 업로드용 해시태그·태그·설명 (제목은 썸네일 문구로 조합) */
  youtube?: YoutubeMeta | null;
}

export interface YoutubeMeta {
  /** 설명란 맨 위 3줄 요약 */
  summary: string[];
  /** 제목 위에 노출되는 해시태그 3개 (# 포함) */
  hashtagsTop: string[];
  /** 설명란 끝에 붙일 추가 해시태그 */
  hashtagsMore: string[];
  hashtagStrategy: string;
  /** 유튜브 "태그" 칸 추천 — 성격별로 묶음 */
  tags: { core: string[]; entities: string[]; broad: string[]; longtail: string[]; brand: string[] };
  tagStrategy: string;
  /** 같은 구조의 다른 제목 후보 (메인 문구만 다름) */
  altTitles: string[];
}

export interface Thumbnail {
  assetId: string;
  title: string;
  subtitle: string;
}

/** 저장 파일(.podcast.json) 형식. 다른 PC·다른 배포에서도 그대로 가져올 수 있다. */
export const PODCAST_FILE_FORMAT = "voicestudio.podcast";
export const PODCAST_FILE_VERSION = 1;

export interface PodcastFile {
  format: typeof PODCAST_FILE_FORMAT;
  version: number;
  savedAt: string;
  project: Project;
  /**
   * 내보내기 파일에 함께 넣은 이미지 (에셋 id → data URL).
   * 서버 자동 저장본에는 없고, 다른 곳으로 옮길 때만 들어간다.
   */
  assets?: Record<string, string>;
}

const PROJECTS_KEY = "podcast:projects:v2";
const ACTIVE_KEY = "podcast:active";
/** 주제 목록이 생기기 전, 한 편만 저장하던 형식 */
const LEGACY_KEY = "podcast:v1";

export const DEFAULT_MODEL_ID = "eleven_v4";

export const DEFAULT_SETUP: EpisodeSetup = {
  topic: "",
  sourceText: "",
  useWebSearch: true,
  targetMinutes: 5,
  tone: "balanced",
  format: "news_briefing",
  speakers: [
    {
      id: "host",
      name: "사회자",
      role: "host",
      persona: "차분하고 또박또박한 진행. 꼭지 전환을 깔끔하게 한다.",
      voiceId: "",
    },
    {
      id: "analyst",
      name: "해설가",
      role: "analyst",
      persona: "배경과 맥락을 쉽게 풀어 설명한다. 가끔 가벼운 농담.",
      voiceId: "",
    },
    {
      id: "panel1",
      name: "패널",
      role: "panel_curious",
      persona: "청취자 눈높이에서 엉뚱하지만 핵심을 찌르는 질문을 한다.",
      voiceId: "",
    },
  ],
  visual: DEFAULT_VISUAL,
};

/**
 * 새 주제. 출연진·분량·톤 같은 "방송 틀"은 직전 주제에서 이어받고,
 * 주제·자료·대본만 비운다. 매번 화자를 다시 설정하지 않도록.
 */
export function newProject(template?: Project | null): Project {
  const base = template?.setup ?? DEFAULT_SETUP;
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    setup: { ...base, topic: "", sourceText: "", speakers: base.speakers.map((s) => ({ ...s })) },
    factSheet: null,
    groundingSources: [],
    script: null,
    flags: [],
    modelId: template?.modelId ?? DEFAULT_MODEL_ID,
  };
}

const ID_RE = /^[\w-]{1,64}$/;

export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

/** 저장본·가져온 파일을 현재 형식으로 맞춘다. 빠진 필드는 기본값으로 채운다. */
export function normalizeProject(raw: Partial<Project>): Project {
  const base = newProject();
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : base.createdAt;
  return {
    ...base,
    ...raw,
    id: isProjectId(raw.id) ? raw.id : base.id,
    createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt,
    setup: {
      ...DEFAULT_SETUP,
      ...raw.setup,
      speakers: Array.isArray(raw.setup?.speakers) ? raw.setup.speakers : DEFAULT_SETUP.speakers,
      visual: normalizeVisual(raw.setup?.visual),
    },
    factSheet: raw.factSheet ?? null,
    groundingSources: Array.isArray(raw.groundingSources) ? raw.groundingSources : [],
    script: raw.script && Array.isArray(raw.script.utterances) ? raw.script : null,
    flags: Array.isArray(raw.flags) ? raw.flags : [],
    modelId: typeof raw.modelId === "string" ? raw.modelId : DEFAULT_MODEL_ID,
    thumbnail: raw.thumbnail && isAssetId(raw.thumbnail.assetId) ? raw.thumbnail : null,
    youtube: raw.youtube && Array.isArray(raw.youtube.hashtagsTop) ? raw.youtube : null,
  };
}

export function toPodcastFile(project: Project, assets?: Record<string, string>): PodcastFile {
  return {
    format: PODCAST_FILE_FORMAT,
    version: PODCAST_FILE_VERSION,
    savedAt: new Date().toISOString(),
    project,
    ...(assets && Object.keys(assets).length ? { assets } : {}),
  };
}

/**
 * 주제가 쓰는 이미지 에셋 id. 지운 이미지를 정리하거나 내보낼 때 쓴다.
 * scenes=false면 디자인시트·스튜디오만 (용량이 작은 기준 이미지).
 */
export function projectAssetIds(p: Project, { scenes = true } = {}): string[] {
  const ids = [
    p.setup.studioImage,
    p.thumbnail?.assetId,
    ...p.setup.speakers.map((s) => s.designSheet),
    ...(scenes ? (p.script?.utterances ?? []).flatMap((u) => [u.scene?.assetId, u.visualRef]) : []),
  ];
  return [...new Set(ids.filter(isAssetId))];
}

/** 파일 내용을 검사해 주제로 읽는다. 형식이 틀리면 사람이 읽을 수 있는 메시지로 실패한다. */
export function parsePodcastFile(raw: unknown): Project {
  return readPodcastFile(raw).project;
}

/** 가져오기용: 주제와 함께 들어 있는 이미지까지 읽는다. */
export function readPodcastFile(raw: unknown): { project: Project; assets: Record<string, string> } {
  const file = raw as Partial<PodcastFile> | null;
  if (!file || typeof file !== "object" || file.format !== PODCAST_FILE_FORMAT || !file.project) {
    throw new Error("뉴스 팟캐스트 주제 파일(.podcast.json)이 아닙니다.");
  }
  if (typeof file.version !== "number" || file.version > PODCAST_FILE_VERSION) {
    throw new Error(`더 새 버전(v${file.version})에서 저장한 파일입니다. 앱을 업데이트한 뒤 가져오세요.`);
  }
  if (!isProjectId(file.project.id)) throw new Error("주제 id가 올바르지 않습니다.");
  const assets = Object.fromEntries(
    Object.entries(file.assets ?? {}).filter(
      ([id, data]) => isAssetId(id) && typeof data === "string" && data.startsWith("data:image/"),
    ),
  );
  return { project: normalizeProject(file.project), assets };
}

export function projectTitle(p: Project): string {
  return p.setup.topic.trim() || p.script?.title || "새 주제";
}

export function projectFileName(p: Project): string {
  return `${projectTitle(p)
    .replace(/[^\w가-힣.-]+/g, "_")
    .slice(0, 60)}.podcast.json`;
}

export function scriptChars(script: Script | null): number {
  return (script?.utterances ?? []).reduce((n, u) => n + stripTags(u.text).length, 0);
}

export function loadProjects(): { projects: Project[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (raw) {
      const projects = (JSON.parse(raw) as Partial<Project>[]).map(normalizeProject);
      return { projects, activeId: localStorage.getItem(ACTIVE_KEY) };
    }

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = normalizeProject(JSON.parse(legacy) as Partial<Project>);
      return { projects: [migrated], activeId: migrated.id };
    }
  } catch {
    /* 깨진 저장값은 버리고 새로 시작 */
  }
  return { projects: [], activeId: null };
}

export function saveProjects(projects: Project[], activeId: string | null): void {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* 용량 초과 등은 무시 — 서버 저장이 원본이다 */
  }
}

const SYNCED_KEY = "podcast:synced";

/** 서버 저장에 성공한 주제별 마지막 updatedAt. 어떤 주제가 "저장됨"인지 판단하는 기준. */
export function loadSynced(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SYNCED_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveSynced(synced: Record<string, string>): void {
  try {
    localStorage.setItem(SYNCED_KEY, JSON.stringify(synced));
  } catch {
    /* 무시 */
  }
}

/**
 * 서버에 저장된 주제와 브라우저 사본을 합친다. 같은 주제면 더 최근에 고친 쪽을 쓴다.
 * - 브라우저에만 있고 서버에 올린 적 없는 주제 → 남긴다. (자동 저장이 올린다)
 * - 브라우저에만 있는데 예전에 올린 적 있는 주제 → 다른 곳에서 지운 것이므로 버린다.
 */
export function mergeProjects(
  server: Project[],
  local: Project[],
  synced: Record<string, string>,
): Project[] {
  const byId = new Map(server.map((p) => [p.id, p]));
  for (const p of local) {
    const other = byId.get(p.id);
    if (other ? p.updatedAt > other.updatedAt : !synced[p.id]) byId.set(p.id, p);
  }
  return [...byId.values()];
}
