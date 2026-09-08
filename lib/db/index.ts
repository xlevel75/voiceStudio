import { JsonVoiceStore } from "./json-store";
import { PostgresVoiceStore } from "./postgres-store";
import type { VoiceStore } from "./store";

let store: VoiceStore | undefined;

/** DATABASE_URL이 있으면 Postgres, 없으면 로컬 JSON 파일 스토어. */
export function getStore(): VoiceStore {
  if (!store) {
    const url = process.env.DATABASE_URL;
    store = url ? new PostgresVoiceStore(url) : new JsonVoiceStore();
  }
  return store;
}

export * from "./store";
