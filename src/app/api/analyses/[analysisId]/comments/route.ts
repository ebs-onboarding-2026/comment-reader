/**
 * The explorer (1e). Every filter is a query parameter so the URL alone
 * restores the view — what the sidebar note promises about sharing a link.
 */
import { NextResponse } from "next/server";

import { getComments } from "@/lib/repository";
import type { CommentQuery, CommentSort, Sentiment } from "@/lib/types";

const SENTIMENTS: Sentiment[] = ["positive", "negative", "neutral"];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ analysisId: string }> },
) {
  const { analysisId } = await params;
  const sp = new URL(request.url).searchParams;

  const sentimentParam = sp.get("sentiment");
  const topicParam = sp.get("topicId");
  const sortParam = sp.get("sort");

  const query: CommentQuery = {
    sentiment: SENTIMENTS.includes(sentimentParam as Sentiment)
      ? (sentimentParam as Sentiment)
      : undefined,
    topicId:
      topicParam !== null && Number.isInteger(Number(topicParam))
        ? Number(topicParam)
        : undefined,
    questionsOnly: sp.get("questionsOnly") === "true",
    // Replies ride along with their parent by default; this makes them rows.
    includeReplies: sp.get("includeReplies") === "true",
    search: sp.get("search") ?? undefined,
    sort: (sortParam === "newest" ? "newest" : "likes") as CommentSort,
    page: Number(sp.get("page")) || 1,
    pageSize: Number(sp.get("pageSize")) || 25,
  };

  try {
    return NextResponse.json(await getComments(analysisId, query));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
