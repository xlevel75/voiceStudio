/**
 * 프롬프트 템플릿과 Gemini responseSchema. (명세 13장)
 * 스키마는 Gemini의 OpenAPI 부분집합 형식(type 대문자)을 따른다.
 */
import {
  CHARS_PER_MINUTE,
  EMOTIONS,
  FORMAT_LABELS,
  ROLE_LABELS,
  TONE_LABELS,
  type EpisodeSetup,
  type FactSheet,
  type Script,
} from "./types";
import { AUDIO_TAG_GROUPS, stripTags } from "./tags";

const STR = { type: "STRING" } as const;
const INT = { type: "INTEGER" } as const;
const arr = (items: object) => ({ type: "ARRAY", items });
const obj = (properties: Record<string, object>, required = Object.keys(properties)) => ({
  type: "OBJECT",
  properties,
  required,
});

export const FACT_SHEET_SCHEMA = obj({
  date: STR,
  segments: arr(
    obj({
      no: INT,
      headline: STR,
      facts: arr(obj({ id: STR, text: STR, source_ids: arr(STR) })),
      numbers: arr(obj({ value: STR, context: STR, fact_id: STR })),
      people: arr(obj({ name: STR, title: STR })),
      background: STR,
      sensitivity: { type: "STRING", enum: ["low", "medium", "high"] },
    }),
  ),
  sources: arr(obj({ id: STR, title: STR, url: STR, publisher: STR })),
});

export function scriptSchema(speakerNames: string[]) {
  return obj({
    title: STR,
    target_minutes: INT,
    utterances: arr(
      obj({
        seq: INT,
        speaker: { type: "STRING", enum: speakerNames },
        segment_no: INT,
        emotion: { type: "STRING", enum: [...EMOTIONS] },
        text: STR,
        fact_ids: arr(STR),
      }),
    ),
  });
}

export const VERIFY_SCHEMA = obj({
  flags: arr(
    obj({
      seq: INT,
      type: { type: "STRING", enum: ["unsupported_number", "unsupported_name", "tone"] },
      detail: STR,
    }),
  ),
});

function today(): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
}

/** 대략적인 꼭지 수. 1꼭지에 3~4분 정도를 잡는다. */
export function segmentCount(targetMinutes: number): number {
  return Math.max(1, Math.min(10, Math.round(targetMinutes / 3.5)));
}

function segmentRule(setup: EpisodeSetup): string {
  return `꼭지 수: 주제에 개수가 적혀 있으면(예: "뉴스 5가지") 그 개수를 따른다. 없으면 ${segmentCount(setup.targetMinutes)}개 내외.`;
}

/** 1차: 웹 검색으로 최신 기사를 모은다. (자유 형식, 그라운딩 출처를 받기 위해 JSON 모드를 쓰지 않음) */
export function researchPrompt(setup: EpisodeSetup): string {
  const hint = setup.sourceText.trim()
    ? `\n사용자가 준 자료가 있으니, 그 내용을 확인·보완하는 기사 위주로 찾아라.\n[자료 요약용 발췌]\n${setup.sourceText.trim().slice(0, 3000)}\n`
    : "";
  return `오늘은 ${today()}이다. 웹 검색으로 다음 주제에 관한 최신 뉴스를 찾아 정리하라.
주제: "${setup.topic}"
${segmentRule(setup)}
${hint}
각 뉴스마다 다음을 적는다.
- 헤드라인
- 확인된 사실들 (날짜·숫자·인물 직함은 기사 그대로)
- 청취자가 몰랐을 법한 배경지식
- 출처 기사 제목, 언론사, 보도 날짜
가능한 한 최근(오늘·어제) 기사를 우선하고, 추정·의견은 빼라.`;
}

