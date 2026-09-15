/** Past analyses, newest first. */
import { NextResponse } from "next/server";

import { getHistory } from "@/lib/repository";

export async function GET(request: Request) {
  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit = Math.min(100, Math.max(1, Number(limitParam) || 30));

  try {
    return NextResponse.json({ items: await getHistory(limit) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
