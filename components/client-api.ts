import type { Capabilities, CloneMode, ProviderId, Voice } from "@/lib/providers/types";

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) return data.error;
  } catch {
    /* JSON이 아니면 무시 */
  }
  return `요청이 실패했습니다 (${res.status})`;
}

export interface VoicesResponse {
  voices: Voice[];
  capabilities: Capabilities;
}

export async function fetchVoices(provider: ProviderId): Promise<VoicesResponse> {
  const res = await fetch(`/api/voices?provider=${provider}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function createVoice(input: {
  provider: ProviderId;
  name: string;
  mode: CloneMode;
  audioUrls: string[];
  consent: boolean;
}): Promise<{ voice: Voice }> {
  const res = await fetch("/api/voices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchVoiceStatus(id: string): Promise<{ status: Voice["status"] }> {
  const res = await fetch(`/api/voices/${encodeURIComponent(id)}/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteVoice(id: string): Promise<void> {
  const res = await fetch(`/api/voices/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res));
}

export interface SynthesisResult {
  blob: Blob;
  url: string;
  downloadable: boolean;
}

export async function synthesize(input: {
  provider: ProviderId;
  voiceId: string;
  text: string;
  modelId?: string;
  options?: Record<string, string | number>;
}): Promise<SynthesisResult> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));

  // 서버가 공급자 약관에 따라 다운로드 허용 여부를 헤더로 알려준다.
  const downloadable = res.headers.get("X-Downloadable") === "1";
  const blob = await res.blob();
  return { blob, url: URL.createObjectURL(blob), downloadable };
}
