import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { geminiJson } from "@/lib/gemini";
import { TAGS_SCHEMA, tagsPrompt } from "@/lib/podcast/prompts";
import { stripTags } from "@/lib/podcast/tags";
import { EMOTIONS, type Emotion, type FactSheet, type Script, type Speaker } from "@/lib/podcast/types";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 한 번에 태그를 다는 발화 수. 긴 에피소드는 나눠서 동시에 요청한다. */
const CHUNK = 50;

type Tagged = { seq: number; text: string; emotion: Emotion };

/** 띄어쓰기 차이는 무시하고 글자만 비교한다. */
const sameWords = (a: string, b: string) =>
  stripTags(a).replace(/\s+/g, "") === stripTags(b).replace(/\s+/g, "");

/**
 * POST /api/podcast/tags — 대본에 상황에 맞는 오디오 태그를 단다.
 * 대사 문구가 바뀐 결과는 버린다. (태그만 입히는 기능이므로)
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      script?: Script;
      speakers?: Speaker[];
      factSheet?: FactSheet | null;
      targetSeqs?: number[];
    };
    const script = body.script;
    if (!script?.utterances?.length) throw new ProviderError("대본이 없습니다.", 400);

    const bySeq = new Map(script.utterances.map((u) => [u.seq, u]));
    const targets = (body.targetSeqs?.length ? body.targetSeqs : script.utterances.map((u) => u.seq)).filter(
      (seq) => bySeq.get(seq)?.text.trim(),
    );
    if (targets.length === 0) throw new ProviderError("태그를 달 대사가 없습니다.", 400);

    const chunks: number[][] = [];
    for (let i = 0; i < targets.length; i += CHUNK) chunks.push(targets.slice(i, i + CHUNK));

    const results = await Promise.all(
      chunks.map((targetSeqs) =>
        geminiJson<{ utterances: Tagged[] }>({
          prompt: tagsPrompt({
            script,
            speakers: body.speakers ?? [],
            factSheet: body.factSheet ?? null,
            targetSeqs,
          }),
          schema: TAGS_SCHEMA,
          temperature: 0.6,
        }),
      ),
    );

    const wanted = new Set(targets);
    const utterances: Tagged[] = [];
    const skipped: number[] = [];
    for (const item of results.flatMap((r) => r.utterances ?? [])) {
      const original = bySeq.get(item.seq);
      if (!original || !wanted.has(item.seq)) continue;
      wanted.delete(item.seq);
      if (!sameWords(item.text, original.text)) {
        skipped.push(item.seq);
        continue;
      }
      utterances.push({
        seq: item.seq,
        text: item.text.trim(),
        emotion: EMOTIONS.includes(item.emotion) ? item.emotion : original.emotion,
      });
    }
    // 모델이 빠뜨린 발화도 "적용 못 함"으로 알려 준다.
    skipped.push(...wanted);

    return NextResponse.json({ utterances, skipped: skipped.sort((a, b) => a - b) });
  } catch (err) {
    return errorResponse(err);
  }
}
