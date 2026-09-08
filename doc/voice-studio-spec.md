# Voice Studio — 음성 복제 + TTS 웹서비스 개발 스펙

> **이 문서의 목적**: Claude Code에게 이 프로젝트를 단계별로 구현시키기 위한 명세서.
> 아래 "작업 지시" 섹션의 Phase 순서대로 진행할 것.

---

## 1. 프로젝트 개요

사용자가 녹음된 음성을 올려 **성우(voice clone)** 를 만들고, **TTS**로 텍스트를 음성으로
변환해 **다운로드**할 수 있는 웹서비스.

- 공급자(Provider) 2종: **ElevenLabs**, **네이버 CLOVA**
- 성우 만들기 모드 2종(ElevenLabs 한정): **IVC**(Instant Voice Cloning), **PVC**(Professional Voice Cloning)
- 배포 대상: **Vercel**
- 개발 도구: Claude Code

---

## 2. ⚠️ 반드시 지켜야 할 제약 (설계 전제)

이 제약들을 무시하면 약관 위반이거나 동작하지 않는다.

### 2-1. 공급자별 능력이 비대칭이다
두 공급자를 **똑같은 기능으로 대칭 구성하면 안 된다.** 아래 표가 실제 가능 범위다.

| 기능 | ElevenLabs | CLOVA |
|---|---|---|
| 성우 만들기 (내 목소리 복제, 셀프 API) | ✅ IVC + PVC | ❌ 불가 (커스텀 화자는 기업 협의 대상) |
| 성우 선택 | ✅ 내가 만든 것 + 라이브러리 | ✅ 프리셋 음성(약 100종)만 |
| TTS 변환 | ✅ | ✅ (실시간 API 호출만 허용) |
| 결과 음성 다운로드 | ✅ | ❌ **약관상 금지** → 재생(미리듣기)만 |

### 2-2. CLOVA Voice 정책
- CLOVA Voice는 **실시간 API 호출 전용**이며, 생성 음성 파일의 **저장·편집·재사용·다운로드가 금지**된다.
  따라서 CLOVA 경로에서는 **다운로드 버튼을 제공하지 말고 브라우저 재생만** 지원한다.
- CLOVA에는 **셀프 성우 만들기 API가 없다.** CLOVA 탭의 "성우 만들기" 영역에는
  "커스텀 음성은 네이버 클라우드 기업 협의가 필요하다"는 안내 UI를 표시한다.
- 클로바노트(clovanote)는 STT(받아쓰기) 서비스로 이 프로젝트와 무관하다. 사용하지 않는다.
- CLOVA Voice API 1회 호출 최대 글자 수: **2,000자**. 긴 텍스트는 분할 호출 필요.
- ⚠️ 실제 배포 전, 사용자가 네이버 클라우드에서 본인 용도의 라이선스/약관을 직접 확인해야 함.

### 2-3. ElevenLabs 제약
- **PVC는 생성에 수 시간이 걸리는 비동기 작업**이다. 단일 요청 안에서 끝낼 수 없다.
  → 생성 요청 후 상태를 폴링하는 구조 필수.
- PVC는 **Creator 플랜 이상** 필요. IVC는 하위 플랜에서도 가능.
- 타인 목소리 복제 시 동의가 필요 → 성우 만들기 UI에 **권리 보유 동의 체크박스 필수**.

### 2-4. Vercel 제약
- 서버리스 함수 요청 본문 크기 제한(약 4.5MB). PVC용 대용량 오디오는 이를 초과한다.
  → 오디오는 **클라이언트 → Vercel Blob 직접 업로드** 후 URL만 API에 전달.
- **모든 공급자 API 키는 서버사이드에서만 사용**한다. 브라우저에 절대 노출 금지.
- 함수 실행 시간 제한은 플랜별로 다르고 변동됨 → 배포 전 현재 값 확인.

---

## 3. 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | **Next.js (App Router) + TypeScript** | Vercel 무설정 배포, 프론트+서버리스 통합 |
| UI | React + Tailwind CSS | (선택) shadcn/ui |
| 서버 상태/폴링 | TanStack Query | PVC 상태 폴링에 유용 |
| 오디오 업로드 | Vercel Blob | 4.5MB 본문 제한 우회 |
| DB (내 성우 목록) | Vercel Postgres 또는 Supabase | 두 공급자 통합 목록 저장 |
| ElevenLabs 연동 | 공식 TS SDK `@elevenlabs/elevenlabs-js` | |
| CLOVA 연동 | REST (`fetch`) | 공식 SDK 없음 |

---

## 4. 아키텍처: 공급자 추상화 레이어 (프로젝트의 핵심)

공통 인터페이스를 정의하고 공급자별 구현체가 능력 플래그와 메서드를 채운다.
UI는 능력 플래그를 보고 버튼을 켜고 끈다. 새 공급자 추가 시 구현체만 추가하면 된다.

