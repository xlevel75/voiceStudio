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

/** 사용자가 직접 만들었거나 소유한 보이스로 볼 카테고리. 목록 상단에 고정된다. */
const OWNED_CATEGORIES = new Set(["cloned", "professional", "generated"]);

function toStatus(fineTuning: { state?: Record<string, string> } | undefined): VoiceStatus {
  const states = Object.values(fineTuning?.state ?? {});
  if (states.length === 0) return "ready"; // IVC/프리셋은 파인튜닝 상태가 없다
  if (states.some((s) => s === "failed")) return "failed";
  if (states.some((s) => s === "fine_tuned")) return "ready";
  return "training"; // not_started | queued | fine_tuning | delayed
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
        const isOwn = OWNED_CATEGORIES.has(category);
        return {
          id: `elevenlabs:${v.voiceId}`,
          provider: "elevenlabs" as const,
          voiceId: v.voiceId,
          name: v.name ?? v.voiceId,
          mode: category === "professional" ? ("pvc" as const) : category === "cloned" ? ("ivc" as const) : undefined,
          status: toStatus(v.fineTuning as { state?: Record<string, string> } | undefined),
          isPreset: !isOwn,
          createdAt: v.createdAtUnix
            ? new Date(v.createdAtUnix * 1000).toISOString()
            : new Date(0).toISOString(),
          isOwn,
          description: v.description ?? undefined,
        };
      });
    } catch (err) {
      throw wrap(err, "성우 목록을 불러오지 못했습니다.");
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

    try {
      if (input.mode === "ivc") {
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
      }

      // PVC: 생성 → 샘플 업로드 → 학습 시작. 완료까지 수 시간 → 폴링으로 확인한다.
      const created = await this.client.voices.pvc.create({ name: input.name, language: "ko" });
      await this.client.voices.pvc.samples.create(created.voiceId, { files });
      await this.client.voices.pvc.train(created.voiceId, { modelId: "eleven_multilingual_v2" });

      return {
        id: `elevenlabs:${created.voiceId}`,
        provider: "elevenlabs",
        voiceId: created.voiceId,
        name: input.name,
        mode: "pvc",
        status: "training",
        isPreset: false,
        createdAt: new Date().toISOString(),
        isOwn: true,
      };
    } catch (err) {
      throw wrap(err, "성우 생성에 실패했습니다.");
    }
  }

  async getVoiceStatus(voiceId: string): Promise<VoiceStatus> {
    try {
      const v = await this.client.voices.get(voiceId);
      return toStatus(v.fineTuning as { state?: Record<string, string> } | undefined);
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
