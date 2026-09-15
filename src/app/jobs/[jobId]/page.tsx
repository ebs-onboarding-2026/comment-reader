"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppBar } from "@/components/AppBar";
import { durationKo, num } from "@/lib/format";
import type { JobStatus } from "@/lib/types";

const POLL_MS = 1500;

export default function JobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();

  const [job, setJob] = useState<JobStatus | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const resp = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!active) return;

        if (!resp.ok) {
          setFetchError("작업을 찾을 수 없습니다.");
          return;
        }

        const data: JobStatus = await resp.json();
        setJob(data);

        if (data.state === "done" && data.analysisId) {
          router.replace(`/a/${data.analysisId}`);
          return;
        }
        if (data.state === "error") return;

        timer = setTimeout(poll, POLL_MS);
      } catch {
        if (active) timer = setTimeout(poll, POLL_MS * 2);
      }
    }

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [jobId, router]);

  return (
    <div className="min-h-dvh">
      <AppBar />
      <main className="flex justify-center px-4 py-10">
        <div className="w-full max-w-[620px]">
          {fetchError ? (
            <Panel>
              <p className="text-[13px] text-muted">{fetchError}</p>
              <HomeButton />
            </Panel>
          ) : !job ? (
            <Panel>
              <p className="text-[13px] text-muted">상태를 불러오는 중…</p>
            </Panel>
          ) : job.state === "error" ? (
            <ErrorState job={job} />
          ) : job.state === "analyzing" ? (
            <Analyzing job={job} />
          ) : (
            <Collecting job={job} />
          )}
        </div>
      </main>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5.5 rounded-[11px] border border-line bg-surface p-8">
      {children}
    </div>
  );
}

function HomeButton({ label = "다른 영상 분석" }: { label?: string }) {
  return (
    <Link
      href="/"
      className="self-start rounded-lg bg-ink px-3.5 py-2.5 text-[12.5px] font-medium text-surface"
    >
      {label}
    </Link>
  );
}

/* --------------------------------------------------------------- 1b 수집 중 */

function Collecting({ job }: { job: JobStatus }) {
  const { collected, expected, pagesFetched, quotaUsed, etaSeconds } = job.progress;
  const percent = expected ? Math.min(99, Math.round((collected / expected) * 100)) : 0;

  return (
    <Panel>
      {job.video && (
        <>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={job.video.thumbnailUrl}
              alt=""
              className="h-11 w-19 shrink-0 rounded-[5px] object-cover"
            />
            <div>
              <div className="text-[13.5px]/[1.4] font-medium">{job.video.title}</div>
              <div className="mt-1 text-[11.5px] text-muted-2">
                {job.video.channelTitle} · 댓글 {num(job.video.commentCount)}
              </div>
            </div>
          </div>
          <div className="h-px bg-line" />
        </>
      )}

      <div className="flex flex-col gap-3.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] font-semibold">1단계 · 댓글 수집 중</span>
          <span className="text-[13px] font-medium text-accent">{percent}%</span>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-track">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="flex flex-wrap justify-between gap-2 text-[12px] text-muted">
          <span>
            {num(collected)} / {num(expected)}개 수집
          </span>
          <span>
            {etaSeconds !== null ? `남은 시간 약 ${durationKo(etaSeconds)}` : "속도 측정 중"}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-[9px] bg-canvas p-4">
        <div className="flex items-center gap-2.5 text-[12.5px] text-muted">
          <span className="size-1.5 rounded-full bg-neutral" aria-hidden />
          2단계 · AI 분석 — 수집 완료 후 시작
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-[11px] text-muted-3">
          <span>YouTube API 사용량 {num(quotaUsed)} / 10,000 units</span>
          <span>페이지 {num(pagesFetched)}</span>
        </div>
      </div>

      <Link
        href="/"
        className="self-start rounded-lg border border-line bg-white px-3.5 py-2.5 text-[12.5px] font-medium text-muted"
      >
        중단하고 나가기
      </Link>
    </Panel>
  );
}

/* -------------------------------------------------------------- 1c 분석 중 */

const STAGES = [
  { key: "classify", label: "감정 · 질문 분류" },
  { key: "cluster", label: "주제 임베딩 후 군집화" },
  { key: "summarize", label: "전체 요약 생성" },
] as const;

