export type ProviderId = "elevenlabs" | "clova";
export type CloneMode = "ivc" | "pvc";
export type VoiceStatus = "ready" | "training" | "failed";

export interface Capabilities {
  canCreateVoice: boolean; // 셀프 성우 만들기 가능?
  cloneModes: CloneMode[]; // 지원 복제 모드
  canDownload: boolean; // 결과 음성 다운로드 허용?
  maxTextLength: number; // TTS 1회 최대 글자 수
  models: { id: string; label: string }[]; // 선택 가능한 TTS 모델/보이스타입
}

export interface Voice {
  id: string; // 내부 DB id
  provider: ProviderId;
  voiceId: string; // 공급자 측 voice id
  name: string;
  mode?: CloneMode; // 프리셋이면 undefined
  status: VoiceStatus;
  isPreset: boolean; // CLOVA 프리셋 여부
  createdAt: string;
  /** 목록에서 "내 성우"를 상단 고정하기 위한 힌트. 공급자 라이브러리 보이스는 false. */
  isOwn?: boolean;
  description?: string;
}

export interface CreateVoiceInput {
  name: string;
  mode: CloneMode;
  audioUrls: string[]; // Vercel Blob URL들
  consent: boolean; // 권리 보유 동의 (필수)
}

export interface SynthesizeInput {
  voiceId: string;
  text: string;
  modelId?: string;
  /** 공급자별 추가 파라미터 (CLOVA speed/pitch/emotion 등) */
  options?: Record<string, string | number>;
}

export interface SynthesizeResult {
  audio: ArrayBuffer;
  format: "mp3" | "wav";
  downloadable: boolean; // false면 UI는 재생만
}

export interface VoiceProvider {
  id: ProviderId;
  capabilities: Capabilities;
  listVoices(): Promise<Voice[]>;
  createVoice?(input: CreateVoiceInput): Promise<Voice>; // 능력 없으면 미구현
  getVoiceStatus?(voiceId: string): Promise<VoiceStatus>; // PVC 폴링용
  synthesize(input: SynthesizeInput): Promise<SynthesizeResult>;
}

/** 공급자 호출 실패를 HTTP 상태와 함께 UI까지 전달하기 위한 에러 타입. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number = 500,
    readonly provider?: ProviderId,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
