import { ProviderError } from "@/lib/providers/types";
import {
  EMOTIONS,
  FORMATS,
  MAX_SPEAKERS,
  MIN_SPEAKERS,
  ROLES,
  TONES,
  type EpisodeSetup,
  type Script,
} from "./types";
import { isAssetId, normalizeVisual } from "./visual";

/**
 * 클라이언트가 보낸 설정을 믿지 않고 서버에서 한 번 더 확인한다.
 * 이미지 생성(스튜디오·디자인시트)은 주제를 정하기 전에도 할 수 있어 requireTopic=false로 부른다.
 */
export function parseSetup(raw: unknown, { requireTopic = true } = {}): EpisodeSetup {
  const s = (raw ?? {}) as Partial<EpisodeSetup>;
  const topic = s.topic?.trim() ?? "";
  if (requireTopic && !topic) throw new ProviderError("주제를 입력해주세요.", 400);

  const speakers = Array.isArray(s.speakers) ? s.speakers : [];
  if (speakers.length < MIN_SPEAKERS || speakers.length > MAX_SPEAKERS) {
    throw new ProviderError(`화자는 ${MIN_SPEAKERS}~${MAX_SPEAKERS}명이어야 합니다.`, 400);
  }
  const names = speakers.map((sp) => sp.name?.trim() ?? "");
  if (names.some((n) => !n)) throw new ProviderError("모든 화자에 이름을 넣어주세요.", 400);
  if (new Set(names).size !== names.length) {
    throw new ProviderError("화자 이름이 겹칩니다. 서로 다른 이름을 써주세요.", 400);
  }

  const minutes = Number(s.targetMinutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 30) {
    throw new ProviderError("분량은 1~30분 사이로 정해주세요.", 400);
  }

  return {
    topic,
    sourceText: s.sourceText ?? "",
    useWebSearch: s.useWebSearch !== false,
    targetMinutes: Math.round(minutes),
    tone: TONES.includes(s.tone as never) ? s.tone! : "balanced",
    format: FORMATS.includes(s.format as never) ? s.format! : "news_briefing",
    speakers: speakers.map((sp, i) => ({
      id: sp.id ?? String(i),
      name: names[i],
      role: ROLES.includes(sp.role as never) ? sp.role : "panel_curious",
      persona: sp.persona ?? "",
      voiceId: sp.voiceId ?? "",
      designSheet: isAssetId(sp.designSheet) ? sp.designSheet : undefined,
    })),
    studioImage: isAssetId(s.studioImage) ? s.studioImage : undefined,
    visual: normalizeVisual(s.visual),
  };
}

/** 모델 출력이 스키마를 벗어나도 화면이 깨지지 않게 다듬는다. 발화가 없으면 실패로 본다. */
export function normalizeScript(raw: Script, speakerNames: string[], targetMinutes: number): Script {
  const utterances = (raw.utterances ?? [])
    .filter((u) => u && typeof u.text === "string" && u.text.trim())
    .map((u, i) => ({
      seq: i + 1,
      speaker: speakerNames.includes(u.speaker) ? u.speaker : speakerNames[0],
      segment_no: Number.isFinite(u.segment_no) ? u.segment_no : 0,
      emotion: EMOTIONS.includes(u.emotion) ? u.emotion : "calm",
      text: u.text.trim(),
      fact_ids: Array.isArray(u.fact_ids) ? u.fact_ids : [],
    }));
  if (utterances.length === 0) {
    throw new ProviderError("대본이 비어 있습니다. 다시 생성해주세요.", 502);
  }
  return { title: raw.title?.trim() || "뉴스 팟캐스트", target_minutes: targetMinutes, utterances };
}
