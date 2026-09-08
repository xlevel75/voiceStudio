import { get } from "@vercel/blob";
import { ProviderError } from "@/lib/providers/types";

export type BlobAccess = "public" | "private";

/**
 * Vercel Blob 스토어의 접근 모드. **스토어 설정과 반드시 일치해야 한다.**
 * 불일치하면 업로드가 "Cannot use public access on a private store" 로 실패한다.
 * 새로 만든 스토어는 기본이 private이므로 기본값도 private으로 둔다.
 */
export function getBlobAccess(): BlobAccess {
  return process.env.BLOB_ACCESS === "public" ? "public" : "private";
}

/** ElevenLabs SDK가 받는 업로드 형태. */
export interface BlobUpload {
  data: ReadableStream<Uint8Array> | Blob;
  filename: string;
  contentType: string;
  contentLength?: number;
}

function filenameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "sample.mp3");
  } catch {
    return "sample.mp3";
  }
}

/**
 * 업로드된 오디오를 공급자에게 전달할 수 있는 형태로 읽어온다.
 * private 스토어는 URL을 그냥 fetch할 수 없고 토큰 인증이 필요하므로 SDK의 get()을 쓴다.
 * 큰 PVC 샘플을 메모리에 다 올리지 않도록 스트림 그대로 넘긴다.
 */
export async function readBlobAsUpload(url: string): Promise<BlobUpload> {
  const filename = filenameFromUrl(url);
  const access = getBlobAccess();

  if (access === "private") {
    const result = await get(url, { access: "private" });
    if (!result) {
      throw new ProviderError(`업로드된 오디오를 찾을 수 없습니다: ${filename}`, 404);
    }
    if (result.statusCode !== 200 || !result.stream) {
      throw new ProviderError(`업로드된 오디오를 읽지 못했습니다 (${result.statusCode})`, 502);
    }
    return {
      data: result.stream,
      filename,
      contentType: result.blob.contentType || "audio/mpeg",
      contentLength: result.blob.size,
    };
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new ProviderError(`업로드된 오디오를 읽지 못했습니다 (${res.status})`, 400);
  }
  const data = await res.blob();
  return {
    data,
    filename,
    contentType: data.type || "audio/mpeg",
    contentLength: data.size,
  };
}
