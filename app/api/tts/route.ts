import { errorResponse } from "@/lib/api";
import { getProvider, isProviderId } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 플랜별 상한이 다르므로 배포 전 현재 값 확인 필요

/** POST /api/tts — 합성 결과 오디오를 그대로 스트림으로 내려준다. API 키는 서버에만 있다. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      provider?: string;
      voiceId?: string;
      text?: string;
      modelId?: string;
      options?: Record<string, string | number>;
    };

    if (!isProviderId(body.provider)) {
      throw new ProviderError("provider 파라미터가 올바르지 않습니다.", 400);
    }
    if (!body.voiceId) throw new ProviderError("성우를 선택해주세요.", 400);
    const text = body.text?.trim();
    if (!text) throw new ProviderError("변환할 텍스트를 입력해주세요.", 400);

    const provider = getProvider(body.provider);
    const result = await provider.synthesize({
      voiceId: body.voiceId,
      text,
      modelId: body.modelId,
      options: body.options,
    });

    return new Response(result.audio, {
      status: 200,
      headers: {
        "Content-Type": result.format === "mp3" ? "audio/mpeg" : "audio/wav",
        "Content-Length": String(result.audio.byteLength),
        // CLOVA는 약관상 저장/다운로드 금지 → 클라이언트가 이 헤더를 보고 재생만 한다.
        "X-Downloadable": result.downloadable ? "1" : "0",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
