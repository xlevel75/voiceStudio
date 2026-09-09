import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { missingEnvMessage } from "@/lib/env";

export const runtime = "nodejs";

/**
 * 클라이언트 → Vercel Blob 직접 업로드용 토큰 발급.
 * Vercel 서버리스 함수의 본문 크기 제한(약 4.5MB)을 우회하기 위해
 * 오디오 파일은 서버를 거치지 않고 브라우저에서 Blob으로 바로 올린다.
 */
export async function POST(request: Request) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        {
          error:
            missingEnvMessage("BLOB_READ_WRITE_TOKEN") +
            " (Storage → Blob 스토어를 프로젝트에 Connect하면 자동으로 주입됩니다.)",
        },
        { status: 503 },
      );
    }

    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "audio/mpeg",
          "audio/mp3",
          "audio/wav",
          "audio/x-wav",
          "audio/wave",
          "audio/webm",
          "audio/ogg",
          "audio/mp4",
          "audio/m4a",
          "audio/x-m4a",
          "video/mp4",
        ],
        maximumSizeInBytes: 200 * 1024 * 1024, // PVC용 장시간 녹음 대비
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // 업로드 완료 훅. 필요 시 로깅/정리 작업을 여기에 둔다.
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
