/**
 * 장면 이미지 + 에피소드 음성 → MP4. 브라우저 WebCodecs(mediabunny)로 만든다. (명세 8-5)
 * 서버리스에 FFmpeg를 올리지 않기 위해서다. H.264/AAC 인코딩이 되는 Chrome·Edge에서 동작한다.
 *
 * 화면: 장면 이미지를 꽉 채우고, 아래에 화자 이름표 + 한 줄 자막을 얹는다.
 * 자막은 발화를 한 줄 단위로 나눠 글자 수 비례로 시간을 나눈다.
 */
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  Input,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import { subtitleChunks } from "./visual";

const WIDTH = 1920;
const HEIGHT = 1080;
/**
 * 정지 화면이지만 일정한 30fps로 넣는다. 프레임 간격이 들쭉날쭉하면
 * 일부 플레이어(Windows 기본 앱 등)가 소리를 못 내거나 탐색이 깨진다.
 * 같은 그림이 이어지는 프레임은 H.264가 거의 0바이트로 압축하므로 파일은 커지지 않는다.
 */
const FPS = 30;
const AUDIO_RATE = 48_000;
/** 모노를 싫어하는 플레이어가 있어 같은 소리를 좌우 두 채널에 넣는다. */
const AUDIO_CHANNELS = 2;
/** 영상·음성을 이 단위로 번갈아 넣어 메모리와 먹서 대기열을 작게 유지한다. */
const WINDOW_SEC = 10;
const FONT = `"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;

export interface VideoScene {
  startMs: number;
  endMs: number;
  speaker: string;
  text: string;
  /** 없으면 검은 화면에 화자 이름 */
  imageUrl?: string;
}

interface Span {
  t0: number;
  t1: number;
  scene: VideoScene;
  subtitle: string | null;
}

/** 전체 시간을 빈틈없이 덮는 화면 구간. 발화 사이 쉬는 동안은 앞 장면을 자막 없이 유지한다. */
function buildSpans(scenes: VideoScene[], durationSec: number): Span[] {
  const spans: Span[] = [];
  scenes.forEach((scene, i) => {
    const end = scene.endMs / 1000;
    const next = i + 1 < scenes.length ? scenes[i + 1].startMs / 1000 : durationSec;
    const chunks = subtitleChunks(scene.text);
    const total = chunks.reduce((n, c) => n + c.length, 0) || 1;
    // 첫 발화 앞 여백은 자막 없이
    if (i === 0 && scene.startMs > 0) spans.push({ t0: 0, t1: scene.startMs / 1000, scene, subtitle: null });
    let t = scene.startMs / 1000;
    chunks.forEach((chunk) => {
      const dur = ((end - scene.startMs / 1000) * chunk.length) / total;
      spans.push({ t0: t, t1: t + dur, scene, subtitle: chunk });
      t += dur;
    });
    if (next > end) spans.push({ t0: end, t1: next, scene, subtitle: null });
  });
  return spans.filter((s) => s.t1 - s.t0 > 0.001);
}

function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap) {
  const scale = Math.max(WIDTH / img.width, HEIGHT / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, size: number, maxWidth: number): number {
  let s = size;
  ctx.font = `700 ${s}px ${FONT}`;
  while (s > 28 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `700 ${s}px ${FONT}`;
  }
  return s;
}

function drawFrame(ctx: CanvasRenderingContext2D, img: ImageBitmap | null, span: Span) {
  ctx.fillStyle = "#0a0b10";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (img) {
    drawCover(ctx, img);
  } else {
    ctx.fillStyle = "#e6e9f2";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 72px ${FONT}`;
    ctx.fillText(span.scene.speaker, WIDTH / 2, HEIGHT / 2 - 60);
  }
  if (!span.subtitle) return;

  // 아래쪽만 얕게 어둡게 깔아 어떤 배경에서도 자막이 읽히게 한다.
  // (화면 아래 15%만 쓴다 — 이미지 프롬프트가 그 영역을 비워 두도록 요청한다)
  const grad = ctx.createLinearGradient(0, HEIGHT * 0.8, 0, HEIGHT);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.8)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, HEIGHT * 0.8, WIDTH, HEIGHT * 0.2);

  // 한 줄: [화자 이름표] 자막 — 둘을 묶어 가운데 정렬한다.
  const centerY = HEIGHT - 70;
  const gap = 20;
  ctx.font = `700 30px ${FONT}`;
  const name = span.scene.speaker;
  const tagW = ctx.measureText(name).width + 40;
  const tagH = 48;
  const size = fitFont(ctx, span.subtitle, 52, WIDTH - 200 - tagW - gap);
  const textW = ctx.measureText(span.subtitle).width;
  const left = (WIDTH - (tagW + gap + textW)) / 2;

  ctx.fillStyle = "#6d5cff";
  ctx.beginPath();
  ctx.roundRect(left, centerY - tagH / 2, tagW, tagH, tagH / 2);
  ctx.fill();
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, left + tagW / 2, centerY + 1);

  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  const textX = left + tagW + gap;
  ctx.strokeText(span.subtitle, textX, centerY + 2);
  ctx.fillText(span.subtitle, textX, centerY + 2);
}

export class VideoUnsupportedError extends Error {}

export interface VideoInfo {
  durationSec: number;
  audio: { codec: string; channels: number; sampleRate: number; durationSec: number } | null;
}

/** 완성된 MP4를 다시 열어 실제로 음성 트랙이 들어갔는지 확인한다. */
export async function inspectVideo(blob: Blob): Promise<VideoInfo> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    return {
      durationSec: video ? await video.computeDuration() : 0,
      audio: audio
        ? {
            codec: audio.codec ?? "unknown",
            channels: audio.numberOfChannels,
            sampleRate: audio.sampleRate,
            durationSec: await audio.computeDuration(),
          }
        : null,
    };
  } finally {
    input.dispose();
  }
}

