# Voice Studio

음성 복제(성우 만들기) + TTS 웹서비스. 명세는 [doc/voice-studio-spec.md](doc/voice-studio-spec.md).

- **공급자 2종**: ElevenLabs, 네이버 CLOVA Voice
- **성우 만들기**: ElevenLabs IVC(즉시) / PVC(비동기·수 시간)
- **TTS**: 텍스트 → 음성 변환, ElevenLabs는 다운로드 / CLOVA는 재생 전용(약관)
- **배포**: Vercel

---

## 빠른 시작

```bash
npm install
# .env.local 에 키를 채운다 (아래 참고)
npm run dev
```

기본 포트 3000이 다른 프로젝트에 점유되어 있다면 `npx next dev -p 3210` 처럼 포트를 지정한다.

### 환경 변수 (`.env.local`)

| 변수 | 필요 시점 | 없을 때 동작 |
|---|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs 목록/생성/TTS | 해당 탭에서 503 + 안내 메시지 |
| `CLOVA_CLIENT_ID` / `CLOVA_CLIENT_SECRET` | CLOVA TTS | 프리셋 목록은 보이고, 변환 시 503 |
| `BLOB_READ_WRITE_TOKEN` | 성우 만들기(오디오 업로드) | 업로드 시 503 + 안내 메시지 |
| `BLOB_ACCESS` | Blob 스토어가 public일 때만 | 비우면 `private` (신규 스토어 기본값) |
| `DATABASE_URL` | 내 성우 목록 영속화 | **로컬 JSON 폴백** (`data/voices.json`) |

> 전부 서버사이드 전용이다. `NEXT_PUBLIC_` 접두사를 절대 붙이지 말 것.
> 키는 API 라우트에서만 읽히며 클라이언트 번들에 포함되지 않는다.

---

## 구조

```
app/
  page.tsx                      화면 진입점
  layout.tsx, providers.tsx     레이아웃 + TanStack Query
  api/
    upload/route.ts             Vercel Blob 클라이언트 직접 업로드 토큰 발급
    voices/route.ts             GET 목록 / POST 성우 생성
    voices/[id]/status/route.ts PVC 학습 상태 폴링
    tts/route.ts                TTS 합성 → 오디오 스트림
components/
  Studio.tsx                    공급자 탭 + 상태 오케스트레이션
  VoiceList.tsx                 성우 목록·선택 (내 성우 상단 고정, 학습중 배지)
  CreateVoicePanel.tsx          IVC/PVC 토글 + 업로드 + 권리 동의
  TtsBar.tsx                    공통 TTS 입력창 (탭 바깥)
  client-api.ts, ui.tsx
lib/
  providers/
    types.ts                    VoiceProvider 인터페이스 (핵심 추상화)
    capabilities.ts             능력 플래그 — 클라이언트에서도 읽는 순수 데이터
    elevenlabs.ts               ElevenLabs 구현체
    clova.ts, clova-speakers.ts CLOVA 구현체 + 프리셋 화자
  db/                           VoiceStore (Postgres / JSON 폴백)
  text.ts                       글자 수 제한 분할, 오디오 버퍼 결합
```

### 공급자 추상화

UI는 `Capabilities` 플래그만 보고 버튼을 켜고 끈다. 새 공급자는 `VoiceProvider`를
구현해 `lib/providers/index.ts`의 `getProvider`에 등록하면 된다.

| 기능 | ElevenLabs | CLOVA |
|---|---|---|
| 성우 만들기 | ✅ IVC + PVC | ❌ (기업 협의 안내 UI 표시) |
| 성우 선택 | 내 성우 + 라이브러리 | 프리셋 화자만 |
| TTS | ✅ (최대 5,000자) | ✅ (최대 2,000자, 초과 시 분할 호출) |
| 다운로드 | ✅ | ❌ 약관상 금지 → 재생만 |

CLOVA 경로는 서버가 응답 헤더 `X-Downloadable: 0`을 내려보내고, 클라이언트는 이를 보고
다운로드 버튼 자체를 렌더링하지 않는다. 생성 음성은 서버에 저장하지 않는다.

---

## 동작 규칙

- 공급자 탭을 전환해도 **TTS 입력 텍스트는 유지**된다. 선택된 성우·모델은 공급자별로 기억한다.
- 내가 만든 성우가 목록 상단에 고정된다.
- PVC 성우는 `status: training` 동안 "학습 중" 배지 + 선택 불가이며, 20초 간격 폴링으로 자동 갱신된다.
- 텍스트가 공급자 한도를 넘으면 글자 수 표시에 "N회 분할 호출"이 뜨고, 서버가 문장 경계로 나눠 호출한 뒤 결과를 이어붙인다.

---

## Vercel 배포

### 1. 프로젝트 연결

Vercel 대시보드 → **Add New → Project** → GitHub의 `xlevel75/voiceStudio` 임포트.
Next.js가 자동 감지되므로 빌드 설정은 건드릴 필요 없다.

CLI를 쓴다면:

```bash
npm i -g vercel
vercel link      # 프로젝트 연결
vercel           # 프리뷰 배포
vercel --prod    # 프로덕션 배포
```

### 2. 환경 변수 등록

**Settings → Environment Variables** 에서 Production/Preview 양쪽에 넣는다.

