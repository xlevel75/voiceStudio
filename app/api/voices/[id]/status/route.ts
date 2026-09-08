import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getStore } from "@/lib/db";
import { getProvider, isProviderId } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/voices/:id/status — PVC 학습 상태 폴링.
 * :id 는 DB의 내부 id, 또는 "<provider>:<voiceId>" 형태 둘 다 받는다.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const store = getStore();
    const record = await store.get(id).catch(() => null);

    let providerId = record?.provider;
    let voiceId = record?.voiceId;

    if (!voiceId) {
      const [prefix, ...rest] = id.split(":");
      if (isProviderId(prefix) && rest.length > 0) {
        providerId = prefix;
        voiceId = rest.join(":");
      }
    }
    if (!providerId || !voiceId) {
      throw new ProviderError("성우를 찾을 수 없습니다.", 404);
    }

    const provider = getProvider(providerId);
    if (!provider.getVoiceStatus) {
      return NextResponse.json({ id, status: "ready" });
    }

    const status = await provider.getVoiceStatus(voiceId);
    if (record && record.status !== status) {
      await store.updateStatus(record.id, status).catch(() => {});
    }
    return NextResponse.json({ id, voiceId, status });
  } catch (err) {
    return errorResponse(err);
  }
}
