import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { readBlobAsUpload } from "@/lib/blob";
import { concatBuffers, splitText, streamToArrayBuffer } from "@/lib/text";
import { ELEVENLABS_CAPABILITIES } from "./capabilities";
import {
  ProviderError,
  type CreateVoiceInput,
  type SynthesizeInput,
  type SynthesizeResult,
  type Voice,
  type VoiceProvider,
  type VoiceStatus,
} from "./types";

/** TTS에 실제로 쓰는 모델. 상태 판정도 이 모델 기준으로 본다. */
const PRIMARY_MODEL = "eleven_multilingual_v2";

/** ElevenLabs PVC 최소 녹음 요건(권장). 이보다 짧으면 학습이 시작되지 않는다. */
const PVC_MIN_MINUTES = 30;

type FineTuning = { state?: Record<string, string>; isAllowedToFineTune?: boolean };

/**
 * 파인튜닝 상태를 UI 상태로 옮긴다.
 *
 * 두 가지를 조심해야 한다.
 * 1) state는 모델별 맵이다. 일부 모델만 failed여도 우리가 쓰는 모델이 fine_tuned면
 *    그 보이스는 멀쩡히 사용 가능하다. 그래서 실제 쓰는 모델을 먼저 보고,
 *    그다음 "하나라도 fine_tuned면 ready"로 판단한다.
 * 2) state가 비어 있다는 건 "학습 이력이 없다"는 뜻일 뿐 "사용 가능"이 아니다.
 *    IVC/프리셋은 애초에 학습이 없으니 ready지만, 내가 만든 PVC가 비어 있으면
 *    학습이 시작조차 안 된 것이므로 ready로 보면 안 된다.
 */
function toStatus(fineTuning: FineTuning | undefined, isOwnPvc: boolean): VoiceStatus {
  const state = fineTuning?.state ?? {};
  const primary = state[PRIMARY_MODEL];
  if (primary === "fine_tuned") return "ready";
  if (primary === "failed") return "failed";

  const states = Object.values(state);
  if (states.length === 0) return isOwnPvc ? "training" : "ready";
  if (states.some((v) => v === "fine_tuned")) return "ready";
  if (states.every((v) => v === "failed")) return "failed";
  return "training"; // not_started | queued | fine_tuning | delayed
}

/**
 * "잘못 만들어진 성우"인가 — 삭제 버튼을 띄울 대상.
 * 내가 만든 것 중에서 (1) 학습에 실패했거나 (2) PVC인데 학습이 시작조차 되지 않아
 * 슬롯만 차지하는 껍데기인 경우다.
 * 정상 동작하는 성우와 진짜로 학습 중인 성우는 여기 해당하지 않는다.
 */
function isBroken(fineTuning: FineTuning | undefined, isOwn: boolean, category: string): boolean {
  if (!isOwn) return false;
  const isOwnPvc = category === "professional";
  if (toStatus(fineTuning, isOwnPvc) === "failed") return true;
  const notStarted = Object.keys(fineTuning?.state ?? {}).length === 0;
  return isOwnPvc && notStarted && fineTuning?.isAllowedToFineTune === false;
}

/** 내가 만든 PVC가 왜 멈춰 있는지 목록에 한 줄로 설명해 준다. */
function statusDetail(fineTuning: FineTuning | undefined, isOwnPvc: boolean): string | undefined {
  if (!isOwnPvc) return undefined;
  const states = Object.values(fineTuning?.state ?? {});
  if (states.some((v) => v === "fine_tuned")) return undefined;
  if (states.length > 0 && states.every((v) => v === "failed")) return "학습에 실패했습니다.";
  if (states.length > 0) return "학습이 진행 중입니다. 완료까지 수 시간이 걸립니다.";
  if (fineTuning?.isAllowedToFineTune === false) {
    return `학습이 시작되지 않았습니다. 녹음이 PVC 최소 요건(${PVC_MIN_MINUTES}분 이상)에 못 미칩니다. 이 성우는 슬롯만 차지하므로 삭제하세요.`;
  }
  return "학습 시작을 기다리고 있습니다.";
}

