/**
 * YouTube Data API v3 access for a single video's comments.
 *
 * Quota matters more than anything else here: the default allowance is 10,000
 * units a day and every commentThreads page costs 1, so a 10k-comment video
 * costs ~100 units. search.list (100 units a call) is never used.
 */
import type { CollectOrder, Sentiment, VideoMeta } from "@/lib/types";

const API_ROOT = "https://www.googleapis.com/youtube/v3";

/**
 * Ceiling on replies pulled from a single thread. Threads this long are
 * pile-ons rather than discussion, and the topic panel reads them the same
 * either way.
 */
const MAX_REPLIES_PER_THREAD = 200;

const QUOTA_COST: Record<string, number> = {
  commentThreads: 1,
  comments: 1,
  videos: 1,
  channels: 1,
};

export type YouTubeErrorCode =
  | "invalid_url"
  | "video_unavailable"
  | "comments_disabled"
  | "youtube_quota"
  | "unknown";

export class YouTubeError extends Error {
  constructor(
    readonly code: YouTubeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "YouTubeError";
  }
}

/** Accepts a bare id, a watch URL, a youtu.be link, or a /shorts/ link. */
export function parseVideoId(ref: string): string {
  const trimmed = ref.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

  let parsed: URL;
  try {
    parsed = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    throw new YouTubeError("invalid_url", `주소를 해석할 수 없습니다: ${ref}`);
  }

  const v = parsed.searchParams.get("v");
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;

  const segments = parsed.pathname.split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (/^[A-Za-z0-9_-]{11}$/.test(segments[i])) return segments[i];
  }

  throw new YouTubeError("invalid_url", `주소에서 영상 ID를 찾을 수 없습니다: ${ref}`);
}

interface CommentSnippet {
  authorDisplayName?: string;
  authorChannelId?: { value?: string };
  textOriginal?: string;
  likeCount?: number;
  publishedAt?: string;
}

/** A comment as collected, before any classification. */
export interface RawComment {
  commentId: string;
  parentId: string | null;
  isReply: boolean;
  author: string;
  authorChannelId: string;
  text: string;
  likeCount: number;
  replyCount: number | null;
  publishedAt: string;
}

export interface CollectProgress {
  collected: number;
  pagesFetched: number;
  quotaUsed: number;
}

export class YouTubeClient {
  private used = 0;
  private calls: Record<string, number> = {};

  constructor(
    private readonly apiKey: string,
    private readonly quotaBudget = 9500,
  ) {}

  get quotaUsed() {
    return this.used;
  }

  get callCounts() {
    return { ...this.calls };
  }

  private charge(endpoint: string) {
    const cost = QUOTA_COST[endpoint] ?? 1;
    if (this.used + cost > this.quotaBudget) {
      throw new YouTubeError(
        "youtube_quota",
        `로컬 할당량 예산 ${this.quotaBudget} units를 초과합니다.`,
      );
    }
    this.used += cost;
    this.calls[endpoint] = (this.calls[endpoint] ?? 0) + 1;
  }

  private async get<T>(
    endpoint: string,
    params: Record<string, string | number>,
  ): Promise<T> {
    this.charge(endpoint);

    const qs = new URLSearchParams({ key: this.apiKey });
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    const url = `${API_ROOT}/${endpoint}?${qs}`;

    let lastError = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      let resp: Response;
      try {
        resp = await fetch(url, { cache: "no-store" });
      } catch (err) {
        lastError = String(err);
        await sleep(2 ** attempt * 500);
        continue;
      }

      if (resp.ok) return (await resp.json()) as T;

      // The HTTP status alone cannot tell "comments off" from "out of quota";
      // the structured reason can.
      let reason = "";
      let message = `${resp.status}`;
      try {
        const body = (await resp.json()) as {
          error?: { message?: string; errors?: { reason?: string }[] };
        };
        message = body.error?.message ?? message;
        reason = body.error?.errors?.[0]?.reason ?? "";
      } catch {
        /* non-JSON error body */
      }

      if (resp.status === 403) {
        if (
          reason === "quotaExceeded" ||
          reason === "dailyLimitExceeded" ||
          reason === "rateLimitExceeded"
        ) {
          throw new YouTubeError("youtube_quota", message);
        }
        if (reason === "commentsDisabled" || reason === "forbidden") {
          throw new YouTubeError("comments_disabled", message);
        }
        throw new YouTubeError("unknown", `403 ${reason}: ${message}`);
      }

      if (resp.status === 404) {
        throw new YouTubeError("video_unavailable", message);
      }

      if (resp.status >= 500 || resp.status === 429) {
        lastError = `${resp.status}: ${message}`;
        await sleep(2 ** attempt * 500);
        continue;
      }

      throw new YouTubeError("unknown", `${resp.status} ${reason}: ${message}`);
    }

