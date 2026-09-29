/**
 * 이미지 프롬프트. (명세 8장)
 * 구도·인물 일관성은 영어 지시가 더 안정적이라 영어로 쓰고, 화면에 들어갈 한국어만 따옴표로 준다.
 * 참조 이미지는 넘긴 순서대로 "Image 1, Image 2…"로 가리킨다.
 */
import { ROLE_LABELS, type Emotion, type EpisodeSetup, type Speaker, type Utterance } from "./types";
import { stripTags } from "./tags";

const ART_STYLE_PROMPTS = {
  photo:
    "Photorealistic still frame from a modern Korean TV broadcast, natural skin texture, soft studio lighting.",
  webtoon:
    "Clean Korean webtoon illustration style, crisp line art, flat cel shading, vivid but tasteful colors.",
  "3d": "Stylized 3D animated film render, soft global illumination, appealing character proportions.",
} as const;

const ROLE_EN: Record<Speaker["role"], string> = {
  host: "news anchor / host",
  analyst: "expert analyst",
  panel_curious: "curious panelist",
  panel_counter: "panelist with a different viewpoint",
};

const EXPRESSIONS: Record<Emotion, string> = {
  calm: "calm and composed, speaking clearly",
  bright: "bright, warm smile while talking",
  serious: "serious and focused expression",
  curious: "curious, eyebrows raised, leaning slightly forward",
  laugh: "laughing naturally",
  surprised: "surprised, eyes wide",
  thinking: "thoughtful, hand near chin",
  listening: "attentive, nodding",
};

/** 대사 속 오디오 태그([laughs] 등)도 표정 힌트로 쓴다. */
function expressionOf(u: Pick<Utterance, "emotion" | "text">): string {
  const tags = (u.text.match(/\[[^[\]\n]{1,40}\]/g) ?? []).map((t) => t.slice(1, -1));
  return tags.length ? `${EXPRESSIONS[u.emotion]} (delivery: ${tags.join(", ")})` : EXPRESSIONS[u.emotion];
}

const COMMON_RULES = `
Rules:
- 16:9 frame. Keep the bottom 15% of the frame free of faces, text and important details (a subtitle will be overlaid there), but continue the scene naturally there — no black bars.
- The broadcast is fictional. Do NOT show any real broadcaster names, channel logos, brand names or watermarks. Background screens may show abstract graphics only.
- Do NOT write subtitles or any text other than what is explicitly requested below.
- All people are fictional characters; do not depict real public figures.`;

type Ref = { label: string };

/** 참조 이미지 목록과 그 설명. 실제 이미지 바이트는 라우트에서 같은 순서로 붙인다. */
export interface ImagePlan {
  prompt: string;
  /** 참조할 에셋 id (순서가 곧 Image 번호) */
  references: string[];
}

function describeSpeaker(s: Speaker): string {
  const persona = s.persona.trim() ? ` Personality: ${s.persona.trim()}.` : "";
  return `${s.name} — ${ROLE_EN[s.role]}.${persona}`;
}

export function characterSheetPlan(setup: EpisodeSetup, speaker: Speaker): ImagePlan {
  return {
    references: [],
    prompt: `Character design sheet for a fictional Korean news podcast cast member.
Character: ${describeSpeaker(speaker)} (${ROLE_LABELS[speaker.role]})
Style: ${ART_STYLE_PROMPTS[setup.visual.artStyle]}
Layout: on a plain light-gray background, show the same person as a full-body front view, a 3/4 view, and four head shots with different expressions (neutral, smiling, surprised, serious). Professional broadcast outfit that fits the role. Consistent face, hairstyle and outfit across all views.
No text, labels, logos or watermarks.`,
  };
}

const STUDIO_LAYOUTS = {
  news_desk: (n: number) =>
    `A modern TV news studio set. Center: an anchor desk facing the camera for one news anchor. To one side: a discussion desk area with ${Math.max(1, n - 1)} seats where the analyst and panelists sit together, angled toward each other so one camera can frame them in the same shot. Large abstract video wall behind.`,
  round_table: (n: number) =>
    `A modern talk-show studio set with one round table and ${n} chairs evenly placed around it, each with a small desk microphone. Warm, inviting lighting.`,
  podcast_booth: (n: number) =>
    `A cozy, modern podcast recording booth with ${n} seats side by side behind a long desk, each seat with a broadcast microphone on a boom arm, acoustic panels on the walls.`,
} as const;

