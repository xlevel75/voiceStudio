"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GroundingSource } from "@/lib/gemini";
import { decodeClip, formatClock, mergeEpisode, segmentLabel, type MergedEpisode } from "@/lib/podcast/audio";
import { assetToDataUrl, dataUrlToBlob, downscaleImage } from "@/lib/podcast/image-client";
import { canPlayAac, inspectVideo, renderEpisodeVideo, type VideoInfo } from "@/lib/podcast/video";
import { assetUrl, sceneSignature } from "@/lib/podcast/visual";
import {
  newProject,
  projectAssetIds,
  readPodcastFile,
  projectFileName,
  projectTitle,
  scriptChars,
  toPodcastFile,
  type Project,
} from "@/lib/podcast/projects";
import { hasTags, stripTags, supportsAudioTags, ttsText } from "@/lib/podcast/tags";
import {
  CHARS_PER_MINUTE,
  type EpisodeSetup,
  type FactSheet,
  type Script,
  type Utterance,
} from "@/lib/podcast/types";
import { ELEVENLABS_CAPABILITIES } from "@/lib/providers/capabilities";
import { fetchVoices, synthesize } from "../client-api";
import { Badge, ErrorNote, InfoNote, Panel, Spinner } from "../ui";
import {
  createFactSheet,
  createScript,
  createThumbnail,
  createYoutubeMeta,
  generateImage,
  tagScript,
  uploadAsset,
  verifyScript,
} from "./podcast-api";
import { ProjectList } from "./ProjectList";
import { ScriptEditor, type ClipState, type SceneState } from "./ScriptEditor";
import { SetupPanel } from "./SetupPanel";
import { SyncIndicator } from "./SyncIndicator";
import { useProjectSync } from "./useProjectSync";
import { ThumbnailBox } from "./ThumbnailBox";
import { YoutubeMetaBox } from "./YoutubeMetaBox";
import { fileBaseName } from "@/lib/podcast/youtube";
import { VisualPanel, type SlotHandlers } from "./VisualPanel";

/** 이미지 모델 분당 요청 한도가 낮아 장면 일괄 생성은 조금씩 */
const IMAGE_CONCURRENCY = 2;

type Video = { url: string; blob: Blob; signature: string; info: VideoInfo };

/** ElevenLabs 동시 요청 한도는 플랜마다 다르다(Free 2 ~ Pro 10). 낮은 쪽에 맞춘다. */
const TTS_CONCURRENCY = 2;

type Stage = "fact-sheet" | "script" | "verify";
const STAGE_LABELS: Record<Stage, string> = {
  "fact-sheet": "뉴스를 모아 팩트 시트를 만드는 중…",
  script: "화자별 대본을 쓰는 중…",
  verify: "대본을 팩트 시트와 대조하는 중…",
};

