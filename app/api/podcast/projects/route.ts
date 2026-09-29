import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getPodcastStore } from "@/lib/podcast/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/podcast/projects — 저장된 주제 전체 */
export async function GET() {
  try {
    const store = getPodcastStore();
    return NextResponse.json({ projects: await store.list(), storage: store.kind });
  } catch (err) {
    return errorResponse(err);
  }
}
