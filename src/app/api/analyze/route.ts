/**
 * Starts a collection + analysis run and returns immediately with a job id.
 *
 * The work continues in `after()`, so closing the tab does not cancel it — the
 * promise the progress screen makes.
 */
import { NextResponse, after } from "next/server";

import { createJob, runJob } from "@/lib/pipeline";
import type { AnalyzeRequest, CollectOrder } from "@/lib/types";

/**
 * A busy video takes minutes end to end. Fluid Compute allows far more than
 * the 300s default, and the run is bounded by the comment cap the user picks.
 */
export const maxDuration = 800;

export async function POST(request: Request) {
  let body: Partial<AnalyzeRequest>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "url이 필요합니다." }, { status: 400 });
  }

  const order: CollectOrder = body.order === "relevance" ? "relevance" : "time";
  const maxComments =
    typeof body.maxComments === "number" && body.maxComments > 0
      ? Math.floor(body.maxComments)
      : null;
  const includeReplies = body.includeReplies !== false;

  const req: AnalyzeRequest = { url, maxComments, order, includeReplies };

  let jobId: string;
  try {
    jobId = await createJob(req);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  after(async () => {
    await runJob(jobId, req);
  });

  return NextResponse.json({ jobId }, { status: 202 });
}