| 변수 | 필수 | 없으면 |
|---|---|---|
| `ELEVENLABS_API_KEY` | ✅ | ElevenLabs 탭 전체가 503 |
| `BLOB_READ_WRITE_TOKEN` | 성우 만들기에 필수 | 업로드 503 |
| `BLOB_ACCESS` | 스토어가 public일 때만 | 기본 `private` |
| `DATABASE_URL` | 사실상 필수 | 아래 참고 |
| `CLOVA_CLIENT_ID` / `CLOVA_CLIENT_SECRET` | CLOVA 쓸 때 | CLOVA 변환만 503 |

`NEXT_PUBLIC_` 접두사를 붙이면 브라우저로 새어 나간다. 절대 붙이지 말 것.

**ElevenLabs 키 스코프**: 최소 Voices(읽기/쓰기)와 Text to Speech가 필요하다.
PVC 슬롯 사전 점검까지 동작시키려면 **User(읽기)** 도 열어야 한다.
없어도 앱은 동작하고 사전 점검만 조용히 생략된다.

### 3. 스토리지 연결

- **Storage → Blob** 스토어 생성 후 프로젝트에 Connect → `BLOB_READ_WRITE_TOKEN` 자동 주입.
  스토어를 public으로 만들었다면 `BLOB_ACCESS=public`도 함께 넣는다.
- **Storage → Postgres**(또는 Supabase) 연결 → `DATABASE_URL` 설정.
  `voices` 테이블은 첫 요청 때 `CREATE TABLE IF NOT EXISTS`로 자동 생성된다.

> `DATABASE_URL` 없이도 앱은 뜬다. 서버리스 파일시스템이 읽기 전용이라
> JSON 폴백이 동작하지 않을 뿐이고, DB 오류는 전부 삼켜서 공급자 API 결과만으로
> 목록을 그린다. 다만 내부 id와 복제 모드가 저장되지 않아 PVC 폴링이 부정확해진다.
> 배포 환경에서는 연결하는 것을 권한다. (누락 시 함수 로그에 경고가 찍힌다.)

### 4. 배포 후 확인

1. `/` 접속 → ElevenLabs 탭에 성우 목록이 뜨는가
2. 짧은 문장 TTS 변환 → 재생 + 다운로드
3. CLOVA 탭 → 프리셋 목록이 뜨고, 변환 시 재생만 되고 다운로드 버튼이 없는가
4. 성우 만들기 → 오디오 업로드가 Blob으로 올라가는가

### 리전과 함수 제한

`vercel.json`에서 리전을 **`icn1`(서울)** 로 고정했다. CLOVA API가 국내에 있고
사용자도 국내이므로 왕복 지연이 줄어든다.

`/api/tts`와 `/api/voices`는 `maxDuration = 60`을 선언한다. 플랜별 상한이 다르므로
배포가 거부되면 이 값을 낮춘다.

### Blob 스토어 접근 모드

`BLOB_ACCESS`는 **스토어의 실제 설정과 일치해야 한다.** 불일치하면 업로드가
`Cannot use public access on a private store` 로 거부된다.

- **private** (신규 스토어 기본값): 업로드 URL을 그냥 `fetch`할 수 없다(403).
  서버는 `lib/blob.ts`의 `readBlobAsUpload()`가 Blob SDK `get()`으로 인증해 읽고,
  스트림 그대로 ElevenLabs에 넘긴다(큰 PVC 샘플을 메모리에 통째로 올리지 않는다).
- **public**: 같은 함수가 평범한 `fetch`로 읽는다.

이 값은 서버 컴포넌트(`app/page.tsx`)에서 읽어 `Studio → CreateVoicePanel`로 내려가
클라이언트 `upload()`의 `access` 인자로 쓰인다. 비밀값이 아니라 추가 왕복 없이 초기 렌더에 실린다.

오디오는 브라우저 → Blob으로 직접 올라가므로 함수 본문 4.5MB 제한에 걸리지 않는다.
`app/api/tts/route.ts`의 `maxDuration = 60`은 플랜별 상한이 다르므로 배포 전 확인할 것.

---

## 배포 전 확인 사항

- [ ] **CLOVA 약관**: 네이버 클라우드에서 본인 용도의 라이선스/약관을 직접 확인.
      현재 구현은 다운로드를 막고 재생만 허용한다.
- [ ] **CLOVA 화자 목록**: `lib/providers/clova-speakers.ts`는 널리 쓰이는 화자를 추린 것이다.
      콘솔/공식 문서에서 본인 계정이 쓸 수 있는 화자로 갱신할 것.
- [ ] **PVC 플랜**: PVC는 ElevenLabs Creator 플랜 이상이 필요하다.
- [ ] **권리 동의**: 타인 목소리 복제 시 동의가 필요하며, UI에 체크박스를 필수로 두었다.

## 아직 결정되지 않은 것 (명세 §11)

인증/로그인 여부, CLOVA 커스텀 음성 기업 협의 도입 여부, 월 사용량 기반 ElevenLabs 플랜 선택.
현재는 **단일 사용자 로컬/개인용**을 전제로 인증 없이 구현되어 있다. 다중 사용자로 가려면
`voices` 테이블에 `owner_id`를 추가하고 API 라우트에 세션 검사를 넣으면 된다.
