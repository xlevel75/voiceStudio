import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getStore } from "@/lib/db";
import { getProvider, isProviderId } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/voices/:id — 잘못 만들어진 성우 삭제.
 * :id 는 DB의 내부 id, 또는 "<provider>:<voiceId>" 형태 둘 다 받는다.
 * 삭제 자격(내가 만든 것 + 망가진 것)은 공급자 구현체가 다시 확인한다.
 */
export async function DELETE(
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
    if (!provider.deleteVoice) {
      throw new ProviderError(
        `${providerId}는 성우 삭제를 지원하지 않습니다.`,
        400,
        providerId,
      );
    }

    await provider.deleteVoice(voiceId);

    // 공급자 쪽에서 지워졌으면 DB 레코드도 정리한다.
    if (record) {
      await store.remove(record.id).catch((err) => {
        console.error("[voices] DB 레코드 삭제 실패 (공급자에서는 삭제됨)", err);
      });
    }

    return NextResponse.json({ id, voiceId, deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
