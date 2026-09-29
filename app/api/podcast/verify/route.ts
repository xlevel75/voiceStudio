import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { geminiJson } from "@/lib/gemini";
import { VERIFY_SCHEMA, verifyPrompt } from "@/lib/podcast/prompts";
import type { FactSheet, Script, VerifyFlag } from "@/lib/podcast/types";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /api/podcast/verify — 대본 vs 팩트 시트 대조 → 발화별 경고 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { factSheet?: FactSheet; script?: Script };
    if (!body.factSheet || !body.script?.utterances?.length) {
      throw new ProviderError("팩트 시트와 대본이 모두 필요합니다.", 400);
    }

    const data = await geminiJson<{ flags: VerifyFlag[] }>({
      prompt: verifyPrompt(body.factSheet, body.script),
      schema: VERIFY_SCHEMA,
      temperature: 0,
    });

    const seqs = new Set(body.script.utterances.map((u) => u.seq));
    const flags = (data.flags ?? []).filter((f) => seqs.has(f.seq));
    return NextResponse.json({ flags });
  } catch (err) {
    return errorResponse(err);
  }
}
