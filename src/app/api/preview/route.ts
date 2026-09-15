/** Resolves a pasted URL to video metadata for the 1a preview card. 2 units. */
import { NextResponse } from "next/server";

import { YouTubeClient, YouTubeError, parseVideoId } from "@/lib/youtube";

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { error: "url 파라미터가 필요합니다.", code: "invalid_url" },
      { status: 400 },
    );
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "YOUTUBE_API_KEY가 설정되지 않았습니다.", code: "unknown" },
      { status: 500 },
    );
  }

  try {
    const videoId = parseVideoId(url);
    const video = await new YouTubeClient(apiKey).getVideo(videoId, url);
    return NextResponse.json({ video });
  } catch (err) {
    if (err instanceof YouTubeError) {
      const status = err.code === "youtube_quota" ? 429 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    return NextResponse.json(
      { error: String(err), code: "unknown" },
      { status: 500 },
    );
  }
}
