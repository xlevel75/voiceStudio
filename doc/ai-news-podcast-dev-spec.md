# AI 멀티화자 뉴스 팟캐스트·영상 자동 제작 시스템 — 개발 명세서

- 문서 버전: v1.0 (2026-09-29)
- 원본 기획서: Claude Docs "AI 멀티화자 뉴스 팟캐스트·영상 자동 제작 시스템 기획서"
- 대상: 개발자 (1~2인 개발 기준)

> 모델명·요금·API 스키마는 2026년 9월 기준입니다. TTS·이미지 모델은 수개월 단위로 교체되므로 **모든 모델명은 설정값으로 관리**하고, 구현 전 공식 문서를 다시 확인하세요.

---

## 0. 한눈에 보기

주제 하나를 입력하면 여러 화자(사회자·해설가·패널)가 대화하는 뉴스 팟캐스트를 **음성 → 영상 → 배포**까지 자동으로 만든다. 사람은 주제 선정, 대본 검수, 최종 승인만 한다.

| 단계 | 결과물 | 핵심 기술 |
| --- | --- | --- |
| 1단계 음성 | 대본 JSON, 발화별 WAV, `episode.mp3`, 타임라인 JSON, SRT | Gemini(요약·검증) + Claude Max(`claude -p`, 대본) + Gemini TTS + FFmpeg |
| 2단계 영상 | 화자 표정 컷, 장면 이미지 목록, `episode.mp4`, 쇼츠 | Nano Banana 2 + FFmpeg(또는 Remotion) |
| 3단계 배포 | 유튜브 업로드, 팟캐스트 RSS | YouTube Data API v3, RSS 생성기 또는 RSS.com API |

---

## 1. 아키텍처

```mermaid
flowchart LR
  subgraph S1[1단계 · 음성]
    A[주제 만들기<br/>화자·역할·분량] --> B[팩트 시트<br/>Gemini]
    B --> C[대본 생성<br/>Claude claude -p]
    C --> D[사실 검증<br/>Gemini]
    D --> E{사람 검수}
    E --> F[화자별 TTS<br/>발화별 WAV]
    F --> G[음성 합치기<br/>MP3 + 타임라인]
  end
  subgraph S2[2단계 · 영상]
    G --> H[장면 이미지<br/>Nano Banana]
    H --> I[영상 렌더링<br/>FFmpeg · 자막]
  end
  subgraph S3[3단계 · 배포]
    I --> J[유튜브 업로드<br/>제목·태그·썸네일]
    G --> K[팟캐스트 RSS<br/>Spotify · Apple]
  end
```

- 모든 무거운 작업(LLM, TTS, 이미지, 렌더링, 업로드)은 **작업 큐(Job)** 로 비동기 처리한다.
- 각 단계 결과를 DB와 스토리지에 저장해 **실패한 조각만 재실행** 가능하게 한다.
- **타임라인 JSON** 이 영상(2단계)과 RSS(3단계)의 공통 기준이다.

---

## 2. 기술 스택

| 영역 | 기술 | 비고 |
| --- | --- | --- |
| 프론트엔드 | Next.js (React, TypeScript) | 주제 만들기, 검수, 장면 목록, 플레이어 |
| 백엔드 API | Python 3.12 + FastAPI | REST API |
| 작업 큐 | Celery(또는 RQ) + Redis | 단계별 워커 분리 권장 |
| DB | PostgreSQL 16 | SQLAlchemy + Alembic |
| 파일 저장 | S3 호환 스토리지 + CDN | 로컬 개발은 MinIO |
| 대본 LLM | Claude (Max 구독, `claude -p`) | 모드 전환: 구독 / Claude API / Gemini 단독 |
| 요약·검증 LLM | Gemini 3.8 Flash | `google-genai` SDK |
| TTS | Gemini 3.8 Flash TTS (기본), Flash-Lite TTS | 어댑터로 ElevenLabs·타입캐스트 등 교체 가능 |
| 이미지 | Nano Banana 2 (`gemini-3.1-flash-image`) | Lite / Pro 선택 가능 |
| 오디오·영상 | FFmpeg 6+ (필요 시 Remotion) | loudnorm, concat, zoompan |
| 배포 | YouTube Data API v3, RSS | `google-api-python-client` |
| 스케줄 | cron (Celery beat) | 매일 아침 자동 제작 |

---

## 3. 디렉터리 구조 (제안)

