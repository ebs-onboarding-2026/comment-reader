/** The whole results screen (1d) in one response. */
import { NextResponse } from "next/server";

import { getAnalysis } from "@/lib/repository";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ analysisId: string }> },
) {
  const { analysisId } = await params;

  try {
    const result = await getAnalysis(analysisId);
    if (!result) {
      return NextResponse.json({ error: "분석 결과를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
