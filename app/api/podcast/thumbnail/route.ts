import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { geminiImage, geminiJson } from "@/lib/gemini";
import { thumbnailPlan } from "@/lib/podcast/image-prompts";
import { THUMBNAIL_TEXT_SCHEMA, thumbnailTextPrompt } from "@/lib/podcast/prompts";
import { assetExt, getAssetStore } from "@/lib/podcast/store";
import type { FactSheet, Script } from "@/lib/podcast/types";
import { parseSetup } from "@/lib/podcast/validate";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 썸네일에 크게 들어가는 글자라 길면 모델이 틀리게 그린다. */
const MAX_TITLE = 20;
const MAX_SUBTITLE = 28;

/**
 * POST /api/podcast/thumbnail — 유튜브 썸네일 한 장.
 * title이 없으면 대본·팩트 시트를 보고 문구부터 만든다. 있으면 그 문구 그대로 그린다(사용자가 고친 문구).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      setup?: unknown;
      script?: Script | null;
      factSheet?: FactSheet | null;
      title?: string;
      subtitle?: string;
    };
    const setup = parseSetup(body.setup, { requireTopic: false });

    let title = body.title?.trim() ?? "";
    let subtitle = body.subtitle?.trim() ?? "";
    if (!title) {
      const text = await geminiJson<{ title: string; subtitle: string }>({
        prompt: thumbnailTextPrompt(setup, body.script ?? null, body.factSheet ?? null),
        schema: THUMBNAIL_TEXT_SCHEMA,
        temperature: 1,
      });
      title = text.title?.trim() ?? "";
      subtitle = subtitle || text.subtitle?.trim() || "";
    }
    if (!title) throw new ProviderError("썸네일 문구를 만들지 못했습니다. 다시 시도해주세요.", 502);
    // 길이 제한은 사용자가 직접 쓴 문구에만 건다. (AI 문구는 프롬프트에서 14자 이내로 요청)
    if (body.title?.trim() && title.length > MAX_TITLE) {
      throw new ProviderError(
        `메인 문구는 ${MAX_TITLE}자 이내로 써주세요. 길면 글자가 틀리게 그려집니다.`,
        400,
      );
    }
    if (body.subtitle?.trim() && subtitle.length > MAX_SUBTITLE) {
      throw new ProviderError(`보조 문구는 ${MAX_SUBTITLE}자 이내로 써주세요.`, 400);
    }

    const plan = thumbnailPlan(setup, title, subtitle);
    const store = getAssetStore();
    const references = await Promise.all(
      plan.references.map(async (id) => {
        const asset = await store.get(id);
        if (!asset) {
          throw new ProviderError(
            "참조 이미지(디자인시트·스튜디오)를 찾을 수 없습니다. 다시 올려주세요.",
            409,
          );
        }
        return { mimeType: asset.contentType, data: asset.data };
      }),
    );

    const image = await geminiImage({ model: setup.visual.imageModel, prompt: plan.prompt, references });
    const assetId = `${crypto.randomUUID()}.${assetExt(image.mimeType) ?? "png"}`;
    await store.put(assetId, image.data, image.mimeType);

    return NextResponse.json({ assetId, title, subtitle });
  } catch (err) {
    return errorResponse(err);
  }
}
