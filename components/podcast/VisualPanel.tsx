"use client";

import {
  SCENE_STYLES,
  CONTENT_MODES,
  ART_STYLES,
  type EpisodeSetup,
  type VisualSettings,
} from "@/lib/podcast/types";
import { ART_STYLE_LABELS, CONTENT_MODE_INFO, IMAGE_MODELS, SCENE_STYLE_INFO } from "@/lib/podcast/visual";
import { Panel } from "../ui";

/** 기준 이미지(스튜디오·디자인시트) 한 칸을 다루는 동작. slot = "studio" | "sheet:{speakerId}" */
export interface SlotHandlers {
  jobOf: (slot: string) => { busy: boolean; error?: string };
  upload: (slot: string, file: File) => void;
  generate: (slot: string) => void;
  clear: (slot: string) => void;
}

const label = "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400";

function Choice<T extends string>({
  value,
  options,
  info,
  onChange,
}: {
  value: T;
  options: readonly T[];
  info: (v: T) => { label: string; desc?: string };
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const active = o === value;
        const { label: title, desc } = info(o);
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            title={desc}
            aria-pressed={active}
            className={[
              "rounded-lg border px-2 py-2 text-left transition",
              active
                ? "border-accent-500/60 bg-accent-500/15 text-accent-300"
                : "border-ink-700 text-ink-300 hover:border-ink-600",
            ].join(" ")}
          >
            <span className="block text-xs font-medium">{title}</span>
            {desc ? <span className="mt-0.5 block text-[10px] leading-snug text-ink-400">{desc}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function VisualPanel({
  setup,
  onChange,
  slots,
}: {
  setup: EpisodeSetup;
  onChange: (next: EpisodeSetup) => void;
  slots: SlotHandlers;
}) {
  const v = setup.visual;
  const patch = (p: Partial<VisualSettings>) => onChange({ ...setup, visual: { ...v, ...p } });
  const noSheet = setup.speakers.filter((s) => !s.designSheet).map((s) => s.name);

  return (
    <Panel
      title="화면 연출"
      subtitle="장면 이미지를 어떻게 찍을지 정합니다. 바꾸면 기존 장면은 '다시 만들기' 대상이 됩니다."
    >
      <div className="flex flex-col gap-4">
        <div>
          <span className={label}>연출 방식</span>
          <Choice
            value={v.sceneStyle}
            options={SCENE_STYLES}
            info={(o) => SCENE_STYLE_INFO[o]}
            onChange={(sceneStyle) => patch({ sceneStyle })}
          />
        </div>

        <div>
          <span className={label}>말한 내용 표시</span>
          <Choice
            value={v.contentMode}
            options={CONTENT_MODES}
            info={(o) => CONTENT_MODE_INFO[o]}
            onChange={(contentMode) => patch({ contentMode })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>그림체</span>
            <Choice
              value={v.artStyle}
              options={ART_STYLES}
              info={(o) => ({ label: ART_STYLE_LABELS[o] })}
              onChange={(artStyle) => patch({ artStyle })}
            />
          </div>
          <div>
            <span className={label}>이미지 모델</span>
            <select
              value={v.imageModel}
              onChange={(e) => patch({ imageModel: e.target.value })}
              className="w-full rounded-lg border border-ink-700 bg-ink-850/60 px-2 py-2 text-xs text-ink-100 outline-none focus:border-accent-500/60"
            >
              {IMAGE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {noSheet.length > 0 ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
            디자인시트가 없는 화자({noSheet.join(", ")})는 장면마다 얼굴이 달라질 수 있습니다. "주제 만들기"의
            화자 칸에서 올리거나 AI로 만들어 주세요.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
