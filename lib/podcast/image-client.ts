/**
 * 브라우저 전용 이미지 도우미.
 */
import { assetUrl } from "./visual";

/** 업로드 전에 줄인다. 서버 본문 한도(4MB)와 Gemini 참조 토큰을 아끼기 위해 긴 변 1600px JPEG로. */
export async function downscaleImage(file: Blob, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  // 투명 PNG가 JPEG에서 검게 변하지 않도록 흰 바탕을 깐다.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("이미지를 변환하지 못했습니다."))),
      "image/jpeg",
      0.9,
    ),
  );
}

export async function assetToDataUrl(id: string): Promise<string> {
  const res = await fetch(assetUrl(id));
  if (!res.ok) throw new Error(`이미지를 읽지 못했습니다 (${id})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

/** 에셋 이미지를 정확한 크기(가운데 맞춰 자르기)의 JPEG로 내려받는다. 유튜브 썸네일은 1280×720, 2MB 이하. */
export async function downloadAssetAs(id: string, width: number, height: number, fileName: string) {
  const res = await fetch(assetUrl(id));
  if (!res.ok) throw new Error("이미지를 읽지 못했습니다.");
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("이미지를 변환하지 못했습니다."))),
      "image/jpeg",
      0.92,
    ),
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