```typescript
// lib/providers/types.ts

export type ProviderId = "elevenlabs" | "clova";
export type CloneMode = "ivc" | "pvc";
export type VoiceStatus = "ready" | "training" | "failed";

export interface Capabilities {
  canCreateVoice: boolean;   // 셀프 성우 만들기 가능?
  cloneModes: CloneMode[];   // 지원 복제 모드
  canDownload: boolean;      // 결과 음성 다운로드 허용?
  maxTextLength: number;     // TTS 1회 최대 글자 수
  models: { id: string; label: string }[]; // 선택 가능한 TTS 모델/보이스타입
}

export interface Voice {
  id: string;            // 내부 DB id
  provider: ProviderId;
  voiceId: string;       // 공급자 측 voice id
  name: string;
  mode?: CloneMode;      // 프리셋이면 undefined
  status: VoiceStatus;
  isPreset: boolean;     // CLOVA 프리셋 여부
  createdAt: string;
}

export interface CreateVoiceInput {
  name: string;
  mode: CloneMode;
  audioUrls: string[];   // Vercel Blob URL들
  consent: boolean;      // 권리 보유 동의 (필수)
}

export interface SynthesizeInput {
  voiceId: string;
  text: string;
  modelId?: string;
  // 공급자별 추가 파라미터는 구현체에서 처리
}

export interface SynthesizeResult {
  audio: ArrayBuffer | ReadableStream;
  format: "mp3" | "wav";
  downloadable: boolean; // false면 UI는 재생만
}

export interface VoiceProvider {
  id: ProviderId;
  capabilities: Capabilities;
  listVoices(): Promise<Voice[]>;
  createVoice?(input: CreateVoiceInput): Promise<Voice>; // 능력 없으면 미구현
  getVoiceStatus?(voiceId: string): Promise<VoiceStatus>; // PVC 폴링용
  synthesize(input: SynthesizeInput): Promise<SynthesizeResult>;
}
```

### 공급자별 능력 선언 (구현 시 기준값)

```typescript
// ElevenLabs
capabilities = {
  canCreateVoice: true,
  cloneModes: ["ivc", "pvc"],
  canDownload: true,
  maxTextLength: 5000,
  models: [
    { id: "eleven_multilingual_v2", label: "다국어 v2 (한국어 안정)" },
    { id: "eleven_v3", label: "v3 (표현력 최고)" },
    { id: "eleven_flash_v2_5", label: "Flash v2.5 (저지연)" },
  ],
};

// CLOVA
capabilities = {
  canCreateVoice: false,       // 셀프 성우 만들기 없음
  cloneModes: [],
  canDownload: false,          // ⚠️ 약관상 다운로드 금지 → 재생만
  maxTextLength: 2000,
  models: [ /* 프리셋 보이스 목록: nara, mijin 등 */ ],
};
```

---

## 5. 데이터 모델 (내 성우 목록)

