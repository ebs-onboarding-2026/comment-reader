/**
 * Turns a collected comment set into the AnalysisResult the screens render.
 *
 * Order matters: classification first (everything downstream is sentiment
 * aware), then embeddings once — reused for both topic clusters and question
 * grouping — then the written layer over the condensed result.
 */
import type {
  AnalysisMetrics,
  AnalysisResult,
  AnalysisStage,
  AnalyzedComment,
  DebateThread,
  QuestionGroup,
  RepresentativeComment,
  Sentiment,
  SentimentBreakdown,
  TimelinePoint,
  Topic,
  TopicTone,
  VideoMeta,
} from "@/lib/types";
import type { RawComment } from "@/lib/youtube";

import { batchCount, classifyAll } from "./classify";
import {
  embedAll,
  kmeans,
  representativeIndices,
  suggestClusterCount,
} from "./cluster";
import { extractKeywords } from "./keywords";
import { CLASSIFICATION_MODEL, EMBEDDING_MODEL } from "./openai";
import {
  labelQuestionGroups,
  labelRepresentatives,
  labelTopics,
  writeNarrative,
} from "./summarize";

const TIMELINE_BUCKETS = 24;
const TOPICS_SHOWN = 5;
const QUESTIONS_SHOWN = 6;
const DEBATES_SHOWN = 5;
const REPRESENTATIVES_SHOWN = 6;

export interface AnalysisProgress {
  stage: AnalysisStage;
  analyzed: number;
  batchesDone: number;
  batchesTotal: number;
}

export type AnalysisOutput = Omit<AnalysisResult, "analysisId"> & {
  comments: AnalyzedComment[];
};

export async function analyze(
  video: VideoMeta,
  raw: RawComment[],
  onProgress?: (p: AnalysisProgress) => void | Promise<void>,
): Promise<AnalysisOutput> {
  const batchesTotal = batchCount(raw.length);

  /* ------------------------------------------------------- 1. classify */

  const classified = await classifyAll(
    raw.map((c) => ({ commentId: c.commentId, text: c.text })),
    async (p) => {
      await onProgress?.({ stage: "classify", ...p });
    },
  );

  const labelById = new Map(classified.map((c) => [c.commentId, c]));

  const comments: AnalyzedComment[] = raw.map((c) => {
    const label = labelById.get(c.commentId);
    return {
      ...c,
      sentiment: label?.sentiment ?? "neutral",
      sentimentReason: label?.sentimentReason ?? "",
      topicId: null,
      isQuestion: label?.isQuestion ?? false,
    };
  });

  /* -------------------------------------------- 2. embed + topic clusters */

  await onProgress?.({
    stage: "cluster",
    analyzed: raw.length,
    batchesDone: batchesTotal,
    batchesTotal,
  });

  const vectors = await embedAll(comments.map((c) => c.text));

  const k = suggestClusterCount(comments.length);
  const { assignments, clusters } = kmeans(vectors, k);
  assignments.forEach((cluster, i) => {
    comments[i].topicId = cluster;
  });

  const topicSamples = clusters.map((members) =>
    representativeIndices(vectors, members, 3).map((i) => comments[i].text),
  );

  const topicLabels = await labelTopics(
    clusters.map((members, id) => ({
      id,
      count: members.length,
      samples: topicSamples[id],
    })),
  );

  const topics: Topic[] = clusters.map((members, id) => {
    const breakdown = countSentiment(members.map((i) => comments[i].sentiment));
    return {
      id,
      label: topicLabels[id]?.label ?? `묶음 ${id + 1}`,
      summary: topicLabels[id]?.summary ?? "",
      count: members.length,
      sentiment: breakdown,
      tone: toneOf(breakdown),
      sampleCommentIds: representativeIndices(vectors, members, 3).map(
        (i) => comments[i].commentId,
      ),
    };
  });

  /* ------------------------------------------------- 3. question grouping */

  const questionIdx = comments
    .map((c, i) => (c.isQuestion ? i : -1))
    .filter((i) => i >= 0);

  let questions: QuestionGroup[] = [];

  if (questionIdx.length > 0) {
    // Reuse the embeddings already paid for rather than re-embedding.
    const qVectors = questionIdx.map((i) => vectors[i]);
    const qK = suggestClusterCount(questionIdx.length);
    const qResult = kmeans(qVectors, qK, { seed: 7 });

    const qClusters = qResult.clusters.slice(0, QUESTIONS_SHOWN);
    const qSamples = qClusters.map((members) =>
      representativeIndices(qVectors, members, 4).map(
        (m) => comments[questionIdx[m]].text,
      ),
    );

    const qLabels = await labelQuestionGroups(
      qClusters.map((members, id) => ({
        id,
        count: members.length,
        samples: qSamples[id],
      })),
    );

    questions = qClusters.map((members, id) => ({
      id,
      representativeText: qLabels[id]?.representativeText ?? qSamples[id][0] ?? "",
      count: members.length,
      category: qLabels[id]?.category ?? "기타",
      commentIds: members.map((m) => comments[questionIdx[m]].commentId),
    }));
  }

  /* --------------------------------------------------------- 4. aggregates */

  const sentiment = countSentiment(comments.map((c) => c.sentiment));
  const metrics = computeMetrics(comments, video);
  const timeline = buildTimeline(comments, video.publishedAt);
  const keywords = extractKeywords(
    comments.map((c) => ({ text: c.text, sentiment: c.sentiment })),
  );
  const debates = buildDebates(comments);

  /* ---------------------------------------------------- 5. representatives */

  const repCandidates = topics
    .slice(0, REPRESENTATIVES_SHOWN)
    .flatMap((topic) => {
      const ids = topic.sampleCommentIds.slice(0, 1);
      return ids.map((commentId) => {
        const comment = comments.find((c) => c.commentId === commentId)!;
        return {
          commentId,
          text: comment.text,
          sentiment: comment.sentiment,
          topicLabel: topic.label,
        };
      });
    });

  const repLabels = await labelRepresentatives(repCandidates);
  const repLabelById = new Map(repLabels.map((r) => [r.commentId, r]));

  const representatives: RepresentativeComment[] = repCandidates.map((c) => {
    const comment = comments.find((x) => x.commentId === c.commentId)!;
    return {
      commentId: c.commentId,
      text: comment.text,
      author: comment.author,
      likeCount: comment.likeCount,
      sentiment: comment.sentiment,
      label: repLabelById.get(c.commentId)?.label ?? c.topicLabel,
      reason: repLabelById.get(c.commentId)?.reason ?? "",
    };
  });

  /* -------------------------------------------------------- 6. narrative */

  await onProgress?.({
    stage: "summarize",
    analyzed: raw.length,
    batchesDone: batchesTotal,
    batchesTotal,
  });

  const negativeWindow = findNegativeWindow(timeline, sentiment);

  const narrative = await writeNarrative({
    videoTitle: video.title,
    totalComments: comments.length,
    sentiment: {
      positive: sentiment.positive,
      negative: sentiment.negative,
      neutral: sentiment.neutral,
    },
    topics: topics.slice(0, TOPICS_SHOWN).map((t) => ({
      label: t.label,
      count: t.count,
      summary: t.summary,
    })),
    questions: questions.map((q) => ({
      representativeText: q.representativeText,
      count: q.count,
      category: q.category,
    })),
    topNegativeSamples: topSamples(comments, "negative", 8),
    topPositiveSamples: topSamples(comments, "positive", 8),
    negativeWindow,
  });

  return {
    video,
    summary: narrative.summary,
    actionItems: narrative.actionItems,
    metrics,
    sentiment,
    timeline,
    timelineInsight: negativeWindow ? narrative.timelineInsight : null,
    topics: topics.slice(0, TOPICS_SHOWN),
    topicClusterCount: clusters.length,
    questions,
    questionTotal: questionIdx.length,
    keywords,
    debates,
    representatives,
    commentsAnalyzed: comments.length,
    analyzedAt: new Date().toISOString(),
    models: { classification: CLASSIFICATION_MODEL, embedding: EMBEDDING_MODEL },
    comments,
  };
}

