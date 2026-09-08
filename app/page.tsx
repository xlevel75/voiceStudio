import { Studio } from "@/components/Studio";
import { getBlobAccess } from "@/lib/blob";

// 환경변수를 빌드 시점에 굳히지 않고 요청마다 읽는다.
// (BLOB_ACCESS를 바꾼 뒤 재빌드 없이도 반영되도록)
export const dynamic = "force-dynamic";

export default function Home() {
  // 스토어의 접근 모드는 서버에서 읽어 클라이언트 업로드에 그대로 전달한다.
  // 비밀값이 아니므로 노출돼도 무방하고, 별도 왕복 없이 초기 렌더에 실린다.
  return <Studio blobAccess={getBlobAccess()} />;
}
