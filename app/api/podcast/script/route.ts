import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { geminiJson } from "@/lib/gemini";
import { scriptPrompt, scriptSchema } from "@/lib/podcast/prompts";
import type { FactSheet, Script } from "@/lib/podcast/types";
import { normalizeScript, parseSetup } from "@/lib/podcast/validate";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/podcast/script — 팩트 시트 + 화자 설정 → 멀티 화자 대본 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { setup?: unknown; factSheet?: FactSheet };
    const setup = parseSetup(body.setup);
    if (!body.factSheet?.segments?.length) {
      throw new ProviderError("팩트 시트가 없습니다. 먼저 팩트 시트를 만들어주세요.", 400);
    }

    const names = setup.speakers.map((s) => s.name);
    const data = await geminiJson<Script>({
      prompt: scriptPrompt(setup, body.factSheet),
      schema: scriptSchema(names),
      temperature: 0.9,
    });

    return NextResponse.json({ script: normalizeScript(data, names, setup.targetMinutes) });
  } catch (err) {
    return errorResponse(err);
  }
}
