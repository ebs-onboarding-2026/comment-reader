/** Polled by the progress screens (1b, 1c) and the failure screens (1f). */
import { NextResponse } from "next/server";

import { getJobStatus } from "@/lib/repository";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  try {
    const status = await getJobStatus(jobId);
    if (!status) {
      return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
