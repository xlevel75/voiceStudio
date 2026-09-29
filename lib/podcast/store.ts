/**
 * 주제 저장소 — 주제 하나를 JSON 파일 하나로 저장한다.
 * - 로컬: data/podcasts/{id}.json  (폴더째 복사하면 다른 PC에서도 그대로 열린다)
 * - Vercel: 서버리스 파일시스템이 읽기 전용이라 같은 JSON을 Vercel Blob의 podcasts/{id}.json에 둔다.
 * PODCAST_STORE=file|blob 으로 강제할 수 있다.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { del, get, head, list, put } from "@vercel/blob";
import { getBlobAccess } from "@/lib/blob";
import { missingEnvMessage } from "@/lib/env";
import { ProviderError } from "@/lib/providers/types";
import {
  isProjectId,
  parsePodcastFile,
  projectAssetIds,
  toPodcastFile,
  type PodcastFile,
  type Project,
} from "./projects";
import { isAssetId } from "./visual";

export interface PodcastStore {
  kind: "file" | "blob";
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  put(project: Project): Promise<PodcastFile>;
  remove(id: string): Promise<void>;
}

function assertId(id: string) {
  // 파일 경로에 쓰이므로 ../ 같은 값은 막는다.
  if (!isProjectId(id)) throw new ProviderError("주제 id가 올바르지 않습니다.", 400);
}

/** 깨진 파일 하나 때문에 목록 전체가 안 뜨면 곤란하므로 건너뛰고 로그만 남긴다. */
function tryParse(text: string, where: string): Project | null {
  try {
    return parsePodcastFile(JSON.parse(text));
  } catch (err) {
    console.error(`[podcast-store] 읽을 수 없는 주제 파일: ${where}`, err);
    return null;
  }
}

class FilePodcastStore implements PodcastStore {
  readonly kind = "file" as const;
  private readonly dir = path.join(process.cwd(), "data", "podcasts");
  private file = (id: string) => path.join(this.dir, `${id}.json`);

  async list() {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const items = await Promise.all(
      names
        .filter((n) => n.endsWith(".json"))
        .map(async (n) => tryParse(await fs.readFile(path.join(this.dir, n), "utf8"), n)),
    );
    return items.filter((p): p is Project => !!p);
  }

  async get(id: string) {
    assertId(id);
    try {
      return tryParse(await fs.readFile(this.file(id), "utf8"), id);
    } catch {
      return null;
    }
  }

