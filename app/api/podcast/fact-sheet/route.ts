import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { geminiJson, geminiSearch, type GroundingSource } from "@/lib/gemini";
import { FACT_SHEET_SCHEMA, factSheetPrompt, researchPrompt } from "@/lib/podcast/prompts";
import type { FactSheet } from "@/lib/podcast/types";
import { parseSetup } from "@/lib/podcast/validate";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 웹 검색 + 구조화로 수십 초 걸린다. 플랜별 상한 확인 필요

/** POST /api/podcast/fact-sheet — 주제·자료 → (웹 검색) → 팩트 시트 */
export async function POST(request: Request) {
  try {
    const setup = parseSetup(await request.json());
    if (!setup.sourceText.trim() && !setup.useWebSearch) {
      throw new ProviderError("자료를 붙여넣거나 웹 검색을 켜주세요.", 400);
    }

    let research: string | undefined;
    let groundingSources: GroundingSource[] = [];
    if (setup.useWebSearch) {
      const found = await geminiSearch(researchPrompt(setup));
      research = found.text;
      groundingSources = found.sources;
    }

    const factSheet = await geminiJson<FactSheet>({
      prompt: factSheetPrompt(setup, research),
      schema: FACT_SHEET_SCHEMA,
      temperature: 0.2,
    });
    if (!factSheet.segments?.length) {
      throw new ProviderError(
        "팩트 시트에 꼭지가 없습니다. 주제를 더 구체적으로 적거나 자료를 붙여넣어 주세요.",
        422,
      );
    }

    return NextResponse.json({ factSheet, groundingSources });
  } catch (err) {
    return errorResponse(err);
  }
}