```
ai-news-podcast/
├─ apps/
│  ├─ web/                    # Next.js
│  └─ api/                    # FastAPI
│     ├─ main.py
│     ├─ routers/             # projects, speakers, utterances, jobs, channels
│     ├─ models/              # SQLAlchemy
│     ├─ schemas/             # Pydantic (FactSheet, Script, Timeline ...)
│     └─ settings.py
├─ workers/
│  ├─ tasks_script.py         # 팩트 시트, 대본, 검증
│  ├─ tasks_tts.py
│  ├─ tasks_mix.py
│  ├─ tasks_image.py
│  ├─ tasks_render.py
│  └─ tasks_publish.py
├─ providers/                 # 어댑터 (교체 가능)
│  ├─ llm/
│  │  ├─ base.py              # LLMProvider 인터페이스
│  │  ├─ claude_cli.py        # claude -p (Max 구독)
│  │  ├─ claude_api.py        # Anthropic API 키
│  │  └─ gemini.py
│  ├─ tts/
│  │  ├─ base.py
│  │  ├─ gemini_tts.py
│  │  └─ elevenlabs.py
│  ├─ image/
│  │  ├─ base.py
│  │  └─ nano_banana.py
│  └─ publish/
│     ├─ youtube.py
│     └─ rss.py
├─ prompts/                   # 프롬프트 템플릿 (Jinja2)
│  ├─ fact_sheet.md.j2
│  ├─ script.md.j2
│  ├─ verify.md.j2
│  └─ metadata.md.j2
├─ media/                     # 효과음, 배경음악, 폰트
├─ docker-compose.yml         # postgres, redis, minio
└─ .env.example
```

---

## 4. 환경 변수 / 설정

```dotenv
# DB / 큐 / 스토리지
DATABASE_URL=postgresql+psycopg://app:app@localhost:5432/podcast
REDIS_URL=redis://localhost:6379/0
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=podcast-assets
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
CDN_BASE_URL=https://cdn.example.com

# Google (Gemini: 요약·검증·TTS·이미지)
GEMINI_API_KEY=...            # 사용자별 키는 DB에 암호화 저장, 이 값은 개발용 기본값
GEMINI_TEXT_MODEL=gemini-3.8-flash
GEMINI_TTS_MODEL=gemini-3.8-flash-tts
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
GEMINI_THUMB_MODEL=gemini-3-pro-image

# Claude 대본 생성 모드: subscription | api | off
CLAUDE_MODE=subscription
CLAUDE_CLI_PATH=claude
CLAUDE_MODEL=                 # 비워두면 CLI 기본 모델
# 주의: subscription 모드에서는 ANTHROPIC_API_KEY를 설정하지 말 것 (설정 시 API 과금)
# ANTHROPIC_API_KEY=          # CLAUDE_MODE=api 일 때만

# YouTube OAuth
YOUTUBE_CLIENT_SECRETS=./client_secret.json
YOUTUBE_REDIRECT_URI=http://localhost:8000/channels/youtube/callback

# 암호화 (사용자 API 키 저장용)
FERNET_KEY=...
```

---

## 5. 데이터 모델

```sql
CREATE TABLE project (
  id            UUID PRIMARY KEY,
  title         TEXT NOT NULL,
  format        TEXT NOT NULL,          -- news_briefing | debate | interview | qa
  tone          TEXT NOT NULL,          -- serious | balanced | humorous
  target_minutes INT NOT NULL,
  sources       JSONB DEFAULT '[]',     -- [{url, title, text}]
  fact_sheet    JSONB,                  -- FactSheet 스키마
  status        TEXT NOT NULL,          -- draft | scripting | review | voicing | mixed | imaging | rendered | published
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE speaker (
  id            UUID PRIMARY KEY,
  project_id    UUID REFERENCES project(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,          -- "사회자"
  role          TEXT NOT NULL,          -- host | analyst | panel_curious | panel_counter
  persona       TEXT,                   -- 캐릭터 바이블 (말버릇, 관심사, 농담 유형)
  tts_provider  TEXT NOT NULL,
  tts_voice_id  TEXT NOT NULL,
  design_sheet_asset_id UUID,
  seat_index    INT                     -- 스튜디오 좌석 위치
);

CREATE TABLE utterance (
  id            UUID PRIMARY KEY,
  project_id    UUID REFERENCES project(id) ON DELETE CASCADE,
  seq           INT NOT NULL,
  speaker_id    UUID REFERENCES speaker(id),
  segment_no    INT,                    -- 뉴스 꼭지 번호 (0=오프닝, 99=클로징)
  text          TEXT NOT NULL,
  emotion       TEXT,                   -- calm | laugh | surprised | curious | serious ...
  flags         JSONB DEFAULT '[]',     -- 검증 경고 [{type, detail}]
  audio_asset_id UUID,
  start_ms      INT,
  end_ms        INT,
  scene_asset_id UUID,
  UNIQUE (project_id, seq)
);

CREATE TABLE asset (
  id            UUID PRIMARY KEY,
  project_id    UUID,
  kind          TEXT NOT NULL,          -- audio_clip | episode_audio | image_expression | image_scene | studio | video | thumbnail | srt | timeline
  storage_key   TEXT NOT NULL,
  meta          JSONB DEFAULT '{}',     -- {model, duration_ms, width, height, emotion ...}
  cost_usd      NUMERIC(10,4) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE job (
  id            UUID PRIMARY KEY,
  project_id    UUID,
  kind          TEXT NOT NULL,          -- fact_sheet | script | verify | tts | mix | image | render | publish_youtube | publish_rss
  target_id     UUID,                   -- utterance 단위 작업이면 utterance.id
  status        TEXT NOT NULL,          -- queued | running | done | failed
  attempts      INT DEFAULT 0,
  error         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  finished_at   TIMESTAMPTZ
);

CREATE TABLE channel (
  id            UUID PRIMARY KEY,
  platform      TEXT NOT NULL,          -- youtube | rss
  oauth_token   BYTEA,                  -- 암호화
  defaults      JSONB DEFAULT '{}'      -- {playlist_id, tags, privacy, notify_subscribers}
);

CREATE TABLE publish (
  id            UUID PRIMARY KEY,
  project_id    UUID,
  channel_id    UUID,
  external_id   TEXT,                   -- YouTube videoId 등
  privacy       TEXT,
  published_at  TIMESTAMPTZ
);

CREATE TABLE user_secret (
  id            UUID PRIMARY KEY,
  provider      TEXT NOT NULL,          -- gemini | anthropic | elevenlabs
  encrypted_key BYTEA NOT NULL,
  last4         TEXT NOT NULL
);
```