```sql
CREATE TABLE voices (
  id          TEXT PRIMARY KEY,       -- uuid
  provider    TEXT NOT NULL,          -- 'elevenlabs' | 'clova'
  voice_id    TEXT NOT NULL,          -- 공급자 측 id
  name        TEXT NOT NULL,
  mode        TEXT,                   -- 'ivc' | 'pvc' | null(프리셋)
  status      TEXT NOT NULL,          -- 'ready' | 'training' | 'failed'
  is_preset   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- CLOVA 프리셋은 DB에 굳이 저장하지 않고 코드 상수로 둬도 됨.
- ElevenLabs에서 만든 성우만 저장하고, 목록 조회 시 공급자 API 결과와 병합해도 됨.

---

## 6. API 라우트 (서버리스, 키는 여기서만 사용)

| 메서드 & 경로 | 역할 |
|---|---|
| `POST /api/upload` | 업로드용 Vercel Blob 토큰 발급 (클라이언트 직접 업로드) |
| `GET  /api/voices?provider=` | 해당 공급자의 성우 목록 |
| `POST /api/voices` | 성우 생성 (IVC 동기 / PVC 비동기 시작) |
| `GET  /api/voices/:id/status` | PVC 학습 상태 폴링 |
| `POST /api/tts` | TTS 합성. 결과 오디오 스트림 반환 |

- `/api/tts`는 `provider`, `voiceId`, `text`, `modelId`를 받아 해당 구현체의 `synthesize` 호출.
- CLOVA 응답은 `downloadable: false`로 내려 UI가 재생만 하도록 한다.

---

## 7. UI 구조

```
┌─────────────────────────────────────────────────────────┐
│  [ ElevenLabs ] [ CLOVA ]        ← 최상위 공급자 탭         │
├───────────────┬───────────────────────────────┬─────────┤
│  성우 목록·선택  │       성우 만들기                │         │
│               │                               │         │
│ - 내 성우(상단) │  ElevenLabs일 때:              │         │
│ - 프리셋       │   · IVC/PVC 하위 토글           │         │
│ - 선택 시 강조  │   · 오디오 파일 업로드           │         │
│               │   · 권리 동의 체크박스(필수)      │         │
│               │   · [만들기] 버튼               │         │
│               │  CLOVA일 때:                   │         │
│               │   · "기업 협의 필요" 안내 표시     │         │
├───────────────┴───────────────────────────────┴─────────┤
│  TTS 입력창 (공급자 탭 바깥, 항상 공통으로 표시)              │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 텍스트 입력...                                       │   │
│  └──────────────────────────────────────────────────┘   │
│  선택된 성우: ___   모델: [▾]   [ 변환 ]  [ 재생 / 다운로드 ] │
└─────────────────────────────────────────────────────────┘
```

동작 규칙:
- 공급자 탭 전환 시 목록/만들기 영역은 해당 공급자 것으로 교체되지만, **TTS 입력 텍스트는 유지**한다.
- 성우 목록은 선택된 공급자 것만 필터링. 내가 만든 성우를 상단 고정.
- 다운로드 버튼은 `capabilities.canDownload && voice.provider !== 'clova'`일 때만 노출.
  CLOVA는 재생 버튼만.
- PVC 성우는 `status: training` 동안 목록에서 "학습 중" 배지 + 비활성 처리, 폴링으로 자동 갱신.

---

## 8. 환경 변수 (.env / Vercel 프로젝트 설정)

```
ELEVENLABS_API_KEY=
CLOVA_CLIENT_ID=            # X-NCP-APIGW-API-KEY-ID
CLOVA_CLIENT_SECRET=        # X-NCP-APIGW-API-KEY
BLOB_READ_WRITE_TOKEN=      # Vercel Blob
DATABASE_URL=               # Postgres/Supabase
```

모두 서버사이드 전용. `NEXT_PUBLIC_` 접두사 절대 붙이지 말 것.

---

## 9. 공급자 연동 참고

### ElevenLabs (TS SDK)
- IVC 생성: `client.voices.ivc.create({ name, files })` → `voice_id` 반환 (동기, 수 초)
- PVC: 대시보드/PVC 엔드포인트로 생성, 학습 완료까지 폴링 (수 시간)
- TTS: `client.textToSpeech.convert(voiceId, { text, modelId, outputFormat })`
- 한국어는 `eleven_multilingual_v2` 권장. 출력 기본 mp3.

### CLOVA Voice (REST)
- URL: `https://naveropenapi.apigw.ntruss.com/tts-premium/v1/tts`
- 헤더: `X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY`, `Content-Type: application/x-www-form-urlencoded`
- 바디: `speaker`(프리셋 보이스), `text`, `speed`, `pitch`, `emotion` 등
- 응답: 오디오 바이너리. **저장/다운로드 금지** → 서버에서 받아 즉시 클라이언트로 재생 스트림만 전달.
- 최대 2,000자. 초과 시 분할.

> API 세부 스펙·파라미터는 구현 시점에 각 공식 문서에서 최신값을 확인할 것.

---

## 10. 작업 지시 (Claude Code — 이 순서대로)

### Phase 1 — 뼈대
- [ ] Next.js(App Router) + TypeScript + Tailwind 프로젝트 생성
- [ ] `lib/providers/types.ts`에 공급자 인터페이스 정의 (섹션 4)
- [ ] 최상위 공급자 탭 + 3단 레이아웃 목업 (더미 데이터로 UI 흐름 확정)
- [ ] TTS 입력창을 탭 바깥 공통 영역에 배치

### Phase 2 — ElevenLabs TTS (가장 확실한 것부터)
- [ ] ElevenLabs 공급자 구현체 작성 (`listVoices`, `synthesize`)
- [ ] `/api/tts` 라우트 (서버사이드 키 사용)
- [ ] 프리셋/기존 보이스로 텍스트 → 음성 → 다운로드 완성

### Phase 3 — ElevenLabs 성우 만들기
- [ ] `/api/upload` + Vercel Blob 클라이언트 직접 업로드
- [ ] 성우 만들기 UI (IVC/PVC 토글, 동의 체크박스)
- [ ] IVC 동기 생성 → DB 저장 → 목록 반영
- [ ] PVC 비동기 생성 + `/api/voices/:id/status` 폴링 + "학습 중" 배지

### Phase 4 — CLOVA 연동
- [ ] CLOVA 공급자 구현체 (`listVoices`=프리셋, `synthesize`, `canDownload:false`)
- [ ] CLOVA 탭: 프리셋 선택 + TTS **재생 전용**(다운로드 버튼 숨김)
- [ ] 성우 만들기 영역에 "기업 협의 필요" 안내 UI

### Phase 5 — 마감
- [ ] 에러 처리·로딩 상태·글자 수 제한 표시
- [ ] 공급자 전환 시 TTS 텍스트 유지 확인
- [ ] 환경 변수 정리, Vercel 배포

---

## 11. 열린 결정 사항 (사용자 확인 필요)
- 인증/로그인이 필요한가, 단일 사용자 로컬용인가? (DB·성우 소유권 설계에 영향)
- CLOVA 커스텀 음성을 기업 협의로 진짜 도입할 계획인가, 아니면 프리셋만으로 충분한가?
- 예상 TTS 사용량(월 글자 수) — ElevenLabs 플랜(Creator vs Pro) 선택 기준.
