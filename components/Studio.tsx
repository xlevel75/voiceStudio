"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BlobAccess } from "@/lib/blob";
import { CAPABILITIES, PROVIDER_IDS, PROVIDER_LABELS } from "@/lib/providers/capabilities";
import type { ProviderId, Voice } from "@/lib/providers/types";
import { CreateVoicePanel } from "./CreateVoicePanel";
import { fetchVoices, synthesize, type SynthesisResult } from "./client-api";
import { TtsBar, type ClovaOptions } from "./TtsBar";
import { VoiceList } from "./VoiceList";

type Result = SynthesisResult & { voiceName: string; fileName: string };

const POLL_INTERVAL_MS = 20_000;

export function Studio({ blobAccess }: { blobAccess: BlobAccess }) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<ProviderId>("elevenlabs");

  // 공급자 탭을 바꿔도 TTS 텍스트는 유지된다 (공통 상태).
  const [text, setText] = useState("");

  // 선택된 성우와 모델은 공급자별로 따로 기억한다.
  const [selectedByProvider, setSelectedByProvider] = useState<
    Partial<Record<ProviderId, string>>
  >({});
  const [modelByProvider, setModelByProvider] = useState<Partial<Record<ProviderId, string>>>({});
  const [clovaOptions, setClovaOptions] = useState<ClovaOptions>({ speed: 0, pitch: 0 });

  const [result, setResult] = useState<Result | null>(null);
  const lastObjectUrl = useRef<string | null>(null);

  const capabilities = CAPABILITIES[provider];

  const voicesQuery = useQuery({
    queryKey: ["voices", provider],
    queryFn: () => fetchVoices(provider),
    // PVC 학습 중인 성우가 있으면 자동 폴링으로 상태를 갱신한다.
    refetchInterval: (query) =>
      query.state.data?.voices.some((v) => v.status === "training") ? POLL_INTERVAL_MS : false,
  });

  const voices = useMemo(() => voicesQuery.data?.voices ?? [], [voicesQuery.data]);
  const isTrainingPolling = voices.some((v) => v.status === "training");

  const selectedVoiceId = selectedByProvider[provider] ?? null;
  const selectedVoice = voices.find((v) => v.voiceId === selectedVoiceId) ?? null;
  const modelId = modelByProvider[provider] ?? capabilities.models[0]?.id ?? "";

  // 목록이 로드되면 선택된 성우가 없을 때 첫 번째 사용 가능한 성우를 고른다.
  useEffect(() => {
    if (voices.length === 0) return;
    setSelectedByProvider((prev) => {
      const current = prev[provider];
      if (current && voices.some((v) => v.voiceId === current && v.status === "ready")) return prev;
      const first = voices.find((v) => v.status === "ready");
      return first ? { ...prev, [provider]: first.voiceId } : prev;
    });
  }, [voices, provider]);

  // 결과 오디오의 objectURL 누수 방지.
  useEffect(() => {
    return () => {
      if (lastObjectUrl.current) URL.revokeObjectURL(lastObjectUrl.current);
    };
  }, []);

  const ttsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVoice) throw new Error("성우를 선택해주세요.");
      return synthesize({
        provider,
        voiceId: selectedVoice.voiceId,
        text,
        modelId: provider === "clova" ? selectedVoice.voiceId : modelId,
        options:
          provider === "clova"
            ? { speed: clovaOptions.speed, pitch: clovaOptions.pitch }
            : undefined,
      });
    },
    onSuccess: (res) => {
      if (lastObjectUrl.current) URL.revokeObjectURL(lastObjectUrl.current);
      lastObjectUrl.current = res.url;
      const name = selectedVoice?.name ?? "voice";
      setResult({
        ...res,
        voiceName: name,
        fileName: `${name.replace(/[^\w가-힣.-]+/g, "_")}-${Date.now()}.mp3`,
      });
    },
  });

  function handleProviderChange(next: ProviderId) {
    setProvider(next);
    // 공급자가 바뀌면 이전 결과는 의미가 없다. 텍스트는 그대로 둔다.
    ttsMutation.reset();
    setResult(null);
    if (lastObjectUrl.current) {
      URL.revokeObjectURL(lastObjectUrl.current);
      lastObjectUrl.current = null;
    }
  }

  function handleSelect(voice: Voice) {
    setSelectedByProvider((prev) => ({ ...prev, [voice.provider]: voice.voiceId }));
  }

  const voicesError =
    voicesQuery.error instanceof Error ? voicesQuery.error.message : null;
  const ttsError = ttsMutation.error instanceof Error ? ttsMutation.error.message : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-100">Voice Studio</h1>
          <p className="mt-1 text-xs text-ink-400">
            내 목소리로 성우를 만들고, 텍스트를 음성으로 변환합니다.
          </p>
        </div>

        {/* 최상위 공급자 탭 */}
        <div
          role="tablist"
          aria-label="공급자"
          className="flex gap-1 rounded-xl border border-ink-700/70 bg-ink-900/70 p-1 backdrop-blur-sm"
        >
          {PROVIDER_IDS.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={provider === id}
              onClick={() => handleProviderChange(id)}
              className={[
                "rounded-lg px-4 py-2 text-sm font-medium transition",
                provider === id
                  ? "bg-accent-500/25 text-accent-300 ring-1 ring-accent-500/40"
                  : "text-ink-400 hover:text-ink-100",
              ].join(" ")}
            >
              {PROVIDER_LABELS[id]}
            </button>
          ))}
        </div>
      </header>

      {/* items-start: 성우 목록이 길어도 만들기 패널이 따라 늘어나지 않는다 */}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <VoiceList
          provider={provider}
          voices={voices}
          selectedVoiceId={selectedVoiceId}
          onSelect={handleSelect}
          isLoading={voicesQuery.isPending}
          error={voicesError}
          isTrainingPolling={isTrainingPolling}
        />
        <CreateVoicePanel
          provider={provider}
          capabilities={capabilities}
          blobAccess={blobAccess}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["voices", provider] })}
        />
      </div>

      {/* TTS 입력창은 공급자 탭 바깥의 공통 영역 */}
      <TtsBar
        capabilities={capabilities}
        selectedVoice={selectedVoice}
        text={text}
        onTextChange={setText}
        modelId={modelId}
        onModelChange={(value) => setModelByProvider((prev) => ({ ...prev, [provider]: value }))}
        clovaOptions={clovaOptions}
        onClovaOptionsChange={setClovaOptions}
        onSynthesize={() => ttsMutation.mutate()}
        busy={ttsMutation.isPending}
        error={ttsError}
        result={result}
      />

      <footer className="pb-2 text-[11px] leading-relaxed text-ink-400">
        API 키는 서버에서만 사용되며 브라우저에 노출되지 않습니다. CLOVA Voice로 만든 음성은
        네이버 클라우드 약관에 따라 저장·재사용이 제한되어 재생만 지원합니다.
      </footer>
    </main>
  );
}