---

## 6. JSON 스키마 (단계 간 계약)

### 6-1. FactSheet (Gemini 출력)

```json
{
  "date": "2026-09-29",
  "segments": [
    {
      "no": 1,
      "headline": "DMZ 폭발, 북한군 지뢰 가능성 매우 높아",
      "facts": [
        {"id": "f1", "text": "9월 21일 서부전선 DMZ에서 폭발 사고 발생", "source_ids": ["s1"]},
        {"id": "f2", "text": "합참은 9월 28일 중간조사에서 북한군 지뢰 가능성이 매우 높다고 발표", "source_ids": ["s1", "s2"]}
      ],
      "numbers": [{"value": "3발", "context": "폭발 2발 + 미폭발 1발 추정", "fact_id": "f3"}],
      "people": [{"name": "권대원", "title": "합참 차장"}],
      "background": "목함지뢰는 나무 상자형 지뢰로 금속탐지기에 잘 걸리지 않음",
      "sensitivity": "high"
    }
  ],
  "sources": [
    {"id": "s1", "title": "합참 DMZ 폭발 중간조사", "url": "https://...", "publisher": "..."}
  ]
}
```

### 6-2. Script (Claude 출력)

```json
{
  "title": "오늘의 한국 · 9월 29일",
  "target_minutes": 20,
  "utterances": [
    {"seq": 1, "speaker": "사회자", "segment_no": 0, "emotion": "bright",
     "text": "9월 29일 화요일 아침, 「오늘의 한국」입니다.", "fact_ids": []},
    {"seq": 2, "speaker": "해설가", "segment_no": 1, "emotion": "calm",
     "text": "합참이 어젯밤 8시 30분 긴급 브리핑을 열었는데요.", "fact_ids": ["f2"]},
    {"seq": 3, "speaker": "패널1", "segment_no": 1, "emotion": "curious",
     "text": "목함이면 나무 상자인데, 왜 플라스틱이라고 하는 거예요?", "fact_ids": []}
  ]
}
```

규칙
- `speaker`는 프로젝트 화자 이름과 정확히 일치해야 한다.
- 사실을 말하는 발화는 `fact_ids`로 근거를 연결한다 (검증 단계에서 사용).
- `emotion`은 허용 목록 중 하나: `calm, bright, serious, curious, laugh, surprised, thinking, listening`.

### 6-3. Timeline (합치기 출력)

```json
{
  "episode_audio": "projects/{id}/episode.mp3",
  "duration_ms": 1198340,
  "items": [
    {"seq": 1, "speaker": "사회자", "start_ms": 0, "end_ms": 4210, "segment_no": 0},
    {"seq": 2, "speaker": "해설가", "start_ms": 4610, "end_ms": 12880, "segment_no": 1}
  ],
  "chapters": [
    {"segment_no": 1, "title": "DMZ 폭발 조사 결과", "start_ms": 38200}
  ]
}
```

---

## 7. 1단계: 음성 팟캐스트

### 7-1. 주제 만들기 (입력)

