import { concatBuffers, splitText } from "@/lib/text";
import { missingEnvMessage } from "@/lib/env";
import { CLOVA_CAPABILITIES } from "./capabilities";
import { CLOVA_SPEAKERS } from "./clova-speakers";
import {
  ProviderError,
  type SynthesizeInput,
  type SynthesizeResult,
  type Voice,
  type VoiceProvider,
} from "./types";

const CLOVA_TTS_URL = "https://naveropenapi.apigw.ntruss.com/tts-premium/v1/tts";

export class ClovaProvider implements VoiceProvider {
  readonly id = "clova" as const;
  readonly capabilities = CLOVA_CAPABILITIES;

  constructor(
    private clientId = process.env.CLOVA_CLIENT_ID,
    private clientSecret = process.env.CLOVA_CLIENT_SECRET,
  ) {}

  private requireKeys() {
    if (!this.clientId || !this.clientSecret) {
      throw new ProviderError(
        missingEnvMessage("CLOVA_CLIENT_ID", "CLOVA_CLIENT_SECRET"),
        503,
        "clova",
      );
    }
    return { id: this.clientId, secret: this.clientSecret };
  }

  /** CLOVA는 프리셋 화자만 제공한다. 코드 상수를 그대로 목록으로 쓴다. */
  async listVoices(): Promise<Voice[]> {
    return CLOVA_SPEAKERS.map((s) => ({
      id: `clova:${s.id}`,
      provider: "clova" as const,
      voiceId: s.id,
      name: s.label,
      status: "ready" as const,
      isPreset: true,
      createdAt: new Date(0).toISOString(),
      isOwn: false,
    }));
  }

  // createVoice / getVoiceStatus 미구현: capabilities.canCreateVoice === false

  async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
    const { id, secret } = this.requireKeys();
    const speaker = input.modelId || input.voiceId;
    if (!speaker) {
      throw new ProviderError("화자(speaker)가 선택되지 않았습니다.", 400, "clova");
    }

    // 1회 호출 2,000자 제한 → 분할 호출 후 이어붙인다.
    const chunks = splitText(input.text, this.capabilities.maxTextLength);
    if (chunks.length === 0) {
      throw new ProviderError("변환할 텍스트가 비어 있습니다.", 400, "clova");
    }

    const buffers: ArrayBuffer[] = [];
    for (const chunk of chunks) {
      const body = new URLSearchParams({ speaker, text: chunk, format: "mp3" });
      const { speed, pitch, volume, emotion, emotionStrength } = input.options ?? {};
      if (speed !== undefined) body.set("speed", String(speed));
      if (pitch !== undefined) body.set("pitch", String(pitch));
      if (volume !== undefined) body.set("volume", String(volume));
      if (emotion !== undefined) body.set("emotion", String(emotion));
      if (emotionStrength !== undefined) body.set("emotion-strength", String(emotionStrength));

      const res = await fetch(CLOVA_TTS_URL, {
        method: "POST",
        headers: {
          "X-NCP-APIGW-API-KEY-ID": id,
          "X-NCP-APIGW-API-KEY": secret,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        // 생성 음성은 저장하지 않는다. 받아서 즉시 클라이언트로 흘려보낼 뿐이다.
        cache: "no-store",
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ProviderError(
          `CLOVA 음성 변환 실패 (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
          res.status,
          "clova",
        );
      }
      buffers.push(await res.arrayBuffer());
    }

    return { audio: concatBuffers(buffers), format: "mp3", downloadable: false };
  }
}
