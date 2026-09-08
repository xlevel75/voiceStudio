"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";
import type { BlobAccess } from "@/lib/blob";
import type { Capabilities, CloneMode, ProviderId } from "@/lib/providers/types";
import { createVoice } from "./client-api";
import { ErrorNote, InfoNote, Panel, Spinner } from "./ui";

export function CreateVoicePanel({
  provider,
  capabilities,
  blobAccess,
  onCreated,
}: {
  provider: ProviderId;
  capabilities: Capabilities;
  blobAccess: BlobAccess;
  onCreated: () => void;
}) {
  if (!capabilities.canCreateVoice) {
    return (
      <Panel title="성우 만들기" subtitle="이 공급자는 셀프 음성 복제를 제공하지 않습니다.">
        <div className="space-y-3">
          <InfoNote>
            <strong className="text-ink-100">CLOVA는 셀프 성우 만들기 API가 없습니다.</strong>
            <br />
            내 목소리를 CLOVA 화자로 등록하려면 <b>네이버 클라우드 플랫폼 기업 협의</b>가 필요합니다
            (커스텀 음성 제작은 별도 계약·심사 대상).
          </InfoNote>
          <InfoNote>
            지금은 <b>프리셋 화자</b>를 선택해 TTS를 사용할 수 있습니다. 내 목소리로 성우를 만들려면
            ElevenLabs 탭을 이용하세요.
          </InfoNote>
          <a
            href="https://www.ncloud.com/product/aiService/clovaVoice"
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
          >
            CLOVA Voice 안내 보기 ↗
          </a>
        </div>
      </Panel>
    );
  }

  return (
    <CloneForm
      provider={provider}
      capabilities={capabilities}
      blobAccess={blobAccess}
      onCreated={onCreated}
    />
  );
}

