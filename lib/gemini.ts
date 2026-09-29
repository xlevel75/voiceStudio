import { missingEnvMessage } from "@/lib/env";
import { ProviderError } from "@/lib/providers/types";

/** 모델명은 수개월 단위로 교체되므로 환경 변수로 바꿀 수 있게 둔다. */
const DEFAULT_TEXT_MODEL = "gemini-3.8-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GroundingSource {
  title: string;
  url: string;
}

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
};

async function callGemini(body: object) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ProviderError(missingEnvMessage("GEMINI_API_KEY"), 503);
  const model = process.env.GEMINI_TEXT_MODEL || DEFAULT_TEXT_MODEL;

  const res = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    const detail = json.error?.message ?? res.statusText;
    throw new ProviderError(
      `Gemini 호출에 실패했습니다 (${model}: ${detail})`,
      res.status >= 500 ? 502 : res.status,
    );
  }
  if (json.promptFeedback?.blockReason) {
    throw new ProviderError(`Gemini가 요청을 거부했습니다 (${json.promptFeedback.blockReason})`, 422);
  }

  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  if (!text.trim()) {
    throw new ProviderError(
      `Gemini 응답이 비어 있습니다 (finishReason: ${candidate?.finishReason ?? "?"})`,
      502,
    );
  }
  return { text, finishReason: candidate?.finishReason, grounding: candidate?.groundingMetadata };
}

/**
 * Google 검색 그라운딩으로 자유 형식 텍스트를 받는다.
 * JSON 모드와 검색을 함께 켜면 groundingMetadata가 빠져 실제로 검색했는지 알 수 없다.
 * 그래서 검색은 이 함수로 따로 하고, 구조화는 geminiJson으로 나눈다.
 */
export async function geminiSearch(prompt: string): Promise<{ text: string; sources: GroundingSource[] }> {
  const { text, grounding } = await callGemini({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2 },
  });
  const seen = new Set<string>();
  const sources = (grounding?.groundingChunks ?? [])
    .map((c) => c.web)
    .filter((w): w is { uri: string; title?: string } => !!w?.uri)
    .filter((w) => !seen.has(w.uri) && !!seen.add(w.uri))
    .map((w) => ({ title: w.title ?? w.uri, url: w.uri }));
  return { text, sources };
}

/** 응답을 responseSchema에 맞춘 JSON으로 받는다. */
export async function geminiJson<T>(input: {
  prompt: string;
  schema: object;
  temperature?: number;
}): Promise<T> {
  const { text, finishReason } = await callGemini({
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: input.schema,
      temperature: input.temperature ?? 0.7,
      maxOutputTokens: 32768,
    },
  });
  return parseJson<T>(text, finishReason);
}

/** 스키마를 지정해도 코드펜스나 앞뒤 잡담이 섞여 올 때가 있어 가장 바깥 {...}만 떼어 파싱한다. */
function parseJson<T>(text: string, finishReason?: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        /* 아래에서 처리 */
      }
    }
    const hint = finishReason === "MAX_TOKENS" ? " 출력이 잘렸습니다. 분량을 줄여 다시 시도하세요." : "";
    throw new ProviderError(`Gemini 응답을 JSON으로 읽지 못했습니다.${hint}`, 502);
  }
}

type ImagePart = { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } };

/**
 * Nano Banana(Gemini 이미지 모델)로 이미지를 만든다.
 * references는 프롬프트 앞에 순서대로 붙는다. 프롬프트에서 "Image 1, Image 2…"로 가리킨다.
 */
export async function geminiImage(input: {
  model: string;
  prompt: string;
  references?: { mimeType: string; data: Uint8Array }[];
  aspectRatio?: string;
}): Promise<{ mimeType: string; data: Uint8Array }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ProviderError(missingEnvMessage("GEMINI_API_KEY"), 503);

  const parts = [
    ...(input.references ?? []).map((r) => ({
      inlineData: { mimeType: r.mimeType, data: Buffer.from(r.data).toString("base64") },
    })),
    { text: input.prompt },
  ];
  const res = await fetch(`${API_BASE}/${input.model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: input.aspectRatio ?? "16:9", imageSize: "1K" },
      },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as Omit<GeminiResponse, "candidates"> & {
    candidates?: { content?: { parts?: ImagePart[] }; finishReason?: string }[];
  };
  if (!res.ok) {
    const detail = json.error?.message ?? res.statusText;
    throw new ProviderError(
      `이미지 생성에 실패했습니다 (${input.model}: ${detail})`,
      res.status >= 500 ? 502 : res.status,
    );
  }
  if (json.promptFeedback?.blockReason) {
    throw new ProviderError(`이미지 요청이 거부됐습니다 (${json.promptFeedback.blockReason})`, 422);
  }
  const candidate = json.candidates?.[0];
  const image = (candidate?.content?.parts ?? []).find((p) => p.inlineData?.data && !p.thought)?.inlineData;
  if (!image?.data) {
    throw new ProviderError(
      `이미지가 만들어지지 않았습니다 (finishReason: ${candidate?.finishReason ?? "?"}). 대사나 설명을 조금 바꿔 다시 시도하세요.`,
      502,
    );
  }
  return { mimeType: image.mimeType ?? "image/png", data: new Uint8Array(Buffer.from(image.data, "base64")) };
}
