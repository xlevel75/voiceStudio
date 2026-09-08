"use client";

import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col rounded-2xl border border-ink-700/70 bg-ink-900/70 backdrop-blur-sm ${className}`}
    >
      <header className="border-b border-ink-700/70 px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-ink-100">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs leading-relaxed text-ink-400">{subtitle}</p> : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col p-5">{children}</div>
    </section>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "warn" | "danger" | "ok";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-ink-700/70 text-ink-300",
    accent: "bg-accent-500/20 text-accent-300 ring-1 ring-accent-500/40",
    warn: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
    danger: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30",
    ok: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-4 w-4 animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-200">
      {message}
    </p>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-ink-700/70 bg-ink-850/60 px-3 py-2 text-xs leading-relaxed text-ink-300">
      {children}
    </div>
  );
}