| 필드 | 타입 | 예시 |
| --- | --- | --- |
| title | string | 오늘의 한국 뉴스 10가지 |
| sources | url[] / text | 기사 링크 10개 |
| auto_collect | bool + N | 오늘 뉴스 N개 자동 수집 |
| speakers | 2~6명 | 이름, 역할, persona, voice |
| target_minutes | int | 20 |
| tone | enum | balanced |
| format | enum | news_briefing |

역할 템플릿: `host`(소개·전환), `analyst`(심층 설명), `panel_curious`(엉뚱한 질문), `panel_counter`(다른 관점).

### 7-2. LLM 역할 분담

| 순서 | 작업 | 담당 | 과금 |
| --- | --- | --- | --- |
| ① | 기사 → FactSheet | Gemini 3.8 Flash (API 키) | Google 종량제, 소액 |
| ② | FactSheet + 화자 설정 → Script | Claude (Max 구독, `claude -p`) | 구독 사용량 차감 |
| ③ | Script vs FactSheet 대조 → flags | Gemini 3.8 Flash | Google 종량제, 소액 |
| ④ | flag 발화만 재작성 | Claude (Max 구독) | 구독 사용량 차감 |
| ⑤ | 유튜브 제목·설명·태그 초안 | Claude 또는 Gemini | 선택 |

### 7-3. 분량 계산

- 한국어 낭독 속도: 분당 약 300~350음절 → `target_chars = target_minutes × 320`
- 20분 이상은 **꼭지별로 나눠 생성** (오프닝, 꼭지 1..N, 클로징) 후 합친다.
- TTS 후 실제 길이가 목표 대비 ±10% 벗어나면 해당 꼭지만 늘리거나 줄이도록 재요청.

### 7-4. Claude 호출 (구독 모드, `claude -p`)

```python
# providers/llm/claude_cli.py
import json, os, subprocess, tempfile

class ClaudeCLIProvider:
    """Claude Max/Pro 구독으로 로그인된 Claude Code CLI를 호출한다.
    사전 조건: 서버에서 `claude` 실행 후 구독 계정으로 로그인해 둘 것.
    """
    def __init__(self, cli_path="claude", model: str | None = None, timeout=600):
        self.cli_path, self.model, self.timeout = cli_path, model, timeout

    def generate_json(self, prompt: str) -> dict:
        env = os.environ.copy()
        env.pop("ANTHROPIC_API_KEY", None)   # 구독 대신 API 과금되는 것 방지
        cmd = [self.cli_path, "-p", prompt, "--output-format", "json"]
        if self.model:
            cmd += ["--model", self.model]
        out = subprocess.run(cmd, capture_output=True, text=True,
                             timeout=self.timeout, env=env, check=True)
        envelope = json.loads(out.stdout)    # CLI 응답 envelope
        text = envelope.get("result", "")
        return extract_json(text)            # ```json ... ``` 블록 파싱 유틸

def extract_json(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start:end + 1])
```

- 긴 프롬프트는 임시 파일에 저장하고 프롬프트에서 "다음 파일을 읽어라"로 넘기거나, 표준입력으로 전달하는 방식도 가능 (CLI 문서 확인).
- 결과는 Pydantic `Script` 스키마로 검증하고, 실패 시 오류 메시지를 붙여 1회 재요청.
- 더 세밀한 제어가 필요하면 Claude Agent SDK(Python)를 같은 로그인으로 사용.

### 7-5. Gemini 호출 (팩트 시트·검증)

```python
# providers/llm/gemini.py
from google import genai
from google.genai import types

class GeminiProvider:
    def __init__(self, api_key: str, model: str):
        self.client, self.model = genai.Client(api_key=api_key), model

    def generate_json(self, prompt: str, schema: dict | None = None) -> dict:
        cfg = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
        )
        res = self.client.models.generate_content(
            model=self.model, contents=prompt, config=cfg)
        return json.loads(res.text)
```

### 7-6. TTS (발화 단위)

- **Gemini 다중 화자 모드는 요청당 최대 2명** → 3명 이상 대화는 **발화 한 줄씩** 생성하는 것을 기본으로 한다.
- Gemini 3.8 TTS는 입력 텍스트를 그대로 읽는 대본으로 취급하고, 말투 지시는 `speech_metadata`(speaker, style)로 분리한다. 스키마는 구현 시 공식 문서로 확인.

```python
# providers/tts/gemini_tts.py  (스키마는 공식 문서로 확인 후 조정)
def synth(self, text: str, voice: str, style: str | None) -> bytes:
    res = self.client.models.generate_content(
        model=self.model,                       # gemini-3.8-flash-tts
        contents=[{"parts": [{
            "text": text,
            "speech_metadata": {"style": style} if style else {},
        }]}],
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))),
        ),
    )
    pcm = res.candidates[0].content.parts[0].inline_data.data
    return pcm_to_wav(pcm, rate=24000)          # 24kHz 16bit mono PCM 가정
```