/* ------------------------------------------------------------- helpers */

function countSentiment(values: Sentiment[]): SentimentBreakdown {
  const out = { positive: 0, negative: 0, neutral: 0, total: values.length };
  for (const v of values) out[v]++;
  return out;
}

function toneOf(b: SentimentBreakdown): TopicTone {
  const polar = b.positive + b.negative;
  if (polar < Math.max(3, b.total * 0.2)) return "neutral";
  const positiveShare = b.positive / polar;
  if (positiveShare >= 0.65) return "mostly_positive";
  if (positiveShare <= 0.35) return "mostly_negative";
  return "mixed";
}

function computeMetrics(
  comments: AnalyzedComment[],
  video: VideoMeta,
): AnalysisMetrics {
  const total = comments.length;
  const replyCount = comments.filter((c) => c.isReply).length;
  const topLevelCount = total - replyCount;

  const likes = comments.map((c) => c.likeCount).sort((a, b) => a - b);
  const totalLikes = likes.reduce((a, b) => a + b, 0);
  const median = likes.length
    ? likes.length % 2
      ? likes[(likes.length - 1) / 2]
      : (likes[likes.length / 2 - 1] + likes[likes.length / 2]) / 2
    : 0;

  const topCount = Math.max(1, Math.floor(likes.length * 0.01));
  const topLikes = likes.slice(-topCount).reduce((a, b) => a + b, 0);

  return {
    totalComments: total,
    topLevelCount,
    replyCount,
    replyRatio: total ? replyCount / total : 0,
    avgLikes: total ? totalLikes / total : 0,
    medianLikes: median,
    top1PercentLikeShare: totalLikes ? topLikes / totalLikes : 0,
    engagementRate: video.viewCount ? total / video.viewCount : 0,
    // Both need data a single-video run never collects. See types.ts.
    channelAvgReplyRatio: null,
    categoryPercentile: null,
  };
}

