"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  loadProjects,
  loadSynced,
  mergeProjects,
  normalizeProject,
  saveProjects,
  saveSynced,
  type Project,
} from "@/lib/podcast/projects";

/**
 * 자동 저장 시점
 * - 고치기를 멈추고 2초 뒤 저장 (타이핑 중 매번 저장하지 않도록)
 * - 계속 고치고 있어도 첫 변경 뒤 10초가 지나면 한 번은 저장 (오래 쓰다 날리지 않도록)
 * - 탭을 닫거나 다른 탭으로 옮길 때 남은 변경을 바로 저장
 * 브라우저 localStorage에도 늘 사본을 둬서, 서버 저장이 실패해도 다음에 열 때 다시 올린다.
 */
const IDLE_MS = 2_000;
const MAX_WAIT_MS = 10_000;
const RETRY_MS = 10_000;
/** fetch keepalive 본문 한도(64KB)보다 조금 작게 */
const KEEPALIVE_LIMIT = 60_000;

export type Storage = "file" | "blob";

export interface SyncStatus {
  state: "loading" | "saved" | "pending" | "saving" | "error";
  storage?: Storage;
  lastSavedAt?: string;
  error?: string;
  /** 다른 곳에서 고친 내용으로 바뀐 주제가 있을 때 한 번 알려 준다 */
  notice?: string;
}