- 발화별 WAV를 `asset(kind=audio_clip)`으로 저장, `duration_ms` 기록.
- 감정 → 스타일 매핑 예: `curious → "호기심 가득한 말투로, 살짝 올려서"`, `calm → "차분하고 또박또박하게"`.

### 7-7. 합치기 (FFmpeg)

1. 발화 WAV 사이에 무음 삽입: 같은 꼭지 내 0.35초, 꼭지 전환 시 징글(1~2초).
2. concat → 라우드니스 평준화 → MP3.

```bash
# concat 목록 (워커가 생성)
# file 'clips/0001.wav'
# file 'silence_350ms.wav'
# file 'clips/0002.wav'
ffmpeg -f concat -safe 0 -i list.txt -c pcm_s16le joined.wav
ffmpeg -i joined.wav -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 44100 -b:a 128k episode.mp3
```

3. 배경음악 덕킹(선택): `sidechaincompress` 필터로 말할 때 BGM 볼륨 낮춤.
4. 누적 길이로 Timeline JSON과 SRT 생성.

### 7-8. 스트리밍

- 웹 플레이어: CDN의 `episode.mp3` 재생, 발화 목록 클릭 시 `start_ms`로 이동.
- 외부 앱: RSS 피드 공개 (10장 참고).

---

## 8. 2단계: 이미지·영상

### 8-1. 화자 디자인시트

- 화자마다 디자인시트 이미지 업로드 (정면·측면·표정 모음 권장), 그림체 선택 (실사 / 웹툰 / 3D).
- 없으면 persona 설명으로 캐릭터를 생성 → 사용자가 하나를 골라 디자인시트로 확정.
- **실존 인물 얼굴은 금지**(또는 본인 동의 확인) — 가상 캐릭터만 허용.

### 8-2. 기준 스튜디오 이미지

- 배경 템플릿: 뉴스 스튜디오 / 원형 토론 테이블 / 회의실 / 라디오 부스.
- 좌석 배치(`speaker.seat_index`)를 반영한 **기준 스튜디오 이미지 1장**을 먼저 생성해 고정 → 이후 모든 장면의 참조 이미지.

### 8-3. 표정 컷 생성 (비용 절약 핵심)

- 발화마다 새로 만들지 않고, **화자별 표정 6~8종**을 미리 생성해 재사용.
- 표정 세트: `calm, bright, serious, curious, laugh, surprised, thinking, listening`.
- 장면 = (말하는 화자의 표정 컷) 중심 미디엄 샷. 20분 에피소드도 30~40장이면 충분.

```python
# providers/image/nano_banana.py
from google import genai
from google.genai import types

def make_expression(client, model, studio_png: bytes, sheet_png: bytes,
                    speaker_desc: str, emotion: str) -> bytes:
    prompt = (
        f"첫 번째 이미지는 스튜디오 배경, 두 번째는 인물 디자인시트다. "
        f"디자인시트의 인물({speaker_desc})이 이 스튜디오 자기 자리에서 "
        f"'{emotion}' 표정으로 말하는 미디엄 샷을 16:9로 그려라. "
        f"얼굴·헤어·의상은 디자인시트와 동일하게 유지."
    )
    res = client.models.generate_content(
        model=model,                                # gemini-3.1-flash-image
        contents=[
            types.Part.from_bytes(data=studio_png, mime_type="image/png"),
            types.Part.from_bytes(data=sheet_png, mime_type="image/png"),
            prompt,
        ],
    )
    for part in res.candidates[0].content.parts:
        if part.inline_data:
            return part.inline_data.data
    raise RuntimeError("no image returned")
```

- 급하지 않은 생성은 Batch API로 (비용 약 50% 절감).
- 원조 Nano Banana(`gemini-2.5-flash-image`)는 2026-10-02 종료 예정 → 사용 금지.

### 8-4. 장면 매핑

- `utterance.emotion` → 해당 화자의 표정 컷을 `scene_asset_id`로 연결.
- 같은 화자가 연속 발화하면 표정만 바꾸거나 줌 방향을 바꿔 단조로움 방지.
- 결과 확인 화면에서 장면별 이미지 교체(재생성 / 다른 표정 선택 / 직접 업로드).

### 8-5. 영상 렌더링

- 타임라인 기준으로 각 발화 구간 동안 장면 이미지 표시, 화자 전환 시 0.2초 크로스페이드.
- 효과: 느린 줌(켄 번스), 하단 자막(SRT 번인), 화자 이름표, 꼭지 제목 바.
- 출력: 16:9 1920×1080 롱폼 + 9:16 쇼츠(꼭지별 1분 요약).