  async put(project: Project) {
    assertId(project.id);
    const doc = toPodcastFile(project);
    await fs.mkdir(this.dir, { recursive: true });
    // 쓰는 도중 끊겨도 기존 파일이 깨지지 않게 임시 파일에 쓴 뒤 바꿔치기한다.
    const tmp = `${this.file(project.id)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(doc, null, 2), "utf8");
    await fs.rename(tmp, this.file(project.id));
    return doc;
  }

  async remove(id: string) {
    assertId(id);
    await fs.rm(this.file(id), { force: true });
  }
}

class BlobPodcastStore implements PodcastStore {
  readonly kind = "blob" as const;
  private readonly prefix = "podcasts/";
  private pathname = (id: string) => `${this.prefix}${id}.json`;

  private async read(pathname: string): Promise<Project | null> {
    // 방금 저장한 내용을 바로 읽어야 하므로 CDN 캐시를 거치지 않는다.
    const res = await get(pathname, { access: getBlobAccess(), useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return tryParse(await new Response(res.stream).text(), pathname);
  }

  async list() {
    const pathnames: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: this.prefix, cursor });
      pathnames.push(...page.blobs.map((b) => b.pathname).filter((p) => p.endsWith(".json")));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    const items = await Promise.all(pathnames.map((p) => this.read(p)));
    return items.filter((p): p is Project => !!p);
  }

  async get(id: string) {
    assertId(id);
    return this.read(this.pathname(id));
  }

  async put(project: Project) {
    assertId(project.id);
    const doc = toPodcastFile(project);
    await put(this.pathname(project.id), JSON.stringify(doc, null, 2), {
      access: getBlobAccess(),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
    return doc;
  }

  async remove(id: string) {
    assertId(id);
    await del(this.pathname(id));
  }
}

let store: PodcastStore | undefined;

export function getPodcastStore(): PodcastStore {
  if (store) return store;
  const forced = process.env.PODCAST_STORE;
  const useBlob = forced ? forced === "blob" : !!process.env.VERCEL;
  if (useBlob && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new ProviderError(
      `${missingEnvMessage("BLOB_READ_WRITE_TOKEN")} (배포 환경에서는 주제를 Vercel Blob에 저장합니다)`,
      503,
    );
  }
  store = useBlob ? new BlobPodcastStore() : new FilePodcastStore();
  return store;
}

// ── 이미지 에셋 ──────────────────────────────────────────────────────────
// 디자인시트·스튜디오·장면 이미지. 주제 JSON에는 id만 두고 파일은 따로 저장한다.
// 로컬은 data/podcasts/assets/ 아래라서 data/podcasts 폴더만 복사하면 이미지까지 함께 옮겨진다.

export const ASSET_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export function assetExt(contentType: string): string | null {
  const found = Object.entries(ASSET_TYPES).find(([, type]) => type === contentType);
  return found ? found[0] : null;
}

function assertAssetId(id: string) {
  if (!isAssetId(id)) throw new ProviderError("이미지 id가 올바르지 않습니다.", 400);
}

export interface AssetStore {
  put(id: string, data: Uint8Array, contentType: string): Promise<void>;
  get(id: string): Promise<{ data: Uint8Array; contentType: string } | null>;
  exists(id: string): Promise<boolean>;
  remove(ids: string[]): Promise<void>;
}

class FileAssetStore implements AssetStore {
  private readonly dir = path.join(process.cwd(), "data", "podcasts", "assets");
  private file = (id: string) => path.join(this.dir, id);

  async put(id: string, data: Uint8Array) {
    assertAssetId(id);
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(id), data);
  }

  async get(id: string) {
    assertAssetId(id);
    try {
      const data = await fs.readFile(this.file(id));
      return { data: new Uint8Array(data), contentType: ASSET_TYPES[id.split(".").pop()!] };
    } catch {
      return null;
    }
  }

  async exists(id: string) {
    assertAssetId(id);
    return fs.access(this.file(id)).then(
      () => true,
      () => false,
    );
  }

  async remove(ids: string[]) {
    ids.forEach(assertAssetId);
    await Promise.all(ids.map((id) => fs.rm(this.file(id), { force: true })));
  }
}

class BlobAssetStore implements AssetStore {
  // 주제 목록(podcasts/)을 훑을 때 이미지가 섞이지 않도록 다른 접두어를 쓴다.
  private pathname = (id: string) => `podcast-assets/${id}`;

  async put(id: string, data: Uint8Array, contentType: string) {
    assertAssetId(id);
    await put(this.pathname(id), Buffer.from(data), {
      access: getBlobAccess(),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    });
  }

  async get(id: string) {
    assertAssetId(id);
    const res = await get(this.pathname(id), { access: getBlobAccess() });
    if (!res || res.statusCode !== 200) return null;
    return {
      data: new Uint8Array(await new Response(res.stream).arrayBuffer()),
      contentType: res.blob.contentType,
    };
  }

  async exists(id: string) {
    assertAssetId(id);
    return head(this.pathname(id)).then(
      () => true,
      () => false,
    );
  }

  async remove(ids: string[]) {
    ids.forEach(assertAssetId);
    if (ids.length) await del(ids.map(this.pathname));
  }
}

let assetStore: AssetStore | undefined;

export function getAssetStore(): AssetStore {
  assetStore ??= getPodcastStore().kind === "blob" ? new BlobAssetStore() : new FileAssetStore();
  return assetStore;
}

/**
 * 더 이상 아무 주제도 쓰지 않는 이미지를 지운다.
 * 가져오기로 만든 사본 주제는 원본과 같은 이미지를 함께 쓰므로, 후보라도 다른 주제가 쓰면 남긴다.
 */
export async function collectAssetGarbage(candidates: string[]): Promise<void> {
  if (candidates.length === 0) return;
  try {
    const all = await getPodcastStore().list();
    const used = new Set(all.flatMap((p) => projectAssetIds(p)));
    const orphans = candidates.filter((id) => !used.has(id));
    await getAssetStore().remove(orphans);
  } catch (err) {
    console.error("[podcast-store] 안 쓰는 이미지 정리 실패", candidates, err);
  }
}
