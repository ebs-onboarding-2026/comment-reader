/** Read paths for the results screen, the explorer and the history list. */
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { analyses, comments, jobs, videos } from "@/lib/db/schema";
import type {
  AnalysisResult,
  AnalyzedComment,
  CommentPage,
  CommentQuery,
  CommentWithReplies,
  HistoryEntry,
  JobStatus,
  VideoMeta,
} from "@/lib/types";
import { nextQuotaReset } from "@/lib/youtube";

const DEFAULT_PAGE_SIZE = 25;

function toVideoMeta(row: typeof videos.$inferSelect): VideoMeta {
  return {
    videoId: row.videoId,
    url: row.url,
    title: row.title,
    channelId: row.channelId,
    channelTitle: row.channelTitle,
    subscriberCount: row.subscriberCount,
    publishedAt: row.publishedAt.toISOString(),
    thumbnailUrl: row.thumbnailUrl,
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
  };
}

function toComment(row: typeof comments.$inferSelect): AnalyzedComment {
  return {
    commentId: row.commentId,
    parentId: row.parentId,
    isReply: row.isReply,
    author: row.author,
    authorChannelId: row.authorChannelId,
    text: row.text,
    likeCount: row.likeCount,
    replyCount: row.replyCount,
    publishedAt: row.publishedAt.toISOString(),
    sentiment: row.sentiment,
    sentimentReason: row.sentimentReason,
    topicId: row.topicId,
    isQuestion: row.isQuestion,
  };
}

export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  const db = getDb();

  const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!row) return null;

  let video: VideoMeta | null = null;
  if (row.videoId) {
    const [v] = await db
      .select()
      .from(videos)
      .where(eq(videos.videoId, row.videoId))
      .limit(1);
    if (v) video = toVideoMeta(v);
  }

  // Estimated from the rate actually observed so far, not a fixed guess.
  let etaSeconds: number | null = null;
  if (row.state === "collecting" && row.expected && row.collected > 0) {
    const elapsed = (Date.now() - row.startedAt.getTime()) / 1000;
    const rate = row.collected / Math.max(elapsed, 0.001);
    etaSeconds = rate > 0 ? Math.round((row.expected - row.collected) / rate) : null;
  }

  return {
    jobId: row.id,
    url: row.url,
    videoId: row.videoId,
    video,
    state: row.state,
    progress: {
      collected: row.collected,
      expected: row.expected,
      pagesFetched: row.pagesFetched,
      quotaUsed: row.quotaUsed,
      etaSeconds,
      analyzed: row.analyzed,
      batchesDone: row.batchesDone,
      batchesTotal: row.batchesTotal,
      stage: row.stage,
      collectSeconds: row.collectSeconds,
    },
    message: row.message,
    errorCode: row.errorCode,
    error: row.error,
    quotaResetsAt:
      row.errorCode === "youtube_quota" ? nextQuotaReset().toISOString() : null,
    analysisId: row.analysisId,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export async function getAnalysis(
  analysisId: string,
): Promise<AnalysisResult | null> {
  const db = getDb();

  const [row] = await db
    .select()
    .from(analyses)
    .where(eq(analyses.id, analysisId))
    .limit(1);
  if (!row) return null;

  const [video] = await db
    .select()
    .from(videos)
    .where(eq(videos.videoId, row.videoId))
    .limit(1);
  if (!video) return null;

  return {
    analysisId: row.id,
    video: toVideoMeta(video),
    summary: row.summary,
    actionItems: row.actionItems,
    metrics: row.metrics,
    sentiment: row.sentiment,
    timeline: row.timeline,
    timelineInsight: row.timelineInsight,
    topics: row.topics,
    topicClusterCount: row.topicClusterCount,
    questions: row.questions,
    questionTotal: row.questionTotal,
    keywords: row.keywords,
    debates: row.debates,
    representatives: row.representatives,
    commentsAnalyzed: row.commentsAnalyzed,
    analyzedAt: row.createdAt.toISOString(),
    models: {
      classification: row.classificationModel,
      embedding: row.embeddingModel,
    },
  };
}

/**
 * One page of the explorer.
 *
 * Filters apply to top-level comments; matching replies are attached to their
 * parent rather than listed separately, which is how the design renders a
 * thread. Facet counts are computed over the whole analysis so the sidebar
 * numbers do not change as you page.
 */
export async function getComments(
  analysisId: string,
  query: CommentQuery,
): Promise<CommentPage> {
  const db = getDb();

  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));

  const filters = [eq(comments.analysisId, analysisId)];

  // Replies are attached to parents, so the list itself is top-level only
  // unless the caller explicitly wants replies as rows.
  if (!query.includeReplies) filters.push(isNull(comments.parentId));
  if (query.sentiment) filters.push(eq(comments.sentiment, query.sentiment));
  if (query.topicId !== undefined) filters.push(eq(comments.topicId, query.topicId));
  if (query.questionsOnly) filters.push(eq(comments.isQuestion, true));
  if (query.search?.trim()) {
    filters.push(ilike(comments.text, `%${query.search.trim()}%`));
  }

  const where = and(...filters);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(comments)
    .where(where);

  const order =
    query.sort === "newest"
      ? desc(comments.publishedAt)
      : desc(comments.likeCount);

  const rows = await db
    .select()
    .from(comments)
    .where(where)
    .orderBy(order, asc(comments.commentId))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const items = rows.map(toComment);

  // Attach replies for the top-level rows on this page only.
  const parentIds = items.filter((c) => !c.isReply).map((c) => c.commentId);
  const repliesByParent = new Map<string, AnalyzedComment[]>();

  if (parentIds.length > 0) {
    const replyRows = await db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.analysisId, analysisId),
          inArray(comments.parentId, parentIds),
        ),
      )
      .orderBy(asc(comments.publishedAt));

    for (const row of replyRows) {
      const reply = toComment(row);
      const list = repliesByParent.get(reply.parentId!) ?? [];
      list.push(reply);
      repliesByParent.set(reply.parentId!, list);
    }
  }

  const withReplies: CommentWithReplies[] = items.map((c) => ({
    ...c,
    replies: repliesByParent.get(c.commentId) ?? [],
  }));

  return {
    items: withReplies,
    total: count,
    page,
    pageSize,
    facets: await getFacets(analysisId),
  };
}