/** 2차: 사용자 자료 + 검색 결과를 FactSheet JSON으로 구조화한다. */
export function factSheetPrompt(setup: EpisodeSetup, research?: string): string {
  const blocks = [
    setup.sourceText.trim() ? `[사용자 자료]\n${setup.sourceText.trim()}` : "",
    research?.trim() ? `[웹 검색 결과]\n${research.trim()}` : "",
  ].filter(Boolean);

  return `너는 뉴스 팟캐스트 제작팀의 리서처다. 오늘은 ${today()}이다.
주제: "${setup.topic}"
${segmentRule(setup)} 자료가 부족하면 줄여도 된다.

아래 자료에서 사실만 추출해 팩트 시트를 만들어라.

${blocks.join("\n\n")}

규칙
- 확인된 사실만 적는다. 추정·의견·전망은 제외한다.
- 숫자·날짜·인물 직함은 원문 그대로 적고, 각 사실(facts)에 근거 출처 id(source_ids)를 연결한다.
- 기사 문장을 그대로 복사하지 말고 짧게 재서술한다. (저작권)
- fact id는 전체에서 고유하게 f1, f2, ... 로, 출처 id는 s1, s2, ... 로 붙인다.
- numbers.fact_id는 그 숫자가 들어 있는 사실의 id다.
- background에는 청취자가 몰랐을 법한 배경지식 1개를 적는다.
- sensitivity는 정치·안보·사건사고 등 민감도(low/medium/high).
- 출처(sources)에는 실제로 참고한 기사의 제목·언론사·URL을 적는다. 모르면 url은 빈 문자열.
- date는 YYYY-MM-DD 형식의 오늘 날짜.`;
}

export function scriptPrompt(setup: EpisodeSetup, factSheet: FactSheet): string {
  const targetChars = setup.targetMinutes * CHARS_PER_MINUTE;
  const speakers = setup.speakers
    .map(
      (s) =>
        `- 이름: ${s.name} / 역할: ${ROLE_LABELS[s.role]}${s.persona.trim() ? `\n  캐릭터: ${s.persona.trim()}` : ""}`,
    )
    .join("\n");

  return `너는 한국어 뉴스 팟캐스트 대본 작가다. 아래 팩트 시트만 근거로 여러 화자가 대화하는 대본을 써라.

[에피소드]
- 주제: ${setup.topic}
- 날짜: ${today()}
- 형식: ${FORMAT_LABELS[setup.format]}
- 톤: ${TONE_LABELS[setup.tone]}
- 목표 길이: ${setup.targetMinutes}분 ≈ 대사 합계 ${targetChars.toLocaleString()}자 (공백 포함, 오디오 태그 제외, ±10% 이내)

[화자]
${speakers}

[흐름]
- segment_no 0 = 오프닝(사회자가 날짜와 오늘 다룰 내용 소개), 1..N = 팩트 시트 꼭지 순서, 99 = 클로징.
- 꼭지마다: 사회자 소개 → 해설가 설명 → 패널 질문·반응 → 해설가 답변 흐름을 기본으로, 매번 똑같지 않게 변주한다.
- 꼭지마다 팩트 시트 background를 활용한 "몰랐던 사실" 1개를 자연스럽게 넣는다.
- 모든 화자가 고르게 말하게 하고, 한 발화는 1~4문장으로 짧게 주고받는다.

[규칙]
- 팩트 시트에 없는 사실·숫자·이름을 새로 만들지 않는다.
- 사실을 말하는 발화는 fact_ids에 근거 fact id를 넣는다. 사실이 아니면 빈 배열.
- 정치·시사는 중립을 지킨다. 특정 진영 조롱, 실존 인물 비하 금지.
- 기사 문장 직접 인용을 남발하지 않는다.
- 상투 표현 금지: "흥미롭네요", "정말 좋은 질문입니다", "결론적으로" 반복 등.
- text는 TTS가 그대로 읽는다. (소괄호) 지문, 이모지, 마크다운, 화자 이름 접두어를 넣지 않는다. 연출은 아래 오디오 태그로만 한다.
  숫자·영문 약어는 읽기 자연스러운 형태로 쓴다. (예: "3.5%p" → "3.5퍼센트포인트")
- speaker는 위 화자 이름 중 하나와 정확히 같아야 한다.
- emotion은 ${EMOTIONS.join(", ")} 중 하나.
- seq는 1부터 순서대로.
- title은 "프로그램명 · 날짜" 형태의 짧은 에피소드 제목.

${AUDIO_TAG_RULES}

[팩트 시트]
${JSON.stringify(factSheet)}`;
}

