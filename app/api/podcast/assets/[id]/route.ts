import { errorResponse } from "@/lib/api";
import { getAssetStore } from "@/lib/podcast/store";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/podcast/assets/:id — 이미지 원본.
 * private Blob은 URL로 바로 못 열어서 서버를 거쳐 내려준다.
 * 이미지를 다시 만들면 새 id가 생기므로(내용이 바뀌지 않음) 오래 캐시해도 된다.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const asset = await getAssetStore().get(id);
    if (!asset) throw new ProviderError("이미지를 찾을 수 없습니다.", 404);
    return new Response(Buffer.from(asset.data), {
      headers: {
        "Content-Type": asset.contentType,
        "Content-Length": String(asset.data.byteLength),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
