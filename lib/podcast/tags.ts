/**
 * ElevenLabs 오디오 태그 — 대사 중간에 [laughs], [pause] 처럼 넣어 말투·호흡을 연출한다.
 * v3·v4 계열만 태그를 해석하고, 다른 모델은 태그를 글자 그대로 읽어버리므로 빼고 보낸다.
 * 클라이언트·서버 양쪽에서 읽으므로 순수 함수만 둔다.
 */
import type { Emotion, Utterance } from "./types";

const TAG_MODELS = new Set(["eleven_v4", "eleven_v4_turbo", "eleven_v3", "eleven_v3_conversational"]);

export function supportsAudioTags(modelId: string): boolean {
  return TAG_MODELS.has(modelId);
}

/** 대괄호 안 짧은 지시문. 기사 인용에 대괄호가 쓰이는 일은 드물어 이 정도로 충분하다. */
const TAG_RE = /\[[^[\]\n]{1,40}\]/g;

export function hasTags(text: string): boolean {
  return new RegExp(TAG_RE.source).test(text);
}

/** 자막·글자 수·태그 미지원 모델용. */
export function stripTags(text: string): string {
  return text
    .replace(TAG_RE, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 태그가 하나도 없는 대사(예전 대본, 직접 쓴 줄)는 emotion으로 기본 태그를 붙여 준다. */
const EMOTION_TAGS: Record<Emotion, string> = {
  calm: "[calm]",
  bright: "[cheerfully]",
  serious: "[serious]",
  curious: "[curious]",
  laugh: "[laughs]",
  surprised: "[surprised]",
  thinking: "[thoughtful]",
  listening: "",
};

/** 실제로 TTS에 보낼 텍스트. */
export function ttsText(u: Pick<Utterance, "text" | "emotion">, modelId: string): string {
  if (!supportsAudioTags(modelId)) return stripTags(u.text);
  if (hasTags(u.text)) return u.text;
  const tag = EMOTION_TAGS[u.emotion];
  return tag ? `${tag} ${u.text}` : u.text;
}

/** 대본 작가(Gemini)와 편집 화면이 함께 쓰는 추천 태그. v4는 목록 밖 자연어 태그도 이해한다. */
export const AUDIO_TAG_GROUPS: { label: string; tags: string[] }[] = [
  {
    label: "감정·말투",
    tags: [
      "[warmly]",
      "[cheerfully]",
      "[excited]",
      "[curious]",
      "[surprised]",
      "[thoughtful]",
      "[serious]",
      "[somber]",
      "[matter-of-fact]",
      "[playfully]",
      "[skeptical]",
      "[reassuring]",
    ],
  },
  {
    label: "반응",
    tags: ["[laughs]", "[chuckles]", "[laughs softly]", "[sighs]", "[gasps]", "[hmm]", "[clears throat]"],
  },
  {
    label: "호흡·강조",
    tags: [
      "[pause]",
      "[short pause]",
      "[long pause]",
      "[hesitates]",
      "[emphasized]",
      "[whispers]",
      "[quickly]",
      "[slowly]",
    ],
  },
];
