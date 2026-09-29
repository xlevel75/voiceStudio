import { del, get } from "@vercel/blob";
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

/**
 * 업로드된 샘플을 Blob에서 지운다.
 *
 * 공급자가 createVoice 시점에 샘플 사본을 자기 쪽으로 가져가므로
 * 그 뒤로는 아무도 이 blob을 참조하지 않는다(DB에도 URL을 남기지 않는다).
 * 남겨두면 스토리지 사용량만 단조증가하므로 성공·실패 모두 정리한다.
 *
 * 삭제 실패가 이미 만들어진 성우를 되돌릴 이유는 없으므로 조용히 넘기고
 * 수동 정리를 위해 URL만 로그에 남긴다.
 */
export async function deleteBlobs(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  try {
    await del(urls);
  } catch (err) {
    console.error("[blob] 업로드 샘플 정리 실패 (수동 삭제 필요)", urls, err);
  }
}