/**
 * 유튜브 썸네일. 뉴스 스튜디오는 앵커 중심, 원탁·부스는 출연자 전원이 모인 모습에 큰 문구를 얹는다.
 * 문구는 짧게 정해서 주므로 모델이 한국어를 정확히 그릴 수 있다.
 */
export function thumbnailPlan(setup: EpisodeSetup, title: string, subtitle: string): ImagePlan {
  const host = setup.speakers.find((s) => s.role === "host") ?? setup.speakers[0];
  const cast = setup.visual.sceneStyle === "news_desk" ? [host] : setup.speakers;

  const refs: string[] = [];
  const refLines: string[] = [];
  if (setup.studioImage) {
    refs.push(setup.studioImage);
    refLines.push(`Image ${refs.length}: the studio set (use as the background environment).`);
  }
  const castLines = cast.map((s) => {
    if (!s.designSheet) return `- ${describeSpeaker(s)}`;
    refs.push(s.designSheet);
    refLines.push(
      `Image ${refs.length}: character design sheet of ${s.name}. Keep this exact face, hairstyle and outfit.`,
    );
    return `- ${describeSpeaker(s)} (looks exactly like Image ${refs.length})`;
  });

  const people =
    setup.visual.sceneStyle === "news_desk"
      ? `The news anchor ${host.name} alone, large in the frame (chest-up), on one side of the frame, with a confident, engaging expression, looking at the camera.`
      : `All ${cast.length} cast members together as a group (${setup.visual.sceneStyle === "round_table" ? "gathered around the round table" : "side by side in the podcast booth"}), close together and large in the frame, with lively, expressive reactions (excited, curious, surprised) as if in the middle of a heated, fun discussion.`;

  return {
    references: refs,
    prompt: `${
      refLines.length
        ? `Reference images:
${refLines.map((l) => `- ${l}`).join("\n")}

`
        : ""
    }Create an eye-catching YouTube thumbnail (16:9) for a Korean news podcast episode.

People (only these, no one else):
${castLines.join("\n")}
${people}

Text — render these Korean strings EXACTLY, character for character, no other text anywhere:
1. Main title: "${title}" — huge, extra-bold Korean typography, bright yellow or white with a thick dark outline and drop shadow, taking up about 40–50% of the frame, placed where it does not cover any face.
2. Subtitle: "${subtitle}" — smaller bold white text on a solid colored banner (red or deep blue) near the main title.

Design: high contrast, vivid saturated colors, clean composition typical of popular Korean YouTube news thumbnails; background slightly blurred/darkened so the text pops.
Style: ${ART_STYLE_PROMPTS[setup.visual.artStyle]}
- The broadcast is fictional. No real broadcaster names, channel logos, brand names or watermarks.
- All people are fictional characters; do not depict real public figures.`,
  };
}

export function studioPlan(setup: EpisodeSetup): ImagePlan {
  return {
    references: [],
    prompt: `Wide establishing shot of an EMPTY set (no people) for a Korean news podcast.
${STUDIO_LAYOUTS[setup.visual.sceneStyle](setup.speakers.length)}
Style: ${ART_STYLE_PROMPTS[setup.visual.artStyle]}
${COMMON_RULES}`,
  };
}

/**
 * 말한 내용을 보여주는 그림.
 * refImage가 있으면(사용자가 붙인 검색 사진 등) 그 그림을 그대로 쓰고, 없으면 대사에 맞게 새로 그린다.
 */
function contentInstruction(setup: EpisodeSetup, speaker: Speaker, refImage?: number): string {
  const picture = refImage
    ? `the exact photo from Image ${refImage}, inserted as-is like a real broadcast graphic (same framing, content and colors — do not redraw, restyle or crop it heavily)`
    : "a picture that directly illustrates the key subject of what is being said (a relevant scene, object, place or chart — not a portrait of the speaker)";
  switch (setup.visual.contentMode) {
    case "backdrop":
      return `News graphic behind the speaker: like a TV news "over-the-shoulder" graphic, show a LARGE framed image (about 40% of the frame width) above and behind ${speaker.name}'s shoulder — on the studio video wall or as a floating graphic panel in the background. It shows ${picture}. The people stay in front of it and are never covered by it; it sits behind them in depth. The graphic contains no text.`;
    case "inset":
      return `Content graphic: in the lower center of the frame, place a small rounded news-graphic inset panel (about 25% of the frame width and 25% of the frame height). Its bottom edge sits at about 80% of the frame height, above the bottom subtitle area, and it must not cover the speaker's face. It shows ${picture}, plus a short Korean caption of at most 10 characters. Render the Korean text exactly and legibly.`;
    default:
      return "No content graphics.";
  }
}

