/**
 * 브라우저에서 발화별 MP3를 하나의 에피소드로 합친다. (명세 7-7의 FFmpeg 단계를 대신함)
 * 서버리스 환경에 FFmpeg를 올리지 않기 위해 Web Audio로 디코드 → 무음 삽입 → WAV 인코딩한다.
 */
import { stripTags } from "./tags";
import type { Timeline, Utterance } from "./types";

/** 음성 품질보다 파일 크기가 중요해 말소리에 충분한 24kHz 모노로 합친다. (20분 ≈ 58MB) */
const SAMPLE_RATE = 24_000;
const GAP_SAME_SEGMENT_MS = 350;
const GAP_SEGMENT_CHANGE_MS = 1_000;
const PEAK_TARGET = 0.89; // ≈ -1dBFS

export async function decodeClip(blob: Blob): Promise<AudioBuffer> {
  // OfflineAudioContext로 디코드하면 컨텍스트의 샘플레이트로 자동 리샘플된다.
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  return ctx.decodeAudioData(await blob.arrayBuffer());
}

export interface Clip {
  utterance: Utterance;
  blob: Blob;
}

export interface MergedEpisode {
  wav: Blob;
  timeline: Timeline;
  srt: string;
}

export async function mergeEpisode(
  clips: Clip[],
  segmentTitles: Map<number, string>,
): Promise<MergedEpisode> {
  const decoded = await Promise.all(clips.map((c) => decodeClip(c.blob)));

  const gapSamples = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);
  let total = 0;
  const placements = decoded.map((buf, i) => {
    if (i > 0) {
      const changed = clips[i].utterance.segment_no !== clips[i - 1].utterance.segment_no;
      total += gapSamples(changed ? GAP_SEGMENT_CHANGE_MS : GAP_SAME_SEGMENT_MS);
    }
    const start = total;
    total += buf.length;
    return { start, end: total };
  });

  const out = new Float32Array(total);
  decoded.forEach((buf, i) => {
    // 모노로 다운믹스
    const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
    const offset = placements[i].start;
    for (let s = 0; s < buf.length; s++) {
      let v = 0;
      for (const ch of channels) v += ch[s];
      out[offset + s] = v / channels.length;
    }
  });
  normalizePeak(out);

  const toMs = (samples: number) => Math.round((samples / SAMPLE_RATE) * 1000);
  const items = clips.map((c, i) => ({
    seq: c.utterance.seq,
    speaker: c.utterance.speaker,
    start_ms: toMs(placements[i].start),
    end_ms: toMs(placements[i].end),
    segment_no: c.utterance.segment_no,
  }));

  const chapters: Timeline["chapters"] = [];
  for (const item of items) {
    if (chapters.some((ch) => ch.segment_no === item.segment_no)) continue;
    chapters.push({
      segment_no: item.segment_no,
      title: segmentTitles.get(item.segment_no) ?? segmentLabel(item.segment_no),
      start_ms: item.start_ms,
    });
  }

  const timeline: Timeline = { duration_ms: toMs(total), items, chapters };
  return { wav: encodeWav(out, SAMPLE_RATE), timeline, srt: toSrt(clips, items) };
}

export function segmentLabel(no: number): string {
  if (no === 0) return "오프닝";
  if (no === 99) return "클로징";
  return `꼭지 ${no}`;
}

function normalizePeak(samples: Float32Array) {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return;
  const gain = PEAK_TARGET / peak;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true); // PCM 청크 크기
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 모노
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const v of samples) {
    const clamped = Math.max(-1, Math.min(1, v));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function srtTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

function toSrt(clips: Clip[], items: Timeline["items"]): string {
  return items
    .map(
      (item, i) =>
        `${i + 1}\n${srtTime(item.start_ms)} --> ${srtTime(item.end_ms)}\n${item.speaker}: ${stripTags(clips[i].utterance.text)}\n`,
    )
    .join("\n");
}

export function formatClock(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
