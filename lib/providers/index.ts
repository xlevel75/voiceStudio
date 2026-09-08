import { ClovaProvider } from "./clova";
import { ElevenLabsProvider } from "./elevenlabs";
import { ProviderError, type ProviderId, type VoiceProvider } from "./types";

/** 서버 전용. 환경변수의 API 키를 사용하므로 클라이언트에서 호출하면 안 된다. */
export function getProvider(id: ProviderId): VoiceProvider {
  switch (id) {
    case "elevenlabs":
      return new ElevenLabsProvider();
    case "clova":
      return new ClovaProvider();
    default:
      throw new ProviderError(`알 수 없는 공급자: ${id}`, 400);
  }
}

export * from "./types";
export * from "./capabilities";
export { CLOVA_SPEAKERS } from "./clova-speakers";