```bash
# 가장 단순한 형태: 이미지 목록 + 표시 시간 → 영상, 음성 합성
# scenes.txt
# file 'scene_0001.png'
# duration 4.61
# file 'scene_0002.png'
# duration 8.27
ffmpeg -f concat -safe 0 -i scenes.txt -i episode.mp3 \
  -vf "scale=1920:1080,format=yuv420p,subtitles=episode.srt" \
  -c:v libx264 -r 30 -c:a aac -shortest episode.mp4
```

- 줌·크로스페이드·이름표가 들어가면 Remotion(React 템플릿) 쪽이 유지보수가 쉽다.
- 립싱크 영상(Veo, HeyGen 등)은 비용이 커서 2차 과제.

---

## 9. 3단계: 유튜브 업로드

### 9-1. 사전 준비 (개발 초기에 바로)

- Google Cloud 프로젝트 생성 → YouTube Data API v3 활성화 → OAuth 동의 화면 구성.
- **검수(Audit)를 받지 않은 API 프로젝트로 올린 영상은 비공개로 잠긴다.** → "YouTube API Services 감사 및 할당량 확장 신청"을 1단계 개발과 동시에 제출. 개인정보처리방침·이용약관 페이지 필요.
- 기본 할당량: 프로젝트당 하루 `videos.insert` 100회 (일일 채널 운영에 충분).

### 9-2. 업로드 코드

```python
# providers/publish/youtube.py
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

def upload(creds, video_path, meta, thumb_path=None, srt_path=None):
    yt = build("youtube", "v3", credentials=creds)
    body = {
        "snippet": {
            "title": meta["title"][:100],
            "description": meta["description"],
            "tags": meta["tags"][:15],
            "categoryId": "25",                # News & Politics
            "defaultLanguage": "ko",
        },
        "status": {
            "privacyStatus": meta.get("privacy", "private"),
            "publishAt": meta.get("publish_at"),       # 예약 공개 시 (private 필요)
            "selfDeclaredMadeForKids": False,
            "containsSyntheticMedia": True,            # AI 합성 콘텐츠 표시
        },
    }
    req = yt.videos().insert(
        part="snippet,status", body=body,
        notifySubscribers=meta.get("notify", True),
        media_body=MediaFileUpload(video_path, chunksize=-1, resumable=True))
    res = None
    while res is None:
        _, res = req.next_chunk()
    vid = res["id"]
    if thumb_path:
        yt.thumbnails().set(videoId=vid, media_body=MediaFileUpload(thumb_path)).execute()
    if srt_path:
        yt.captions().insert(part="snippet",
            body={"snippet": {"videoId": vid, "language": "ko", "name": "한국어"}},
            media_body=MediaFileUpload(srt_path)).execute()
    if meta.get("playlist_id"):
        yt.playlistItems().insert(part="snippet", body={"snippet": {
            "playlistId": meta["playlist_id"],
            "resourceId": {"kind": "youtube#video", "videoId": vid}}}).execute()
    return vid
```

### 9-3. 메타데이터 자동 생성

| 항목 | 생성 규칙 |
| --- | --- |
| 제목 | 날짜 + 핵심 뉴스 2~3개 키워드, 100자 이내 |
| 설명 | 요약 3줄 + 챕터 타임스탬프(`00:38 DMZ 폭발 조사`) + 원문 출처 목록 + "이 영상은 AI 음성·이미지로 제작되었습니다" |
| 태그 | 대본 키워드 10~15개 |
| 썸네일 | Nano Banana Pro로 출연진 + 큰 제목 문구, 1280×720, 2MB 이하 |
| 자막 | 1단계 SRT |
| AI 합성 표시 | `containsSyntheticMedia: true` |

---

## 10. 3단계: 팟캐스트 RSS 배포

| 플랫폼 | 방법 | 비고 |
| --- | --- | --- |
| Spotify | RSS 등록 또는 Spotify for Creators 호스팅 | RSS 소유 확인 메일은 피드의 이메일로 발송 |
| Apple 팟캐스트 | Podcasts Connect에 RSS 등록 | |
| YouTube Music / 유튜브 팟캐스트 | 유튜브 스튜디오에 RSS 제출 | 영상 업로드와 중복되지 않게 채널 분리 권장 |
| Amazon Music 등 | 호스팅 업체 일괄 배포 | |
| 네이버 오디오클립 | 사용 불가 | 2025-12-31 종료 |
| 팟빵 | 수동 등록 | 2025년 저작권 송출 제한 이후 위축 |

구현 옵션
- **A. 직접 RSS**: `rss.xml`을 생성해 CDN에 올림. `<item>`에 `enclosure url/length/type`, `guid`, `pubDate`, `itunes:duration`, 챕터 포함.
- **B. RSS.com API**: 에피소드 업로드·게시를 API로 자동화, 40여 개 디렉터리 일괄 배포 (Network 요금제 필요).

