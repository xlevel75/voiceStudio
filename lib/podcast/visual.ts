/**
 * 화면 연출 설정과 장면 이미지 관련 순수 함수. 클라이언트·서버 양쪽에서 쓴다.
 */
import { stripTags } from "./tags";
import type { ArtStyle, ContentMode, EpisodeSetup, SceneStyle, Utterance, VisualSettings } from "./types";

export const SCENE_STYLE_INFO: Record<SceneStyle, { label: string; desc: string }> = {
  news_desk: {
    label: "뉴스 스튜디오",
    desc: "사회자는 앵커 단독 화면, 해설가·패널은 한 카메라에 함께 잡혀 서로 대화",
  },
  round_table: { label: "원탁 토론", desc: "모두 둥근 테이블에 둘러앉아 서로 의논" },
  podcast_booth: { label: "팟캐스트 부스", desc: "마이크 앞에 나란히 앉아 대화" },
};

export const CONTENT_MODE_INFO: Record<ContentMode, { label: string; desc: string }> = {
  backdrop: { label: "인물 뒤 뉴스 그림", desc: "화자 뒤·위에 대화 내용과 관련된 큰 그림 (화자는 안 가림)" },
  inset: { label: "하단 인서트", desc: "화면 가운데 아래에 내용을 그린 뉴스 그래픽" },
  none: { label: "없음", desc: "인물만" },
};

export const ART_STYLE_LABELS: Record<ArtStyle, string> = {
  photo: "실사",
  webtoon: "웹툰",
  "3d": "3D 애니메이션",
};

/** Nano Banana 계열. 모델명은 자주 바뀌므로 서버에서도 이 목록으로만 허용한다. */
export const IMAGE_MODELS = [
  { id: "gemini-3.1-flash-image", label: "Nano Banana 2 (균형)" },
  { id: "gemini-3-pro-image", label: "Nano Banana Pro (최고 품질·비쌈)" },
  { id: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite (저렴·빠름)" },
];

export const DEFAULT_VISUAL: VisualSettings = {
  sceneStyle: "news_desk",
  contentMode: "backdrop",
  artStyle: "photo",
  imageModel: IMAGE_MODELS[0].id,
};

export function normalizeVisual(raw: Partial<VisualSettings> | undefined): VisualSettings {
  const v = { ...DEFAULT_VISUAL, ...raw };
  // 예전 "말풍선(글자)" 방식은 "인물 뒤 뉴스 그림"으로 바뀌었다.
  if ((v.contentMode as string) === "bubble") v.contentMode = "backdrop";
  return {
    sceneStyle: SCENE_STYLE_INFO[v.sceneStyle] ? v.sceneStyle : DEFAULT_VISUAL.sceneStyle,
    contentMode: CONTENT_MODE_INFO[v.contentMode] ? v.contentMode : DEFAULT_VISUAL.contentMode,
    artStyle: ART_STYLE_LABELS[v.artStyle] ? v.artStyle : DEFAULT_VISUAL.artStyle,
    imageModel: IMAGE_MODELS.some((m) => m.id === v.imageModel) ? v.imageModel : DEFAULT_VISUAL.imageModel,
  };
}

/** 에셋 id 형식: uuid.확장자 — 파일 경로에 쓰이므로 엄격하게 검사한다. */
const ASSET_ID_RE = /^[\w-]{1,64}\.(png|jpg|webp)$/;

export function isAssetId(value: unknown): value is string {
  return typeof value === "string" && ASSET_ID_RE.test(value);
}

export function assetUrl(id: string): string {
  return `/api/podcast/assets/${encodeURIComponent(id)}`;
}

/** 짧은 문자열 해시 (FNV-1a 32bit). 장면이 최신인지 비교하는 용도라 충돌 걱정은 작다. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** 장면 이미지를 결정하는 입력들. 하나라도 바뀌면 "다시 만들어야 함"으로 표시한다. */
export function sceneSignature(
  u: Pick<Utterance, "speaker" | "text" | "emotion" | "visualRef">,
  setup: EpisodeSetup,
): string {
  const sheets = setup.speakers.map((s) => `${s.name}:${s.role}:${s.designSheet ?? ""}`).join(",");
  const v = setup.visual;
  return hash(
    [
      u.speaker,
      u.emotion,
      u.text,
      u.visualRef ?? "",
      v.sceneStyle,
      v.contentMode,
      v.artStyle,
      setup.studioImage ?? "",
      sheets,
    ].join("|"),
  );
}

/**
 * 한 줄 자막으로 나눈다. 문장 경계를 우선하고, 그래도 길면 어절 단위로 자른다.
 * 각 조각은 글자 수에 비례해 발화 시간을 나눠 가진다.
 */
export function subtitleChunks(text: string, maxChars = 34): string[] {
  const clean = stripTags(text);
  if (!clean) return [];
  const sentences = clean
    .match(/[^.!?。…]+[.!?。…]*/g)
    ?.map((s) => s.trim())
    .filter(Boolean) ?? [clean];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      chunks.push(sentence);
      continue;
    }
    // 긴 문장은 비슷한 길이의 줄로 나눈다. ("…잘" / "잡히지 않습니다."처럼 꼬리만 남지 않게)
    const target = sentence.length / Math.ceil(sentence.length / maxChars);
    let line = "";
    for (const word of sentence.split(/\s+/)) {
      const joined = line ? `${line} ${word}` : word;
      if (line && joined.length > target + 4) {
        chunks.push(line);
        line = word;
      } else {
        line = joined;
      }
    }
    if (line) chunks.push(line);
  }
  return chunks;
}
