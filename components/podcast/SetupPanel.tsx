"use client";

import { useState } from "react";
import {
  FORMAT_LABELS,
  FORMATS,
  MAX_SPEAKERS,
  MIN_SPEAKERS,
  ROLE_LABELS,
  ROLES,
  TONE_LABELS,
  TONES,
  type EpisodeSetup,
  type Speaker,
} from "@/lib/podcast/types";
import type { Voice } from "@/lib/providers/types";
import { synthesize } from "../client-api";
import { ErrorNote, Panel, Spinner } from "../ui";
import { ImageSlot } from "./ImageSlot";
import type { SlotHandlers } from "./VisualPanel";

const field =
  "w-full rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-2 text-sm text-ink-100 outline-none transition placeholder:text-ink-400/70 focus:border-accent-500/60";
const label = "mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400";

export function SetupPanel({
  setup,
  onChange,
  onRenameSpeaker,
  voices,
  voicesLoading,
  voicesError,
  modelId,
  slots,
}: {
  setup: EpisodeSetup;
  onChange: (next: EpisodeSetup) => void;
  /** 이름을 바꾸면 이미 만든 대본의 화자 이름도 따라 바뀌어야 한다. */
  onRenameSpeaker: (from: string, to: string) => void;
  voices: Voice[];
  voicesLoading: boolean;
  voicesError: string | null;
  modelId: string;
  slots: SlotHandlers;
}) {
  const studioJob = slots.jobOf("studio");
  const patch = (p: Partial<EpisodeSetup>) => onChange({ ...setup, ...p });
  const patchSpeaker = (id: string, p: Partial<Speaker>) =>
    patch({ speakers: setup.speakers.map((s) => (s.id === id ? { ...s, ...p } : s)) });

  function addSpeaker() {
    const used = new Set(setup.speakers.map((s) => s.voiceId));
    const voice = voices.find((v) => !used.has(v.voiceId)) ?? voices[0];
    patch({
      speakers: [
        ...setup.speakers,
        {
          id: crypto.randomUUID(),
          name: `패널${setup.speakers.length}`,
          role: "panel_counter",
          persona: "",
          voiceId: voice?.voiceId ?? "",
        },
      ],
    });
  }

  return (
    <Panel title="1. 주제 만들기" subtitle="주제와 자료, 출연할 화자를 정합니다.">
      <div className="flex flex-col gap-4">
        <div>
          <span className={label}>주제</span>
          <input
            value={setup.topic}
            onChange={(e) => patch({ topic: e.target.value })}
            placeholder="예: 오늘의 한국 주요 뉴스 5가지"
            className={field}
          />
        </div>

        <div>
          <span className={label}>자료 (선택)</span>
          <textarea
            value={setup.sourceText}
            onChange={(e) => patch({ sourceText: e.target.value })}
            rows={4}
            placeholder="기사 본문이나 메모를 붙여넣으세요. 비워두면 웹 검색으로 최신 뉴스를 모읍니다."
            className={`${field} resize-y leading-relaxed`}
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-ink-300">
            <input
              type="checkbox"
              checked={setup.useWebSearch}
              onChange={(e) => patch({ useWebSearch: e.target.checked })}
              className="accent-accent-500"
            />
            웹 검색으로 최신 뉴스 수집·보완 (Google 검색)
          </label>
        </div>

        <div>
          <span className={label}>배경 스튜디오</span>
          <ImageSlot
            assetId={setup.studioImage}
            label="배경 스튜디오 사진"
            emptyHint="스튜디오 없음"
            busy={studioJob.busy}
            error={studioJob.error}
            onUpload={(file) => slots.upload("studio", file)}
            onGenerate={() => slots.generate("studio")}
            onClear={() => slots.clear("studio")}
          />
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-400">
            모든 장면 이미지의 배경 기준입니다. 사람이 없는 빈 스튜디오 사진이 가장 좋습니다.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <span className={label}>분량(분)</span>
            <input
              type="number"
              min={1}
              max={30}
              value={setup.targetMinutes}
              onChange={(e) => patch({ targetMinutes: Number(e.target.value) || 1 })}
              className={field}
            />
          </div>
          <div>
            <span className={label}>톤</span>
            <select
              value={setup.tone}
              onChange={(e) => patch({ tone: e.target.value as EpisodeSetup["tone"] })}
              className={field}
            >
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {TONE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={label}>형식</span>
            <select
              value={setup.format}
              onChange={(e) => patch({ format: e.target.value as EpisodeSetup["format"] })}
              className={field}
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABELS[f]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className={label}>
              화자 {setup.speakers.length}명 ({MIN_SPEAKERS}~{MAX_SPEAKERS})
            </span>
            {voicesLoading ? (
              <span className="flex items-center gap-1 text-[11px] text-ink-400">
                <Spinner className="h-3 w-3" /> 성우 목록 불러오는 중
              </span>
            ) : null}
          </div>
          {voicesError ? <ErrorNote message={voicesError} /> : null}

          <div className="flex flex-col gap-2">
            {setup.speakers.map((sp) => (
              <SpeakerRow
                key={sp.id}
                speaker={sp}
                voices={voices}
                modelId={modelId}
                slots={slots}
                canRemove={setup.speakers.length > MIN_SPEAKERS}
                onPatch={(p) => patchSpeaker(sp.id, p)}
                onRename={(to) => {
                  onRenameSpeaker(sp.name, to);
                  patchSpeaker(sp.id, { name: to });
                }}
                onRemove={() => patch({ speakers: setup.speakers.filter((s) => s.id !== sp.id) })}
              />
            ))}
          </div>
          {setup.speakers.length < MAX_SPEAKERS ? (
            <button
              onClick={addSpeaker}
              className="mt-2 w-full rounded-lg border border-dashed border-ink-600 py-2 text-xs text-ink-300 transition hover:border-accent-500/60 hover:text-accent-300"
            >
              + 화자 추가
            </button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function SpeakerRow({
  speaker,
  voices,
  modelId,
  slots,
  canRemove,
  onPatch,
  onRename,
  onRemove,
}: {
  speaker: Speaker;
  voices: Voice[];
  modelId: string;
  slots: SlotHandlers;
  canRemove: boolean;
  onPatch: (p: Partial<Speaker>) => void;
  onRename: (to: string) => void;
  onRemove: () => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  const sheetSlot = `sheet:${speaker.id}`;
  const sheetJob = slots.jobOf(sheetSlot);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function preview() {
    if (!speaker.voiceId) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const res = await synthesize({
        provider: "elevenlabs",
        voiceId: speaker.voiceId,
        text: `안녕하세요, ${speaker.name || "진행자"}입니다. 오늘의 뉴스를 전해드릴게요.`,
        modelId,
      });
      const audio = new Audio(res.url);
      audio.onended = () => URL.revokeObjectURL(res.url);
      await audio.play();
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "미리듣기에 실패했습니다.");
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="rounded-xl border border-ink-700/70 bg-ink-850/40 p-3">
      <div className="grid grid-cols-[1fr_1.2fr] gap-2">
        <input
          value={speaker.name}
          onChange={(e) => onRename(e.target.value)}
          placeholder="이름"
          className={field}
        />
        <select
          value={speaker.role}
          onChange={(e) => onPatch({ role: e.target.value as Speaker["role"] })}
          className={field}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex gap-2">
        <select
          value={speaker.voiceId}
          onChange={(e) => onPatch({ voiceId: e.target.value })}
          className={`${field} min-w-0 flex-1`}
        >
          <option value="">목소리 선택</option>
          {voices.map((v) => (
            <option key={v.voiceId} value={v.voiceId}>
              {v.isOwn ? "★ " : ""}
              {v.name}
            </option>
          ))}
        </select>
        <button
          onClick={preview}
          disabled={!speaker.voiceId || previewing}
          title="목소리 미리듣기"
          className="shrink-0 rounded-lg border border-ink-700 px-3 text-xs text-ink-300 transition hover:text-accent-300 disabled:opacity-40"
        >
          {previewing ? <Spinner className="h-3 w-3" /> : "▶ 듣기"}
        </button>
        {canRemove ? (
          <button
            onClick={onRemove}
            title="화자 삭제"
            className="shrink-0 rounded-lg border border-ink-700 px-3 text-xs text-ink-400 transition hover:text-rose-300"
          >
            삭제
          </button>
        ) : null}
      </div>
      <textarea
        value={speaker.persona}
        onChange={(e) => onPatch({ persona: e.target.value })}
        rows={2}
        placeholder="캐릭터: 말버릇, 관심사, 농담 유형, 하지 말아야 할 것"
        className={`${field} mt-2 resize-y text-xs leading-relaxed`}
      />
      {previewError ? <p className="mt-1 text-[11px] text-rose-300">{previewError}</p> : null}
      <div className="mt-2 flex items-center gap-2">
        <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-400">
          디자인시트
        </span>
        <ImageSlot
          compact
          assetId={speaker.designSheet}
          label={`${speaker.name} 디자인시트`}
          emptyHint="없음"
          busy={sheetJob.busy}
          error={sheetJob.error}
          onUpload={(file) => slots.upload(sheetSlot, file)}
          onGenerate={() => slots.generate(sheetSlot)}
          onClear={() => slots.clear(sheetSlot)}
        />
      </div>
    </div>
  );
}
