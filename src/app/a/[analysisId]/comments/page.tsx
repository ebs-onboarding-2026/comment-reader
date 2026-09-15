"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import {
  agoKo,
  num,
  SENTIMENT_COLOR,
  SENTIMENT_LABEL,
  SENTIMENT_TINT,
} from "@/lib/format";
import type { CommentPage, CommentWithReplies, Sentiment } from "@/lib/types";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-10 text-[13px] text-muted">불러오는 중…</div>}>
      <Explorer />
    </Suspense>
  );
}

function Explorer() {
  const { analysisId } = useParams<{ analysisId: string }>();
  const router = useRouter();
  const sp = useSearchParams();

  const sentiment = sp.get("sentiment") as Sentiment | null;
  const topicId = sp.get("topicId");
  const questionsOnly = sp.get("questionsOnly") === "true";
  const includeReplies = sp.get("includeReplies") === "true";
  const search = sp.get("search") ?? "";
  const sort = sp.get("sort") === "newest" ? "newest" : "likes";
  const page = Number(sp.get("page")) || 1;

  // Keyed by the query string so "is this page stale?" is derived, not tracked
  // with a setState the effect would have to fire synchronously.
  const queryKey = sp.toString();
  const [loaded, setLoaded] = useState<{ key: string; data: CommentPage } | null>(
    null,
  );
  const data = loaded?.data ?? null;
  const loading = loaded?.key !== queryKey;

  const [draft, setDraft] = useState(search);
  const [syncedSearch, setSyncedSearch] = useState(search);

  // Every filter lives in the URL, so a shared link reopens the same view.
  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      if (!("page" in patch)) next.delete("page");
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [router, sp],
  );

  // React's documented way to adjust state when a prop-like value changes:
  // during render, not in an effect. Keeps the box in step when a chip clears
  // the search from the URL.
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setDraft(search);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      if (draft !== search) setParam({ search: draft || null });
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, search, setParam]);

  useEffect(() => {
    let active = true;

    const qs = new URLSearchParams(queryKey);
    qs.set("pageSize", "25");

    fetch(`/api/analyses/${analysisId}/comments?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (active) setLoaded({ key: queryKey, data: d });
      });

    return () => {
      active = false;
    };
  }, [analysisId, queryKey]);

  const chips = [
    sentiment && {
      key: "sentiment",
      label: `감정 · ${SENTIMENT_LABEL[sentiment]}`,
    },
    topicId && {
      key: "topicId",
      label: `주제 · ${data?.facets.topics.find((t) => String(t.topicId) === topicId)?.label ?? topicId}`,
    },
    questionsOnly && { key: "questionsOnly", label: "질문만" },
    search && { key: "search", label: `검색 · ${search}` },
  ].filter(Boolean) as { key: string; label: string }[];

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="min-h-dvh bg-surface">
      <header className="flex flex-wrap items-center gap-3.5 border-b border-line px-5 py-3">
        <Link href={`/a/${analysisId}`} className="text-[12.5px] text-muted hover:text-ink">
          ← 분석 결과
        </Link>
        <span className="text-[14px] font-semibold">댓글 탐색기</span>
        <span className="text-[12px] text-muted-2">
          {num(total)} / {num(data?.facets.sentiment.total ?? 0)}
        </span>

        <div className="flex flex-1 flex-wrap justify-end gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setParam({ [c.key]: null })}
              className="flex items-center gap-1.5 rounded-[7px] bg-sunken px-2.5 py-1.5 text-[11.5px] font-medium"
            >
              {c.label} <span className="opacity-60">✕</span>
            </button>
          ))}
          {chips.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setParam({
                  sentiment: null,
                  topicId: null,
                  questionsOnly: null,
                  search: null,
                })
              }
              className="px-2.5 py-1.5 text-[11.5px] text-muted-2"
            >
              전체 해제
            </button>
          )}
        </div>
      </header>

      <div className="grid lg:grid-cols-[262px_1fr]">
        {/* filter rail */}
        <aside className="flex flex-col gap-5.5 border-b border-line bg-panel p-5 lg:border-r lg:border-b-0">
          <div className="flex h-9.5 items-center gap-2 rounded-lg border border-line bg-white px-3">
            <span className="text-muted-3" aria-hidden>
              ⌕
            </span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="댓글 내용 검색"
              className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-3"
            />
          </div>

          <div className="flex flex-col gap-2.5">
            <RailLabel>감정</RailLabel>
            {(["positive", "negative", "neutral"] as const).map((s) => {
              const active = sentiment === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setParam({ sentiment: active ? null : s })}
                  className={`flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left ${
                    active ? "bg-sunken" : "hover:bg-sunken/60"
                  }`}
                >
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ background: SENTIMENT_COLOR[s] }}
                    aria-hidden
                  />
                  <span className={`flex-1 text-[12.5px] ${active ? "font-medium" : ""}`}>
                    {SENTIMENT_LABEL[s]}
                  </span>
                  <span className="text-[11px] text-muted-2">
                    {num(data?.facets.sentiment[s] ?? 0)}
                  </span>
                </button>
              );
            })}
          </div>

          {(data?.facets.topics.length ?? 0) > 0 && (
            <div className="flex flex-col gap-2.5">
              <RailLabel>주제</RailLabel>
              {data!.facets.topics.map((t) => {
                const active = topicId === String(t.topicId);
                return (
                  <button
                    key={t.topicId}
                    type="button"
                    onClick={() =>
                      setParam({ topicId: active ? null : String(t.topicId) })
                    }
                    className={`flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left ${
                      active ? "bg-sunken" : "hover:bg-sunken/60"
                    }`}
                  >
                    <span
                      className={`size-3.5 shrink-0 rounded-[3px] border-[1.5px] ${
                        active ? "border-accent bg-accent" : "border-neutral"
                      }`}
                      aria-hidden
                    />
                    <span
                      className={`flex-1 truncate text-[12.5px] ${active ? "font-medium" : ""}`}
                    >
                      {t.label}
                    </span>
                    <span className="text-[11px] text-muted-2">{num(t.count)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <RailToggle
              label="질문만 보기"
              on={questionsOnly}
              onToggle={() => setParam({ questionsOnly: questionsOnly ? null : "true" })}
            />
            <RailToggle
              label="답글도 목록에"
              on={includeReplies}
              onToggle={() => setParam({ includeReplies: includeReplies ? null : "true" })}
            />
          </div>

          <p className="mt-auto rounded-lg bg-sunken p-3 text-[11px]/[1.6] text-muted">
            필터 상태는 주소에 남습니다. 링크를 그대로 공유하면 같은 화면이 열립니다.
          </p>
        </aside>

        {/* list */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="text-[12px] text-muted">
              {loading ? "불러오는 중…" : `${num(total)}개 중 ${data?.items.length ?? 0}개 표시`}
            </span>
            <div className="flex rounded-[7px] bg-sunken p-[3px]">
              {(["likes", "newest"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setParam({ sort: s })}
                  className={`rounded-[5px] px-3 py-1.5 text-[12px] ${
                    sort === s ? "bg-white font-medium shadow-sm" : "text-muted"
                  }`}
                >
                  {s === "likes" ? "좋아요순" : "최신순"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col px-5 pb-5">
            {!loading && data?.items.length === 0 ? (
              <p className="py-18 text-center text-[13px]/[1.7] text-muted-2">
                조건에 맞는 댓글이 없습니다.
                <br />
                필터를 하나씩 해제해 보세요.
              </p>
            ) : (
              data?.items.map((c) => (
                <CommentRow key={c.commentId} comment={c} topics={data.facets.topics} />
              ))
            )}
          </div>

          {lastPage > 1 && (
            <div className="flex items-center justify-center gap-3 border-t border-line py-4">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setParam({ page: String(page - 1) })}
                className="rounded-lg border border-line px-3 py-2 text-[12px] disabled:opacity-35"
              >
                이전
              </button>
              <span className="text-[12px] text-muted">
                {page} / {lastPage}
              </span>
              <button
                type="button"
                disabled={page >= lastPage}
                onClick={() => setParam({ page: String(page + 1) })}
                className="rounded-lg border border-line px-3 py-2 text-[12px] disabled:opacity-35"
              >
                다음
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-medium tracking-[0.08em] text-muted-2">
      {children}
    </span>
  );
}

function RailToggle({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="flex items-center justify-between"
    >
      <span className="text-[12.5px]">{label}</span>
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
    </button>
  );
}

function CommentRow({
  comment: c,
  topics,
}: {
  comment: CommentWithReplies;
  topics: { topicId: number; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const topicLabel = topics.find((t) => t.topicId === c.topicId)?.label;

  return (
    <article className="flex gap-3.5 border-b border-line-soft py-4.5">
      <span className="size-8 shrink-0 rounded-full bg-avatar" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-medium">{c.author}</span>
          <span className="text-[11px] text-muted-3">{agoKo(c.publishedAt)}</span>
          <span
            className="rounded px-1.5 py-1 text-[10.5px] font-medium"
            style={{
              background: SENTIMENT_TINT[c.sentiment],
              color: SENTIMENT_COLOR[c.sentiment],
            }}
          >
            {SENTIMENT_LABEL[c.sentiment]}
          </span>
          {topicLabel && (
            <span className="rounded bg-sunken px-1.5 py-1 text-[10.5px] text-muted">
              {topicLabel}
            </span>
          )}
          {c.isQuestion && (
            <span className="rounded bg-accent-tint px-1.5 py-1 text-[10.5px] font-medium text-accent-deep">
              질문
            </span>
          )}
        </div>

        <div className="text-[14px]/[1.7] wrap-break-word text-pretty">{c.text}</div>

        {c.sentimentReason && (
          <div className="text-[11.5px]/[1.5] text-muted-2">
            판단 근거 · {c.sentimentReason}
          </div>
        )}

        <div className="flex items-center gap-3.5">
          <span className="text-[11.5px] text-muted">♥ {num(c.likeCount)}</span>
          {c.replies.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-[11.5px] font-medium text-accent"
            >
              {open ? "답글 접기" : `답글 ${num(c.replies.length)}개 보기`}
            </button>
          )}
        </div>

        {open && c.replies.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-2.5 rounded-lg bg-panel p-3.5">
            {c.replies.map((r) => (
              <div key={r.commentId} className="flex gap-2.5">
                <span className="size-5.5 shrink-0 rounded-full bg-avatar" aria-hidden />
                <div className="flex flex-col gap-1">
                  <div className="flex gap-2 text-[11px] text-muted-2">
                    <span className="font-medium text-ink">{r.author}</span>
                    <span>{agoKo(r.publishedAt)}</span>
                  </div>
                  <div className="text-[13px]/[1.65] wrap-break-word">{r.text}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
