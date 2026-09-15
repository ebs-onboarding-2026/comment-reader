import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  ActionItem,
  AnalysisMetrics,
  AnalysisStage,
  DebateThread,
  JobErrorCode,
  JobState,
  KeywordItem,
  QuestionGroup,
  RepresentativeComment,
  Sentiment,
  SentimentBreakdown,
  TimelinePoint,
  Topic,
} from "@/lib/types";

/** Video metadata, keyed by YouTube's own id so re-analysis reuses the row. */
export const videos = pgTable("videos", {
  videoId: text("video_id").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  channelId: text("channel_id").notNull(),
  channelTitle: text("channel_title").notNull(),
  subscriberCount: integer("subscriber_count"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  thumbnailUrl: text("thumbnail_url").notNull(),
  viewCount: integer("view_count").notNull(),
  likeCount: integer("like_count").notNull(),
  /** null = comments disabled. */
  commentCount: integer("comment_count"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One completed analysis. The aggregate panels are stored as jsonb because
 * they are written once and always read whole; only the comments need
 * relational access, and they get their own table.
 */
export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: text("video_id")
      .notNull()
      .references(() => videos.videoId, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    actionItems: jsonb("action_items").$type<ActionItem[]>().notNull(),
    metrics: jsonb("metrics").$type<AnalysisMetrics>().notNull(),
    sentiment: jsonb("sentiment").$type<SentimentBreakdown>().notNull(),
    timeline: jsonb("timeline").$type<TimelinePoint[]>().notNull(),
    timelineInsight: text("timeline_insight"),
    topics: jsonb("topics").$type<Topic[]>().notNull(),
    topicClusterCount: integer("topic_cluster_count").notNull(),
    questions: jsonb("questions").$type<QuestionGroup[]>().notNull(),
    questionTotal: integer("question_total").notNull(),
    keywords: jsonb("keywords").$type<KeywordItem[]>().notNull(),
    debates: jsonb("debates").$type<DebateThread[]>().notNull(),
    representatives: jsonb("representatives")
      .$type<RepresentativeComment[]>()
      .notNull(),
    commentsAnalyzed: integer("comments_analyzed").notNull(),
    classificationModel: text("classification_model").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("analyses_video_created_idx").on(t.videoId, t.createdAt)],
);

/**
 * Every collected comment, already classified. The explorer filters and pages
 * over this in SQL rather than loading ten thousand rows into the client.
 */
export const comments = pgTable(
  "comments",
  {
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    commentId: text("comment_id").notNull(),
    parentId: text("parent_id"),
    isReply: boolean("is_reply").notNull(),
    author: text("author").notNull(),
    authorChannelId: text("author_channel_id").notNull().default(""),
    text: text("text").notNull(),
    likeCount: integer("like_count").notNull(),
    replyCount: integer("reply_count"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    sentiment: text("sentiment").$type<Sentiment>().notNull(),
    sentimentReason: text("sentiment_reason").notNull().default(""),
    topicId: integer("topic_id"),
    isQuestion: boolean("is_question").notNull().default(false),
  },
  (t) => [
    index("comments_pk_idx").on(t.analysisId, t.commentId),
    // The explorer's three filters, each paired with analysis_id because every
    // query is scoped to one analysis.
    index("comments_sentiment_idx").on(t.analysisId, t.sentiment),
    index("comments_topic_idx").on(t.analysisId, t.topicId),
    index("comments_question_idx").on(t.analysisId, t.isQuestion),
    index("comments_likes_idx").on(t.analysisId, t.likeCount),
    index("comments_published_idx").on(t.analysisId, t.publishedAt),
    // Replies are fetched by parent when a thread is expanded.
    index("comments_parent_idx").on(t.analysisId, t.parentId),
  ],
);

/** A collection + analysis run. Polled by the progress screens. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull(),
    videoId: text("video_id"),
    state: text("state").$type<JobState>().notNull(),

    // request options
    maxComments: integer("max_comments"),
    order: text("order").notNull(),
    includeReplies: boolean("include_replies").notNull(),

    // progress (artboards 1b and 1c)
    collected: integer("collected").notNull().default(0),
    expected: integer("expected"),
    pagesFetched: integer("pages_fetched").notNull().default(0),
    quotaUsed: integer("quota_used").notNull().default(0),
    analyzed: integer("analyzed").notNull().default(0),
    batchesDone: integer("batches_done").notNull().default(0),
    batchesTotal: integer("batches_total").notNull().default(0),
    stage: text("stage").$type<AnalysisStage>(),
    collectSeconds: real("collect_seconds"),

    message: text("message").notNull().default(""),
    errorCode: text("error_code").$type<JobErrorCode>(),
    error: text("error"),
    analysisId: uuid("analysis_id").references(() => analyses.id, {
      onDelete: "set null",
    }),

    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_state_idx").on(t.state, t.updatedAt)],
);

export type VideoRow = typeof videos.$inferSelect;
export type AnalysisRow = typeof analyses.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
