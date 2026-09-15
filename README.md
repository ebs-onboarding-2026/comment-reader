# 댓글독해

유튜브 영상 주소 하나를 넣으면 댓글 전체를 수집해 OpenAI로 분석하고, 제작자가
바로 쓸 수 있는 형태로 정리합니다.

- **수집** — YouTube Data API v3, 답글 포함, 할당량 추적
- **분석** — 감정·질문 분류(판단 근거 포함), 임베딩 군집으로 주제 묶기, 질문 통합, 요약
- **저장** — Neon Postgres (Vercel Marketplace)

## 화면

| 경로 | 화면 |
|---|---|
| `/` | URL 입력 · 영상 확인 · 수집 옵션 |
| `/jobs/[jobId]` | 수집 중 / 분석 중 / 실패 상태 |
| `/a/[analysisId]` | 분석 결과 대시보드 |
| `/a/[analysisId]/comments` | 댓글 탐색기 (필터가 주소에 남음) |
| `/history` | 지난 분석 목록 |

## 실행

```bash
npm install
vercel env pull          # Neon DATABASE_URL 등을 .env.local로
npm run db:push          # 스키마 반영
npm run dev
```

`.env.local`에 필요한 값은 `.env.example` 참고.

| 변수 | 용도 |
|---|---|
| `YOUTUBE_API_KEY` | Google Cloud Console → YouTube Data API v3 키 |
| `OPENAI_API_KEY` | OpenAI 키 |
| `OPENAI_MODEL` | 분류·요약 기본 모델 (미지정 시 `gpt-4o-mini`) |
| `OPENAI_CLASSIFICATION_MODEL` / `OPENAI_SUMMARY_MODEL` | 단계별 개별 지정 (선택) |
| `OPENAI_EMBEDDING_MODEL` | 기본 `text-embedding-3-small` |
| `DATABASE_URL` | Neon |

## 스크립트

```bash
npm run dev        # 개발 서버
npm run build      # 프로덕션 빌드
npm run smoke      # URL 파싱 · 군집 · 키워드 · 실제 YouTube 수집 점검
npm run db:push    # 스키마 반영
npm run db:check   # 테이블·인덱스·FK 확인
npm run db:studio  # Drizzle Studio
```

## 구조

```
src/
  app/
    api/                     수집·분석·조회 엔드포인트
    a/[analysisId]/          결과 + 탐색기
    jobs/[jobId]/            진행 상태
  lib/
    types.ts                 UI와의 데이터 계약 (여기부터 읽으면 됨)
    youtube.ts               Data API v3 클라이언트 (할당량·에러 분기)
    pipeline.ts              수집 → 분석 → 저장 잡 실행
    repository.ts            조회 (결과·탐색기·히스토리)
    analysis/
      classify.ts            감정·질문 분류 (배치 80, 동시 6)
      cluster.ts             임베딩 + k-means
      keywords.ts            한국어 키워드 (형태소 분석기 없이)
      summarize.ts           주제·질문 라벨, 요약, 대표 댓글
      index.ts               오케스트레이션
```

## 할당량과 비용

YouTube는 하루 **10,000 units**(태평양시 자정 리셋). 댓글 100개당 1 unit이라
댓글 1만 개 영상이 약 100 units입니다. `search.list`(100 units)는 쓰지 않습니다.

한 스레드가 수집 예산을 독차지하지 않도록 **스레드당 답글은 전체 상한의 10%,
최대 200개**로 제한합니다.

OpenAI 비용은 댓글 수천 건 기준으로 낮아, 샘플링 없이 전체를 분석합니다.

## 알려진 제약

- **채널 평균 답글 비율**, **카테고리 참여도 백분위** — 단일 영상 분석만으로는
  계산할 수 없어 `null`입니다. 지표 카드에 그렇게 표시됩니다.
- 긴 영상은 수집+분석이 수 분 걸립니다. 작업은 `after()`로 응답 이후에도
  이어지며, 진행 상황은 DB의 잡 행에 기록되므로 창을 닫아도 됩니다. 다만
  Vercel 함수 실행 시간(`maxDuration = 800`)을 넘길 규모라면 Vercel Queues나
  Workflow로 옮겨야 합니다.
- 분류 배치의 20% 넘게 실패하면 잡 전체를 실패 처리합니다. 전부 중립으로 채운
  결과를 "완료"로 내보내지 않기 위해서입니다.
- 정렬은 YouTube가 주는 `time` / `relevance` 두 가지뿐입니다.