type Episode = MergedEpisode & { url: string; signature: string };

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export function PodcastStudio() {
  // 주제 목록 + 자동 저장(서버 JSON 파일 + 브라우저 사본)
  const sync = useProjectSync();
  const { projects, setProjects, activeId, setActiveId, hydrated } = sync;

  // 진행 상태·오류·합친 에피소드는 주제별로 따로 둔다. 다른 주제로 옮겨도 생성은 계속된다.
  const [stages, setStages] = useState<Record<string, Stage>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [episodes, setEpisodes] = useState<Record<string, Episode>>({});

  // 음성 조각은 (목소리, 모델, 읽을 텍스트)로 캐시한다. 대사를 고치면 키가 바뀌어 자연히 "미생성"이 된다.
  const [clips, setClips] = useState<Record<string, ClipState>>({});
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  /** ElevenLabs 동시 요청 한도 때문에 일괄 생성은 한 번에 한 주제만 */
  const [batch, setBatch] = useState<{ projectId: string; done: number; total: number } | null>(null);
  const cancelRef = useRef(false);

  const [merging, setMerging] = useState(false);
  /** 주제별로 태그를 다는 중인 발화 seq */
  const [tagging, setTagging] = useState<Record<string, number[]>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [activeSeq, setActiveSeq] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // 이미지 작업 상태: "{주제id}|{slot}" — slot = studio | sheet:{speakerId} | scene:{seq}
  const [imageJobs, setImageJobs] = useState<Record<string, { busy: boolean; error?: string }>>({});
  const [sceneBatch, setSceneBatch] = useState<{ projectId: string; done: number; total: number } | null>(
    null,
  );
  const sceneCancelRef = useRef(false);
  const [videos, setVideos] = useState<Record<string, Video>>({});
  const [videoJob, setVideoJob] = useState<{ projectId: string; progress: number } | null>(null);
  const [thumbJobs, setThumbJobs] = useState<Record<string, { busy: boolean; error?: string }>>({});
  const [ytJobs, setYtJobs] = useState<Record<string, { busy: boolean; error?: string }>>({});
  const videoAbortRef = useRef<AbortController | null>(null);
  const playerRef = useRef<HTMLAudioElement>(null);

  // 주제가 하나도 없으면 빈 주제를 만들고, 선택된 주제가 없어졌으면 가장 최근 주제를 고른다.
  // 서버 목록을 받기 전에 만들면 빈 주제가 쓸데없이 생기므로 로딩이 끝난 뒤에 한다.
  useEffect(() => {
    if (!hydrated || sync.status.state === "loading") return;
    if (projects.length === 0) {
      const first = newProject();
      setProjects([first]);
      setActiveId(first.id);
    } else if (!projects.some((p) => p.id === activeId)) {
      setActiveId([...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].id);
    }
  }, [hydrated, sync.status.state, projects, activeId, setProjects, setActiveId]);

  // 언마운트 시 objectURL 정리
  const episodesRef = useRef(episodes);
  episodesRef.current = episodes;
  useEffect(
    () => () => {
      Object.values(clipsRef.current).forEach((c) => c.url && URL.revokeObjectURL(c.url));
      Object.values(episodesRef.current).forEach((e) => URL.revokeObjectURL(e.url));
    },
    [],
  );

  const updateProject = useCallback(
    (id: string, patch: Partial<Project> | ((p: Project) => Partial<Project>)) => {
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          const changes = typeof patch === "function" ? patch(p) : patch;
          // 바뀐 게 없으면 updatedAt을 건드리지 않는다. (쓸데없는 자동 저장 방지)
          if (Object.keys(changes).length === 0) return p;
          return { ...p, ...changes, updatedAt: new Date().toISOString() };
        }),
      );
    },
    [setProjects],
  );

  const project = projects.find((p) => p.id === activeId) ?? null;
  const setup = project?.setup;
  const modelId = project?.modelId ?? ELEVENLABS_CAPABILITIES.models[0].id;

  // ── 주제 목록 ───────────────────────────────────────────────────────
  function selectProject(id: string) {
    if (id === activeId) return;
    playerRef.current?.pause();
    setActiveSeq(null);
    setActiveId(id);
  }

  /** 주제를 .podcast.json 파일로 내려받는다. 다른 PC에서 "가져오기"로 그대로 연다. */
  async function exportProject(target: Project) {
    // 디자인시트·스튜디오는 늘 넣고, 용량이 큰 장면 이미지는 물어본다.
    const base = projectAssetIds(target, { scenes: false });
    const scenes = projectAssetIds(target).filter((id) => !base.includes(id));
    const withScenes =
      scenes.length > 0 &&
      window.confirm(
        `장면 이미지 ${scenes.length}장도 파일에 넣을까요? (약 ${Math.round(scenes.length * 0.9)}MB 늘어납니다)\n\n확인: 장면 이미지까지 넣기\n취소: 디자인시트·스튜디오만 넣기`,
      );
    const ids = withScenes ? [...base, ...scenes] : base;
    const assets: Record<string, string> = {};
    const failed: string[] = [];
    await Promise.all(
      ids.map(async (id) => {
        try {
          assets[id] = await assetToDataUrl(id);
        } catch {
          failed.push(id);
        }
      }),
    );
    if (failed.length) setImportError(`이미지 ${failed.length}장을 읽지 못해 빼고 내보냈습니다.`);
    const file = toPodcastFile(target, assets);
    downloadBlob(
      new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
      projectFileName(target),
    );
  }

  async function importFiles(files: File[]) {
    const imported: Project[] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const { project: incoming, assets } = readPodcastFile(JSON.parse(await file.text()));
        // 파일에 든 이미지를 먼저 서버에 올린다. 같은 id가 이미 있으면 서버가 건너뛴다.
        await Promise.all(
          Object.entries(assets).map(async ([id, dataUrl]) => uploadAsset(await dataUrlToBlob(dataUrl), id)),
        );
        const now = new Date().toISOString();
        const exists = projects.some((p) => p.id === incoming.id);
        const overwrite =
          exists &&
          window.confirm(
            `"${projectTitle(incoming)}" 주제가 이미 있습니다.

확인: 파일 내용으로 덮어쓰기
취소: 사본으로 따로 가져오기`,
          );
        // 가져온 순간을 최신 수정으로 본다. 그래야 자동 저장이 서버의 옛 버전을 덮어쓴다.
        imported.push(
          exists && !overwrite
            ? { ...incoming, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
            : { ...incoming, updatedAt: now },
        );
      } catch (err) {
        const reason =
          err instanceof SyntaxError ? "JSON 형식이 아닙니다." : err instanceof Error ? err.message : "";
        failures.push(`${file.name}: ${reason}`);
      }
    }
    if (imported.length > 0) {
      const ids = new Set(imported.map((p) => p.id));
      setProjects((prev) => [...prev.filter((p) => !ids.has(p.id)), ...imported]);
      selectProject(imported[imported.length - 1].id);
    }
    setImportError(failures.length > 0 ? `가져오지 못한 파일 — ${failures.join(" / ")}` : null);
  }

  function createProject() {
    const next = newProject(project);
    setProjects((prev) => [...prev, next]);
    selectProject(next.id);
  }

  function deleteProject(target: Project) {
    const ok = window.confirm(
      `"${projectTitle(target)}" 주제를 삭제할까요?\n\n팩트 시트와 대본이 함께 지워지며 되돌릴 수 없습니다.`,
    );
    if (!ok) return;
    if (batch?.projectId === target.id) cancelRef.current = true;
    const removed = episodes[target.id];
    if (removed) URL.revokeObjectURL(removed.url);
    setEpisodes((prev) => without(prev, target.id));
    const video = videos[target.id];
    if (video) URL.revokeObjectURL(video.url);
    setVideos((prev) => without(prev, target.id));
    if (videoJob?.projectId === target.id) videoAbortRef.current?.abort();
    if (sceneBatch?.projectId === target.id) sceneCancelRef.current = true;

    sync.removeRemote(target.id);
    const remaining = projects.filter((p) => p.id !== target.id);
    if (remaining.length === 0) {
      const fresh = newProject(target);
      setProjects([fresh]);
      selectProject(fresh.id);
      return;
    }
    setProjects(remaining);
    if (target.id === activeId) {
      const latest = [...remaining].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      selectProject(latest.id);
    }
  }

  // ── 성우 목록 ────────────────────────────────────────────────────────
  const voicesQuery = useQuery({
    queryKey: ["voices", "elevenlabs"],
    queryFn: () => fetchVoices("elevenlabs"),
  });
  const voices = useMemo(
    () => (voicesQuery.data?.voices ?? []).filter((v) => v.status === "ready"),
    [voicesQuery.data],
  );

  // 목소리가 비어 있는 화자에게 서로 다른 목소리를 채워 준다.
  useEffect(() => {
    if (!activeId || voices.length === 0) return;
    updateProject(activeId, (p) => {
      if (p.setup.speakers.every((s) => s.voiceId && voices.some((v) => v.voiceId === s.voiceId))) return {};
      const used = new Set(p.setup.speakers.map((s) => s.voiceId));
      return {
        setup: {
          ...p.setup,
          speakers: p.setup.speakers.map((s) => {
            if (s.voiceId && voices.some((v) => v.voiceId === s.voiceId)) return s;
            const pick = voices.find((v) => !used.has(v.voiceId)) ?? voices[0];
            used.add(pick.voiceId);
            return { ...s, voiceId: pick.voiceId };
          }),
        },
      };
    });
  }, [activeId, voices, updateProject]);

  // ── 파생 값 ─────────────────────────────────────────────────────────
  const voiceOfIn = useCallback(
    (p: Project, speakerName: string) => p.setup.speakers.find((s) => s.name === speakerName)?.voiceId ?? "",
    [],
  );
  const keyIn = useCallback(
    (p: Project, u: Utterance) => `${voiceOfIn(p, u.speaker)}|${p.modelId}|${ttsText(u, p.modelId)}`,
    [voiceOfIn],
  );
  const clipOf = useCallback(
    (u: Utterance) => (project ? clips[keyIn(project, u)] : undefined),
    [clips, keyIn, project],
  );

  const factSheet = project?.factSheet ?? null;
  const script = project?.script ?? null;
  const flags = project?.flags ?? [];
  const groundingSources = project?.groundingSources ?? [];
  const stage = activeId ? stages[activeId] : undefined;
  const error = activeId ? errors[activeId] : undefined;
  const episode = activeId ? episodes[activeId] : undefined;
  const notice = activeId ? notices[activeId] : undefined;
  const taggingSeqs = useMemo(() => new Set(activeId ? (tagging[activeId] ?? []) : []), [tagging, activeId]);

  const segmentTitles = useMemo(
    () => new Map((factSheet?.segments ?? []).map((s) => [s.no, s.headline])),
    [factSheet],
  );

  const utterances = script?.utterances ?? [];
  const totalChars = scriptChars(script);
  const doneCount = utterances.filter((u) => clipOf(u)?.status === "done").length;
  const allDone = utterances.length > 0 && doneCount === utterances.length;
  const clipDurationMs = utterances.reduce((n, u) => n + (clipOf(u)?.durationMs ?? 0), 0);
  const signature = project ? utterances.map((u) => keyIn(project, u)).join("\n") : "";
  const episodeStale = !!episode && episode.signature !== signature;
  const missingVoice = (setup?.speakers ?? []).filter((s) => !s.voiceId).map((s) => s.name);
  const busyIds = useMemo(
    () => new Set([...Object.keys(stages), ...(batch ? [batch.projectId] : [])]),
    [stages, batch],
  );

  // ── 대본 파이프라인 ─────────────────────────────────────────────────
  // 시작 시점의 주제 id와 설정을 붙잡아 두고, 결과는 그 주제에 쓴다.
  async function run(id: string, fn: (setStage: (s: Stage) => void) => Promise<void>) {
    setErrors((prev) => without(prev, id));
    try {
      await fn((s) => setStages((prev) => ({ ...prev, [id]: s })));
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.",
      }));
    } finally {
      setStages((prev) => without(prev, id));
    }
  }

  async function writeScript(id: string, snap: EpisodeSetup, sheet: FactSheet, setStage: (s: Stage) => void) {
    setStage("script");
    const { script: next } = await createScript(snap, sheet);
    updateProject(id, { script: next, flags: [] });
    setStage("verify");
    const { flags: found } = await verifyScript(sheet, next);
    updateProject(id, { flags: found });
  }

  function generateAll() {
    if (!project) return;
    const { id, setup: snap } = project;
    void run(id, async (setStage) => {
      setStage("fact-sheet");
      const res = await createFactSheet(snap);
      updateProject(id, { factSheet: res.factSheet, groundingSources: res.groundingSources });
      await writeScript(id, snap, res.factSheet, setStage);
    });
  }

  function rewriteScript() {
    if (!project?.factSheet) return;
    const { id, setup: snap, factSheet: sheet } = project;
    void run(id, (setStage) => writeScript(id, snap, sheet, setStage));
  }

  function reverify() {
    if (!project?.factSheet || !project.script) return;
    const { id, factSheet: sheet, script: current } = project;
    void run(id, async (setStage) => {
      setStage("verify");
      updateProject(id, { flags: (await verifyScript(sheet, current)).flags });
    });
  }

  function setSetup(next: EpisodeSetup) {
    if (activeId) updateProject(activeId, { setup: next });
  }
  function setScript(next: Script) {
    if (activeId) updateProject(activeId, { script: next });
  }
  function setModelId(next: string) {
    if (activeId) updateProject(activeId, { modelId: next });
  }

  function renameSpeaker(from: string, to: string) {
    if (!activeId) return;
    updateProject(activeId, (p) => ({
      script: p.script
        ? {
            ...p.script,
            utterances: p.script.utterances.map((u) => (u.speaker === from ? { ...u, speaker: to } : u)),
          }
        : p.script,
    }));
  }

  // ── 음성 ────────────────────────────────────────────────────────────
  const synthesizeIn = useCallback(
    async (p: Project, u: Utterance) => {
      const key = keyIn(p, u);
      const voiceId = voiceOfIn(p, u.speaker);
      const put = (state: ClipState) =>
        setClips((prev) => {
          const old = prev[key];
          if (old?.url && old.url !== state.url) URL.revokeObjectURL(old.url);
          return { ...prev, [key]: state };
        });

      if (!voiceId) {
        put({ status: "error", error: `"${u.speaker}" 화자에 목소리가 없습니다.` });
        return;
      }
      put({ status: "loading" });
      try {
        const res = await synthesize({
          provider: "elevenlabs",
          voiceId,
          text: ttsText(u, p.modelId),
          modelId: p.modelId,
        });
        const decoded = await decodeClip(res.blob);
        put({
          status: "done",
          blob: res.blob,
          url: res.url,
          durationMs: Math.round(decoded.duration * 1000),
        });
      } catch (err) {
        put({ status: "error", error: err instanceof Error ? err.message : "음성 변환에 실패했습니다." });
      }
    },
    [keyIn, voiceOfIn],
  );

  const synthesizeOne = useCallback(
    (u: Utterance) => {
      if (project) void synthesizeIn(project, u);
    },
    [project, synthesizeIn],
  );

  async function synthesizeAll() {
    if (!project) return;
    const snap = project;
    const seen = new Set<string>();
    const queue = utterances.filter((u) => {
      const key = keyIn(snap, u);
      if (seen.has(key) || clipsRef.current[key]?.status === "done" || !u.text.trim()) return false;
      seen.add(key);
      return true;
    });
    if (queue.length === 0) return;

    cancelRef.current = false;
    let done = 0;
    setBatch({ projectId: snap.id, done, total: queue.length });
    const worker = async () => {
      while (queue.length > 0 && !cancelRef.current) {
        await synthesizeIn(snap, queue.shift()!);
        setBatch({ projectId: snap.id, done: ++done, total: seen.size });
      }
    };
    await Promise.all(Array.from({ length: TTS_CONCURRENCY }, worker));
    setBatch(null);
  }

  /**
   * AI로 감정 태그를 단다. seqs가 없으면 전체 발화.
   * 기다리는 사이 사용자가 그 대사를 고쳤으면 덮어쓰지 않는다.
   */
  async function tagUtterances(seqs?: number[]) {
    if (!project?.script) return;
    const { id, script: snap, factSheet: sheet } = project;
    const speakers = project.setup.speakers;
    const targets = seqs ?? snap.utterances.filter((u) => u.text.trim()).map((u) => u.seq);
    if (targets.length === 0) return;
    if (!seqs && snap.utterances.some((u) => hasTags(u.text))) {
      const ok = window.confirm("이미 달린 태그를 지우고 모든 대사에 태그를 새로 답니다. 계속할까요?");
      if (!ok) return;
    }

    const sentText = new Map(snap.utterances.map((u) => [u.seq, u.text]));
    setTagging((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), ...targets] }));
    setErrors((prev) => without(prev, id));
    setNotices((prev) => without(prev, id));
    try {
      const res = await tagScript({ script: snap, speakers, factSheet: sheet, targetSeqs: seqs });
      const tagged = new Map(res.utterances.map((t) => [t.seq, t]));
      updateProject(id, (p) => {
        if (!p.script) return {};
        return {
          script: {
            ...p.script,
            utterances: p.script.utterances.map((u) => {
              const t = tagged.get(u.seq);
              if (!t || stripTags(u.text) !== stripTags(sentText.get(u.seq) ?? "")) return u;
              return { ...u, text: t.text, emotion: t.emotion };
            }),
          },
        };
      });
      if (!seqs || res.skipped.length > 0) {
        const skippedNote =
          res.skipped.length > 0
            ? ` ${res.skipped.length}개는 대사가 바뀌어 적용하지 않았습니다(${res.skipped.join(", ")}번).`
            : "";
        setNotices((prev) => ({
          ...prev,
          [id]: `${res.utterances.length}개 대사에 감정 태그를 달았습니다.${skippedNote}`,
        }));
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "태그 달기에 실패했습니다.",
      }));
    } finally {
      const done = new Set(targets);
      setTagging((prev) => {
        const left = (prev[id] ?? []).filter((seq) => !done.has(seq));
        return left.length ? { ...prev, [id]: left } : without(prev, id);
      });
    }
  }

  async function merge(): Promise<Episode | null> {
    if (!project) return null;
    const id = project.id;
    setMerging(true);
    setErrors((prev) => without(prev, id));
    try {
      const list = utterances.map((u) => ({ utterance: u, blob: clipOf(u)!.blob! }));
      const merged = await mergeEpisode(list, segmentTitles);
      const next: Episode = { ...merged, url: URL.createObjectURL(merged.wav), signature };
      setEpisodes((prev) => {
        if (prev[id]) URL.revokeObjectURL(prev[id].url);
        return { ...prev, [id]: next };
      });
      return next;
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? `합치기에 실패했습니다: ${err.message}` : "합치기에 실패했습니다.",
      }));
      return null;
    } finally {
      setMerging(false);
    }
  }

  // ── 이미지 ──────────────────────────────────────────────────────────
  const jobKey = (projectId: string, slot: string) => `${projectId}|${slot}`;
  const setJob = useCallback(
    (projectId: string, slot: string, state: { busy: boolean; error?: string } | null) => {
      const key = `${projectId}|${slot}`;
      setImageJobs((prev) => (state ? { ...prev, [key]: state } : without(prev, key)));
    },
    [],
  );

  /** 스튜디오·디자인시트 칸에 이미지를 넣거나 뺀다. */
  function applySlot(projectId: string, slot: string, assetId: string | undefined) {
    updateProject(projectId, (p) =>
      slot === "studio"
        ? { setup: { ...p.setup, studioImage: assetId } }
        : {
            setup: {
              ...p.setup,
              speakers: p.setup.speakers.map((s) =>
                `sheet:${s.id}` === slot ? { ...s, designSheet: assetId } : s,
              ),
            },
          },
    );
  }

  async function runSlot(projectId: string, slot: string, make: () => Promise<string>) {
    setJob(projectId, slot, { busy: true });
    try {
      applySlot(projectId, slot, await make());
      setJob(projectId, slot, null);
    } catch (err) {
      setJob(projectId, slot, {
        busy: false,
        error: err instanceof Error ? err.message : "이미지를 만들지 못했습니다.",
      });
    }
  }

  const slots: SlotHandlers = {
    jobOf: (slot) => (activeId ? (imageJobs[jobKey(activeId, slot)] ?? { busy: false }) : { busy: false }),
    upload: (slot, file) => {
      if (!project) return;
      void runSlot(project.id, slot, async () => uploadAsset(await downscaleImage(file)));
    },
    generate: (slot) => {
      if (!project) return;
      const { id, setup: snap } = project;
      void runSlot(id, slot, async () => {
        const res =
          slot === "studio"
            ? await generateImage({ kind: "studio", setup: snap })
            : await generateImage({ kind: "character", setup: snap, speakerId: slot.slice("sheet:".length) });
        return res.assetId;
      });
    },
    clear: (slot) => {
      if (activeId) applySlot(activeId, slot, undefined);
    },
  };

  const sceneOf = (u: Utterance): SceneState => {
    const job = activeId ? imageJobs[jobKey(activeId, `scene:${u.seq}`)] : undefined;
    const ref = activeId ? imageJobs[jobKey(activeId, `ref:${u.seq}`)] : undefined;
    return {
      refBusy: !!ref?.busy,
      refError: ref?.error,
      assetId: u.scene?.assetId,
      stale: !!u.scene && !!setup && u.scene.sig !== sceneSignature(u, setup),
      busy: !!job?.busy,
      error: job?.error,
    };
  };

  /**
   * 발화 장면을 만든다. 기다리는 사이 대사가 바뀌었으면 붙이지 않는다.
   * (태그만 바뀐 건 같은 대사로 보고 붙인 뒤 "대사 바뀜"으로 표시한다)
   */
  const generateSceneIn = useCallback(
    async (p: Project, u: Utterance) => {
      const slot = `scene:${u.seq}`;
      const sig = sceneSignature(u, p.setup);
      setJob(p.id, slot, { busy: true });
      try {
        const { assetId } = await generateImage({
          kind: "scene",
          setup: p.setup,
          utterance: { speaker: u.speaker, text: u.text, emotion: u.emotion, visualRef: u.visualRef },
        });
        updateProject(p.id, (cur) => {
          if (!cur.script) return {};
          let hit = false;
          const utterances = cur.script.utterances.map((x) => {
            if (x.seq !== u.seq || x.speaker !== u.speaker || stripTags(x.text) !== stripTags(u.text))
              return x;
            hit = true;
            return { ...x, scene: { assetId, sig } };
          });
          return hit ? { script: { ...cur.script, utterances } } : {};
        });
        setJob(p.id, slot, null);
      } catch (err) {
        setJob(p.id, slot, {
          busy: false,
          error: err instanceof Error ? err.message : "장면을 만들지 못했습니다.",
        });
      }
    },
    [setJob, updateProject],
  );

  /** 발화에 관련 사진을 붙이거나(file) 뗀다(null). 바꾸면 그 장면은 "다시 만들기" 대상이 된다. */
  async function setVisualRef(u: Utterance, file: File | null) {
    if (!project) return;
    const pid = project.id;
    const slot = `ref:${u.seq}`;
    const apply = (id: string | undefined) =>
      updateProject(pid, (cur) =>
        cur.script
          ? {
              script: {
                ...cur.script,
                utterances: cur.script.utterances.map((x) =>
                  x.seq === u.seq && x.speaker === u.speaker ? { ...x, visualRef: id } : x,
                ),
              },
            }
          : {},
      );
    if (!file) return apply(undefined);
    setJob(pid, slot, { busy: true });
    try {
      apply(await uploadAsset(await downscaleImage(file)));
      setJob(pid, slot, null);
    } catch (err) {
      setJob(pid, slot, {
        busy: false,
        error: err instanceof Error ? err.message : "사진을 올리지 못했습니다.",
      });
    }
  }

  async function generateAllScenes() {
    if (!project?.script) return;
    const snap = project;
    const queue = snap.script!.utterances.filter(
      (u) => u.text.trim() && (!u.scene || u.scene.sig !== sceneSignature(u, snap.setup)),
    );
    if (queue.length === 0) return;
    if (
      queue.length > 10 &&
      !window.confirm(
        `장면 이미지 ${queue.length}장을 만듭니다. 이미지마다 Gemini 요금이 듭니다 (Nano Banana 2 기준 장당 약 50~100원). 계속할까요?`,
      )
    )
      return;

    sceneCancelRef.current = false;
    const total = queue.length;
    let done = 0;
    setSceneBatch({ projectId: snap.id, done, total });
    const worker = async () => {
      while (queue.length > 0 && !sceneCancelRef.current) {
        await generateSceneIn(snap, queue.shift()!);
        setSceneBatch({ projectId: snap.id, done: ++done, total });
      }
    };
    await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, worker));
    setSceneBatch(null);
  }

  // ── 영상 ────────────────────────────────────────────────────────────
  const videoSignature = `${signature}#${utterances.map((u) => u.scene?.assetId ?? "-").join(",")}`;

  /**
   * 유튜브 썸네일. text가 없으면 AI가 문구부터 만들고, 있으면 그 문구로 그린다.
   * 새 썸네일이 나오면 이전 이미지는 서버 자동 저장 때 정리된다.
   */
  async function makeThumbnail(text?: { title: string; subtitle: string }) {
    if (!project) return;
    const { id, setup: snap, script: snapScript, factSheet: snapSheet } = project;
    setThumbJobs((prev) => ({ ...prev, [id]: { busy: true } }));
    try {
      const res = await createThumbnail({ setup: snap, script: snapScript, factSheet: snapSheet, ...text });
      updateProject(id, { thumbnail: { assetId: res.assetId, title: res.title, subtitle: res.subtitle } });
      setThumbJobs((prev) => without(prev, id));
      // 문구가 새로 나왔거나 업로드 정보가 아직 없으면 해시태그·태그·설명도 함께 만든다.
      // (문구만 고쳐 다시 그린 경우 제목은 화면에서 자동으로 다시 조합된다)
      if (!text || !project.youtube) void makeYoutubeMeta(res.title);
    } catch (err) {
      setThumbJobs((prev) => ({
        ...prev,
        [id]: { busy: false, error: err instanceof Error ? err.message : "썸네일을 만들지 못했습니다." },
      }));
    }
  }

  /** 유튜브 업로드 정보. 제목은 썸네일 메인 문구로 화면에서 조합하고, 나머지를 AI가 만든다. */
  async function makeYoutubeMeta(mainTitle?: string) {
    if (!project) return;
    const { id, setup: snap, script: snapScript, factSheet: snapSheet } = project;
    setYtJobs((prev) => ({ ...prev, [id]: { busy: true } }));
    try {
      const { meta } = await createYoutubeMeta({
        setup: snap,
        script: snapScript,
        factSheet: snapSheet,
        mainTitle: mainTitle ?? project.thumbnail?.title ?? snapScript?.title ?? "",
      });
      updateProject(id, { youtube: meta });
      setYtJobs((prev) => without(prev, id));
    } catch (err) {
      setYtJobs((prev) => ({
        ...prev,
        [id]: { busy: false, error: err instanceof Error ? err.message : "업로드 정보를 만들지 못했습니다." },
      }));
    }
  }

  async function makeVideo() {
    if (!project || !allDone) return;
    const id = project.id;
    const missing = utterances.filter((u) => !u.scene).length;
    if (
      missing > 0 &&
      !window.confirm(
        `장면 이미지가 없는 발화 ${missing}개는 화자 이름만 있는 검은 화면으로 들어갑니다. 계속할까요?`,
      )
    ) {
      return;
    }
    // 음성이 최신 에피소드로 합쳐져 있어야 한다.
    const ep = episode && !episodeStale ? episode : await merge();
    if (!ep) return;

    const bySeq = new Map(utterances.map((u) => [u.seq, u]));
    const scenes = ep.timeline.items.map((item) => {
      const u = bySeq.get(item.seq);
      return {
        startMs: item.start_ms,
        endMs: item.end_ms,
        speaker: item.speaker,
        text: u?.text ?? "",
        imageUrl: u?.scene ? assetUrl(u.scene.assetId) : undefined,
      };
    });

    const abort = new AbortController();
    videoAbortRef.current = abort;
    setVideoJob({ projectId: id, progress: 0 });
    setErrors((prev) => without(prev, id));
    try {
      const blob = await renderEpisodeVideo({
        scenes,
        audio: ep.wav,
        durationMs: ep.timeline.duration_ms,
        onProgress: (progress) => setVideoJob({ projectId: id, progress }),
        signal: abort.signal,
      });
      const info = await inspectVideo(blob);
      setVideos((prev) => {
        if (prev[id]) URL.revokeObjectURL(prev[id].url);
        return { ...prev, [id]: { url: URL.createObjectURL(blob), blob, signature: videoSignature, info } };
      });
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setErrors((prev) => ({
          ...prev,
          [id]:
            err instanceof Error
              ? `영상 만들기에 실패했습니다: ${err.message}`
              : "영상 만들기에 실패했습니다.",
        }));
      }
    } finally {
      setVideoJob(null);
      videoAbortRef.current = null;
    }
  }

  function seek(seq: number) {
    const item = episode?.timeline.items.find((i) => i.seq === seq);
    if (!item || !playerRef.current) return;
    playerRef.current.currentTime = item.start_ms / 1000;
    void playerRef.current.play();
  }

  function onTimeUpdate() {
    if (!episode || !playerRef.current) return;
    const ms = playerRef.current.currentTime * 1000;
    const item = episode.timeline.items.find((i) => ms >= i.start_ms && ms < i.end_ms + 350);
    setActiveSeq(item?.seq ?? null);
  }

  // 내려받는 파일 이름: 뉴스_브리핑_오늘_2026년_9월_29일 (영상·썸네일·음성·자막 공통)
  const baseName = fileBaseName(script, factSheet);

  // ── 화면 ────────────────────────────────────────────────────────────
  if (!project || !setup) {
    return (
      <main className="flex min-h-screen items-center justify-center text-ink-400">
        <Spinner />
      </main>
    );
  }

  const busy = !!stage;
  const taggingAll =
    utterances.length > 0 && utterances.every((u) => !u.text.trim() || taggingSeqs.has(u.seq));
  const batchHere = batch?.projectId === project.id ? batch : null;
  const thumbJob = thumbJobs[project.id];
  const ytJob = ytJobs[project.id];
  const sceneBatchHere = sceneBatch?.projectId === project.id ? sceneBatch : null;
  const videoHere = videoJob?.projectId === project.id ? videoJob : null;
  const video = videos[project.id];
  const videoStale = !!video && video.signature !== videoSignature;
  const aacPlayable = typeof document === "undefined" || canPlayAac();
  const scenesPending = utterances.filter(
    (u) => u.text.trim() && (!u.scene || u.scene.sig !== sceneSignature(u, setup)),
  ).length;
  const canGenerate =
    !busy && setup.topic.trim().length > 0 && (setup.useWebSearch || setup.sourceText.trim().length > 0);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-5 px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-100">뉴스 팟캐스트 생성기</h1>
          <p className="mt-1 text-xs text-ink-400">
            주제를 넣으면 Gemini가 뉴스를 모아 여러 화자의 대본을 쓰고, ElevenLabs가 화자별 목소리로 읽습니다.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <SyncIndicator status={sync.status} onDismissNotice={sync.dismissNotice} />
          <Link
            href="/"
            className="rounded-lg border border-ink-700/70 px-3 py-2 text-xs text-ink-300 transition hover:text-accent-300"
          >
            ← Voice Studio
          </Link>
        </div>
      </header>
      {importError ? <ErrorNote message={importError} /> : null}

      <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)] lg:overflow-y-auto lg:overscroll-contain">
          <ProjectList
            projects={projects}
            activeId={activeId}
            busyIds={busyIds}
            onSelect={selectProject}
            onCreate={createProject}
            onDelete={deleteProject}
            onExport={exportProject}
            onImport={(files) => void importFiles(files)}
            unsavedIds={sync.unsavedIds}
          />
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <div className="flex flex-col gap-3 xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
            <SetupPanel
              setup={setup}
              onChange={setSetup}
              onRenameSpeaker={renameSpeaker}
              voices={voices}
              voicesLoading={voicesQuery.isPending}
              voicesError={voicesQuery.error instanceof Error ? voicesQuery.error.message : null}
              modelId={modelId}
              slots={slots}
            />
            <button
              onClick={generateAll}
              disabled={!canGenerate}
              className="flex items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <Spinner /> : null}
              {script ? "새 뉴스로 대본 다시 만들기" : "대본 만들기"}
            </button>
            <p className="text-center text-[11px] text-ink-400">
              목표 약 {(setup.targetMinutes * CHARS_PER_MINUTE).toLocaleString()}자 · 팩트 시트 → 대본 → 사실
              검증
            </p>
            <VisualPanel setup={setup} onChange={setSetup} slots={slots} />
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            {stage ? (
              <InfoNote>
                <span className="flex items-center gap-2">
                  <Spinner className="h-3.5 w-3.5 text-accent-300" /> {STAGE_LABELS[stage]}
                </span>
              </InfoNote>
            ) : null}
            {error ? <ErrorNote message={error} /> : null}
            {notice ? <InfoNote>{notice}</InfoNote> : null}

            {factSheet ? <FactSheetView factSheet={factSheet} groundingSources={groundingSources} /> : null}

            {script ? (
              <Panel
                title={`2. 대본 검수 — ${script.title}`}
                subtitle={`발화 ${utterances.length}개 · ${totalChars.toLocaleString()}자 (목표 ${(setup.targetMinutes * CHARS_PER_MINUTE).toLocaleString()}자, 태그 제외) · 경고 ${flags.length}건. 대사·화자·감정·오디오 태그를 고친 뒤 음성을 만드세요.`}
              >
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <button onClick={rewriteScript} disabled={busy || !factSheet} className={secondaryBtn}>
                    같은 뉴스로 대본 다시 쓰기
                  </button>
                  <button onClick={reverify} disabled={busy || !factSheet} className={secondaryBtn}>
                    다시 검증
                  </button>
                  {sceneBatchHere ? (
                    <button onClick={() => (sceneCancelRef.current = true)} className={secondaryBtn}>
                      <Spinner className="h-3.5 w-3.5" /> 장면 {sceneBatchHere.done}/{sceneBatchHere.total}{" "}
                      중지
                    </button>
                  ) : (
                    <button
                      onClick={() => void generateAllScenes()}
                      disabled={scenesPending === 0 || !!sceneBatch}
                      title={
                        sceneBatch
                          ? "다른 주제의 장면을 만드는 중입니다"
                          : "장면이 없거나 대사가 바뀐 발화의 이미지를 만듭니다"
                      }
                      className={secondaryBtn}
                    >
                      {scenesPending > 0 ? `장면 이미지 ${scenesPending}장 만들기` : "장면 이미지 모두 최신"}
                    </button>
                  )}
                  <DownloadLink
                    label="대본 JSON"
                    make={() => new Blob([JSON.stringify(script, null, 2)], { type: "application/json" })}
                    name={`${baseName}.script.json`}
                  />
                </div>

                <ScriptEditor
                  script={script}
                  onChange={(next) => setScript(next)}
                  speakers={setup.speakers}
                  flags={flags}
                  segmentTitles={segmentTitles}
                  clipOf={clipOf}
                  onSynthesize={synthesizeOne}
                  onTag={(u) => void tagUtterances([u.seq])}
                  taggingSeqs={taggingSeqs}
                  sceneOf={sceneOf}
                  onScene={(u) => void generateSceneIn(project, u)}
                  onVisualRef={(u, file) => void setVisualRef(u, file)}
                  relatedEnabled={setup.visual.contentMode !== "none"}
                  activeSeq={activeSeq}
                  tagsEnabled={supportsAudioTags(modelId)}
                  onSeek={episode && !episodeStale ? seek : undefined}
                />
              </Panel>
            ) : !stage ? (
              <Panel title="2. 대본 검수">
                <p className="py-10 text-center text-sm text-ink-400">
                  주제와 화자를 정한 뒤 <b className="text-ink-300">대본 만들기</b>를 누르세요.
                </p>
              </Panel>
            ) : null}

            {script ? (
              <Panel title="3. 음성 · 에피소드" subtitle="발화별로 음성을 만들고 하나의 에피소드로 합칩니다.">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-[200px]">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                      TTS 모델
                    </span>
                    <select
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      disabled={!!batchHere}
                      className="w-full rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-2 text-sm text-ink-100 outline-none"
                    >
                      {ELEVENLABS_CAPABILITIES.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    onClick={() => void tagUtterances()}
                    disabled={taggingAll || !!batchHere}
                    title="AI가 대화 흐름을 보고 모든 대사에 상황에 맞는 감정 태그를 답니다"
                    className={secondaryBtn}
                  >
                    {taggingAll ? <Spinner className="h-3.5 w-3.5" /> : null}
                    {taggingAll ? "태그 다는 중…" : "감정 태그 달기"}
                  </button>
                  {batchHere ? (
                    <button onClick={() => (cancelRef.current = true)} className={secondaryBtn}>
                      <Spinner className="h-3.5 w-3.5" /> {batchHere.done}/{batchHere.total} 중지
                    </button>
                  ) : (
                    <button
                      onClick={synthesizeAll}
                      disabled={allDone || missingVoice.length > 0 || !!batch}
                      title={batch ? "다른 주제의 음성을 만드는 중입니다" : undefined}
                      className={primaryBtn}
                    >
                      {doneCount > 0 && !allDone
                        ? `남은 ${utterances.length - doneCount}개 음성 만들기`
                        : "전체 음성 만들기"}
                    </button>
                  )}
                  <button
                    onClick={() => void makeThumbnail()}
                    disabled={!!thumbJob?.busy}
                    title="주요 뉴스로 흥미로운 썸네일 문구를 만들고, 연출 방식에 맞는 썸네일 이미지를 그립니다"
                    className={secondaryBtn}
                  >
                    {thumbJob?.busy ? <Spinner className="h-3.5 w-3.5" /> : null}
                    {thumbJob?.busy
                      ? "썸네일 만드는 중…"
                      : project.thumbnail
                        ? "썸네일 새로 만들기"
                        : "썸네일 이미지 만들기"}
                  </button>
                  <button onClick={merge} disabled={!allDone || merging || !!batch} className={primaryBtn}>
                    {merging ? <Spinner className="h-3.5 w-3.5" /> : null}
                    에피소드 합치기
                  </button>
                  {videoHere ? (
                    <button onClick={() => videoAbortRef.current?.abort()} className={secondaryBtn}>
                      <Spinner className="h-3.5 w-3.5" /> 영상 {Math.round(videoHere.progress * 100)}% 중지
                    </button>
                  ) : (
                    <button
                      onClick={() => void makeVideo()}
                      disabled={!allDone || merging || !!batch || !!videoJob}
                      title={
                        allDone
                          ? "장면 이미지와 음성을 합쳐 MP4를 만듭니다"
                          : "먼저 모든 발화의 음성을 만드세요"
                      }
                      className={primaryBtn}
                    >
                      영상 만들기
                    </button>
                  )}

                  <span className="ml-auto flex items-center gap-2 text-[11px] tabular-nums text-ink-400">
                    <Badge tone={allDone ? "ok" : "neutral"}>
                      {doneCount}/{utterances.length}
                    </Badge>
                    {clipDurationMs > 0 ? (
                      <span>
                        발화 합계 {formatClock(clipDurationMs)} / 목표 {setup.targetMinutes}:00
                      </span>
                    ) : null}
                  </span>
                </div>

                {project.thumbnail ? (
                  <ThumbnailBox
                    key={project.thumbnail.assetId}
                    thumbnail={project.thumbnail}
                    fileName={`${baseName}.thumbnail.jpg`}
                    busy={!!thumbJob?.busy}
                    error={thumbJob?.error}
                    onRedraw={(title, subtitle) => void makeThumbnail({ title, subtitle })}
                    onNewText={() => void makeThumbnail()}
                  />
                ) : thumbJob?.error ? (
                  <div className="mt-3">
                    <ErrorNote message={thumbJob.error} />
                  </div>
                ) : null}
                {project.thumbnail && project.youtube ? (
                  <YoutubeMetaBox
                    meta={project.youtube}
                    mainTitle={project.thumbnail.title}
                    script={script}
                    factSheet={factSheet}
                    timeline={episode && !episodeStale ? episode.timeline : null}
                    fileName={`${baseName}.youtube.txt`}
                    busy={!!ytJob?.busy}
                    error={ytJob?.error}
                    onRegenerate={() => void makeYoutubeMeta()}
                  />
                ) : project.thumbnail ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => void makeYoutubeMeta()}
                      disabled={!!ytJob?.busy}
                      className={secondaryBtn}
                    >
                      {ytJob?.busy ? <Spinner className="h-3.5 w-3.5" /> : null}
                      {ytJob?.busy ? "해시태그·태그·설명 만드는 중…" : "유튜브 업로드 정보 만들기"}
                    </button>
                    {ytJob?.error ? <ErrorNote message={ytJob.error} /> : null}
                  </div>
                ) : null}
                {missingVoice.length > 0 ? (
                  <p className="mt-2 text-[11px] text-amber-300">
                    목소리가 없는 화자: {missingVoice.join(", ")} — 왼쪽에서 목소리를 골라주세요.
                  </p>
                ) : null}
                <p className="mt-2 text-[11px] text-ink-400">
                  {supportsAudioTags(modelId)
                    ? "대사 속 [오디오 태그]로 말투·웃음·쉼을 연출합니다. 태그가 없는 대사는 감정(emotion)에 맞는 태그를 앞에 붙입니다."
                    : "이 모델은 오디오 태그를 이해하지 못해 태그를 빼고 읽습니다. 감정 연출은 v4를 쓰세요."}
                </p>

                {episode ? (
                  <div className="mt-5 rounded-xl border border-ink-700/70 bg-ink-850/50 p-4">
                    {episodeStale ? (
                      <p className="mb-2 text-[11px] text-amber-300">
                        대본이나 음성이 바뀌었습니다. 다시 합쳐야 반영됩니다.
                      </p>
                    ) : null}
                    <audio
                      ref={playerRef}
                      src={episode.url}
                      controls
                      onTimeUpdate={onTimeUpdate}
                      onEnded={() => setActiveSeq(null)}
                      className="w-full"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {episode.timeline.chapters.map((ch) => (
                        <button
                          key={ch.segment_no}
                          onClick={() => {
                            if (!playerRef.current) return;
                            playerRef.current.currentTime = ch.start_ms / 1000;
                            void playerRef.current.play();
                          }}
                          className="rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:border-accent-500/50 hover:text-accent-300"
                        >
                          <span className="tabular-nums text-ink-400">{formatClock(ch.start_ms)}</span>{" "}
                          {ch.segment_no === 0 || ch.segment_no === 99
                            ? segmentLabel(ch.segment_no)
                            : ch.title}
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-700/70 pt-3">
                      <span className="text-[11px] text-ink-400">
                        길이 {formatClock(episode.timeline.duration_ms)} · 다운로드
                      </span>
                      <DownloadLink label="에피소드 WAV" make={() => episode.wav} name={`${baseName}.wav`} />
                      <DownloadLink
                        label="자막 SRT"
                        make={() => new Blob([episode.srt], { type: "application/x-subrip" })}
                        name={`${baseName}.srt`}
                      />
                      <DownloadLink
                        label="타임라인 JSON"
                        make={() =>
                          new Blob([JSON.stringify(episode.timeline, null, 2)], { type: "application/json" })
                        }
                        name={`${baseName}.timeline.json`}
                      />
                    </div>
                  </div>
                ) : null}
                {videoHere ? (
                  <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full bg-accent-500 transition-[width]"
                      style={{ width: `${Math.round(videoHere.progress * 100)}%` }}
                    />
                  </div>
                ) : null}
                {video ? (
                  <div className="mt-5 rounded-xl border border-ink-700/70 bg-ink-850/50 p-4">
                    {videoStale ? (
                      <p className="mb-2 text-[11px] text-amber-300">
                        대본·음성·장면이 바뀌었습니다. 영상을 다시 만들어야 반영됩니다.
                      </p>
                    ) : null}
                    {video.info.audio && !aacPlayable ? (
                      <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                        파일에는 음성이 들어 있지만, 지금 브라우저는 MP4의 AAC 소리를 재생하지 못해 여기서는
                        소리가 안 납니다 (VS Code 안의 브라우저 등). 아래 &quot;영상 MP4&quot;로 내려받아 PC
                        플레이어로 보거나 Chrome·Edge에서 이 페이지를 여세요.
                      </p>
                    ) : null}
                    <video src={video.url} controls className="aspect-video w-full rounded-lg bg-black" />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-ink-400">
                        MP4 1920×1080 · {(video.blob.size / 1024 / 1024).toFixed(1)}MB
                      </span>
                      {video.info.audio ? (
                        <Badge tone="ok">
                          음성 포함 ✓ {video.info.audio.codec.toUpperCase()}{" "}
                          {video.info.audio.channels === 2 ? "스테레오" : `${video.info.audio.channels}ch`} ·{" "}
                          {formatClock(video.info.audio.durationSec * 1000)}
                        </Badge>
                      ) : (
                        <Badge tone="danger">음성 없음</Badge>
                      )}
                      <DownloadLink label="영상 MP4" make={() => video.blob} name={`${baseName}.mp4`} />
                    </div>
                  </div>
                ) : null}
              </Panel>
            ) : null}
          </div>
        </div>
      </div>

      <footer className="pb-2 text-[11px] leading-relaxed text-ink-400">
        AI가 만든 대본은 사실과 다를 수 있습니다. 공개 전 경고 표시된 발화와 출처를 반드시 확인하세요. 설정과
        대본은 이 브라우저에 저장되며, 음성은 새로고침하면 다시 만들어야 합니다.
      </footer>
    </main>
  );
}

