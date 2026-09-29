import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { geminiJson } from "@/lib/gemini";
import type { YoutubeMeta } from "@/lib/podcast/projects";
import { YOUTUBE_META_SCHEMA, youtubeMetaPrompt } from "@/lib/podcast/prompts";
import type { FactSheet, Script } from "@/lib/podcast/types";
import { parseSetup } from "@/lib/podcast/validate";
import { normalizeYoutubeMeta, showName } from "@/lib/podcast/youtube";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/podcast/youtube — 유튜브 업로드 정보(요약·해시태그·태그 추천). 제목은 화면에서 썸네일 문구로 조합한다. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      setup?: unknown;
      script?: Script | null;
      factSheet?: FactSheet | null;
      mainTitle?: string;
    };
    const setup = parseSetup(body.setup, { requireTopic: false });
    if (!body.script?.utterances?.length) throw new ProviderError("대본을 먼저 만들어주세요.", 400);

    const raw = await geminiJson<YoutubeMeta>({
      prompt: youtubeMetaPrompt({
        setup,
        script: body.script,
        factSheet: body.factSheet ?? null,
        mainTitle: body.mainTitle?.trim() || body.script.title,
        showName: showName(body.script),
      }),
      schema: YOUTUBE_META_SCHEMA,
      temperature: 0.7,
    });
    const meta = normalizeYoutubeMeta(raw);
    if (meta.hashtagsTop.length === 0 || meta.summary.length === 0) {
      throw new ProviderError("유튜브 정보를 만들지 못했습니다. 다시 시도해주세요.", 502);
    }
    return NextResponse.json({ meta });
  } catch (err) {
    return errorResponse(err);
  }
}