/** 연출 방식 + 누가 말하는지에 따라 구도와 화면에 들어갈 인물을 정한다. */
function composition(
  setup: EpisodeSetup,
  speaker: Speaker,
  expression: string,
): { cast: Speaker[]; shot: string } {
  const all = setup.speakers;
  const others = (list: Speaker[]) => list.filter((s) => s.id !== speaker.id).map((s) => s.name);
  const listeners = (list: Speaker[]) =>
    others(list).length
      ? ` ${others(list).join(", ")} listen and react naturally, looking at ${speaker.name}.`
      : "";

  switch (setup.visual.sceneStyle) {
    case "news_desk": {
      if (speaker.role === "host") {
        return {
          cast: [speaker],
          shot: `Anchor shot: medium close-up (waist up) of ${speaker.name} seated behind the anchor desk (the desk is visible in the lower part of the frame), alone in the frame, facing the camera and talking to the viewers. Expression: ${expression}.`,
        };
      }
      const group = all.filter((s) => s.role !== "host");
      return {
        cast: group,
        shot: `Discussion shot: a medium group shot of exactly ${group.length} people — ${group.map((s) => s.name).join(", ")} — seated close together at the side discussion desk (NOT the central anchor desk; nobody sits at the anchor desk), bodies angled toward each other in conversation, all in the same camera frame. ${speaker.name} is speaking with a natural hand gesture. Expression: ${expression}.${listeners(group)} Camera slightly favors ${speaker.name}.`,
      };
    }
    case "round_table":
      return {
        cast: all,
        shot: `Medium-wide shot of everyone seated around the round table in this order clockwise: ${all.map((s) => s.name).join(", ")}. ${speaker.name} is speaking to the others with a natural gesture. Expression: ${expression}.${listeners(all)} ${speaker.name} is the clear visual focus.`,
      };
    case "podcast_booth":
      return {
        cast: all,
        shot: `Shot of the booth with everyone seated side by side, left to right: ${all.map((s) => s.name).join(", ")}. ${speaker.name} is speaking into their microphone, turned slightly toward the others. Expression: ${expression}.${listeners(all)} ${speaker.name} is in focus.`,
      };
  }
}

export function scenePlan(
  setup: EpisodeSetup,
  u: Pick<Utterance, "speaker" | "text" | "emotion" | "visualRef">,
): ImagePlan {
  const speaker = setup.speakers.find((s) => s.name === u.speaker);
  if (!speaker) throw new Error(`화자 "${u.speaker}"를 찾을 수 없습니다.`);

  const line = stripTags(u.text);
  const { cast, shot } = composition(setup, speaker, expressionOf(u));

  const refs: string[] = [];
  const refLines: Ref[] = [];
  if (setup.studioImage) {
    refs.push(setup.studioImage);
    refLines.push({
      label: `Image ${refs.length}: the studio set. Keep the same set design, colors, furniture and lighting.`,
    });
  }
  const castLines = cast.map((s) => {
    if (s.designSheet) {
      refs.push(s.designSheet);
      refLines.push({
        label: `Image ${refs.length}: character design sheet of ${s.name}. Keep this exact face, hairstyle and outfit.`,
      });
      return `- ${describeSpeaker(s)} (looks exactly like Image ${refs.length})`;
    }
    return `- ${describeSpeaker(s)}`;
  });
  let contentRef: number | undefined;
  if (u.visualRef && setup.visual.contentMode !== "none") {
    refs.push(u.visualRef);
    contentRef = refs.length;
    refLines.push({ label: `Image ${refs.length}: the news picture to show in the content graphic.` });
  }

  return {
    references: refs,
    prompt: `${refLines.length ? `Reference images:\n${refLines.map((r) => `- ${r.label}`).join("\n")}\n\n` : ""}Create one frame of a Korean news podcast video.
${setup.studioImage ? "Setting: the studio in the reference image. Use it only as the environment (set design, colors, lighting); move the camera closer as described below instead of copying its wide empty-set angle." : `Setting: ${STUDIO_LAYOUTS[setup.visual.sceneStyle](setup.speakers.length)}`}
People in frame — exactly ${cast.length}, no one else, no duplicates:
${castLines.join("\n")}

${shot}
Mouth slightly open mid-speech so it clearly reads as talking.

What ${speaker.name} is saying (Korean, for mood and the content graphic only — do NOT write this sentence in the image):
"${line}"

${contentInstruction(setup, speaker, contentRef)}
Style: ${ART_STYLE_PROMPTS[setup.visual.artStyle]}
${COMMON_RULES}`,
  };
}