async function putProject(project: Project, keepalive = false) {
  return fetch(`/api/podcast/projects/${encodeURIComponent(project.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project }),
    keepalive,
  });
}

export function useProjectSync(): {
  projects: Project[];
  setProjects: Dispatch<SetStateAction<Project[]>>;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  hydrated: boolean;
  status: SyncStatus;
  unsavedIds: Set<string>;
  removeRemote: (id: string) => void;
  dismissNotice: () => void;
} {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<SyncStatus>({ state: "loading" });
  // 서버에 올라간 주제별 updatedAt. 이 값과 다르면 "저장 안 됨"이다.
  const [synced, setSynced] = useState<Record<string, string>>({});

  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const syncedRef = useRef(synced);
  syncedRef.current = synced;
  const remoteReady = useRef(false);
  const saving = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstDirtyAt = useRef<number | null>(null);

  const markSynced = useCallback((update: (prev: Record<string, string>) => Record<string, string>) => {
    setSynced((prev) => {
      const next = update(prev);
      syncedRef.current = next;
      saveSynced(next);
      return next;
    });
  }, []);

  // ── 처음 열 때: 브라우저 사본으로 바로 그리고, 서버 목록과 합친다 ──────────
  useEffect(() => {
    const local = loadProjects();
    const localSynced = loadSynced();
    setProjects(local.projects);
    setActiveId(local.activeId);
    setSynced(localSynced);
    setHydrated(true);

    (async () => {
      try {
        const res = await fetch("/api/podcast/projects", { cache: "no-store" });
        const data = (await res.json()) as { projects?: Project[]; storage?: Storage; error?: string };
        if (!res.ok || !data.projects)
          throw new Error(data.error ?? `서버 목록을 읽지 못했습니다 (${res.status})`);
        const server = data.projects.map(normalizeProject);
        // 서버에 있는 버전은 저장된 것으로 본다.
        const serverSynced = Object.fromEntries(server.map((p) => [p.id, p.updatedAt]));
        setProjects((current) => mergeProjects(server, current, localSynced));
        markSynced(() => serverSynced);
        remoteReady.current = true;
        setStatus({ state: "saved", storage: data.storage });
      } catch (err) {
        setStatus({
          state: "error",
          error: `${err instanceof Error ? err.message : "서버에 연결하지 못했습니다."} 이 브라우저에만 저장됩니다.`,
        });
      }
    })();
  }, [markSynced]);

  // 브라우저 사본은 바뀔 때마다 바로 쓴다. (가볍고, 서버가 안 될 때의 안전망)
  useEffect(() => {
    if (hydrated) saveProjects(projects, activeId);
  }, [hydrated, projects, activeId]);

  const dirtyProjects = useCallback(
    () => projectsRef.current.filter((p) => syncedRef.current[p.id] !== p.updatedAt),
    [],
  );

  // ── 서버 저장 ─────────────────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    firstDirtyAt.current = null;
    if (!remoteReady.current) return;
    if (saving.current) {
      again.current = true;
      return;
    }
    const dirty = dirtyProjects();
    if (dirty.length === 0) return;

    saving.current = true;
    setStatus((s) => ({ ...s, state: "saving", error: undefined }));
    let failure: string | undefined;
    let conflicts = 0;
    for (const project of dirty) {
      try {
        const res = await putProject(project);
        const data = (await res.json().catch(() => ({}))) as { error?: string; project?: Project };
        if (res.status === 409 && data.project) {
          // 다른 탭·기기에서 더 나중에 고쳤다 → 그 내용을 받아들인다.
          const theirs = normalizeProject(data.project);
          conflicts++;
          setProjects((prev) => prev.map((p) => (p.id === theirs.id ? theirs : p)));
          markSynced((prev) => ({ ...prev, [theirs.id]: theirs.updatedAt }));
          continue;
        }
        if (!res.ok) throw new Error(data.error ?? `저장 실패 (${res.status})`);
        markSynced((prev) => ({ ...prev, [project.id]: project.updatedAt }));
      } catch (err) {
        failure = err instanceof Error ? err.message : "저장에 실패했습니다.";
      }
    }
    saving.current = false;

    setStatus((s) => ({
      ...s,
      state: failure ? "error" : "saved",
      error: failure ? `${failure} ${RETRY_MS / 1000}초 뒤 다시 시도합니다.` : undefined,
      lastSavedAt: failure ? s.lastSavedAt : new Date().toISOString(),
      notice: conflicts
        ? `다른 곳에서 더 최근에 고친 주제 ${conflicts}개를 그 내용으로 바꿨습니다.`
        : s.notice,
    }));
    if (failure) {
      timer.current = setTimeout(() => void flush(), RETRY_MS);
    } else if (again.current) {
      again.current = false;
      void flush();
    }
  }, [dirtyProjects, markSynced]);

  // 바뀐 게 있으면 저장 예약: 2초 쉬면 저장, 단 첫 변경 뒤 10초는 넘기지 않는다.
  useEffect(() => {
    if (!hydrated || !remoteReady.current) return;
    if (dirtyProjects().length === 0) return;
    const now = Date.now();
    firstDirtyAt.current ??= now;
    const wait = Math.min(IDLE_MS, Math.max(0, firstDirtyAt.current + MAX_WAIT_MS - now));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), wait);
    setStatus((s) => (s.state === "saving" || s.state === "error" ? s : { ...s, state: "pending" }));
  }, [hydrated, projects, synced, dirtyProjects, flush]);

  // 탭을 떠날 때 남은 변경을 바로 보낸다. 큰 주제는 keepalive 한도를 넘으니
  // 브라우저 사본에 맡기고, 다음에 열 때 자동으로 올라간다.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden" || !remoteReady.current) return;
      for (const project of dirtyProjects()) {
        const size = new TextEncoder().encode(JSON.stringify({ project })).length;
        if (size < KEEPALIVE_LIMIT) void putProject(project, true).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [dirtyProjects]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const removeRemote = useCallback(
    (id: string) => {
      markSynced(({ [id]: _removed, ...rest }) => rest);
      if (!remoteReady.current) return;
      void fetch(`/api/podcast/projects/${encodeURIComponent(id)}`, { method: "DELETE" }).then(
        async (res) => {
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            setStatus((s) => ({
              ...s,
              state: "error",
              error: data.error ?? "서버에서 주제를 지우지 못했습니다.",
            }));
          }
        },
        () => setStatus((s) => ({ ...s, state: "error", error: "서버에서 주제를 지우지 못했습니다." })),
      );
    },
    [markSynced],
  );

  const unsavedIds = new Set(projects.filter((p) => synced[p.id] !== p.updatedAt).map((p) => p.id));

  return {
    projects,
    setProjects,
    activeId,
    setActiveId,
    hydrated,
    status,
    unsavedIds,
    removeRemote,
    dismissNotice: () => setStatus((s) => ({ ...s, notice: undefined })),
  };
}
