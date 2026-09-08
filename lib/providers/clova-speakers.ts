/**
 * CLOVA Voice (tts-premium) 프리셋 화자 목록.
 *
 * ⚠️ 네이버 클라우드 플랫폼은 화자를 계속 추가/변경한다(공식 문서 기준 약 100종).
 *    아래는 널리 쓰이는 화자를 추린 것이며, 실제 사용 전 콘솔/공식 문서에서
 *    본인 계정이 사용 가능한 화자 목록을 확인해 이 배열을 갱신할 것.
 *    문서: https://api.ncloud-docs.com/docs/ai-naver-clovavoice-ttspremium
 */
export interface ClovaSpeaker {
  id: string;
  label: string;
  lang: "ko" | "en" | "ja" | "zh" | "es";
  /** emotion 파라미터(0~3)를 지원하는 화자인지. 미지원 화자에 보내면 에러가 난다. */
  supportsEmotion?: boolean;
}

export const CLOVA_SPEAKERS: ClovaSpeaker[] = [
  // 한국어 — 여성
  { id: "nara", label: "아라 (여성, 차분)", lang: "ko", supportsEmotion: true },
  { id: "nara_call", label: "아라 (여성, 상담원)", lang: "ko" },
  { id: "nminyoung", label: "민영 (여성, 밝음)", lang: "ko" },
  { id: "nyejin", label: "예진 (여성, 아나운서)", lang: "ko" },
  { id: "mijin", label: "미진 (여성, 기본)", lang: "ko" },
  { id: "napple", label: "사과 (여성, 상큼)", lang: "ko" },
  { id: "njiyun", label: "지윤 (여성, 밝음)", lang: "ko" },
  { id: "nsujin", label: "수진 (여성, 부드러움)", lang: "ko" },
  { id: "nyuna", label: "유나 (여성, 차분)", lang: "ko" },
  { id: "nkyunglee", label: "경리 (여성, 뉴스)", lang: "ko" },
  { id: "neunyoung", label: "은영 (여성, 성우)", lang: "ko" },
  { id: "nsunkyung", label: "선경 (여성, 발랄)", lang: "ko" },
  { id: "nyujin", label: "유진 (여성, 밝음)", lang: "ko" },
  { id: "nnarae", label: "나래 (여성, 차분)", lang: "ko" },
  { id: "nsabina", label: "사비나 (여성, 발랄)", lang: "ko" },
  { id: "ndain", label: "다인 (아동, 여아)", lang: "ko" },
  { id: "ngaram", label: "가람 (아동, 여아)", lang: "ko" },

  // 한국어 — 남성
  { id: "jinho", label: "진호 (남성, 기본)", lang: "ko" },
  { id: "nminsang", label: "민상 (남성, 차분)", lang: "ko" },
  { id: "nsinu", label: "신우 (남성, 뉴스)", lang: "ko", supportsEmotion: true },
  { id: "njihwan", label: "지환 (남성, 아나운서)", lang: "ko" },
  { id: "nsangdo", label: "상도 (남성, 차분)", lang: "ko" },
  { id: "njonghyun", label: "종현 (남성, 발랄)", lang: "ko" },
  { id: "njoonyoung", label: "준영 (남성, 부드러움)", lang: "ko" },
  { id: "nseonghoon", label: "성훈 (남성, 밝음)", lang: "ko" },
  { id: "nwontak", label: "원탁 (남성, 굵은 목소리)", lang: "ko" },
  { id: "nkitae", label: "기태 (남성, 차분)", lang: "ko" },
  { id: "ntaejin", label: "태진 (남성, 뉴스)", lang: "ko" },
  { id: "nsiyoon", label: "시윤 (남성, 부드러움)", lang: "ko" },
  { id: "nhajun", label: "하준 (아동, 남아)", lang: "ko" },

  // 외국어
  { id: "clara", label: "Clara (영어, 여성)", lang: "en" },
  { id: "matt", label: "Matt (영어, 남성)", lang: "en" },
  { id: "shinji", label: "Shinji (일본어, 남성)", lang: "ja" },
  { id: "ntomoko", label: "Tomoko (일본어, 여성)", lang: "ja" },
  { id: "meimei", label: "Meimei (중국어, 여성)", lang: "zh" },
  { id: "liangliang", label: "Liangliang (중국어, 남성)", lang: "zh" },
  { id: "carmen", label: "Carmen (스페인어, 여성)", lang: "es" },
  { id: "jose", label: "Jose (스페인어, 남성)", lang: "es" },
];