    throw new YouTubeError("unknown", `${endpoint} 재시도 실패: ${lastError}`);
  }

  /** Video metadata plus the channel's subscriber count (2 quota units). */
  async getVideo(videoId: string, url: string): Promise<VideoMeta> {
    const data = await this.get<{
      items?: {
        id: string;
        snippet: {
          title: string;
          channelId: string;
          channelTitle: string;
          publishedAt: string;
          thumbnails?: Record<string, { url: string }>;
        };
        statistics: Record<string, string>;
      }[];
    }>("videos", { part: "snippet,statistics", id: videoId });

    const item = data.items?.[0];
    if (!item) {
      throw new YouTubeError(
        "video_unavailable",
        "비공개·삭제된 영상이거나 주소에 오타가 있습니다.",
      );
    }

    const thumbs = item.snippet.thumbnails ?? {};
    const thumbnailUrl =
      thumbs.maxres?.url ??
      thumbs.standard?.url ??
      thumbs.high?.url ??
      thumbs.medium?.url ??
      thumbs.default?.url ??
      "";

    let subscriberCount: number | null = null;
    try {
      const ch = await this.get<{
        items?: { statistics?: { subscriberCount?: string } }[];
      }>("channels", { part: "statistics", id: item.snippet.channelId });
      const raw = ch.items?.[0]?.statistics?.subscriberCount;
      subscriberCount = raw ? Number(raw) : null;
    } catch {
      // Hidden subscriber counts are common and never worth failing over.
    }

    return {
      videoId: item.id,
      url,
      title: item.snippet.title,
      channelId: item.snippet.channelId,
      channelTitle: item.snippet.channelTitle,
      subscriberCount,
      publishedAt: item.snippet.publishedAt,
      thumbnailUrl,
      viewCount: Number(item.statistics.viewCount ?? 0),
      likeCount: Number(item.statistics.likeCount ?? 0),
      // The field is absent entirely when the uploader disabled comments.
      commentCount:
        item.statistics.commentCount === undefined
          ? null
          : Number(item.statistics.commentCount),
    };
  }

  /**
   * Collect a video's comments.
   *
   * `onProgress` fires after every page so the job row — and therefore the
   * progress screen — reflects a long collection as it happens.
   */
  async collectComments(
    videoId: string,
    opts: {
      order: CollectOrder;
      maxComments: number | null;
      includeReplies: boolean;
      onProgress?: (p: CollectProgress) => void | Promise<void>;
      signal?: AbortSignal;
    },
  ): Promise<RawComment[]> {
    const out: RawComment[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
      if (opts.signal?.aborted) break;

      const page = await this.get<{
        items?: {
          snippet: {
            totalReplyCount?: number;
            topLevelComment: { id: string; snippet: CommentSnippet };
          };
          replies?: { comments?: { id: string; snippet: CommentSnippet }[] };
        }[];
        nextPageToken?: string;
      }>("commentThreads", {
        part: "snippet,replies",
        videoId,
        maxResults: 100,
        order: opts.order,
        textFormat: "plainText",
        ...(pageToken ? { pageToken } : {}),
      });

      pages++;

      for (const thread of page.items ?? []) {
        const top = thread.snippet.topLevelComment;
        const replyCount = thread.snippet.totalReplyCount ?? 0;
        out.push(toRaw(top.id, top.snippet, null, replyCount));

        if (opts.includeReplies && replyCount > 0) {
          const embedded = thread.replies?.comments ?? [];
          // commentThreads embeds at most 5 replies; fetch the rest only when
          // there actually are more.
          if (replyCount > embedded.length) {
            // One viral thread can hold thousands of replies. Left unbounded it
            // would spend the whole comment cap — and a pile of quota — before
            // the collector ever reaches the second top-level comment, so no
            // single thread may take more than a tenth of the requested total.
            const budget = opts.maxComments
              ? Math.max(0, opts.maxComments - out.length)
              : Infinity;
            const share = opts.maxComments
              ? Math.max(5, Math.floor(opts.maxComments * 0.1))
              : MAX_REPLIES_PER_THREAD;
            const limit = Math.min(MAX_REPLIES_PER_THREAD, share, budget);

            for (const reply of await this.fetchReplies(top.id, limit)) {
              out.push(reply);
            }
          } else {
            for (const reply of embedded) {
              out.push(toRaw(reply.id, reply.snippet, top.id, null));
            }
          }
        }
      }

      await opts.onProgress?.({
        collected: out.length,
        pagesFetched: pages,
        quotaUsed: this.used,
      });

      if (opts.maxComments && out.length >= opts.maxComments) {
        return out.slice(0, opts.maxComments);
      }

      pageToken = page.nextPageToken;
    } while (pageToken);

    return out;
  }

  private async fetchReplies(
    parentId: string,
    limit = MAX_REPLIES_PER_THREAD,
  ): Promise<RawComment[]> {
    const out: RawComment[] = [];
    if (limit <= 0) return out;
    let pageToken: string | undefined;

    do {
      const page = await this.get<{
        items?: { id: string; snippet: CommentSnippet }[];
        nextPageToken?: string;
      }>("comments", {
        part: "snippet",
        parentId,
        maxResults: 100,
        textFormat: "plainText",
        ...(pageToken ? { pageToken } : {}),
      });

      for (const reply of page.items ?? []) {
        out.push(toRaw(reply.id, reply.snippet, parentId, null));
        if (out.length >= limit) return out;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);

    return out;
  }
}

function toRaw(
  id: string,
  snippet: CommentSnippet,
  parentId: string | null,
  replyCount: number | null,
): RawComment {
  return {
    commentId: id,
    parentId,
    isReply: parentId !== null,
    author: snippet.authorDisplayName ?? "",
    authorChannelId: snippet.authorChannelId?.value ?? "",
    text: snippet.textOriginal ?? "",
    likeCount: snippet.likeCount ?? 0,
    replyCount,
    publishedAt: snippet.publishedAt ?? new Date().toISOString(),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Next reset of the daily quota (midnight US Pacific), for the 1f screen. */
export function nextQuotaReset(from = new Date()): Date {
  const pacificNow = new Date(
    from.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
  );
  const offsetMs = from.getTime() - pacificNow.getTime();
  const nextMidnightPacific = new Date(pacificNow);
  nextMidnightPacific.setHours(24, 0, 0, 0);
  return new Date(nextMidnightPacific.getTime() + offsetMs);
}

export type { Sentiment };