const AUDIO_TAG_RULES = `[오디오 태그 — ElevenLabs v4가 읽으며 연출하는 지시문]
- text 안, 효과를 줄 단어나 문장 바로 앞에 영어 소문자 태그를 대괄호로 넣는다. 예: "[curious] 그럼 폭발력은 목함지뢰보다 세다는 거예요?"
- 발화의 첫머리에는 그 발화의 기본 말투 태그를 하나 둔다. 감정이 바뀌는 지점, 웃음·한숨 같은 반응, 뜸 들이는 곳에만 추가로 넣는다.
- 한 발화에 태그는 1~3개. 모든 문장마다 넣지 않는다. 같은 태그를 연달아 반복하지 않는다.
- 대본 전체에서 한 가지 태그가 발화의 5분의 1을 넘지 않게 골고루 쓴다. 화자의 캐릭터에 어울리는 태그를 고른다.
- 상황에 맞게 고른다.
  · 오프닝·클로징 인사: [warmly], [cheerfully]
  · 숫자·핵심 사실 전달: [matter-of-fact], [emphasized], 중요한 숫자 앞 [short pause]
  · 패널의 엉뚱한 질문·반전: [curious], [playfully], [surprised], [skeptical]
  · 가벼운 농담 뒤: [laughs], [chuckles], [laughs softly]
  · 곰곰이 생각: [hmm], [thoughtful], [hesitates]
  · 사망·부상·재난·범죄 등 민감한 꼭지(sensitivity high): [serious], [somber]만 쓰고 웃음 태그 금지
- 추천 태그: ${AUDIO_TAG_GROUPS.flatMap((g) => g.tags).join(" ")}
  목록에 없어도 짧은 영어 자연어 태그(예: [lower, thoughtful])는 쓸 수 있다.
- emotion 필드는 발화 전체의 대표 감정으로, 첫머리 태그와 어울리게 고른다.`;

export const TAGS_SCHEMA = obj({
  utterances: arr(obj({ seq: INT, text: STR, emotion: { type: "STRING", enum: [...EMOTIONS] } })),
});

/**
 * 이미 있는 대본에 오디오 태그만 입힌다. 대사 문구는 절대 바꾸지 않는다.
 * targetSeqs가 있으면 그 발화만 태그를 달고, 나머지는 앞뒤 맥락으로만 쓴다.
 */
export function tagsPrompt(input: {
  script: Script;
  speakers: EpisodeSetup["speakers"];
  factSheet: FactSheet | null;
  targetSeqs: number[];
}): string {
  const { script, speakers, factSheet, targetSeqs } = input;
  const targets = new Set(targetSeqs);
  const cast = speakers
    .map((s) => `- ${s.name} (${ROLE_LABELS[s.role]})${s.persona.trim() ? `: ${s.persona.trim()}` : ""}`)
    .join("\n");
  const segments = (factSheet?.segments ?? [])
    .map((s) => `- 꼭지 ${s.no}: ${s.headline} (민감도 ${s.sensitivity})`)
    .join("\n");
  const lines = script.utterances
    .map(
      (u) =>
        `${targets.has(u.seq) ? "▶" : " "} ${u.seq}. [꼭지 ${u.segment_no}] ${u.speaker}: ${stripTags(u.text)}`,
    )
    .join("\n");

  return `너는 오디오 드라마 연출가다. 아래 뉴스 팟캐스트 대본의 ▶ 표시된 발화에 ElevenLabs 오디오 태그를 달아라.
앞뒤 발화는 흐름을 파악하는 맥락으로만 쓴다.

[가장 중요한 규칙]
- 대사의 글자는 한 글자도 바꾸거나 빼거나 더하지 않는다. 띄어쓰기·문장부호도 그대로 둔다. 오직 [태그]만 끼워 넣는다.
- 결과 utterances에는 ▶ 표시된 발화만, 원래 seq 그대로 넣는다.
- emotion에는 그 발화의 대표 감정(${EMOTIONS.join(", ")})을 첫머리 태그와 어울리게 넣는다.

${AUDIO_TAG_RULES}

[화자]
${cast}
${segments ? `\n[꼭지]\n${segments}\n` : ""}
[대본] (segment 0 = 오프닝, 99 = 클로징)
${lines}`;
}

