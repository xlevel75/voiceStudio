/**
 * 공급자별 1회 호출 글자 수 제한에 맞춰 텍스트를 분할한다.
 * 문단 → 문장 → (그래도 길면) 강제 슬라이스 순으로 경계를 찾는다.
 */
export function splitText(text: string, maxLength: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLength) return [trimmed];

  // 문장 끝(. ! ? 。 개행) 뒤에서 자른다.
  const pieces = trimmed.match(/[^.!?。\n]+[.!?。]*\n*|\n+/g) ?? [trimmed];
  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    if (piece.length > maxLength) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = "";
      }
      for (let i = 0; i < piece.length; i += maxLength) {
        chunks.push(piece.slice(i, i + maxLength).trim());
      }
      continue;
    }
    if (current.length + piece.length > maxLength) {
      chunks.push(current.trim());
      current = piece;
    } else {
      current += piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

/** 여러 오디오 청크를 하나의 버퍼로 이어붙인다. (mp3 프레임 단순 연결) */
export function concatBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  if (buffers.length === 1) return buffers[0];
  const total = buffers.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    out.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  return out.buffer;
}

export async function streamToArrayBuffer(
  stream: ReadableStream<Uint8Array>,
): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}
