/**
 * The data contract between the analysis pipeline and the UI.
 *
 * Shaped to the "댓글독해" mockups (artboards 1a-1f): every field here backs a
 * visible element on one of those screens, so a panel can be built against
 * this file alone.
 */

export type Sentiment = "positive" | "negative" | "neutral";

/** Metadata for the video being analyzed. Drives the 1a preview card and the
 *  1d results header. */
export interface VideoMeta {
  videoId: string;
  url: string;
  title: string;
  channelId: string;
  channelTitle: string;
  /** Shown as "구독자 41.2만" on 1a. */
  subscriberCount: number | null;
  publishedAt: string;
  thumbnailUrl: string;
  viewCount: number;
  likeCount: number;
  /** null means the uploader disabled comments (state 1f). */
  commentCount: number | null;
}

/** One comment after classification. Powers the 1e explorer. */
export interface AnalyzedComment {
  commentId: string;
  /** null for a top-level comment. */
  parentId: string | null;
  isReply: boolean;
  author: string;
  authorChannelId: string;
  text: string;
  likeCount: number;
  /** Only set on top-level comments. */
  replyCount: number | null;
  publishedAt: string;
  sentiment: Sentiment;
  /** The "판단 근거 · …" line under every comment on 1e. Carrying the model's
   *  reason is what makes a sarcasm call auditable rather than a black box. */
  sentimentReason: string;
  topicId: number | null;
  isQuestion: boolean;
}

export interface SentimentBreakdown {
  positive: number;
  negative: number;
  neutral: number;
  total: number;
}

/* --------------------------------------------------------------- summary */

/** The three tags under the AI summary on 1d. */
export type ActionKind = "use_next" | "fix" | "disclose";

export interface ActionItem {
  kind: ActionKind;
  /** e.g. "촬영지 목록 고정" — the label before it is fixed per kind. */
  text: string;
}

/* --------------------------------------------------------------- metrics */

export interface AnalysisMetrics {
  totalComments: number;
  topLevelCount: number;
  replyCount: number;
  /** 0..1 */
  replyRatio: number;
  avgLikes: number;
  medianLikes: number;
  /** 0..1 — share of all likes held by the top 1% of comments. */
  top1PercentLikeShare: number;
  /** comments per view, 0..1 */
  engagementRate: number;
  /**
   * 1d shows "채널 평균 14.1% 대비 높음" next to the reply ratio. That needs the
   * channel's other videos, which a single-video analysis never collects, so
   * this stays null until a channel baseline is computed separately.
   */
  channelAvgReplyRatio: number | null;
  /**
   * 1d shows "동일 카테고리 상위 12%" next to engagement. YouTube exposes no
   * category benchmark, so this stays null unless a benchmark source is added.
   */
  categoryPercentile: number | null;
}

/* -------------------------------------------------------------- timeline */

/** One bar of the 1d inflow chart. The bar is tinted by which sentiment
 *  dominates the bucket, and hovering shows `sampleText`. */
export interface TimelinePoint {
  hoursSinceUpload: number;
  bucketStart: string;
  count: number;
  sentiment: SentimentBreakdown;
  dominant: Sentiment;
  /** A representative comment from this bucket, for the hover tooltip. */
  sampleText: string | null;
  sampleCommentId: string | null;
}

/* ---------------------------------------------------------------- topics */

export type TopicTone = "mostly_positive" | "mostly_negative" | "mixed" | "neutral";

/** An embedding cluster. The headline differentiator on 1d. */
export interface Topic {
  id: number;
  /** Short human label, e.g. "자막 오타 지적". */
  label: string;
  /** One sentence on what this group is saying. */
  summary: string;
  count: number;
  sentiment: SentimentBreakdown;
  tone: TopicTone;
  /** Three comments shown when the row is expanded. */
  sampleCommentIds: string[];
}

/* ------------------------------------------------------------- questions */

/**
 * 1d groups questions by meaning, not one row per comment: "3분 12초 골목 어디?"
 * appears 284 times in different wordings and shows as a single row.
 */
export interface QuestionGroup {
  id: number;
  /** The clearest phrasing found in the group. */
  representativeText: string;
  count: number;
  /** Free-form tag on the right of the row, e.g. "촬영지", "음악", "장비". */
  category: string;
  commentIds: string[];
}

/* -------------------------------------------------------------- keywords */

export interface KeywordItem {
  term: string;
  count: number;
  /** 0..1 — share of occurrences in positive comments. */
  positiveRatio: number;
  /** Which of the three legend colors the bar takes on 1d. */
  context: "positive" | "negative" | "mixed";
}

/* --------------------------------------------------------------- debates */

/** A comment that drew many replies — where opinion split. */
export interface DebateThread {
  commentId: string;
  text: string;
  author: string;
  replyCount: number;
  likeCount: number;
  publishedAt: string;
  /** Badge text on 1d, e.g. "찬반 갈림", "반박 우세". */
  splitLabel: string;
  /** Sentiment mix among the replies, which tints the badge. */
  replySentiment: SentimentBreakdown;
}