function Analyzing({ job }: { job: JobStatus }) {
  const { analyzed, collected, batchesDone, batchesTotal, stage, collectSeconds } =
    job.progress;
  const percent = batchesTotal ? Math.round((batchesDone / batchesTotal) * 100) : 0;
  const currentIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <Panel>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-[12px] text-positive">
          <span aria-hidden>✓</span>1단계 · 수집 완료 — {num(collected)}개 (
          {durationKo(collectSeconds)})
        </div>
        <div className="my-2 h-px bg-line" />
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] font-semibold">2단계 · AI 분석 중</span>
          <span className="text-[13px] font-medium text-accent">
            배치 {num(batchesDone)} / {num(batchesTotal)}
          </span>
        </div>
      </div>

      <div className="relative h-2 overflow-hidden rounded-full bg-track">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
        <div className="animate-sweep absolute inset-y-0 w-[30%] bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.55),transparent)]" />
      </div>

      <div className="flex flex-col gap-2.5">
        {STAGES.map((s, i) => {
          const state =
            currentIndex === -1
              ? "pending"
              : i < currentIndex
                ? "done"
                : i === currentIndex
                  ? "active"
                  : "pending";
          return (
            <div
              key={s.key}
              className={`flex items-center gap-2.5 text-[12.5px] ${
                state === "pending" ? "text-muted" : ""
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  state === "active"
                    ? "animate-pulse-dot bg-accent"
                    : state === "done"
                      ? "bg-positive"
                      : "bg-neutral"
                }`}
                aria-hidden
              />
              {s.label}
              <span className="text-[11.5px] text-muted-3">
                {state === "active" && s.key === "classify"
                  ? `${num(analyzed)} / ${num(collected)}`
                  : state === "done"
                    ? "완료"
                    : state === "active"
                      ? "진행 중"
                      : "대기"}
              </span>
            </div>
          );
        })}
      </div>

      <p className="rounded-[9px] bg-canvas p-4 text-[12px]/[1.6] text-muted">
        분석이 끝나기 전에 창을 닫아도 됩니다. 완료되면 결과 링크가 그대로
        유지됩니다.
      </p>
    </Panel>
  );
}

/* -------------------------------------------------------------- 1f 실패 화면 */

function ErrorState({ job }: { job: JobStatus }) {
  const map = {
    comments_disabled: {
      mark: "⊘",
      title: "댓글이 꺼져 있습니다",
      body: "업로더가 이 영상의 댓글을 사용중지했습니다. 분석할 수 있는 댓글이 없습니다.",
    },
    no_comments: {
      mark: "0",
      title: "아직 댓글이 없습니다",
      body: "댓글이 쌓인 뒤에 다시 시도해 주세요.",
    },
    invalid_url: {
      mark: "!",
      title: "영상을 찾을 수 없습니다",
      body: "비공개·삭제된 영상이거나 주소에 오타가 있습니다.",
    },
    video_unavailable: {
      mark: "!",
      title: "영상을 찾을 수 없습니다",
      body: "비공개·삭제된 영상이거나 주소에 오타가 있습니다.",
    },
    youtube_quota: {
      mark: "⧗",
      title: "오늘 수집 한도를 다 썼습니다",
      body: "YouTube 하루 할당량 10,000 units를 모두 사용했습니다.",
    },
    openai_failed: {
      mark: "!",
      title: "분석에 실패했습니다",
      body: "AI 분석 단계에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    },
    unknown: {
      mark: "!",
      title: "문제가 생겼습니다",
      body: "알 수 없는 오류로 분석을 마치지 못했습니다.",
    },
  } as const;

  const view = map[job.errorCode ?? "unknown"] ?? map.unknown;
  const resetTime = job.quotaResetsAt
    ? new Date(job.quotaResetsAt).toLocaleTimeString("ko-KR", {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <Panel>
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <span
          className="flex size-11 items-center justify-center rounded-full bg-sunken text-[17px] text-muted"
          aria-hidden
        >
          {view.mark}
        </span>
        <h1 className="text-[17px] font-semibold">{view.title}</h1>
        <p className="max-w-[46ch] text-[13px]/[1.7] text-muted">
          {view.body}
          {resetTime && ` 한국시간 ${resetTime}에 초기화됩니다.`}
        </p>
        {job.error && (
          <p className="max-w-[52ch] rounded-lg bg-canvas px-3 py-2 text-[11.5px]/[1.6] text-muted-3">
            {job.error}
          </p>
        )}
      </div>

      <div className="flex justify-center gap-2">
        <HomeButton
          label={job.errorCode === "invalid_url" ? "주소 다시 입력" : "다른 영상 분석"}
        />
        <Link
          href="/history"
          className="rounded-lg border border-line bg-white px-3.5 py-2.5 text-[12.5px] font-medium text-muted"
        >
          이전 분석 결과 보기
        </Link>
      </div>
    </Panel>
  );
}