const primaryBtn =
  "flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryBtn =
  "flex items-center gap-2 rounded-lg border border-ink-700 px-3 py-2 text-xs text-ink-300 transition hover:border-accent-500/50 hover:text-accent-300 disabled:cursor-not-allowed disabled:opacity-40";

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DownloadLink({ label, make, name }: { label: string; make: () => Blob; name: string }) {
  return (
    <button onClick={() => downloadBlob(make(), name)} className={secondaryBtn}>
      ↓ {label}
    </button>
  );
}

function FactSheetView({
  factSheet,
  groundingSources,
}: {
  factSheet: FactSheet;
  groundingSources: GroundingSource[];
}) {
  const factCount = factSheet.segments.reduce((n, s) => n + s.facts.length, 0);
  const sources = factSheet.sources;

  return (
    <details className="group rounded-2xl border border-ink-700/70 bg-ink-900/70 backdrop-blur-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-ink-100">팩트 시트 · {factSheet.date}</h2>
          <p className="mt-1 text-xs text-ink-400">
            꼭지 {factSheet.segments.length}개 · 사실 {factCount}개 · 출처 {sources.length}개 — 대본의
            근거입니다.
          </p>
        </div>
        <span className="text-xs text-ink-400 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-ink-700/70 px-5 py-4">
        {factSheet.segments.map((seg) => (
          <div key={seg.no}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-accent-300">꼭지 {seg.no}</span>
              <span className="text-sm font-medium text-ink-100">{seg.headline}</span>
              {seg.sensitivity === "high" ? <Badge tone="warn">민감</Badge> : null}
            </div>
            <ul className="mt-1.5 flex flex-col gap-1 pl-4 text-xs leading-relaxed text-ink-300">
              {seg.facts.map((f) => (
                <li key={f.id} className="list-disc">
                  <span className="text-ink-400">{f.id}</span> {f.text}{" "}
                  <span className="text-ink-400">[{f.source_ids.join(", ")}]</span>
                </li>
              ))}
            </ul>
            {seg.background ? (
              <p className="mt-1.5 pl-4 text-[11px] text-ink-400">배경: {seg.background}</p>
            ) : null}
          </div>
        ))}
        {sources.length > 0 ? (
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">출처</span>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs">
              {sources.map((s) => (
                <li key={s.id} className="truncate text-ink-300">
                  <span className="text-ink-400">{s.id}</span>{" "}
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-accent-300 hover:underline"
                    >
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                  {s.publisher ? <span className="text-ink-400"> · {s.publisher}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {groundingSources.length > 0 ? (
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
              웹 검색에 쓰인 페이지
            </span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {groundingSources.map((g) => (
                <a
                  key={g.url}
                  href={g.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-ink-700 px-2 py-0.5 text-[11px] text-ink-300 transition hover:border-accent-500/50 hover:text-accent-300"
                >
                  {g.title}
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
