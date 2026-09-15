"use client";

import Link from "next/link";
import { useState } from "react";

import { num, pct, TONE_LABEL } from "@/lib/format";
import type { AnalyzedComment, TimelinePoint, Topic } from "@/lib/types";

const SENTIMENT_BAR_COLOR = {
  positive: "var(--color-positive)",
  negative: "var(--color-negative)",
  neutral: "var(--color-neutral)",
} as const;

/* ------------------------------------------------------------- timeline */

export function TimelineChart({
  points,
  insight,
}: {
  points: TimelinePoint[];
  insight: string | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.count));
  const lastHour = points.at(-1)?.hoursSinceUpload ?? 0;
  const active = hover !== null ? points[hover] : null;

  return (
    <section className="flex flex-col gap-3.5 rounded-[10px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold">댓글 유입 타임라인</h2>
        <span className="text-[11px] text-muted-3">
          업로드 후 경과 시간 · 막대에 올리면 그 시점 댓글
        </span>
      </div>

      <div className="relative flex h-[170px] items-end gap-1">
        {points.map((p, i) => (
          <button
            key={p.bucketStart}
            type="button"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            className="flex h-full flex-1 cursor-pointer flex-col justify-end"
            aria-label={`${Math.round(p.hoursSinceUpload)}시간, 댓글 ${p.count}개`}
          >
            <span
              className="rounded-t-[3px] transition-opacity"
              style={{
                height: `${Math.max(2, (p.count / max) * 100)}%`,
                background: SENTIMENT_BAR_COLOR[p.dominant],
                opacity: hover === null || hover === i ? 1 : 0.45,
              }}
            />
          </button>
        ))}

        {active && active.sampleText && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-[260px] max-w-[80vw] rounded-lg bg-ink p-3 text-canvas shadow-lg"
            style={{
              left: `${((hover! + 0.5) / points.length) * 100}%`,
              transform: `translateX(${hover! < points.length / 2 ? "-10%" : "-90%"})`,
            }}
          >
            <div className="mb-2 flex justify-between text-[11px] font-medium text-neutral">
              <span>{Math.round(active.hoursSinceUpload)}시간 후</span>
              <span>{num(active.count)}개</span>
            </div>
            <div className="text-[12px]/[1.6]">{active.sampleText}</div>
          </div>
        )}
      </div>

      <div className="flex justify-between text-[11px] text-muted-3">
        <span>0h</span>
        <span>{Math.round(lastHour * 0.25)}h</span>
        <span>{Math.round(lastHour * 0.5)}h</span>
        <span>{Math.round(lastHour * 0.75)}h</span>
        <span>{Math.round(lastHour)}h</span>
      </div>

      {insight && (
        <div className="flex items-start gap-2 rounded-lg bg-accent-soft p-3 text-[12px]/[1.6]">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
          <span>{insight}</span>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- topics */

const TOPIC_TONE_COLOR = {
  mostly_positive: "var(--color-positive)",
  mostly_negative: "var(--color-negative)",
  mixed: "var(--color-accent)",
  neutral: "var(--color-neutral)",
} as const;

export function TopicsPanel({
  analysisId,
  topics,
  clusterCount,
  samples,
  embeddingModel,
}: {
  analysisId: string;
  topics: Topic[];
  clusterCount: number;
  samples: Record<string, AnalyzedComment>;
  embeddingModel: string;
}) {
  const [open, setOpen] = useState<number | null>(topics[0]?.id ?? null);
  const max = Math.max(1, ...topics.map((t) => t.count));

  return (
    <section className="flex flex-col gap-3.5 rounded-[10px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-[14px] font-semibold">주제별 묶음</h2>
          <span className="text-[11.5px] text-muted-3">
            임베딩 군집 {clusterCount}개 중 상위 {topics.length}개 · 펼치면 실제 댓글
          </span>
        </div>
        <span className="text-[11px] font-medium text-muted-2">{embeddingModel}</span>
      </div>

      <div className="flex flex-col gap-2">
        {topics.map((t) => {
          const color = TOPIC_TONE_COLOR[t.tone];
          const expanded = open === t.id;

          return (
            <div key={t.id} className="overflow-hidden rounded-[9px] border border-line">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : t.id)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-3.5 bg-surface p-4 text-left hover:bg-canvas"
              >
                <span
                  className="h-6.5 w-2 shrink-0 rounded-sm"
                  style={{ background: color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 text-[14.5px] font-medium sm:min-w-[200px] sm:flex-none">
                  {t.label}
                </span>
                <span
                  className="shrink-0 text-[14px] font-medium"
                  style={{ color }}
                >
                  {num(t.count)}건
                </span>
                <span className="hidden h-1.5 max-w-[420px] flex-1 overflow-hidden rounded-full bg-track sm:block">
                  <span
                    className="block h-full rounded-full opacity-55"
                    style={{ width: `${(t.count / max) * 100}%`, background: color }}
                  />
                </span>
                <span className="hidden text-[11.5px] text-muted-2 md:inline">
                  {TONE_LABEL[t.tone]}
                </span>
                <span className="w-3.5 shrink-0 text-center text-[12px] text-muted-3">
                  {expanded ? "▴" : "▾"}
                </span>
              </button>

              {expanded && (
                <div className="flex flex-col gap-2 bg-panel px-4 pt-1 pb-4">
                  {t.summary && (
                    <p className="py-1 text-[12.5px]/[1.6] text-muted">{t.summary}</p>
                  )}
                  {t.sampleCommentIds.map((id) => {
                    const c = samples[id];
                    if (!c) return null;
                    return (
                      <div
                        key={id}
                        className="flex gap-3 rounded-lg border border-line-soft bg-surface p-3.5"
                      >
                        <span className="size-6 shrink-0 rounded-full bg-avatar" aria-hidden />
                        <div className="flex flex-1 flex-col gap-1.5">
                          <div className="flex items-center gap-2 text-[11px] text-muted-2">
                            <span className="font-medium text-ink">{c.author}</span>
                            <span>좋아요 {num(c.likeCount)}</span>
                          </div>
                          <div className="text-[13.5px]/[1.6]">{c.text}</div>
                        </div>
                      </div>
                    );
                  })}
                  <Link
                    href={`/a/${analysisId}/comments?topicId=${t.id}`}
                    className="self-start py-1.5 text-[12px] font-medium text-accent hover:text-accent-deep"
                  >
                    이 묶음 {num(t.count)}건 전부 보기 →
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- debates bar */

export function SplitBadge({
  label,
  positive,
  negative,
}: {
  label: string;
  positive: number;
  negative: number;
}) {
  const polar = positive + negative;
  const tone =
    polar === 0
      ? "neutral"
      : positive / polar >= 0.7
        ? "positive"
        : positive / polar <= 0.3
          ? "negative"
          : "mixed";

  const style =
    tone === "positive"
      ? { background: "var(--color-positive-tint)", color: "var(--color-positive)" }
      : tone === "negative"
        ? { background: "var(--color-accent-tint)", color: "var(--color-accent-deep)" }
        : { background: "var(--color-sunken)", color: "var(--color-muted)" };

  return (
    <span className="rounded px-1.5 py-1 text-[10.5px]" style={style}>
      {label}
    </span>
  );
}

export { pct };