export const THUMBNAIL_TEXT_SCHEMA = obj({ title: STR, subtitle: STR });

const strArr = arr(STR);
export const YOUTUBE_META_SCHEMA = obj({
  summary: strArr,
  hashtagsTop: strArr,
  hashtagsMore: strArr,
  hashtagStrategy: STR,
  tags: obj({ core: strArr, entities: strArr, broad: strArr, longtail: strArr, brand: strArr }),
  tagStrategy: STR,
  altTitles: strArr,
});

/** 유튜브 업로드 정보: 요약·해시태그·태그. 검색 유입을 노리되 대본에 없는 내용은 넣지 않는다. */
export function youtubeMetaPrompt(input: {
  setup: EpisodeSetup;
  script: Script | null;
  factSheet: FactSheet | null;
  mainTitle: string;
  showName: string;
}): string {
  const { setup, script, factSheet, mainTitle, showName } = input;
  const segments = (factSheet?.segments ?? [])
    .map(
      (s) =>
        `- 꼭지 ${s.no}: ${s.headline} / 인물: ${s.people.map((p) => `${p.name}(${p.title})`).join(", ") || "없음"} / 민감도 ${s.sensitivity}`,
    )
    .join("\n");
  return `너는 한국 유튜브 뉴스 채널의 성장 담당자다. 아래 에피소드를 올릴 때 쓸 정보를 만들어라.

[에피소드]
- 프로그램: ${showName}
- 날짜: ${factSheet?.date ?? ""}
- 주제: ${setup.topic || script?.title || ""}
- 썸네일 메인 문구: ${mainTitle}
- 다룬 뉴스:
${segments || "(팩트 시트 없음)"}

[만들 것]
1. summary: 설명란 맨 위에 들어갈 요약 3줄. 한 줄에 40자 안팎, 가장 중요한 뉴스부터. 검색에 걸릴 핵심 키워드를 자연스럽게 넣는다.
2. hashtagsTop: 제목 위에 노출되는 해시태그 정확히 3개. 첫째는 가장 검색량이 큰 넓은 키워드(예: #뉴스),
   둘째·셋째는 이번 회 가장 화제성 큰 사건 키워드. 띄어쓰기 없이 "#"로 시작.
3. hashtagsMore: 설명란 끝에 붙일 해시태그 8~12개. 꼭지별 핵심 사건, 관련 기관·지역, 분야(#경제뉴스 등), 채널 브랜드를 섞는다.
   유튜브는 해시태그가 15개를 넘으면 모두 무시하므로 hashtagsTop과 합쳐 15개 이하.
4. hashtagStrategy: 왜 이렇게 골랐는지 3~4문장. 노출 위치(제목 위 3개), 넓은/좁은 키워드 배합, 개수 제한을 설명.
5. tags: 유튜브 "태그" 입력칸에 넣을 추천. 한국어 위주, 필요하면 영어 표기 병기.
   - core: 이번 회 핵심 사건 키워드 5~8개 (사람들이 실제로 검색할 표현)
   - entities: 등장 인물·기관·지역·고유명사 5~10개 (팩트 시트에 있는 것만)
   - broad: 넓은 분야 키워드 4~6개 (예: 오늘의 뉴스, 뉴스 브리핑, 시사)
   - longtail: 긴 검색어 5~8개 (예: "DMZ 지뢰 폭발 원인", "9월 29일 주요 뉴스")
   - brand: 채널·프로그램 브랜드 2~3개 (${showName} 등)
6. tagStrategy: 태그를 어떤 순서로 넣어야 하는지와 이유 3~4문장. (앞쪽 태그가 더 중요, 전체 500자 제한, 오타·변형어 활용 등)
7. altTitles: 같은 구조로 쓸 수 있는 다른 메인 문구 후보 3개 (각 20자 이내, 썸네일 메인 문구와 다른 각도).

[규칙]
- 팩트 시트에 없는 사실·인물·숫자를 만들지 않는다. 과장·낚시성 허위 금지.
- 특정 정치 진영 조롱, 실존 인물 비하, 사망·재난을 가볍게 다루는 표현 금지.
- 해시태그는 "#단어" 형식, 태그에는 "#"를 붙이지 않는다.`;
}

