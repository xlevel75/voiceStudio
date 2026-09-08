/**
 * 능력 플래그는 클라이언트 컴포넌트에서도 읽는다.
 * 공급자 SDK를 끌고 들어오지 않도록 순수 데이터만 이 파일에 둔다.
 */
import { CLOVA_SPEAKERS } from "./clova-speakers";
import type { Capabilities, ProviderId } from "./types";

export const ELEVENLABS_CAPABILITIES: Capabilities = {
  canCreateVoice: true,
  cloneModes: ["ivc", "pvc"],
  canDownload: true,
  maxTextLength: 5000,
  models: [
    { id: "eleven_multilingual_v2", label: "다국어 v2 (한국어 안정)" },
    { id: "eleven_v3", label: "v3 (표현력 최고)" },
    { id: "eleven_flash_v2_5", label: "Flash v2.5 (저지연)" },
  ],
};

export const CLOVA_CAPABILITIES: Capabilities = {
  canCreateVoice: false, // 셀프 성우 만들기 없음 (커스텀 화자는 기업 협의 대상)
  cloneModes: [],
  canDownload: false, // ⚠️ 약관상 다운로드 금지 → 재생만
  maxTextLength: 2000,
  models: CLOVA_SPEAKERS.map((s) => ({ id: s.id, label: s.label })),
};

export const CAPABILITIES: Record<ProviderId, Capabilities> = {
  elevenlabs: ELEVENLABS_CAPABILITIES,
  clova: CLOVA_CAPABILITIES,
};

export const PROVIDER_IDS: ProviderId[] = ["elevenlabs", "clova"];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  elevenlabs: "ElevenLabs",
  clova: "CLOVA",
};

export function isProviderId(value: unknown): value is ProviderId {
  return value === "elevenlabs" || value === "clova";
}
