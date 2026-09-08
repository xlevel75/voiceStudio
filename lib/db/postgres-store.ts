import postgres from "postgres";
import type { ProviderId, VoiceStatus } from "@/lib/providers/types";
import type { VoiceRecord, VoiceStore } from "./store";

type Row = {
  id: string;
  provider: ProviderId;
  voice_id: string;
  name: string;
  mode: VoiceRecord["mode"];
  status: VoiceStatus;
  is_preset: boolean;
  created_at: Date;
};

const toRecord = (r: Row): VoiceRecord => ({
  id: r.id,
  provider: r.provider,
  voiceId: r.voice_id,
  name: r.name,
  mode: r.mode,
  status: r.status,
  isPreset: r.is_preset,
  createdAt: new Date(r.created_at).toISOString(),
});

export class PostgresVoiceStore implements VoiceStore {
  private sql: postgres.Sql;
  private ready?: Promise<void>;

  constructor(url: string) {
    this.sql = postgres(url, { ssl: "require", max: 1 });
  }

  async init() {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS voices (
          id          TEXT PRIMARY KEY,
          provider    TEXT NOT NULL,
          voice_id    TEXT NOT NULL,
          name        TEXT NOT NULL,
          mode        TEXT,
          status      TEXT NOT NULL,
          is_preset   BOOLEAN NOT NULL DEFAULT false,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
    })();
    return this.ready;
  }

  async list(provider?: ProviderId) {
    await this.init();
    const rows = provider
      ? await this.sql<Row[]>`SELECT * FROM voices WHERE provider = ${provider} ORDER BY created_at DESC`
      : await this.sql<Row[]>`SELECT * FROM voices ORDER BY created_at DESC`;
    return rows.map(toRecord);
  }

  async get(id: string) {
    await this.init();
    const rows = await this.sql<Row[]>`SELECT * FROM voices WHERE id = ${id} LIMIT 1`;
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async insert(record: VoiceRecord) {
    await this.init();
    await this.sql`
      INSERT INTO voices (id, provider, voice_id, name, mode, status, is_preset, created_at)
      VALUES (${record.id}, ${record.provider}, ${record.voiceId}, ${record.name},
              ${record.mode}, ${record.status}, ${record.isPreset}, ${record.createdAt})`;
    return record;
  }

  async updateStatus(id: string, status: VoiceStatus) {
    await this.init();
    await this.sql`UPDATE voices SET status = ${status} WHERE id = ${id}`;
  }

  async remove(id: string) {
    await this.init();
    await this.sql`DELETE FROM voices WHERE id = ${id}`;
  }
}
