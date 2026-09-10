import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPECTED = [
  "ELEVENLABS_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_ACCESS",
  "CLOVA_CLIENT_ID",
  "CLOVA_CLIENT_SECRET",
  "DATABASE_URL",
] as const;

/**
 * 환경 변수 진단용 임시 라우트.
 * **값은 절대 반환하지 않는다.** 존재 여부와 길이, 그리고 실제로 주입된 키 이름만 본다.
 * 원인이 잡히면 이 파일은 지운다.
 */
export async function GET() {
  const present: Record<string, string> = {};
  for (const name of EXPECTED) {
    const value = process.env[name];
    present[name] = value ? `설정됨 (${value.length}자)` : "없음";
  }

  // 오타·공백이 섞인 키 이름을 잡아내기 위해 원본 키를 그대로(따옴표 포함) 보여준다.
  const blobKeys = Object.keys(process.env)
    .filter((k) => k.toUpperCase().includes("BLOB"))
    .map((k) => JSON.stringify(k));

  return NextResponse.json({
    vercelEnv: process.env.VERCEL_ENV ?? "(로컬)",
    deploymentUrl: process.env.VERCEL_URL ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    present,
    blobKeysInRuntime: blobKeys,
  });
}
