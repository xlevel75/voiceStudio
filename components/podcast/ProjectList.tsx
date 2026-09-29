"use client";

import { useRef } from "react";
import { projectTitle, type Project } from "@/lib/podcast/projects";
import { Badge, Spinner } from "../ui";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function ProjectList({
  projects,
  activeId,
  busyIds,
  unsavedIds,
  onSelect,
  onCreate,
  onDelete,
  onExport,
  onImport,
}: {
  projects: Project[];
  activeId: string | null;
  /** 대본 생성·음성 생성이 진행 중인 주제 */
  busyIds: Set<string>;
  /** 아직 서버에 자동 저장되지 않은 주제 */
  unsavedIds: Set<string>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (project: Project) => void;
  onExport: (project: Project) => void;
  onImport: (files: File[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  // 최근에 만든 주제가 위로
  const sorted = [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <nav className="flex flex-col rounded-2xl border border-ink-700/70 bg-ink-900/70 backdrop-blur-sm">
      <header className="flex items-center justify-between gap-2 border-b border-ink-700/70 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-ink-100">주제 {projects.length}</h2>
        <div className="flex gap-1">
          <button
            onClick={() => fileRef.current?.click()}
            title="다른 곳에서 내보낸 주제 파일(.podcast.json) 가져오기"
            className="rounded-lg border border-ink-700 px-2 py-1 text-xs text-ink-300 transition hover:border-accent-500/50 hover:text-accent-300"
          >
            가져오기
          </button>
          <button
            onClick={onCreate}
            className="rounded-lg bg-accent-500/20 px-2.5 py-1 text-xs font-medium text-accent-300 ring-1 ring-accent-500/40 transition hover:bg-accent-500/30"
          >
            + 새 주제
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = ""; // 같은 파일을 다시 골라도 onChange가 오도록
            if (files.length) onImport(files);
          }}
        />
      </header>

      <ul className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto p-2">
        {sorted.map((p) => {
          const active = p.id === activeId;
          const busy = busyIds.has(p.id);
          const unsaved = unsavedIds.has(p.id);
          const count = p.script?.utterances.length ?? 0;
          return (
            <li key={p.id}>
              <div
                className={[
                  "group flex items-start gap-1 rounded-lg px-3 py-2 transition",
                  active ? "bg-accent-500/15 ring-1 ring-accent-500/40" : "hover:bg-ink-850/70",
                ].join(" ")}
              >
                <button onClick={() => onSelect(p.id)} className="min-w-0 flex-1 text-left">
                  <span
                    className={`block truncate text-sm ${active ? "font-medium text-ink-100" : "text-ink-300"} ${
                      p.setup.topic.trim() ? "" : "italic text-ink-400"
                    }`}
                  >
                    {projectTitle(p)}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-400">
                    <span className="tabular-nums">{formatDate(p.createdAt)}</span>
                    {busy ? (
                      <Spinner className="h-3 w-3 text-accent-300" />
                    ) : count > 0 ? (
                      <Badge tone="neutral">대본 {count}</Badge>
                    ) : (
                      <Badge tone="neutral">준비 중</Badge>
                    )}
                    {p.flags.length > 0 ? <Badge tone="warn">경고 {p.flags.length}</Badge> : null}
                    {unsaved ? (
                      <span
                        title="아직 저장되지 않은 변경이 있습니다"
                        className="h-1.5 w-1.5 rounded-full bg-amber-300"
                      />
                    ) : null}
                  </span>
                </button>
                <div className="flex shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    onClick={() => onExport(p)}
                    title="JSON 파일로 내보내기"
                    aria-label={`${projectTitle(p)} 내보내기`}
                    className="rounded px-1.5 py-0.5 text-xs text-ink-400 transition hover:bg-ink-700/60 hover:text-accent-300"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => onDelete(p)}
                    title="주제 삭제"
                    aria-label={`${projectTitle(p)} 삭제`}
                    className="rounded px-1.5 py-0.5 text-xs text-ink-400 transition hover:bg-rose-500/15 hover:text-rose-300"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
