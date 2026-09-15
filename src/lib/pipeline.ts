/**
 * The collect-then-analyze run behind a job row.
 *
 * The progress screens promise that closing the tab is safe, so this never
 * depends on the client staying connected: every step writes its progress to
 * the job row, and the result is persisted before the job is marked done.
 */
import { eq } from "drizzle-orm";

import { analyze } from "@/lib/analysis";
import { getDb } from "@/lib/db";
import { analyses, comments as commentsTable, jobs, videos } from "@/lib/db/schema";
import type { AnalyzeRequest, JobErrorCode } from "@/lib/types";
import {
  YouTubeClient,
  YouTubeError,
  nextQuotaReset,
  parseVideoId,
} from "@/lib/youtube";

/** Neon's HTTP driver caps statement size; comments go in at this width. */
const INSERT_CHUNK = 500;

/** Throttle job-row writes so a fast collection does not spend its time
 *  writing progress rows. */
const PROGRESS_INTERVAL_MS = 700;

export async function createJob(req: AnalyzeRequest): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(jobs)
    .values({
      url: req.url,
      state: "queued",
      maxComments: req.maxComments,
      order: req.order,
      includeReplies: req.includeReplies,
      message: "대기 중",
    })
    .returning({ id: jobs.id });

  return row.id;
}

export async function runJob(jobId: string, req: AnalyzeRequest): Promise<void> {
  const db = getDb();

  let lastWrite = 0;
  const touch = async (
    patch: Partial<typeof jobs.$inferInsert>,
    { force = false } = {},
  ) => {
    const now = Date.now();
    if (!force && now - lastWrite < PROGRESS_INTERVAL_MS) return;
    lastWrite = now;
    await db
      .update(jobs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
  };

  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) throw new Error("YOUTUBE_API_KEY가 설정되지 않았습니다.");

    const videoId = parseVideoId(req.url);
    const client = new YouTubeClient(apiKey);

    /* ------------------------------------------------------ metadata */

    await touch(
      { state: "collecting", videoId, message: "영상 정보를 가져오는 중" },
      { force: true },
    );

    const video = await client.getVideo(videoId, req.url);

    if (video.commentCount === null) {
      throw new YouTubeError(
        "comments_disabled",
        "업로더가 이 영상의 댓글을 사용중지했습니다.",
      );
    }
    if (video.commentCount === 0) {
      await failJob(jobId, "no_comments", "아직 댓글이 없습니다.");
      return;
    }

    await db
      .insert(videos)
      .values({
        videoId: video.videoId,
        url: video.url,
        title: video.title,
        channelId: video.channelId,
        channelTitle: video.channelTitle,
        subscriberCount: video.subscriberCount,
        publishedAt: new Date(video.publishedAt),
        thumbnailUrl: video.thumbnailUrl,
        viewCount: video.viewCount,
        likeCount: video.likeCount,
        commentCount: video.commentCount,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: videos.videoId,
        set: {
          title: video.title,
          viewCount: video.viewCount,
          likeCount: video.likeCount,
          commentCount: video.commentCount,
          subscriberCount: video.subscriberCount,
          fetchedAt: new Date(),
        },
      });

    await touch(
      {
        expected: video.commentCount,
        quotaUsed: client.quotaUsed,
        message: "댓글 수집 중",
      },
      { force: true },
    );

    /* ------------------------------------------------------- collect */

    const collectStart = Date.now();
    let lastProgress = { collected: 0, pagesFetched: 0, quotaUsed: 0 };

    const raw = await client.collectComments(videoId, {
      order: req.order,
      maxComments: req.maxComments,
      includeReplies: req.includeReplies,
      onProgress: async (p) => {
        lastProgress = p;
        await touch({
          collected: p.collected,
          pagesFetched: p.pagesFetched,
          quotaUsed: p.quotaUsed,
          message: "댓글 수집 중",
        });
      },
    });

    const collectSeconds = (Date.now() - collectStart) / 1000;

    if (raw.length === 0) {
      await failJob(jobId, "no_comments", "수집된 댓글이 없습니다.");
      return;
    }

    /* ------------------------------------------------------- analyze */

    await touch(
      {
        state: "analyzing",
        collected: raw.length,
        // A collection fast enough to finish inside one throttle window never
        // wrote its page count, so carry the final tally here.
        pagesFetched: lastProgress.pagesFetched,
        collectSeconds,
        quotaUsed: client.quotaUsed,
        stage: "classify",
        message: "AI 분석 중",
      },
      { force: true },
    );

    const result = await analyze(video, raw, async (p) => {
      await touch({
        stage: p.stage,
        analyzed: p.analyzed,
        batchesDone: p.batchesDone,
        batchesTotal: p.batchesTotal,
      });
    });

    /* ------------------------------------------------------ persist */

    const [analysis] = await db
      .insert(analyses)
      .values({
        videoId: video.videoId,
        summary: result.summary,
        actionItems: result.actionItems,
        metrics: result.metrics,
        sentiment: result.sentiment,
        timeline: result.timeline,
        timelineInsight: result.timelineInsight,
        topics: result.topics,
        topicClusterCount: result.topicClusterCount,
        questions: result.questions,
        questionTotal: result.questionTotal,
        keywords: result.keywords,
        debates: result.debates,
        representatives: result.representatives,
        commentsAnalyzed: result.commentsAnalyzed,
        classificationModel: result.models.classification,
        embeddingModel: result.models.embedding,
      })
      .returning({ id: analyses.id });

    for (let i = 0; i < result.comments.length; i += INSERT_CHUNK) {
      const chunk = result.comments.slice(i, i + INSERT_CHUNK);
      await db.insert(commentsTable).values(
        chunk.map((c) => ({
          analysisId: analysis.id,
          commentId: c.commentId,
          parentId: c.parentId,
          isReply: c.isReply,
          author: c.author,
          authorChannelId: c.authorChannelId,
          text: c.text,
          likeCount: c.likeCount,
          replyCount: c.replyCount,
          publishedAt: new Date(c.publishedAt),
          sentiment: c.sentiment,
          sentimentReason: c.sentimentReason,
          topicId: c.topicId,
          isQuestion: c.isQuestion,
        })),
      );
    }

    await db
      .update(jobs)
      .set({
        state: "done",
        analysisId: analysis.id,
        analyzed: result.commentsAnalyzed,
        stage: null,
        quotaUsed: client.quotaUsed,
        message: "완료",
        updatedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  } catch (err) {
    const { code, message } = toJobError(err);
    await failJob(jobId, code, message);
  }
}

async function failJob(jobId: string, code: JobErrorCode, message: string) {
  const db = getDb();
  await db
    .update(jobs)
    .set({
      state: "error",
      errorCode: code,
      error: message,
      message,
      stage: null,
      updatedAt: new Date(),
      finishedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

function toJobError(err: unknown): { code: JobErrorCode; message: string } {
  if (err instanceof YouTubeError) {
    return { code: err.code as JobErrorCode, message: err.message };
  }

  const message = err instanceof Error ? err.message : String(err);

  if (/OPENAI_API_KEY|openai/i.test(message)) {
    return { code: "openai_failed", message };
  }
  return { code: "unknown", message };
}

export { nextQuotaReset };
