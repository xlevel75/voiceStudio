import type { CloneMode, ProviderId, Voice, VoiceStatus } from "@/lib/providers/types";

export interface VoiceRecord {
  id: string;
  provider: ProviderId;
  voiceId: string;
  name: string;
  mode: CloneMode | null;
  status: VoiceStatus;
  isPreset: boolean;
  createdAt: string;
}

export interface VoiceStore {
  init(): Promise<void>;
  list(provider?: ProviderId): Promise<VoiceRecord[]>;
  get(id: string): Promise<VoiceRecord | null>;
  insert(record: VoiceRecord): Promise<VoiceRecord>;
  updateStatus(id: string, status: VoiceStatus): Promise<void>;
  remove(id: string): Promise<void>;
}

export function recordToVoice(r: VoiceRecord): Voice {
  return {
    id: r.id,
    provider: r.provider,
    voiceId: r.voiceId,
    name: r.name,
    mode: r.mode ?? undefined,
    status: r.status,
    isPreset: r.isPreset,
    createdAt: r.createdAt,
    isOwn: true,
  };
}
