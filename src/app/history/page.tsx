import Link from "next/link";

import { AppBar } from "@/components/AppBar";
import { dateTimeKo, num, pct, SENTIMENT_COLOR } from "@/lib/format";
import { getHistory } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const items = await getHistory(30);

  return (
    <div className="min-h-dvh">
      <AppBar />
      <main className="mx-auto w-full max-w-[860px] px-5 py-8">
        <h1 className="mb-5 text-[20px] font-semibold tracking-[-0.01em]">지난 분석</h1>

        {items.length === 0 ? (
          <div className="rounded-[11px] border border-line bg-surface p-10 text-center">
            <p className="text-[13px]/[1.7] text-muted">
              아직 분석한 영상이 없습니다.
            </p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-lg bg-ink px-3.5 py-2.5 text-[12.5px] font-medium text-surface"
            >
              첫 분석 시작
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {items.map((h) => (
              <li key={h.analysisId}>
                <Link
                  href={`/a/${h.analysisId}`}
                  className="flex gap-4 rounded-[10px] border border-line bg-surface p-3.5 hover:bg-panel"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={h.thumbnailUrl}
                    alt=""
                    className="h-[68px] w-30 shrink-0 rounded-md object-cover"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="truncate text-[14px] font-medium">{h.title}</div>
                    <div className="text-[11.5px] text-muted-2">
                      {h.channelTitle} · 댓글 {num(h.commentsAnalyzed)}개 ·{" "}
                      {dateTimeKo(h.analyzedAt)}
                    </div>
                    <div className="mt-auto flex h-1.5 max-w-[280px] overflow-hidden rounded-full">
                      {(["positive", "negative", "neutral"] as const).map((s) => (
                        <span
                          key={s}
                          style={{
                            width: `${h.sentiment.total ? (h.sentiment[s] / h.sentiment.total) * 100 : 0}%`,
                            background: SENTIMENT_COLOR[s],
                          }}
                        />
                      ))}
                    </div>
                    <div className="text-[11px] text-muted-3">
                      긍정 {pct(h.sentiment.total ? h.sentiment.positive / h.sentiment.total : 0, 0)}
                      {" · "}
                      부정 {pct(h.sentiment.total ? h.sentiment.negative / h.sentiment.total : 0, 0)}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
