import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getStore, recordToVoice, type VoiceRecord } from "@/lib/db";
import { getProvider, isProviderId } from "@/lib/providers";
import { ProviderError, type CloneMode, type Voice } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 성우 생성은 오디오 샘플 업로드를 포함해 오래 걸린다.
// 플랜별 상한이 다르므로 배포가 거부되면 이 값을 낮출 것.
export const maxDuration = 60;

/** GET /api/voices?provider= — 공급자 API 결과와 DB에 저장된 내 성우를 병합한다. */
export async function GET(request: Request) {
  try {
    const providerId = new URL(request.url).searchParams.get("provider");
    if (!isProviderId(providerId)) {
      throw new ProviderError("provider 파라미터가 올바르지 않습니다.", 400);
    }

    const provider = getProvider(providerId);
    const [remote, records] = await Promise.all([
      provider.listVoices(),
      getStore().list(providerId).catch(() => [] as VoiceRecord[]),
    ]);

    const byVoiceId = new Map<string, Voice>();
    for (const v of remote) byVoiceId.set(v.voiceId, v);

    // DB 레코드는 내부 id/모드를 갖고 있으므로 우선 적용.
    // 이름·상태·상태설명은 공급자 쪽이 최신이므로 그쪽 값을 덮어쓴다.
    for (const r of records) {
      const remoteMatch = byVoiceId.get(r.voiceId);
      byVoiceId.set(r.voiceId, {
        ...recordToVoice(r),
        ...(remoteMatch
          ? {
              name: remoteMatch.name,
              status: remoteMatch.status,
              statusDetail: remoteMatch.statusDetail,
              description: remoteMatch.description,
              deletable: remoteMatch.deletable,
            }
          : {}),
        id: r.id,
        mode: r.mode ?? remoteMatch?.mode,
        isOwn: true,
      });
    }

    // 내 성우를 상단 고정, 그 안에서는 최신순.
    const voices = [...byVoiceId.values()].sort((a, b) => {
      if (!!a.isOwn !== !!b.isOwn) return a.isOwn ? -1 : 1;
      if (a.isOwn) return b.createdAt.localeCompare(a.createdAt);
      return a.name.localeCompare(b.name, "ko");
    });

    return NextResponse.json({ voices, capabilities: provider.capabilities });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST /api/voices — 성우 생성 (IVC 동기 / PVC 비동기 시작). */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      provider?: string;
      name?: string;
      mode?: CloneMode;
      audioUrls?: string[];
      consent?: boolean;
    };

    if (!isProviderId(body.provider)) {
      throw new ProviderError("provider 파라미터가 올바르지 않습니다.", 400);
    }
    const provider = getProvider(body.provider);
    if (!provider.capabilities.canCreateVoice || !provider.createVoice) {
      throw new ProviderError(
        `${body.provider}는 셀프 성우 만들기를 지원하지 않습니다.`,
        400,
        body.provider,
      );
    }
    const name = body.name?.trim();
    if (!name) throw new ProviderError("성우 이름을 입력해주세요.", 400);
    if (!body.consent) {
      throw new ProviderError("목소리에 대한 권리 보유 동의가 필요합니다.", 400);
    }
    const mode = body.mode ?? "ivc";
    if (!provider.capabilities.cloneModes.includes(mode)) {
      throw new ProviderError(`지원하지 않는 복제 모드입니다: ${mode}`, 400);
    }
    const audioUrls = (body.audioUrls ?? []).filter(Boolean);
    if (audioUrls.length === 0) {
      throw new ProviderError("오디오 파일을 최소 1개 업로드해주세요.", 400);
    }

    const created = await provider.createVoice({ name, mode, audioUrls, consent: true });

    const record: VoiceRecord = {
      id: randomUUID(),
      provider: created.provider,
      voiceId: created.voiceId,
      name: created.name,
      mode: created.mode ?? null,
      status: created.status,
      isPreset: false,
      createdAt: created.createdAt,
    };

    // DB 저장 실패가 성우 생성 자체를 되돌리지는 않는다. 목록 갱신 시 공급자 API로 복구된다.
    try {
      await getStore().insert(record);
    } catch (dbErr) {
      console.error("[voices] DB 저장 실패 (공급자에는 생성됨)", dbErr);
    }

    return NextResponse.json({ voice: { ...created, id: record.id } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