/** 유튜브 썸네일 문구. 눈길을 끌되 팩트 시트를 벗어난 과장·허위는 쓰지 않는다. */
export function thumbnailTextPrompt(
  setup: EpisodeSetup,
  script: Script | null,
  factSheet: FactSheet | null,
): string {
  const headlines = (factSheet?.segments ?? [])
    .map((s) => `- ${s.headline} (민감도 ${s.sensitivity})`)
    .join("\n");
  const opening = (script?.utterances ?? [])
    .filter((u) => u.segment_no === 0)
    .map((u) => stripTags(u.text))
    .join(" ")
    .slice(0, 600);
  return `너는 한국 유튜브 뉴스 채널의 썸네일 카피라이터다. 이번 에피소드의 썸네일 문구를 만들어라.

[에피소드]
- 주제: ${setup.topic || script?.title || "뉴스 브리핑"}
- 제목: ${script?.title ?? ""}
- 톤: ${TONE_LABELS[setup.tone]}
${
  headlines
    ? `- 다룬 뉴스:
${headlines}`
    : ""
}
${opening ? `- 오프닝 멘트: ${opening}` : ""}

[규칙]
- title: 썸네일 한가운데 크게 들어갈 메인 문구. 공백 포함 14자 이내. 가장 흥미로운 뉴스 1~2개를 골라
  호기심을 자극하게 쓴다. 숫자·대비·질문형·반전 표현을 활용해도 좋다.
- subtitle: 메인 문구를 받쳐 주는 보조 문구. 공백 포함 20자 이내. 날짜나 "오늘의 뉴스 N가지"처럼 맥락을 준다.
- 사실과 다른 과장, 낚시성 허위, 특정 인물·진영 비하, 사망·재난을 가볍게 다루는 표현은 금지.
- 이모지, 따옴표, 해시태그는 넣지 않는다.`;
}

export function verifyPrompt(factSheet: FactSheet, script: Script): string {
  const lines = script.utterances.map((u) => `${u.seq}. ${u.speaker}: ${stripTags(u.text)}`).join("\n");
  return `너는 뉴스 팟캐스트 팩트체커다. 대본의 각 발화를 팩트 시트와 대조하라.

찾아야 할 문제
- unsupported_number: 팩트 시트에 없는 숫자·날짜·수량
- unsupported_name: 팩트 시트에 없는 인물·기관 이름이나 틀린 직함
- tone: 특정 정치 진영 조롱, 실존 인물 비하, 단정적 추측 등 부적절한 표현

문제가 있는 발화만 flags에 넣는다. detail에는 무엇이 왜 문제인지 한 문장으로 적는다.
일반 상식 수준의 표현(예: "오늘", "여러분")이나 인사말은 문제로 보지 않는다. 문제가 없으면 빈 배열.

[팩트 시트]
${JSON.stringify(factSheet)}

[대본]
${lines}`;
}