function CloneForm({
  provider,
  capabilities,
  blobAccess,
  onCreated,
}: {
  provider: ProviderId;
  capabilities: Capabilities;
  blobAccess: BlobAccess;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<CloneMode>(capabilities.cloneModes[0] ?? "ivc");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const canSubmit = name.trim().length > 0 && files.length > 0 && consent && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Vercel 함수 본문 4.5MB 제한을 피하기 위해 브라우저에서 Blob으로 직접 업로드한다.
      const audioUrls: string[] = [];
      for (const [i, file] of files.entries()) {
        setProgress(`오디오 업로드 중… (${i + 1}/${files.length}) ${file.name}`);
        // access 는 스토어 설정과 일치해야 한다. 불일치 시 업로드가 거부된다.
        const blob = await upload(`voice-samples/${Date.now()}-${file.name}`, file, {
          access: blobAccess,
          handleUploadUrl: "/api/upload",
          contentType: file.type || "audio/mpeg",
        });
        audioUrls.push(blob.url);
      }

      setProgress(mode === "ivc" ? "성우 생성 중…" : "PVC 학습 요청 중…");
      const { voice } = await createVoice({
        provider,
        name: name.trim(),
        mode,
        audioUrls,
        consent,
      });

      setNotice(
        voice.status === "training"
          ? `"${voice.name}" PVC 학습을 시작했습니다. 완료까지 수 시간이 걸리며, 목록에서 상태가 자동 갱신됩니다.`
          : `"${voice.name}" 성우가 만들어졌습니다. 아래 TTS 입력창에서 바로 사용할 수 있습니다.`,
      );
      setName("");
      setFiles([]);
      setTotalSeconds(0);
      setConsent(false);
      if (fileInput.current) fileInput.current.value = "";
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "성우 생성에 실패했습니다.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const totalMb = files.reduce((n, f) => n + f.size, 0) / 1024 / 1024;
  // ElevenLabs PVC 권장 최소 녹음 길이. 이보다 짧으면 학습이 시작되지 않는 일이 잦다.
  const PVC_MIN_SECONDS = 30 * 60;
  const tooShortForPvc = mode === "pvc" && totalSeconds > 0 && totalSeconds < PVC_MIN_SECONDS;

  return (
    <Panel title="성우 만들기" subtitle="녹음된 음성을 올려 내 목소리로 성우를 만듭니다.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* IVC / PVC 토글 */}
        <div className="flex gap-1 rounded-xl border border-ink-700/70 bg-ink-850/60 p-1">
          {capabilities.cloneModes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={[
                "flex-1 rounded-lg px-3 py-2 text-xs font-medium transition",
                mode === m
                  ? "bg-accent-500/25 text-accent-300 ring-1 ring-accent-500/40"
                  : "text-ink-400 hover:text-ink-100",
              ].join(" ")}
            >
              {m === "ivc" ? "IVC · 즉시 복제" : "PVC · 고품질 복제"}
            </button>
          ))}
        </div>

        <InfoNote>
          {mode === "ivc" ? (
            <>
              <b>IVC</b>는 짧은 샘플(1분 이상 권장)로 수 초 만에 성우를 만듭니다. 하위 플랜에서도
              사용할 수 있습니다.
            </>
          ) : (
            <>
              <b>PVC</b>는 30분 이상의 고품질 녹음을 권장하며, 학습에 <b>수 시간</b>이 걸리는 비동기
              작업입니다. <b>Creator 플랜 이상</b>이 필요합니다.
            </>
          )}
        </InfoNote>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-300">성우 이름</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 내 목소리 (내레이션)"
            maxLength={80}
            className="w-full rounded-xl border border-ink-700 bg-ink-850/60 px-3 py-2.5 text-sm text-ink-100 outline-none transition placeholder:text-ink-400/70 focus:border-accent-500/60"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-ink-300">오디오 파일</span>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            multiple
            onChange={async (e) => {
              const picked = Array.from(e.target.files ?? []);
              setFiles(picked);
              setTotalSeconds(0);
              const lengths = await Promise.all(picked.map(audioDuration));
              setTotalSeconds(lengths.reduce((a, b) => a + b, 0));
            }}
            className="block w-full cursor-pointer rounded-xl border border-dashed border-ink-600 bg-ink-850/40 px-3 py-3 text-xs text-ink-400 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-ink-700 file:px-3 file:py-1.5 file:text-xs file:text-ink-100 hover:border-ink-500"
          />
          {files.length > 0 ? (
            <p className="mt-1.5 text-[11px] text-ink-400">
              {files.length}개 선택 · 총 {totalMb.toFixed(1)}MB
              {totalSeconds > 0 ? ` · 길이 ${formatDuration(totalSeconds)}` : ""}
            </p>
          ) : null}
          {tooShortForPvc ? (
            <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
              PVC는 <b>30분 이상</b>의 녹음을 권장합니다. 지금 길이({formatDuration(totalSeconds)})로는
              보이스만 만들어지고 <b>학습이 시작되지 않을 수 있습니다.</b> 짧은 샘플이라면 IVC를
              사용하세요.
            </p>
          ) : null}
        </div>

        {/* 권리 보유 동의 — ElevenLabs 정책상 필수 */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-ink-700/70 bg-ink-850/40 p-3">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent-500)]"
          />
          <span className="text-[11px] leading-relaxed text-ink-300">
            업로드한 음성이 <b className="text-ink-100">본인의 목소리이거나</b>, 화자로부터 복제 및
            합성에 대한 <b className="text-ink-100">명시적 동의를 받았음</b>을 확인합니다.
            (필수)
          </span>
        </label>

        {error ? <ErrorNote message={error} /> : null}
        {notice ? (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs leading-relaxed text-emerald-200">
            {notice}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white transition enabled:hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
        >
          {busy ? <Spinner /> : null}
          {busy ? (progress ?? "처리 중…") : "만들기"}
        </button>
      </form>
    </Panel>
  );
}

/** 오디오 파일의 재생 길이를 초 단위로 읽는다. 실패하면 0(=알 수 없음). */
async function audioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    const done = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}
