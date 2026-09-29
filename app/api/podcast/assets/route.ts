import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assetExt, getAssetStore } from "@/lib/podcast/store";
import { isAssetId } from "@/lib/podcast/visual";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vercel 함수 요청 본문 한도(4.5MB)보다 작게. 브라우저가 올리기 전에 줄여서 보낸다. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * POST /api/podcast/assets — 이미지 업로드 (디자인시트·스튜디오, 가져오기 파일의 이미지).
 * 본문은 이미지 바이트 그대로, Content-Type으로 형식을 알린다.
 * ?id= 를 주면 그 id로 저장한다(가져오기 때 원래 id 유지). 이미 있으면 다시 쓰지 않는다.
 */
export async function POST(request: Request) {
  try {
    const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext = assetExt(contentType);
    if (!ext) throw new ProviderError("PNG, JPEG, WebP 이미지만 올릴 수 있습니다.", 415);

    const data = new Uint8Array(await request.arrayBuffer());
    if (data.byteLength === 0) throw new ProviderError("이미지가 비어 있습니다.", 400);
    if (data.byteLength > MAX_BYTES) throw new ProviderError("이미지가 너무 큽니다 (최대 4MB).", 413);

    const requested = new URL(request.url).searchParams.get("id");
    if (requested && !isAssetId(requested)) throw new ProviderError("이미지 id가 올바르지 않습니다.", 400);
    const id = requested ?? `${crypto.randomUUID()}.${ext}`;

    const store = getAssetStore();
    if (!requested || !(await store.exists(id))) await store.put(id, data, contentType);
    return NextResponse.json({ id });
  } catch (err) {
    return errorResponse(err);
  }
}
