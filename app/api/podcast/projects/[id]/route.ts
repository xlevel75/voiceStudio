import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { normalizeProject, projectAssetIds, type Project } from "@/lib/podcast/projects";
import { collectAssetGarbage, getPodcastStore } from "@/lib/podcast/store";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * PUT /api/podcast/projects/:id — 주제 저장(자동 저장).
 * 다른 탭·기기에서 더 나중에 고친 내용이 이미 저장돼 있으면 덮어쓰지 않고 409로 그 내용을 돌려준다.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { project?: Partial<Project> };
    if (!body.project || body.project.id !== id) {
      throw new ProviderError("저장할 주제가 올바르지 않습니다.", 400);
    }
    const incoming = normalizeProject(body.project);
    const store = getPodcastStore();

    const current = await store.get(id);
    if (current && current.updatedAt > incoming.updatedAt) {
      return NextResponse.json(
        { error: "다른 곳에서 더 최근에 고친 내용이 있습니다.", project: current },
        { status: 409 },
      );
    }

    const saved = await store.put(incoming);
    // 다시 만들거나 지워서 빠진 이미지는 (다른 주제가 안 쓰면) 정리한다.
    if (current) {
      const kept = new Set(projectAssetIds(incoming));
      await collectAssetGarbage(projectAssetIds(current).filter((a) => !kept.has(a)));
    }
    return NextResponse.json({ savedAt: saved.savedAt, storage: store.kind });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/podcast/projects/:id */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const store = getPodcastStore();
    const current = await store.get(id);
    await store.remove(id);
    if (current) await collectAssetGarbage(projectAssetIds(current));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
