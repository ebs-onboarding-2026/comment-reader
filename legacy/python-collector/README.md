# YouTube 댓글 분석

YouTube Data API v3로 댓글을 수집해 분석 가능한 CSV/JSONL로 떨어뜨립니다.

## 준비

1. [Google Cloud Console](https://console.cloud.google.com) → 프로젝트 생성
2. **API 및 서비스 → 라이브러리 → YouTube Data API v3 → 사용 설정**
3. **사용자 인증 정보 → API 키 만들기** (공개 댓글 읽기만 하므로 OAuth 불필요)
4. 생성된 키에 **API 제한 → YouTube Data API v3만 허용**
5. `.env.example`를 `.env`로 복사하고 키 입력

```bash
pip install -r requirements.txt
cp .env.example .env   # YOUTUBE_API_KEY=... 채우기
```

## 사용법

```bash
# 영상 지정 (URL, youtu.be, /shorts/, 11자리 ID 모두 인식)
python collect.py "https://www.youtube.com/watch?v=VIDEO_ID"

# 여러 개
python collect.py VIDEO_ID_1 VIDEO_ID_2 VIDEO_ID_3

# 채널 최신 영상 20개
python collect.py --channel @EBSCulture --limit 20

# 영상당 댓글 상한 + 답글 전체 수집
python collect.py --channel @EBSCulture --limit 50 --max-comments 500 --all-replies
```

| 옵션 | 설명 |
|---|---|
| `--channel` | 핸들(`@name`), 채널 URL, `UC...` ID |
| `--limit` | `--channel` 사용 시 최신 영상 개수 (기본 10) |
| `--order` | `time`(기본) 또는 `relevance` |
| `--max-comments` | 영상당 수집 상한 |
| `--all-replies` | 답글 전체 수집. 미지정 시 스레드당 최초 5개만 |
| `--quota` | 로컬 할당량 예산 (기본 9500) |
| `--out` | `data/` 출력 파일명 (기본 `comments`) |
| `--fresh` | 기존 출력 무시하고 처음부터 |

## 출력

- `data/<name>.csv` — 분석용 플랫 테이블 (`utf-8-sig`, Excel에서 한글 정상)
- `data/<name>.jsonl` — 동일 데이터, 한 줄당 한 댓글
- `data/<name>_videos.csv` — 영상 메타데이터 (제목/조회수/좋아요/댓글수)

CSV 컬럼: `comment_id`, `video_id`, `parent_id`, `is_reply`, `author`,
`author_channel_id`, `text`, `like_count`, `reply_count`, `published_at`, `updated_at`

## 할당량

기본 **하루 10,000 units**, 태평양시 자정 리셋.

| 호출 | 비용 | 비고 |
|---|---|---|
| `commentThreads.list` | 1 | 댓글 100개/호출 |
| `comments.list` | 1 | 답글 100개/호출 |
| `videos.list` | 1 | 영상 50개/호출 |
| `playlistItems.list` | 1 | 영상 ID 50개/호출 |
| `channels.list` | 1 | |
| `search.list` | **100** | 이 프로젝트에서 미사용 |

채널 영상 목록은 `search.list`(100 units) 대신 업로드 재생목록 `playlistItems.list`(1 unit)로
가져옵니다. 100배 차이라 채널 단위 수집에서 결정적입니다.

**할당량이 떨어지면** 스크립트가 진행분을 저장하고 종료 코드 2로 멈춥니다.
다음 날 같은 명령을 `--fresh` 없이 다시 실행하면 이미 수집한 영상은 건너뛰고 이어서 받습니다.

## 알아둘 API 제약

- 댓글 사용중지 영상은 403 `commentsDisabled` → 자동 스킵 (통계에 `commentCount`가 아예 없음)
- 비공개/삭제 영상은 메타데이터 조회에서 빠짐 → 자동 스킵
- 정렬은 `time` / `relevance` 2가지뿐, 좋아요순 전체 정렬 불가
- 삭제·스팸 처리된 댓글은 응답에 없음 → 실제 `commentCount`보다 적게 걷힐 수 있음
- `commentThreads`는 답글을 최대 5개만 포함 → 전체는 `--all-replies` 필요
- 한국어 Windows 콘솔(cp949)은 이모지에서 죽으므로 스크립트가 stdout을 UTF-8로 강제

## 보안

`.env`는 `.gitignore`에 있습니다. API 키를 코드나 커밋에 넣지 마세요.
키가 노출됐다면 콘솔에서 삭제 후 재발급하세요.
