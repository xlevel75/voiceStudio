import { NextResponse } from "next/server";
import { ProviderError } from "@/lib/providers/types";

export function errorResponse(err: unknown) {
  if (err instanceof ProviderError) {
    return NextResponse.json(
      { error: err.message, provider: err.provider },
      { status: err.status },
    );
  }
  const message = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
  console.error("[api]", err);
  return NextResponse.json({ error: message }, { status: 500 });
}