---

## 11. 백엔드 API (FastAPI 초안)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| POST | `/projects` | 주제 만들기 |
| GET | `/projects/{id}` | 상태·요약 조회 |
| POST | `/projects/{id}/speakers` | 화자 추가 (디자인시트 업로드 포함) |
| POST | `/projects/{id}/fact-sheet` | 팩트 시트 생성 작업 시작 |
| POST | `/projects/{id}/script` | 대본 생성 작업 시작 |
| GET | `/projects/{id}/utterances` | 발화 목록 (검수 화면) |
| PATCH | `/utterances/{id}` | 대사·화자·감정 수정 |
| POST | `/utterances/{id}/regenerate` | 대사 / 음성 / 장면 개별 재생성 (`?what=text|audio|scene`) |
| POST | `/projects/{id}/voice` | 전체 TTS |
| POST | `/projects/{id}/mix` | 합치기 |
| POST | `/projects/{id}/images` | 표정 컷·장면 생성 |
| POST | `/projects/{id}/render` | 영상 렌더링 |
| POST | `/projects/{id}/publish/youtube` | 유튜브 업로드 |
| POST | `/projects/{id}/publish/rss` | RSS 게시 |
| GET | `/jobs/{id}` | 작업 상태 |
| GET | `/channels/youtube/connect` | OAuth 시작 |
| PUT | `/settings/secrets/{provider}` | API 키 저장 (암호화, 끝 4자리만 반환) |

---

## 12. 화면 목록

1. **주제 만들기**: 주제·자료·화자(이름/역할/persona/목소리 미리듣기/디자인시트)·분량·톤·형식.
2. **대본 검수**: 발화 표 (순번·화자·대사·감정·경고), 인라인 수정, 순서 이동, 개별 재생성.
3. **음성**: 발화별 재생, 전체 에피소드 플레이어, 길이 vs 목표 표시.
4. **화자 목록**: 디자인시트, 목소리, 표정 컷 모음.
5. **장면 목록**: `대사 / 화자 / 장면 이미지 / 음성 재생 / 길이` 한 줄씩, 이미지 교체.
6. **영상**: 미리보기, 쇼츠 목록.
7. **배포**: 채널 연결, 메타데이터 편집, 썸네일 선택, 공개 설정·예약.
8. **설정**: API 키, Claude 모드(구독/API/끔), 모델 선택, 비용 대시보드.

---

## 13. 프롬프트 템플릿 요점

### 13-1. 팩트 시트 (Gemini)

- 입력 기사에서 **사실만** 추출, 추정·의견 제외.
- 숫자·날짜·인물 직함은 원문 그대로, 각 사실에 `source_ids` 연결.
- 기사 문장을 그대로 복사하지 말고 짧게 재서술 (저작권).

### 13-2. 대본 (Claude)

- 화자 바이블(persona) 전체 포함: 말버릇, 관심사, 농담 유형, 금지 행동.
- 형식 규칙: 사회자 소개 → 해설가 설명 → 패널 질문 → 해설가 답변(유머 허용) 흐름.
- 금지: 팩트 시트에 없는 사실·숫자 추가, 기사 문장 직접 인용 남발, 특정 정치 진영 조롱, 실존 인물 비하.
- 상투 표현 금지 목록: "흥미롭네요", "정말 좋은 질문입니다", "결론적으로" 반복 등.
- 꼭지마다 "몰랐던 사실" 1개 (팩트 시트의 background 활용).
- 좋은 예시 대본 2~3개 few-shot.
- 출력: 6-2 Script JSON만.

### 13-3. 검증 (Gemini)

- 각 발화의 숫자·이름·날짜가 팩트 시트에 있는지 대조.
- 출력: `[{seq, type: "unsupported_number"|"unsupported_name"|"tone", detail}]`.

---

## 14. 비용 추정 (20분 1편, 2026년 9월 요금)

| 항목 | 계산 | 비용(약) |
| --- | --- | --- |
| 대본 | Claude 0원(Max 구독) + Gemini 요약·검증 | 0.05달러 미만 |
| TTS | 20분 + 재생성 여유 | 0.3~0.6달러 |
| 표정 컷·장면 | 40장 × 0.034~0.067달러 | 1.4~2.7달러 |
| 썸네일 | Pro 1~3장 | 0.13~0.4달러 |
| 유튜브 API | 할당량제 | 0 |
| **합계** | | **약 2~4달러 / 편** (매일 제작 시 월 60~120달러) |

- Gemini 요금은 2026-12-31까지 기준, 2027년 TTS 인상 예고 보도 있음 → 개발 시 재확인.
- 모든 생성 결과의 `asset.cost_usd`를 기록해 에피소드별 비용 표시.

