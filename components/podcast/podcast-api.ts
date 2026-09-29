import type { GroundingSource } from "@/lib/gemini";
import type { YoutubeMeta } from "@/lib/podcast/projects";
import type {
  Emotion,
  EpisodeSetup,
  FactSheet,
  Script,
  Speaker,
  Utterance,
  VerifyFlag,
} from "@/lib/podcast/types";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `요청이 실패했습니다 (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* JSON이 아니면 무시 (예: 함수 시간 초과 HTML) */
    }
    throw new Error(message);
  }
  return res.json();
}

export function createFactSheet(setup: EpisodeSetup) {
  return post<{ factSheet: FactSheet; groundingSources: GroundingSource[] }>(
    "/api/podcast/fact-sheet",
    setup,
  );
}

export function createScript(setup: EpisodeSetup, factSheet: FactSheet) {
  return post<{ script: Script }>("/api/podcast/script", { setup, factSheet });
}

export function tagScript(input: {
  script: Script;
  speakers: Speaker[];
  factSheet: FactSheet | null;
  /** 비우면 전체 발화 */
  targetSeqs?: number[];
}) {
  return post<{ utterances: { seq: number; text: string; emotion: Emotion }[]; skipped: number[] }>(
    "/api/podcast/tags",
    input,
  );
}

export function verifyScript(factSheet: FactSheet, script: Script) {
  return post<{ flags: VerifyFlag[] }>("/api/podcast/verify", { factSheet, script });
}

/** 이미지 업로드. id를 주면 그 id로 저장한다(가져오기 때 원래 id 유지). */
export async function uploadAsset(blob: Blob, id?: string): Promise<string> {
  const res = await fetch(`/api/podcast/assets${id ? `?id=${encodeURIComponent(id)}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": blob.type },
    body: blob,
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !data.id) throw new Error(data.error ?? `이미지 업로드 실패 (${res.status})`);
  return data.id;
}

export type ImageRequest =
  | { kind: "studio"; setup: EpisodeSetup }
  | { kind: "character"; setup: EpisodeSetup; speakerId: string }
  | {
      kind: "scene";
      setup: EpisodeSetup;
      utterance: Pick<Utterance, "speaker" | "text" | "emotion" | "visualRef">;
    };

export function generateImage(input: ImageRequest) {
  return post<{ assetId: string }>("/api/podcast/image", input);
}

/** 유튜브 썸네일. title을 비우면 서버가 문구부터 만든다. */
export function createThumbnail(input: {
  setup: EpisodeSetup;
  script: Script | null;
  factSheet: FactSheet | null;
  title?: string;
  subtitle?: string;
}) {
  return post<{ assetId: string; title: string; subtitle: string }>("/api/podcast/thumbnail", input);
}

/** 유튜브 업로드 정보 (요약·해시태그·태그 추천). */
export function createYoutubeMeta(input: {
  setup: EpisodeSetup;
  script: Script | null;
  factSheet: FactSheet | null;
  mainTitle: string;
}) {
  return post<{ meta: YoutubeMeta }>("/api/podcast/youtube", input);
}
