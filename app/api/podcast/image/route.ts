import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { geminiImage } from "@/lib/gemini";
import { characterSheetPlan, scenePlan, studioPlan, type ImagePlan } from "@/lib/podcast/image-prompts";
import { assetExt, getAssetStore } from "@/lib/podcast/store";
import type { Utterance } from "@/lib/podcast/types";
import { parseSetup } from "@/lib/podcast/validate";
import { sceneSignature } from "@/lib/podcast/visual";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/podcast/image — 이미지 한 장을 만들어 에셋으로 저장하고 id를 돌려준다.
 * kind
 * - studio: 기준 스튜디오 (사람 없음)
 * - character: 화자 디자인시트 (speakerId)
 * - scene: 발화 장면 (utterance) — 스튜디오·디자인시트를 참조해 인물과 배경을 유지한다
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      kind?: "studio" | "character" | "scene";
      setup?: unknown;
      speakerId?: string;
      utterance?: Pick<Utterance, "speaker" | "text" | "emotion" | "visualRef">;
    };
    const setup = parseSetup(body.setup, { requireTopic: false });

    let plan: ImagePlan;
    let sig: string | undefined;
    switch (body.kind) {
      case "studio":
        plan = studioPlan(setup);
        break;
      case "character": {
        const speaker = setup.speakers.find((s) => s.id === body.speakerId);
        if (!speaker) throw new ProviderError("화자를 찾을 수 없습니다.", 400);
        plan = characterSheetPlan(setup, speaker);
        break;
      }
      case "scene": {
        const u = body.utterance;
        if (!u?.text?.trim()) throw new ProviderError("대사가 비어 있습니다.", 400);
        try {
          plan = scenePlan(setup, u);
        } catch (err) {
          throw new ProviderError((err as Error).message, 400);
        }
        sig = sceneSignature(u, setup);
        break;
      }
      default:
        throw new ProviderError("kind는 studio, character, scene 중 하나여야 합니다.", 400);
    }

    const store = getAssetStore();
    const references = await Promise.all(
      plan.references.map(async (id) => {
        const asset = await store.get(id);
        if (!asset)
          throw new ProviderError(
            "참조 이미지(디자인시트·스튜디오)를 찾을 수 없습니다. 다시 올려주세요.",
            409,
          );
        return { mimeType: asset.contentType, data: asset.data };
      }),
    );

    const image = await geminiImage({ model: setup.visual.imageModel, prompt: plan.prompt, references });
    const ext = assetExt(image.mimeType) ?? "png";
    const id = `${crypto.randomUUID()}.${ext}`;
    await store.put(id, image.data, image.mimeType);

    return NextResponse.json({ assetId: id, sig });
  } catch (err) {
    return errorResponse(err);
  }
}
