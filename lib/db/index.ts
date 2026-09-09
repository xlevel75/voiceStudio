import { JsonVoiceStore } from "./json-store";
import { PostgresVoiceStore } from "./postgres-store";
import type { VoiceStore } from "./store";

let store: VoiceStore | undefined;

/** DATABASE_URL이 있으면 Postgres, 없으면 로컬 JSON 파일 스토어. */
export function getStore(): VoiceStore {
  if (!store) {
    const url = process.env.DATABASE_URL;
    if (!url && process.env.VERCEL) {
      // 서버리스 파일시스템은 읽기 전용이라 JSON 폴백이 동작하지 않는다.
      // 앱은 공급자 API 결과만으로 계속 동작하지만, 내부 id/모드는 저장되지 않는다.
      console.warn(
        "[db] DATABASE_URL이 없습니다. Vercel에서는 JSON 폴백이 동작하지 않아 " +
          "내 성우 목록이 영속되지 않습니다. Postgres/Supabase를 연결하세요.",
      );
    }
    store = url ? new PostgresVoiceStore(url) : new JsonVoiceStore();
  }
  return store;
}

export * from "./store";