export class ElevenLabsProvider implements VoiceProvider {
  readonly id = "elevenlabs" as const;
  readonly capabilities = ELEVENLABS_CAPABILITIES;
  private client: ElevenLabsClient;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!key) {
      throw new ProviderError(
        "ELEVENLABS_API_KEY가 설정되지 않았습니다. .env.local에 키를 넣어주세요.",
        503,
        "elevenlabs",
      );
    }
    this.client = new ElevenLabsClient({ apiKey: key });
  }

  async listVoices(): Promise<Voice[]> {
    try {
      const res = await this.client.voices.getAll();
      return (res.voices ?? []).map((v) => {
        const category = v.category ?? "premade";
        // 소유 판정은 category가 아니라 isOwner로 한다.
        // 보이스 라이브러리에서 추가한 남의 보이스도 category는 "professional"이라,
        // category만 보면 라이브러리 보이스가 "내 성우"로 잘못 올라온다.
        const isOwn = v.isOwner ?? (category === "cloned" || category === "generated");
        const isOwnPvc = isOwn && category === "professional";
        const fineTuning = v.fineTuning as FineTuning | undefined;
        return {
          id: `elevenlabs:${v.voiceId}`,
          provider: "elevenlabs" as const,
          voiceId: v.voiceId,
          name: v.name ?? v.voiceId,
          // 복제 모드 배지는 내가 만든 성우에만 의미가 있다.
          mode: !isOwn
            ? undefined
            : category === "professional"
              ? ("pvc" as const)
              : category === "cloned"
                ? ("ivc" as const)
                : undefined,
          status: toStatus(fineTuning, isOwnPvc),
          isPreset: !isOwn,
          createdAt: v.createdAtUnix
            ? new Date(v.createdAtUnix * 1000).toISOString()
            : new Date(0).toISOString(),
          isOwn,
          description: v.description ?? undefined,
          statusDetail: statusDetail(fineTuning, isOwnPvc),
          deletable: isBroken(fineTuning, isOwn, category),
        };
      });
    } catch (err) {
      throw wrap(err, "성우 목록을 불러오지 못했습니다.");
    }
  }

  /** PVC 사전 점검용 구독 정보. user_read 권한이 없으면 null(=점검 생략). */
  private async getPvcQuota(): Promise<{
    tier: string;
    canUsePvc: boolean;
    used: number;
    limit: number;
  } | null> {
    try {
      const sub = (await this.client.user.subscription.get()) as {
        tier?: string;
        canUseProfessionalVoiceCloning?: boolean;
        professionalVoiceSlotsUsed?: number;
        professionalVoiceLimit?: number;
      };
      return {
        tier: sub.tier ?? "unknown",
        canUsePvc: sub.canUseProfessionalVoiceCloning ?? true,
        used: Number(sub.professionalVoiceSlotsUsed ?? 0),
        limit: Number(sub.professionalVoiceLimit ?? 0),
      };
    } catch {
      // API 키에 user_read 스코프가 없으면 조회할 수 없다. 사전 점검만 건너뛴다.
      return null;
    }
  }

  async createVoice(input: CreateVoiceInput): Promise<Voice> {
    if (!input.consent) {
      throw new ProviderError("권리 보유 동의가 필요합니다.", 400, "elevenlabs");
    }
    if (input.audioUrls.length === 0) {
      throw new ProviderError("오디오 파일이 최소 1개 필요합니다.", 400, "elevenlabs");
    }

    // private 스토어는 URL 직접 fetch가 막혀 있어 Blob SDK로 인증해 읽는다.
    const files = await Promise.all(input.audioUrls.map(readBlobAsUpload));

    if (input.mode === "ivc") {
      try {
        const created = await this.client.voices.ivc.create({ name: input.name, files });
        return {
          id: `elevenlabs:${created.voiceId}`,
          provider: "elevenlabs",
          voiceId: created.voiceId,
          name: input.name,
          mode: "ivc",
          status: "ready",
          isPreset: false,
          createdAt: new Date().toISOString(),
          isOwn: true,
        };
      } catch (err) {
        throw wrap(err, "성우 생성에 실패했습니다.");
      }
    }

    // ── PVC ──────────────────────────────────────────────────────────────
    // 아무것도 만들기 전에 플랜/슬롯부터 확인한다. 슬롯이 없는데 진행하면
    // 학습되지 않는 껍데기 보이스만 남아 슬롯을 계속 차지한다.
    const quota = await this.getPvcQuota();
    if (quota && !quota.canUsePvc) {
      throw new ProviderError(
        `현재 플랜(${quota.tier})에서는 PVC를 사용할 수 없습니다. Creator 이상으로 업그레이드하거나 IVC를 사용하세요.`,
        403,
        "elevenlabs",
      );
    }
    if (quota && quota.limit > 0 && quota.used >= quota.limit) {
      throw new ProviderError(
        `PVC 슬롯이 가득 찼습니다 (${quota.used}/${quota.limit}, ${quota.tier} 플랜). ` +
          `ElevenLabs에서 기존 PVC 성우를 삭제한 뒤 다시 시도하세요.`,
        409,
        "elevenlabs",
      );
    }

    // 생성 → 샘플 업로드 → 학습 시작. 완료까지 수 시간 → 폴링으로 확인한다.
    // 중간에 실패하면 이미 만들어진 껍데기 보이스를 지워 슬롯을 돌려준다.
    let createdVoiceId: string | undefined;
    try {
      const created = await this.client.voices.pvc.create({ name: input.name, language: "ko" });
      createdVoiceId = created.voiceId;

      await this.client.voices.pvc.samples.create(createdVoiceId, { files });
      await this.client.voices.pvc.train(createdVoiceId, { modelId: PRIMARY_MODEL });

      // train()이 성공을 반환해도 조건 미달이면 학습이 실제로 시작되지 않는다.
      // 그 경우 보이스는 "만들어진 것처럼" 남아 슬롯만 차지하므로 실패로 처리한다.
      const check = await this.client.voices.get(createdVoiceId);
      const ft = check.fineTuning as FineTuning | undefined;
      const started = Object.keys(ft?.state ?? {}).length > 0;
      if (!started && ft?.isAllowedToFineTune === false) {
        throw new ProviderError(
          `PVC 학습이 시작되지 않았습니다. 업로드한 녹음이 ElevenLabs의 최소 요건에 미치지 못합니다 ` +
            `(PVC는 ${PVC_MIN_MINUTES}분 이상, 2~3시간 권장). 짧은 샘플이라면 IVC를 사용하세요.`,
          422,
          "elevenlabs",
        );
      }

      return {
        id: `elevenlabs:${createdVoiceId}`,
        provider: "elevenlabs",
        voiceId: createdVoiceId,
        name: input.name,
        mode: "pvc",
        status: "training",
        isPreset: false,
        createdAt: new Date().toISOString(),
        isOwn: true,
      };
    } catch (err) {
      const cleanup = createdVoiceId ? await this.deleteQuietly(createdVoiceId) : null;
      const base = wrap(err, "성우 생성에 실패했습니다.");
      const suffix =
        cleanup === true
          ? " 생성 중이던 성우는 자동으로 삭제해 PVC 슬롯을 반환했습니다."
          : cleanup === false
            ? ` 생성 중이던 성우(${createdVoiceId})를 자동 삭제하지 못했습니다. ElevenLabs에서 직접 삭제하세요.`
            : "";
      throw new ProviderError(base.message + suffix, base.status, "elevenlabs");
    }
  }

  /**
   * voiceId로 성우 하나를 찾는다.
   *
   * 반드시 listVoices()(=voices.getAll())를 거친다. 단건 조회 voices.get()은
   * isOwner를 돌려주지 않아서, 그걸로 소유 판정을 하면 내가 만든 성우도
   * "남의 보이스"로 잘못 판단된다.
   */
  private async findVoice(voiceId: string): Promise<Voice | undefined> {
    const voices = await this.listVoices();
    return voices.find((v) => v.voiceId === voiceId);
  }

  /**
   * 잘못 만들어진 성우만 삭제한다.
   * 클라이언트가 보낸 값을 믿지 않고, 목록 조회 결과로 자격을 다시 확인한다.
   */
  async deleteVoice(voiceId: string): Promise<void> {
    const target = await this.findVoice(voiceId);
    if (!target) {
      throw new ProviderError("삭제할 성우를 찾지 못했습니다.", 404, "elevenlabs");
    }
    if (!target.isOwn) {
      throw new ProviderError(
        "내가 만든 성우만 삭제할 수 있습니다. 라이브러리 보이스는 대상이 아닙니다.",
        403,
        "elevenlabs",
      );
    }
    if (!target.deletable) {
      throw new ProviderError(
        "정상 동작하거나 학습이 진행 중인 성우는 여기서 삭제할 수 없습니다. " +
          "ElevenLabs 대시보드에서 직접 삭제하세요.",
        400,
        "elevenlabs",
      );
    }

    try {
      await this.client.voices.delete(voiceId);
    } catch (err) {
      throw wrap(err, "성우 삭제에 실패했습니다.");
    }
  }

  /** 정리용 삭제. 성공/실패만 알려주고 예외를 밖으로 던지지 않는다. */
  private async deleteQuietly(voiceId: string): Promise<boolean> {
    try {
      await this.client.voices.delete(voiceId);
      return true;
    } catch (err) {
      console.error("[elevenlabs] 임시 보이스 삭제 실패", voiceId, err);
      return false;
    }
  }

  async getVoiceStatus(voiceId: string): Promise<VoiceStatus> {
    try {
      // voices.get()은 isOwner를 주지 않아 PVC 여부를 오판한다. 목록 기준으로 본다.
      const target = await this.findVoice(voiceId);
      if (!target) {
        throw new ProviderError("성우를 찾지 못했습니다.", 404, "elevenlabs");
      }
      return target.status;
    } catch (err) {
      throw wrap(err, "성우 상태를 확인하지 못했습니다.");
    }
  }

  async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
    const chunks = splitText(input.text, this.capabilities.maxTextLength);
    if (chunks.length === 0) {
      throw new ProviderError("변환할 텍스트가 비어 있습니다.", 400, "elevenlabs");
    }

    try {
      const buffers: ArrayBuffer[] = [];
      for (const chunk of chunks) {
        const stream = await this.client.textToSpeech.convert(input.voiceId, {
          text: chunk,
          modelId: input.modelId ?? "eleven_multilingual_v2",
          outputFormat: "mp3_44100_128",
        });
        buffers.push(await streamToArrayBuffer(stream));
      }
      return { audio: concatBuffers(buffers), format: "mp3", downloadable: true };
    } catch (err) {
      throw wrap(err, "음성 변환에 실패했습니다.");
    }
  }
}

function wrap(err: unknown, fallback: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const status = typeof (err as { statusCode?: number })?.statusCode === "number"
    ? (err as { statusCode: number }).statusCode
    : 502;
  const detail = (err as { body?: { detail?: { message?: string } } })?.body?.detail?.message
    ?? (err as Error)?.message;
  return new ProviderError(detail ? `${fallback} (${detail})` : fallback, status, "elevenlabs");
}