/* -------------------------------------------------- representative comments */

/** 1d shows six of these, each with the model's reason for picking it. */
export interface RepresentativeComment {
  commentId: string;
  text: string;
  author: string;
  likeCount: number;
  sentiment: Sentiment;
  /** Short group label, e.g. "색감 칭찬", "자막 불만". */
  label: string;
  /** Why this comment represents the group. */
  reason: string;
}

/* ---------------------------------------------------------------- result */

export interface AnalysisResult {
  analysisId: string;
  video: VideoMeta;
  /** The paragraph at the top of 1d, written over every comment. */
  summary: string;
  actionItems: ActionItem[];
  metrics: AnalysisMetrics;
  sentiment: SentimentBreakdown;
  timeline: TimelinePoint[];
  /** The callout under the timeline, e.g. "19~22시간 구간에 부정 댓글이 집중". */
  timelineInsight: string | null;
  topics: Topic[];
  /** How many clusters were formed before trimming to the top five shown. */
  topicClusterCount: number;
  questions: QuestionGroup[];
  questionTotal: number;
  keywords: KeywordItem[];
  debates: DebateThread[];
  representatives: RepresentativeComment[];
  commentsAnalyzed: number;
  analyzedAt: string;
  models: { classification: string; embedding: string };
}

/* ------------------------------------------------------------------ jobs */

/**
 * Collection and analysis each take minutes, so the UI polls a job rather than
 * holding a request open. States map to artboards 1b, 1c and 1f.
 */
export type JobState =
  | "queued"
  | "collecting"
  | "analyzing"
  | "done"
  | "error";

/** The four failure screens on 1f, plus the ones that are not the user's fault. */
export type JobErrorCode =
  | "invalid_url"
  | "video_unavailable"
  | "comments_disabled"
  | "no_comments"
  | "youtube_quota"
  | "openai_failed"
  | "unknown";

/** Sub-steps listed on 1c. */
export type AnalysisStage = "classify" | "cluster" | "summarize";

export interface JobProgress {
  /** Comments fetched so far (1b). */
  collected: number;
  /** YouTube's own comment count, known once metadata lands. */
  expected: number | null;
  /** commentThreads pages consumed (1b). */
  pagesFetched: number;
  /** YouTube quota units spent by this job (1b). */
  quotaUsed: number;
  /** Seconds left in collection, estimated from observed rate. */
  etaSeconds: number | null;
  /** Comments classified so far (1c). */
  analyzed: number;
  batchesDone: number;
  batchesTotal: number;
  /** Which of the three analysis steps is running (1c). */
  stage: AnalysisStage | null;
  /** Seconds collection took, shown as "수집 완료 — 8,412개 (2분 04초)" on 1c. */
  collectSeconds: number | null;
}

export interface JobStatus {
  jobId: string;
  url: string;
  videoId: string | null;
  video: VideoMeta | null;
  state: JobState;
  progress: JobProgress;
  /** Short human-readable line for the progress screen. */
  message: string;
  errorCode: JobErrorCode | null;
  error: string | null;
  /** For youtube_quota (1f): when the daily quota resets, in the viewer's zone. */
  quotaResetsAt: string | null;
  analysisId: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/* -------------------------------------------------------------- explorer */

export type CommentSort = "likes" | "newest";

/** Mirrors the 1e filter rail. Serialized into the URL so a filtered view is
 *  shareable, as the sidebar note promises. */
export interface CommentQuery {
  sentiment?: Sentiment;
  topicId?: number;
  questionsOnly?: boolean;
  includeReplies?: boolean;
  search?: string;
  sort?: CommentSort;
  page?: number;
  pageSize?: number;
}

/** A top-level comment with its replies attached, as 1e renders it. */
export interface CommentWithReplies extends AnalyzedComment {
  replies: AnalyzedComment[];
}

export interface CommentPage {
  items: CommentWithReplies[];
  total: number;
  page: number;
  pageSize: number;
  /** Counts for the filter rail, computed over the whole analysis. */
  facets: {
    sentiment: SentimentBreakdown;
    topics: { topicId: number; label: string; count: number }[];
    questions: number;
  };
}

/* --------------------------------------------------------------- request */

export type CollectOrder = "time" | "relevance";

export interface AnalyzeRequest {
  url: string;
  /** null = collect everything available ("전체" on 1a). */
  maxComments: number | null;
  order: CollectOrder;
  includeReplies: boolean;
}

/** Row in the history list. */
export interface HistoryEntry {
  analysisId: string;
  videoId: string;
  title: string;
  thumbnailUrl: string;
  channelTitle: string;
  commentsAnalyzed: number;
  sentiment: SentimentBreakdown;
  analyzedAt: string;
}