/**
 * 이 브라우저가 MP4의 AAC 소리를 재생할 수 있는가.
 * VS Code 안의 브라우저처럼 AAC 디코더가 없는 곳은 영상만 나오고 소리가 안 난다(파일에는 들어 있음).
 */
export function canPlayAac(): boolean {
  return document.createElement("audio").canPlayType('audio/mp4; codecs="mp4a.40.2"') !== "";
}

export async function renderEpisodeVideo(input: {
  scenes: VideoScene[];
  audio: Blob;
  durationMs: number;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}): Promise<Blob> {
  if (
    typeof VideoEncoder === "undefined" ||
    !(await canEncodeVideo("avc", { width: WIDTH, height: HEIGHT }))
  ) {
    throw new VideoUnsupportedError(
      "이 브라우저는 H.264 영상 인코딩을 지원하지 않습니다. Chrome이나 Edge에서 만들어 주세요.",
    );
  }
  if (!(await canEncodeAudio("aac", { numberOfChannels: AUDIO_CHANNELS, sampleRate: AUDIO_RATE }))) {
    throw new VideoUnsupportedError(
      "이 브라우저는 AAC 음성 인코딩을 지원하지 않습니다. Chrome이나 Edge에서 만들어 주세요.",
    );
  }

  // 음성: AAC가 받는 48kHz로 디코드(리샘플)한다.
  const decodeCtx = new OfflineAudioContext(1, 1, AUDIO_RATE);
  const audioBuffer = await decodeCtx.decodeAudioData(await input.audio.arrayBuffer());
  const pcm = audioBuffer.getChannelData(0);
  const durationSec = Math.max(input.durationMs / 1000, audioBuffer.duration);

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, { codec: "avc", bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  const audio = new AudioBufferSource({ codec: "aac", bitrate: QUALITY_MEDIUM });
  output.addVideoTrack(video, { frameRate: FPS });
  output.addAudioTrack(audio);
  await output.start();

  const spans = buildSpans(input.scenes, durationSec);
  const bitmaps = new Map<string, Promise<ImageBitmap | null>>();
  const loadImage = (url?: string) => {
    if (!url) return Promise.resolve(null);
    if (!bitmaps.has(url)) {
      bitmaps.set(
        url,
        fetch(url)
          .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
          .then((b) => createImageBitmap(b))
          .catch(() => null),
      );
    }
    return bitmaps.get(url)!;
  };
  const release = (url?: string) => {
    const p = url ? bitmaps.get(url) : undefined;
    if (!p) return;
    bitmaps.delete(url!);
    void p.then((b) => b?.close());
  };

  try {
    const totalFrames = Math.ceil(durationSec * FPS);
    const framesPerWindow = FPS * WINDOW_SEC;
    let spanIndex = 0;
    let drawn = -1;
    let audioOffset = 0;

    // 영상 WINDOW_SEC초를 넣을 때마다 같은 구간의 음성을 넣는다. (먹서 대기열을 작게)
    const pushAudioUntil = async (sec: number) => {
      const end = Math.min(pcm.length, Math.round(sec * AUDIO_RATE));
      if (end <= audioOffset) return;
      const chunk = new AudioBuffer({
        length: end - audioOffset,
        numberOfChannels: AUDIO_CHANNELS,
        sampleRate: AUDIO_RATE,
      });
      const slice = pcm.subarray(audioOffset, end);
      for (let ch = 0; ch < AUDIO_CHANNELS; ch++) chunk.copyToChannel(slice, ch);
      await audio.add(chunk);
      audioOffset = end;
    };

    for (let n = 0; n < totalFrames; n++) {
      const t = n / FPS;
      while (spanIndex < spans.length - 1 && spans[spanIndex].t1 <= t) spanIndex++;
      if (drawn !== spanIndex) {
        const span = spans[spanIndex];
        const img = await loadImage(span.scene.imageUrl);
        drawFrame(ctx, img, span);
        drawn = spanIndex;
        // 앞 장면 이미지는 다시 안 쓰면 메모리에서 내리고, 다음 장면은 미리 읽어 둔다.
        const prev = spans[spanIndex - 1]?.scene.imageUrl;
        if (prev && prev !== span.scene.imageUrl) release(prev);
        const next = spans.find((s, k) => k > spanIndex && s.scene.imageUrl !== span.scene.imageUrl);
        void loadImage(next?.scene.imageUrl);
      }
      await video.add(t, 1 / FPS);

      if ((n + 1) % framesPerWindow === 0 || n === totalFrames - 1) {
        if (input.signal?.aborted) throw new DOMException("영상 만들기를 취소했습니다.", "AbortError");
        await pushAudioUntil((n + 1) / FPS);
        input.onProgress?.((n + 1) / totalFrames);
      }
    }
    await pushAudioUntil(durationSec + 1);

    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("영상 파일이 비어 있습니다.");
    const result = new Blob([buffer], { type: "video/mp4" });
    const info = await inspectVideo(result);
    if (!info.audio || info.audio.durationSec < Math.min(1, durationSec / 2)) {
      throw new Error(
        "완성된 영상에 음성 트랙이 없습니다. 에피소드를 다시 합친 뒤 영상을 다시 만들어 주세요.",
      );
    }
    return result;
  } catch (err) {
    await output.cancel().catch(() => {});
    throw err;
  } finally {
    for (const url of [...bitmaps.keys()]) release(url);
  }
}
