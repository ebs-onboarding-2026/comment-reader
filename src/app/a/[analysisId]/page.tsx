import Link from "next/link";
import { notFound } from "next/navigation";

import { SplitBadge, TimelineChart, TopicsPanel } from "@/components/results/Interactive";
import {
  ACTION_LABEL,
  dateTimeKo,
  num,
  pct,
  SENTIMENT_COLOR,
  SENTIMENT_LABEL,
} from "@/lib/format";
import { getAnalysis, getCommentsByIds } from "@/lib/repository";
import type { AnalyzedComment, Sentiment } from "@/lib/types";

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  const result = await getAnalysis(analysisId);
  if (!result) notFound();

  // Topic rows, the timeline tooltip and the representatives all point at
  // comments by id; fetch that set once.
  const referenced = [
    ...result.topics.flatMap((t) => t.sampleCommentIds),
    ...result.representatives.map((r) => r.commentId),
  ];
  const sampleMap = await getCommentsByIds(analysisId, referenced);
  const samples = Object.fromEntries(sampleMap) as Record<string, AnalyzedComment>;

  const { video, metrics, sentiment } = result;

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={video.thumbnailUrl}
            alt=""
            className="h-[30px] w-[52px] shrink-0 rounded object-cover"
          />
          <div className="min-w-0">
            <div className="truncate text-[13px]/[1.3] font-medium">{video.title}</div>
            <div className="mt-0.5 text-[11px] text-muted-2">
              {video.channelTitle} · 댓글 {num(result.commentsAnalyzed)}개 분석 ·{" "}
              {dateTimeKo(result.analyzedAt)}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href="/"
            className="rounded-lg border border-line bg-white px-3.5 py-2.5 text-[12px] font-medium"
          >
            새 분석
          </Link>
          <Link
            href={`/a/${analysisId}/comments`}
            className="rounded-lg bg-ink px-3.5 py-2.5 text-[12px] font-medium text-surface"
          >
            댓글 탐색기
          </Link>
        </div>
      </header>

      <main className="flex flex-col gap-6.5 px-5 py-7">
        {/* AI summary first — the panel people actually came to read. */}
        <section className="flex flex-col gap-4 rounded-[11px] border border-line bg-surface p-6.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10.5px] font-medium tracking-[0.09em] text-muted-2">
              AI 요약 — 댓글 {num(result.commentsAnalyzed)}개 전체를 읽고 작성
            </span>
            <span className="text-[11px] text-muted-3">
              {result.models.classification}
            </span>
          </div>
          <div className="flex gap-4.5">
            <span className="w-[3px] shrink-0 rounded-sm bg-accent" aria-hidden />
            <p className="max-w-[92ch] text-[clamp(15px,2.2vw,19px)]/[1.75] tracking-[-0.01em] text-pretty">
              {result.summary}
            </p>
          </div>
          {result.actionItems.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {result.actionItems.map((a, i) => (
                <span
                  key={i}
                  className="rounded-[7px] bg-sunken px-2.5 py-1.5 text-[12px] font-medium"
                >
                  {ACTION_LABEL[a.kind]} · {a.text}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* metrics */}
        <section className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            label="총 댓글 수"
            value={num(metrics.totalComments)}
            sub={`원댓글 ${num(metrics.topLevelCount)} · 답글 ${num(metrics.replyCount)}`}
          />
          <Tile
            label="답글 비율"
            value={pct(metrics.replyRatio)}
            sub={
              metrics.channelAvgReplyRatio === null
                ? "채널 평균은 채널 단위 분석에서 제공"
                : `채널 평균 ${pct(metrics.channelAvgReplyRatio)} 대비`
            }
          />
          <Tile
            label="평균 좋아요"
            value={metrics.avgLikes.toFixed(1)}
            sub={`중앙값 ${num(metrics.medianLikes)} · 상위 1%가 ${pct(metrics.top1PercentLikeShare, 0)} 차지`}
          />
          <Tile
            label="댓글 / 조회 (참여도)"
            value={pct(metrics.engagementRate, 2)}
            sub={
              metrics.categoryPercentile === null
                ? "카테고리 비교 기준 없음"
                : `동일 카테고리 상위 ${pct(metrics.categoryPercentile, 0)}`
            }
          />
        </section>

        <div className="grid gap-4.5 lg:grid-cols-[1fr_1.35fr]">
          {/* sentiment */}
          <section className="flex flex-col gap-4 rounded-[10px] border border-line bg-surface p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[14px] font-semibold">감정 분포</h2>
              <span className="text-[11px] text-muted-3">클릭하면 해당 댓글만 보기</span>
            </div>

            <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
              {(["positive", "negative", "neutral"] as const).map((s) => (
                <span
                  key={s}
                  style={{
                    width: `${sentiment.total ? (sentiment[s] / sentiment.total) * 100 : 0}%`,
                    background: SENTIMENT_COLOR[s],
                  }}
                />
              ))}
            </div>

            <div className="flex flex-col gap-0.5">
              {(["positive", "negative", "neutral"] as const).map((s) => (
                <Link
                  key={s}
                  href={`/a/${analysisId}/comments?sentiment=${s}`}
                  className="flex items-center gap-3 rounded-lg px-2.5 py-3 hover:bg-[#f1f1f3]"
                >
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ background: SENTIMENT_COLOR[s] }}
                    aria-hidden
                  />
                  <span className="flex-1 text-[13px] font-medium">
                    {SENTIMENT_LABEL[s]}
                  </span>
                  <span className="text-[13px] font-medium">
                    {pct(sentiment.total ? sentiment[s] / sentiment.total : 0)}
                  </span>
                  <span className="w-16 text-right text-[12px] text-muted-2">
                    {num(sentiment[s])}건
                  </span>
                  <span className="text-[13px] text-muted-3" aria-hidden>
                    →
                  </span>
                </Link>
              ))}
            </div>

            <p className="rounded-lg bg-canvas px-3.5 py-3 text-[11.5px]/[1.65] text-muted">
              비꼼·반어는 규칙 기반으로 잡히지 않습니다. 모든 댓글에{" "}
              <b className="font-semibold text-ink">판단 근거 한 줄</b>이 함께
              붙습니다.
            </p>
          </section>

          <TimelineChart points={result.timeline} insight={result.timelineInsight} />
        </div>

        <TopicsPanel
          analysisId={analysisId}
          topics={result.topics}
          clusterCount={result.topicClusterCount}
          samples={samples}
          embeddingModel={result.models.embedding}
        />

        <div className="grid gap-4.5 lg:grid-cols-[1.1fr_1fr]">
          {/* questions */}
          <section className="flex flex-col gap-3.5 rounded-[10px] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-[14px] font-semibold">시청자 질문 모음</h2>
                <span className="text-[11.5px] text-muted-3">같은 뜻끼리 합쳐 빈도순</span>
              </div>
              <span className="text-[11px] font-medium text-muted-2">
                질문 {num(result.questionTotal)}건
              </span>
            </div>

            {result.questions.length === 0 ? (
              <Empty>질문으로 분류된 댓글이 없습니다.</Empty>
            ) : (
              <div className="flex flex-col gap-0.5">
                {result.questions.map((q) => (
                  <Link
                    key={q.id}
                    href={`/a/${analysisId}/comments?questionsOnly=true`}
                    className="flex items-center gap-3.5 rounded-lg px-2.5 py-3 hover:bg-[#f1f1f3]"
                  >
                    <span className="w-11 shrink-0 text-[14px] font-semibold text-accent">
                      {num(q.count)}
                    </span>
                    <span className="flex-1 text-[13.5px]/[1.5]">
                      {q.representativeText}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-3">
                      {q.category}
                    </span>
                  </Link>
                ))}
              </div>
            )}

            <Link
              href={`/a/${analysisId}/comments?questionsOnly=true`}
              className="self-start py-1 text-[12px] font-medium text-accent hover:text-accent-deep"
            >
              질문만 필터로 전체 보기 →
            </Link>
          </section>

          {/* keywords */}
          <section className="flex flex-col gap-3.5 rounded-[10px] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-[14px] font-semibold">
                키워드 상위 {result.keywords.length}
              </h2>
              <span className="text-[11.5px] text-muted-3">색은 주로 쓰인 맥락</span>
            </div>

            {result.keywords.length === 0 ? (
              <Empty>반복된 키워드가 없습니다.</Empty>
            ) : (
              <div className="grid gap-x-5.5 gap-y-1.5 sm:grid-cols-2">
                {result.keywords.map((k) => {
                  const max = Math.max(...result.keywords.map((x) => x.count));
                  const color =
                    k.context === "positive"
                      ? "var(--color-positive)"
                      : k.context === "negative"
                        ? "var(--color-negative)"
                        : "var(--color-neutral)";
                  return (
                    <div key={k.term} className="flex items-center gap-2.5 py-1">
                      <span className="w-18 shrink-0 truncate text-right text-[12.5px]">
                        {k.term}
                      </span>
                      <span className="h-3.5 flex-1 overflow-hidden rounded-sm bg-sunken">
                        <span
                          className="block h-full opacity-80"
                          style={{ width: `${(k.count / max) * 100}%`, background: color }}
                        />
                      </span>
                      <span className="w-8 shrink-0 text-right text-[11px] text-muted-2">
                        {k.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-4 pt-1 text-[11px] text-muted-2">
              <Legend color="var(--color-positive)">긍정 맥락</Legend>
              <Legend color="var(--color-negative)">부정 맥락</Legend>
              <Legend color="var(--color-neutral)">중립·혼재</Legend>
            </div>
          </section>
        </div>

        <div className="grid gap-4.5 lg:grid-cols-2">
          {/* debates */}
          <section className="flex flex-col gap-3.5 rounded-[10px] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h2 className="text-[14px] font-semibold">논쟁 스레드</h2>
              <span className="text-[11.5px] text-muted-3">
                답글 수 상위 {result.debates.length} — 의견이 갈린 지점
              </span>
            </div>

            {result.debates.length === 0 ? (
              <Empty>답글이 달린 댓글이 없습니다.</Empty>
            ) : (
              <div className="flex flex-col gap-2.5">
                {result.debates.map((d) => (
                  <div
                    key={d.commentId}
                    className="flex gap-3.5 rounded-[9px] border border-line p-3.5"
                  >
                    <div className="flex w-11 shrink-0 flex-col items-center gap-1">
                      <span className="text-[16px] font-semibold">{num(d.replyCount)}</span>
                      <span className="text-[9.5px] text-muted-3">답글</span>
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5">
                      <div className="text-[13.5px]/[1.55] line-clamp-3">{d.text}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <SplitBadge
                          label={d.splitLabel}
                          positive={d.replySentiment.positive}
                          negative={d.replySentiment.negative}
                        />
                        <span className="text-[11px] text-muted-2">{d.author}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* representatives */}
          <section className="flex flex-col gap-3.5 rounded-[10px] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h2 className="text-[14px] font-semibold">대표 댓글</h2>
              <span className="text-[11.5px] text-muted-3">
                좋아요순이 아니라 그 그룹을 가장 잘 대변하는 댓글
              </span>
            </div>

            {result.representatives.length === 0 ? (
              <Empty>대표 댓글을 뽑을 만한 묶음이 없습니다.</Empty>
            ) : (
              <div className="flex flex-col gap-2.5">
                {result.representatives.map((r) => (
                  <div
                    key={r.commentId}
                    className="flex gap-3 rounded-r-lg border-l-[3px] p-3.5"
                    style={{
                      borderColor: SENTIMENT_COLOR[r.sentiment as Sentiment],
                      background:
                        r.sentiment === "positive"
                          ? "var(--color-positive-tint)"
                          : r.sentiment === "negative"
                            ? "var(--color-accent-tint)"
                            : "var(--color-canvas)",
                    }}
                  >
                    <div className="flex flex-1 flex-col gap-1.5">
                      <div className="text-[13.5px]/[1.6]">{r.text}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="text-[10.5px] font-medium"
                          style={{ color: SENTIMENT_COLOR[r.sentiment as Sentiment] }}
                        >
                          {r.label}
                        </span>
                        {r.reason && (
                          <span className="text-[11px]/[1.5] text-muted">
                            근거 · {r.reason}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-2">
                      ♥ {num(r.likeCount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface px-5 py-4.5">
      <span className="text-[10.5px] font-medium tracking-[0.07em] text-muted-2">
        {label}
      </span>
      <span className="text-[30px]/[1] font-medium tracking-[-0.02em]">{value}</span>
      <span className="text-[11.5px] text-muted">{sub}</span>
    </div>
  );
}

function Legend({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2 rounded-sm" style={{ background: color }} aria-hidden />
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-8 text-center text-[12.5px] text-muted-2">{children}</p>
  );
}