---

## 15. 운영·컴플라이언스 체크리스트

- [ ] 유튜브 API 감사 신청 (1단계 착수와 동시)
- [ ] 개인정보처리방침·이용약관 페이지 공개
- [ ] 설명란 AI 제작 고지 + `containsSyntheticMedia` 설정
- [ ] 원문 출처 목록 자동 표기, 기사 문장 직접 복사 금지
- [ ] 게시 전 사람 승인 단계 (자동 공개 금지 옵션 기본값)
- [ ] 실존 인물 얼굴 사용 금지 / 동의 확인
- [ ] 정치·시사 중립 규칙을 프롬프트에 명시
- [ ] 매회 형식·코너 변주로 "양산형 콘텐츠" 판정 회피 (2026년 7월 유튜브 정책)
- [ ] Claude 구독 모드는 **본인 채널 운영용**으로만 사용 (타 사용자 서비스화 시 API 키 모드)
- [ ] 구독 모드 환경에 `ANTHROPIC_API_KEY` 미설정 확인
- [ ] 사용자 API 키 암호화 저장, 로그에 키 노출 금지

---

## 16. 마일스톤과 작업 목록

### M1. 1단계 음성 MVP (4~6주)

- [ ] 프로젝트 골격: docker-compose(Postgres, Redis, MinIO), FastAPI, Next.js
- [ ] DB 스키마 + Alembic 마이그레이션
- [ ] 어댑터 인터페이스: `LLMProvider`, `TTSProvider`
- [ ] `ClaudeCLIProvider` (구독 모드) + `GeminiProvider`
- [ ] 팩트 시트 → 대본 → 검증 파이프라인, Pydantic 스키마 검증·재시도
- [ ] 주제 만들기 화면, 대본 검수 화면
- [ ] Gemini TTS 발화별 생성, 음성 미리듣기, 개별 재생성
- [ ] FFmpeg 합치기 + loudnorm + Timeline JSON + SRT
- [ ] 웹 플레이어
- [ ] (병행) 유튜브 API 감사 신청

### M2. 2단계 영상 (4~6주)

- [ ] 디자인시트 업로드, 캐릭터 생성 흐름
- [ ] 기준 스튜디오 이미지 생성·고정
- [ ] 표정 컷 세트 생성 (Batch 옵션)
- [ ] 장면 매핑 + 장면 목록 화면 (교체·재생성)
- [ ] FFmpeg 렌더링 (자막 번인) → Remotion 템플릿 (줌·페이드·이름표)
- [ ] 쇼츠 자동 추출

### M3. 3단계 배포 (2~3주)

- [ ] YouTube OAuth 연결, 업로드, 썸네일, 자막, 재생목록
- [ ] 메타데이터 자동 생성 (제목·설명·챕터·태그)
- [ ] RSS 생성기 (또는 RSS.com API) + Spotify·Apple 등록
- [ ] 배포 기록·상태 화면

### M4. 운영·고도화 (상시)

- [ ] 매일 아침 자동 제작 스케줄 (뉴스 자동 수집 → 검수 알림)
- [ ] 비용 대시보드
- [ ] 모델 A/B 비교 (같은 팩트 시트로 Claude / Gemini / GPT 대본 비교)
- [ ] 립싱크 영상, 다국어 버전

---

## 17. 열린 질문

- [ ] 개인용 도구인가, 다른 사람도 쓰는 서비스(가입·결제)인가? → Claude 구독 모드 사용 가능 여부가 달라짐
- [ ] 캐릭터 그림체 기본값: 실사형 / 웹툰형 / 3D?
- [ ] 뉴스 자동 수집 출처: 포털, 언론사 RSS, 검색 API 중 무엇?
- [ ] 영상 채널과 오디오 전용 채널을 분리할 것인가?

---

## 18. 참고 링크

- Gemini API 음성 생성: https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
- Gemini 3.8 Flash-Lite TTS 모델 페이지: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts
- Gemini API 이미지 생성(Nano Banana): https://ai.google.dev/gemini-api/docs/image-generation
- YouTube Data API `videos.insert`: https://developers.google.com/youtube/v3/docs/videos/insert
- YouTube 할당량과 감사: https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- YouTube API 변경 이력: https://developers.google.com/youtube/v3/revision_history
- Spotify RSS 피드: https://support.spotify.com/bb/creators/article/your-rss-feed
- RSS.com API: https://rss.com/blog/rss-com-launches-public-api/
- Claude 요금제와 API 별도 결제: https://support.claude.com/en/articles/9876003
- Pro·Max로 Claude Code 사용: https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
- 구독으로 Agent SDK 사용(보류 공지 포함): https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- Claude Code 법률·규정: https://code.claude.com/docs/en/legal-and-compliance
