"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AppBar } from "@/components/AppBar";
import { compactKo, dateKo, num } from "@/lib/format";
import type { CollectOrder, VideoMeta } from "@/lib/types";

type Cap = "all" | 1000 | 3000;

export default function HomePage() {
  const router = useRouter();

  const [url, setUrl] = useState("");
  const [cap, setCap] = useState<Cap>("all");
  const [order, setOrder] = useState<CollectOrder>("relevance");
  const [includeReplies, setIncludeReplies] = useState(true);

  const [video, setVideo] = useState<VideoMeta | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [starting, setStarting] = useState(false);

  // Clearing the field is a user event, so the reset belongs here rather than
  // in the effect below — setState in an effect body cascades renders.
  function onUrlChange(value: string) {
    setUrl(value);
    if (!value.trim()) {
      setVideo(null);
      setLookupError(null);
      setLooking(false);
    }
  }

  // Resolve the pasted URL as it settles, so the card appears without a button.
  const requestRef = useRef(0);
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) return;

    const mine = ++requestRef.current;
    const timer = setTimeout(async () => {
      setLooking(true);
      try {
        const resp = await fetch(`/api/preview?url=${encodeURIComponent(trimmed)}`);
        const data = await resp.json();
        if (mine !== requestRef.current) return;

        if (resp.ok) {
          setVideo(data.video);
          setLookupError(null);
        } else {
          setVideo(null);
          setLookupError(data.error ?? "영상을 찾을 수 없습니다.");
        }
      } catch {
        if (mine === requestRef.current) {
          setVideo(null);
          setLookupError("영상 정보를 불러오지 못했습니다.");
        }
      } finally {
        if (mine === requestRef.current) setLooking(false);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [url]);

  const commentsOff = video !== null && video.commentCount === null;
  const noComments = video?.commentCount === 0;
  const canStart = video !== null && !commentsOff && !noComments && !starting;

  async function start() {
    if (!canStart) return;
    setStarting(true);
    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          maxComments: cap === "all" ? null : cap,
          order,
          includeReplies,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "시작하지 못했습니다.");
      router.push(`/jobs/${data.jobId}`);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppBar
        right={
          <Link href="/history" className="text-[12px] text-muted-2 hover:text-ink">
            지난 분석
          </Link>
        }
      />

      {/* flex-1 so the gradient runs to the bottom of the viewport instead of
          ending in a hard edge partway down a tall window. */}
      <main className="flex-1 bg-[linear-gradient(#f7f7f8,#fcfcfd)] px-4 py-10 sm:py-13">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6.5">
          <div className="flex flex-col gap-2.5">
            <h1 className="text-[clamp(22px,5vw,30px)]/[1.32] font-semibold tracking-[-0.02em] text-balance">
              링크 하나면 댓글을 전부 읽어 정리해 드립니다
            </h1>
            <p className="text-[14px]/[1.6] text-muted">
              watch · youtu.be · shorts 주소를 모두 지원합니다. 샘플링 없이{" "}
              <b className="font-semibold text-ink">전체 댓글</b>을 분석합니다.
            </p>
          </div>

          <div className="flex gap-2.5">
            <div className="flex h-13 flex-1 items-center gap-2.5 rounded-[9px] border-[1.5px] border-accent bg-white px-4 shadow-[0_0_0_4px_oklch(0.56_0.16_32/.10)]">
              <label htmlFor="url" className="text-[11px] font-medium text-muted-3">
                URL
              </label>
              <input
                id="url"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && start()}
                placeholder="https://youtu.be/..."
                autoFocus
                className="w-full bg-transparent text-[14.5px] outline-none placeholder:text-muted-3"
              />
            </div>
            <button
              type="button"
              onClick={() => onUrlChange("")}
              className="h-13 shrink-0 rounded-[9px] border border-line bg-white px-4.5 text-[13px] font-medium text-muted hover:bg-panel"
            >
              지우기
            </button>
          </div>

          <VideoCard
            video={video}
            looking={looking}
            error={lookupError}
            commentsOff={commentsOff}
            noComments={!!noComments}
          />

          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field label="댓글 수 상한">
              <Segmented
                options={[
                  { value: "all", label: "전체" },
                  { value: 1000, label: "1000" },
                  { value: 3000, label: "3000" },
                ]}
                value={cap}
                onChange={(v) => setCap(v as Cap)}
              />
            </Field>

            <Field label="정렬">
              <Segmented
                options={[
                  { value: "time", label: "최신순" },
                  { value: "relevance", label: "인기순" },
                ]}
                value={order}
                onChange={(v) => setOrder(v as CollectOrder)}
              />
            </Field>

            <Field label="답글">
              <button
                type="button"
                role="switch"
                aria-checked={includeReplies}
                onClick={() => setIncludeReplies((v) => !v)}
                className="flex h-[37px] items-center justify-between rounded-lg border border-line bg-white px-3 text-[12.5px]"
              >
                <span>답글도 함께 수집</span>
                <Toggle on={includeReplies} />
              </button>
            </Field>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={start}
              disabled={!canStart}
              className="h-13.5 rounded-[9px] bg-ink text-[15px] font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-35"
            >
              {starting
                ? "시작하는 중…"
                : video && video.commentCount
                  ? `댓글 ${num(video.commentCount)}개 분석 시작`
                  : "분석 시작"}
            </button>
            <p className="text-center text-[11.5px]/[1.5] text-muted-3">
              예상 소요 2~4분 · 수집과 분석이 순차로 진행됩니다
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11.5px] font-medium text-muted">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-line bg-sunken p-[3px]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-md py-2 text-[12.5px] ${
              active
                ? "bg-white font-medium shadow-[0_1px_2px_rgb(23_23_26/0.08)]"
                : "text-muted"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`relative inline-block h-5 w-[34px] rounded-full transition-colors ${
        on ? "bg-accent" : "bg-neutral"
      }`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-all ${
          on ? "left-[16px]" : "left-0.5"
        }`}
      />
    </span>
  );
}

function VideoCard({
  video,
  looking,
  error,
  commentsOff,
  noComments,
}: {
  video: VideoMeta | null;
  looking: boolean;
  error: string | null;
  commentsOff: boolean;
  noComments: boolean;
}) {
  if (!video && !looking && !error) return null;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] font-medium tracking-[0.08em] text-muted-2">
          {error ? "NOT FOUND" : looking && !video ? "LOOKING UP" : "VIDEO FOUND"}
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>

      {error ? (
        <p className="rounded-[10px] border border-line bg-white p-4 text-[13px]/[1.6] text-muted">
          {error}
        </p>
      ) : !video ? (
        <div className="flex gap-4.5 rounded-[10px] border border-line bg-white p-4">
          <div className="h-32 w-57 shrink-0 animate-pulse rounded-[7px] bg-avatar" />
          <div className="flex flex-1 flex-col gap-2.5 pt-1">
            <div className="h-4 w-3/4 animate-pulse rounded bg-avatar" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-avatar" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-white p-4 sm:flex-row sm:gap-4.5">
          {/* Thumbnails come straight from i.ytimg.com; no optimizer needed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={video.thumbnailUrl}
            alt=""
            className="aspect-video w-full rounded-[7px] object-cover sm:w-57"
          />
          <div className="flex flex-1 flex-col gap-2 pt-0.5">
            <div className="text-[17px]/[1.45] font-semibold tracking-[-0.01em]">
              {video.title}
            </div>
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <span className="size-5 rounded-full bg-avatar" aria-hidden />
              {video.channelTitle}
              {video.subscriberCount !== null &&
                ` · 구독자 ${compactKo(video.subscriberCount)}`}
            </div>
            <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
              <span>{dateKo(video.publishedAt)} 업로드</span>
              <span className="text-line" aria-hidden>
                |
              </span>
              <span>조회 {num(video.viewCount)}</span>
              <span className="text-line" aria-hidden>
                |
              </span>
              <span className="font-medium text-ink">
                {commentsOff
                  ? "댓글 사용중지"
                  : `댓글 ${num(video.commentCount)}`}
              </span>
            </div>
            {(commentsOff || noComments) && (
              <p className="text-[12px] text-accent-deep">
                {commentsOff
                  ? "업로더가 댓글을 꺼두어 분석할 수 없습니다."
                  : "아직 댓글이 없어 분석할 수 없습니다."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
