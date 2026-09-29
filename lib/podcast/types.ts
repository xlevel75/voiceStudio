/**
 * 뉴스 팟캐스트 단계 간 계약(JSON 스키마).
 * 클라이언트에서도 읽으므로 순수 타입·상수만 둔다. (doc/ai-news-podcast-dev-spec.md 6장)
 */

export const ROLES = ["host", "analyst", "panel_curious", "panel_counter"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  host: "사회자 (소개·전환)",
  analyst: "해설가 (심층 설명)",
  panel_curious: "패널 (엉뚱한 질문)",
  panel_counter: "패널 (다른 관점)",
};

export const EMOTIONS = [
  "calm",
  "bright",
  "serious",
  "curious",
  "laugh",
  "surprised",
  "thinking",
  "listening",
] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const TONES = ["serious", "balanced", "humorous"] as const;
export type Tone = (typeof TONES)[number];
export const TONE_LABELS: Record<Tone, string> = {
  serious: "진지하게",
  balanced: "균형 있게",
  humorous: "유머 있게",
};

export const FORMATS = ["news_briefing", "debate", "interview", "qa"] as const;
export type Format = (typeof FORMATS)[number];
export const FORMAT_LABELS: Record<Format, string> = {
  news_briefing: "뉴스 브리핑",
  debate: "토론",
  interview: "인터뷰",
  qa: "Q&A",
};

export const MIN_SPEAKERS = 2;
export const MAX_SPEAKERS = 6;

/** 한국어 낭독 속도(분당 약 300~350음절) 기준 목표 글자 수. */
export const CHARS_PER_MINUTE = 320;

export interface Speaker {
  id: string;
  name: string;
  role: Role;
  persona: string;
  /** ElevenLabs voice id */
  voiceId: string;
  /** 캐릭터 디자인시트 이미지 (에셋 id). 장면마다 같은 얼굴·옷을 유지하는 기준 */
  designSheet?: string;
}

/** 장면 연출 방식 */
export const SCENE_STYLES = ["news_desk", "round_table", "podcast_booth"] as const;
export type SceneStyle = (typeof SCENE_STYLES)[number];

/** 화자가 한 말의 핵심을 화면에 어떻게 보여줄지 */
export const CONTENT_MODES = ["backdrop", "inset", "none"] as const;
export type ContentMode = (typeof CONTENT_MODES)[number];

export const ART_STYLES = ["photo", "webtoon", "3d"] as const;
export type ArtStyle = (typeof ART_STYLES)[number];

export interface VisualSettings {
  sceneStyle: SceneStyle;
  contentMode: ContentMode;
  artStyle: ArtStyle;
  imageModel: string;
}

export interface EpisodeSetup {
  topic: string;
  /** 사용자가 붙여넣은 기사 원문·메모. 비어 있으면 웹 검색으로 수집한다. */
  sourceText: string;
  useWebSearch: boolean;
  targetMinutes: number;
  tone: Tone;
  format: Format;
  speakers: Speaker[];
  /** 기준 스튜디오 이미지 (에셋 id). 모든 장면의 배경 참조 */
  studioImage?: string;
  visual: VisualSettings;
}

export interface FactSheet {
  date: string;
  segments: {
    no: number;
    headline: string;
    facts: { id: string; text: string; source_ids: string[] }[];
    numbers: { value: string; context: string; fact_id: string }[];
    people: { name: string; title: string }[];
    background: string;
    sensitivity: "low" | "medium" | "high";
  }[];
  sources: { id: string; title: string; url: string; publisher: string }[];
}

export interface Utterance {
  seq: number;
  speaker: string;
  /** 뉴스 꼭지 번호 (0=오프닝, 99=클로징) */
  segment_no: number;
  emotion: Emotion;
  text: string;
  fact_ids: string[];
  /** 이 발화의 장면 이미지. sig가 지금 대사·설정과 다르면 다시 만들어야 한다. */
  scene?: { assetId: string; sig: string };
  /** 장면에 넣을 관련 이미지(검색에서 찾은 사진 등, 에셋 id). 없으면 AI가 내용에 맞게 그린다. */
  visualRef?: string;
}

export interface Script {
  title: string;
  target_minutes: number;
  utterances: Utterance[];
}

export type FlagType = "unsupported_number" | "unsupported_name" | "tone";

export interface VerifyFlag {
  seq: number;
  type: FlagType;
  detail: string;
}

export interface TimelineItem {
  seq: number;
  speaker: string;
  start_ms: number;
  end_ms: number;
  segment_no: number;
}

export interface Timeline {
  duration_ms: number;
  items: TimelineItem[];
  chapters: { segment_no: number; title: string; start_ms: number }[];
}