async function getFacets(analysisId: string): Promise<CommentPage["facets"]> {
  const db = getDb();

  const sentimentRows = await db
    .select({
      sentiment: comments.sentiment,
      count: sql<number>`count(*)::int`,
    })
    .from(comments)
    .where(eq(comments.analysisId, analysisId))
    .groupBy(comments.sentiment);

  const breakdown = { positive: 0, negative: 0, neutral: 0, total: 0 };
  for (const row of sentimentRows) {
    breakdown[row.sentiment] = row.count;
    breakdown.total += row.count;
  }

  const [questionRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(eq(comments.analysisId, analysisId), eq(comments.isQuestion, true)));

  const topicRows = await db
    .select({ topicId: comments.topicId, count: sql<number>`count(*)::int` })
    .from(comments)
    .where(eq(comments.analysisId, analysisId))
    .groupBy(comments.topicId);

  // Topic labels live on the analysis row, not on each comment.
  const [analysisRow] = await db
    .select({ topics: analyses.topics })
    .from(analyses)
    .where(eq(analyses.id, analysisId))
    .limit(1);

  const labelById = new Map(
    (analysisRow?.topics ?? []).map((t) => [t.id, t.label]),
  );

  const topics = topicRows
    .filter((r) => r.topicId !== null)
    .map((r) => ({
      topicId: r.topicId!,
      label: labelById.get(r.topicId!) ?? `묶음 ${r.topicId! + 1}`,
      count: r.count,
    }))
    .sort((a, b) => b.count - a.count);

  return { sentiment: breakdown, topics, questions: questionRow?.count ?? 0 };
}

/**
 * Look up specific comments by id — the samples the topic rows, the timeline
 * tooltip and the representative panel refer to by id rather than duplicating.
 */
export async function getCommentsByIds(
  analysisId: string,
  ids: string[],
): Promise<Map<string, AnalyzedComment>> {
  if (ids.length === 0) return new Map();

  const db = getDb();
  const rows = await db
    .select()
    .from(comments)
    .where(
      and(eq(comments.analysisId, analysisId), inArray(comments.commentId, ids)),
    );

  return new Map(rows.map((r) => [r.commentId, toComment(r)]));
}

export async function getHistory(limit = 30): Promise<HistoryEntry[]> {
  const db = getDb();

  const rows = await db
    .select({
      analysisId: analyses.id,
      videoId: analyses.videoId,
      commentsAnalyzed: analyses.commentsAnalyzed,
      sentiment: analyses.sentiment,
      createdAt: analyses.createdAt,
      title: videos.title,
      thumbnailUrl: videos.thumbnailUrl,
      channelTitle: videos.channelTitle,
    })
    .from(analyses)
    .innerJoin(videos, eq(analyses.videoId, videos.videoId))
    .orderBy(desc(analyses.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    analysisId: r.analysisId,
    videoId: r.videoId,
    title: r.title,
    thumbnailUrl: r.thumbnailUrl,
    channelTitle: r.channelTitle,
    commentsAnalyzed: r.commentsAnalyzed,
    sentiment: r.sentiment,
    analyzedAt: r.createdAt.toISOString(),
  }));
}
