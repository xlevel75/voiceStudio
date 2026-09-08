"use client";

import type { ProviderId, Voice } from "@/lib/providers/types";
import { Badge, ErrorNote, Panel, Spinner } from "./ui";

const STATUS_BADGE: Record<Voice["status"], { tone: "ok" | "warn" | "danger"; label: string }> = {
  ready: { tone: "ok", label: "사용 가능" },
  training: { tone: "warn", label: "학습 중" },
  failed: { tone: "danger", label: "실패" },
};

const MODE_LABEL: Record<string, string> = { ivc: "IVC", pvc: "PVC" };

export function VoiceList({
  provider,
  voices,
  selectedVoiceId,
  onSelect,
  isLoading,
  error,
  isTrainingPolling,
  onDelete,
  deletingId,
}: {
  provider: ProviderId;
  voices: Voice[];
  selectedVoiceId: string | null;
  onSelect: (voice: Voice) => void;
  isLoading: boolean;
  error: string | null;
  isTrainingPolling: boolean;
  onDelete: (voice: Voice) => void;
  deletingId: string | null;
}) {
  const own = voices.filter((v) => v.isOwn);
  const presets = voices.filter((v) => !v.isOwn);

  return (
    <Panel
      title="성우 목록 · 선택"
      subtitle={
        provider === "clova"
          ? "CLOVA는 프리셋 화자만 제공합니다."
          : "내가 만든 성우가 상단에 고정됩니다."
      }
      className="min-h-0"
    >
      {error ? <ErrorNote message={error} /> : null}

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-ink-400">
          <Spinner /> 성우 목록을 불러오는 중…
        </div>
      ) : null}

      {!isLoading && !error && voices.length === 0 ? (
        <p className="py-6 text-xs text-ink-400">표시할 성우가 없습니다.</p>
      ) : null}

      <div className="-mr-2 max-h-[min(60vh,560px)] min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
        {own.length > 0 ? (
          <Group
            label="내 성우"
            trailing={
              isTrainingPolling ? (
                <span className="flex items-center gap-1 text-[10px] text-amber-300">
                  <Spinner className="h-3 w-3" /> 상태 확인 중
                </span>
              ) : null
            }
          >
            {own.map((v) => (
              <VoiceRow
                key={v.id}
                voice={v}
                selected={v.voiceId === selectedVoiceId}
                onSelect={onSelect}
                onDelete={onDelete}
                deleting={deletingId === v.id}
              />
            ))}
          </Group>
        ) : null}

        {presets.length > 0 ? (
          <Group label={provider === "clova" ? "프리셋 화자" : "라이브러리 · 프리셋"}>
            {presets.map((v) => (
              <VoiceRow
                key={v.id}
                voice={v}
                selected={v.voiceId === selectedVoiceId}
                onSelect={onSelect}
              />
            ))}
          </Group>
        ) : null}
      </div>
    </Panel>
  );
}

function Group({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
          {label}
        </h3>
        {trailing}
      </div>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}

function VoiceRow({
  voice,
  selected,
  onSelect,
  onDelete,
  deleting = false,
}: {
  voice: Voice;
  selected: boolean;
  onSelect: (voice: Voice) => void;
  onDelete?: (voice: Voice) => void;
  deleting?: boolean;
}) {
  // 학습 중이거나 실패한 성우는 선택할 수 없다.
  const disabled = voice.status !== "ready";
  const badge = STATUS_BADGE[voice.status];
  // 삭제 버튼은 "잘못 만들어진 내 성우"에만 붙는다. 정상 성우/라이브러리에는 없다.
  const showDelete = !!onDelete && voice.deletable === true;

  return (
    <li
      className={[
        "flex items-center gap-1 rounded-xl border transition",
        disabled
          ? "border-ink-700/50 bg-ink-850/40"
          : selected
            ? "border-accent-500/70 bg-accent-500/15 shadow-[0_0_0_1px_rgba(109,92,255,0.35)]"
            : "border-ink-700/60 bg-ink-850/40 hover:border-ink-600 hover:bg-ink-800/60",
      ].join(" ")}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(voice)}
        className={[
          "flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left",
          disabled ? "cursor-not-allowed opacity-60" : "",
        ].join(" ")}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink-100">{voice.name}</span>
          {voice.statusDetail ? (
            <span className="mt-0.5 block text-[11px] leading-relaxed text-amber-300/90">
              {voice.statusDetail}
            </span>
          ) : voice.description ? (
            <span className="mt-0.5 block truncate text-[11px] text-ink-400">
              {voice.description}
            </span>
          ) : null}
        </span>
        {voice.mode ? <Badge tone="accent">{MODE_LABEL[voice.mode] ?? voice.mode}</Badge> : null}
        {voice.status !== "ready" ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
      </button>

      {showDelete ? (
        <button
          type="button"
          disabled={deleting}
          onClick={() => onDelete(voice)}
          title="잘못 만들어진 성우 삭제"
          aria-label={`${voice.name} 삭제`}
          className="mr-2 shrink-0 rounded-lg border border-rose-500/30 px-2 py-1.5 text-rose-300 transition hover:border-rose-500/60 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deleting ? <Spinner className="h-3.5 w-3.5" /> : <TrashIcon />}
        </button>
      ) : null}
    </li>
  );
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
