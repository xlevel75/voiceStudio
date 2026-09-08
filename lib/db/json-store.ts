import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProviderId, VoiceStatus } from "@/lib/providers/types";
import type { VoiceRecord, VoiceStore } from "./store";

/**
 * DATABASE_URL이 없을 때 쓰는 로컬 개발용 스토어.
 * Vercel의 서버리스 파일시스템은 읽기 전용이므로 배포 환경에서는 Postgres를 써야 한다.
 */
export class JsonVoiceStore implements VoiceStore {
  private readonly file = path.join(process.cwd(), "data", "voices.json");

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      await fs.access(this.file);
    } catch {
      await fs.writeFile(this.file, "[]", "utf8");
    }
  }

  private async readAll(): Promise<VoiceRecord[]> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      return JSON.parse(raw) as VoiceRecord[];
    } catch {
      return [];
    }
  }

  private async writeAll(rows: VoiceRecord[]) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(rows, null, 2), "utf8");
  }

  async list(provider?: ProviderId) {
    const rows = await this.readAll();
    return rows
      .filter((r) => !provider || r.provider === provider)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string) {
    const rows = await this.readAll();
    return rows.find((r) => r.id === id) ?? null;
  }

  async insert(record: VoiceRecord) {
    const rows = await this.readAll();
    rows.push(record);
    await this.writeAll(rows);
    return record;
  }

  async updateStatus(id: string, status: VoiceStatus) {
    const rows = await this.readAll();
    const row = rows.find((r) => r.id === id);
    if (row) {
      row.status = status;
      await this.writeAll(rows);
    }
  }

  async remove(id: string) {
    const rows = await this.readAll();
    await this.writeAll(rows.filter((r) => r.id !== id));
  }
}