function buildTimeline(
  comments: AnalyzedComment[],
  publishedAt: string,
): TimelinePoint[] {
  if (comments.length === 0) return [];

  const uploadMs = new Date(publishedAt).getTime();
  const offsets = comments.map((c) =>
    Math.max(0, new Date(c.publishedAt).getTime() - uploadMs),
  );
  const spanMs = Math.max(...offsets, 1);
  const bucketMs = spanMs / TIMELINE_BUCKETS;

  const buckets: AnalyzedComment[][] = Array.from(
    { length: TIMELINE_BUCKETS },
    () => [],
  );

  offsets.forEach((offset, i) => {
    const idx = Math.min(TIMELINE_BUCKETS - 1, Math.floor(offset / bucketMs));
    buckets[idx].push(comments[i]);
  });

  return buckets.map((members, i) => {
    const breakdown = countSentiment(members.map((c) => c.sentiment));
    const dominant = dominantSentiment(breakdown);
    // Show the bucket's most-liked comment on hover — the one a reader is
    // most likely to recognize as "what happened here".
    const sample = [...members].sort((a, b) => b.likeCount - a.likeCount)[0];

    return {
      hoursSinceUpload: (i * bucketMs) / 3_600_000,
      bucketStart: new Date(uploadMs + i * bucketMs).toISOString(),
      count: members.length,
      sentiment: breakdown,
      dominant,
      sampleText: sample ? sample.text.slice(0, 160) : null,
      sampleCommentId: sample?.commentId ?? null,
    };
  });
}

function dominantSentiment(b: SentimentBreakdown): Sentiment {
  if (b.total === 0) return "neutral";
  if (b.negative > b.positive && b.negative >= b.total * 0.3) return "negative";
  if (b.positive >= b.negative && b.positive >= b.total * 0.4) return "positive";
  return "neutral";
}

/**
 * The contiguous stretch where negative comments run clearly above the
 * video's own baseline — what the callout under the chart describes.
 */
function findNegativeWindow(
  timeline: TimelinePoint[],
  overall: SentimentBreakdown,
): { fromHour: number; toHour: number; negativeShare: number } | null {
  if (timeline.length === 0 || overall.total === 0) return null;

  const baseline = overall.negative / overall.total;
  const minVolume = Math.max(5, overall.total / (TIMELINE_BUCKETS * 4));

  let best: { from: number; to: number; share: number } | null = null;
  let runStart = -1;

  const isHot = (p: TimelinePoint) =>
    p.count >= minVolume &&
    p.sentiment.total > 0 &&
    p.sentiment.negative / p.sentiment.total >= baseline * 1.5;

  for (let i = 0; i <= timeline.length; i++) {
    const hot = i < timeline.length && isHot(timeline[i]);

    if (hot && runStart === -1) runStart = i;

    if (!hot && runStart !== -1) {
      const slice = timeline.slice(runStart, i);
      const neg = slice.reduce((a, p) => a + p.sentiment.negative, 0);
      const tot = slice.reduce((a, p) => a + p.sentiment.total, 0);
      const share = tot ? neg / tot : 0;

      if (slice.length >= 2 && (!best || share > best.share)) {
        best = { from: runStart, to: i - 1, share };
      }
      runStart = -1;
    }
  }

  if (!best) return null;

  return {
    fromHour: Math.round(timeline[best.from].hoursSinceUpload),
    toHour: Math.round(timeline[best.to].hoursSinceUpload),
    negativeShare: best.share,
  };
}

function buildDebates(comments: AnalyzedComment[]): DebateThread[] {
  const repliesByParent = new Map<string, AnalyzedComment[]>();
  for (const c of comments) {
    if (!c.parentId) continue;
    const list = repliesByParent.get(c.parentId) ?? [];
    list.push(c);
    repliesByParent.set(c.parentId, list);
  }

  return comments
    .filter((c) => !c.isReply && (c.replyCount ?? 0) > 0)
    .sort((a, b) => (b.replyCount ?? 0) - (a.replyCount ?? 0))
    .slice(0, DEBATES_SHOWN)
    .map((c) => {
      const replies = repliesByParent.get(c.commentId) ?? [];
      const replySentiment = countSentiment(replies.map((r) => r.sentiment));
      return {
        commentId: c.commentId,
        text: c.text,
        author: c.author,
        replyCount: c.replyCount ?? 0,
        likeCount: c.likeCount,
        publishedAt: c.publishedAt,
        splitLabel: splitLabelFor(replySentiment),
        replySentiment,
      };
    });
}

/** Derived from the replies' own sentiment mix — deterministic, and cheaper
 *  than asking the model to characterize five threads. */
function splitLabelFor(b: SentimentBreakdown): string {
  const polar = b.positive + b.negative;
  if (b.total === 0) return "답글 미수집";
  if (polar < 2) return "의견 적음";

  const positiveShare = b.positive / polar;
  if (positiveShare >= 0.7) return "공감 우세";
  if (positiveShare <= 0.3) return "반박 우세";
  return "찬반 갈림";
}

function topSamples(
  comments: AnalyzedComment[],
  sentiment: Sentiment,
  count: number,
): string[] {
  return comments
    .filter((c) => c.sentiment === sentiment)
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, count)
    .map((c) => c.text.slice(0, 200));
}
