/**
 * Smoke test for the parts that need no OpenAI key or database:
 * URL parsing, live YouTube collection, keyword extraction, clustering.
 *
 *   npx tsx scripts/smoke.ts [videoUrl]
 */
import { config } from "dotenv";

// Next reads .env.local; dotenv defaults to .env, so point it at the same file.
config({ path: [".env.local", ".env"], quiet: true });

import { extractKeywords } from "@/lib/analysis/keywords";
import { kmeans, suggestClusterCount } from "@/lib/analysis/cluster";
import { YouTubeClient, parseVideoId } from "@/lib/youtube";

function ok(label: string, passed: boolean, detail = "") {
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!passed) process.exitCode = 1;
}

async function main() {
  console.log("--- parseVideoId ---");
  const cases: [string, string][] = [
    ["jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["https://www.youtube.com/watch?v=jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["https://youtu.be/jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["https://www.youtube.com/shorts/jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["youtube.com/watch?v=jNQXAC9IVRw&t=30s", "jNQXAC9IVRw"],
  ];
  for (const [input, expected] of cases) {
    let actual = "";
    try {
      actual = parseVideoId(input);
    } catch (err) {
      actual = `threw: ${err}`;
    }
    ok(input.slice(0, 48), actual === expected, `-> ${actual}`);
  }

  let threw = false;
  try {
    parseVideoId("https://example.com/nope");
  } catch {
    threw = true;
  }
  ok("rejects a non-YouTube URL", threw);

  console.log("\n--- kmeans ---");
  // Three tight, well-separated groups in 8 dimensions.
  const vectors: Float32Array[] = [];
  for (let g = 0; g < 3; g++) {
    for (let i = 0; i < 30; i++) {
      const v = new Float32Array(8);
      v[g] = 1;
      v[(g + 3) % 8] = 0.05 * (i % 3);
      const norm = Math.hypot(...v);
      for (let d = 0; d < 8; d++) v[d] /= norm;
      vectors.push(v);
    }
  }
  const { clusters, assignments } = kmeans(vectors, 3);
  ok("finds three clusters", clusters.length === 3, `sizes ${clusters.map((c) => c.length).join("/")}`);
  ok(
    "groups each block together",
    [0, 1, 2].every((g) => {
      const block = assignments.slice(g * 30, g * 30 + 30);
      return new Set(block).size === 1;
    }),
  );
  ok("cluster count heuristic stays in range", (() => {
    const k = suggestClusterCount(8412);
    return k >= 4 && k <= 12;
  })(), `k(8412)=${suggestClusterCount(8412)}`);

  console.log("\n--- keywords (Korean) ---");
  const sample = [
    { text: "자막 오타가 너무 많아요 자막 검수 좀", sentiment: "negative" as const },
    { text: "자막이 빨리 지나가서 못 읽겠어요", sentiment: "negative" as const },
    { text: "자막 타이밍이 아쉽네요", sentiment: "negative" as const },
    { text: "색감이 정말 예뻐요 색감 최고", sentiment: "positive" as const },
    { text: "색감 진짜 좋네요", sentiment: "positive" as const },
    { text: "색감 미쳤다", sentiment: "positive" as const },
    { text: "촬영지가 어디인가요?", sentiment: "neutral" as const },
    { text: "촬영지 알려주세요", sentiment: "neutral" as const },
  ];
  const keywords = extractKeywords(sample, 8);
  console.log(
    keywords
      .map((k) => `  ${k.term} ${k.count} ${k.context} (${k.positiveRatio.toFixed(2)})`)
      .join("\n"),
  );
  const terms = keywords.map((k) => k.term);
  ok("strips the 이/가/이/을 particles", terms.includes("자막") && terms.includes("색감"));
  ok("keeps 촬영지 despite the 가 ending", terms.includes("촬영지"));
  ok(
    "tags 자막 as negative context",
    keywords.find((k) => k.term === "자막")?.context === "negative",
  );
  ok(
    "tags 색감 as positive context",
    keywords.find((k) => k.term === "색감")?.context === "positive",
  );
  ok("drops filler words", !terms.includes("정말") && !terms.includes("진짜"));

  console.log("\n--- live YouTube ---");
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.log("SKIP  YOUTUBE_API_KEY not set");
    return;
  }

  const url = process.argv[2] ?? "https://www.youtube.com/watch?v=jNQXAC9IVRw";
  const client = new YouTubeClient(apiKey);
  const videoId = parseVideoId(url);

  const video = await client.getVideo(videoId, url);
  console.log(`  ${video.title}  /  ${video.channelTitle}`);
  console.log(
    `  views ${video.viewCount.toLocaleString()}  comments ${video.commentCount?.toLocaleString()}  subs ${video.subscriberCount?.toLocaleString() ?? "hidden"}`,
  );
  ok("video metadata", Boolean(video.title) && video.commentCount !== null);
  ok("thumbnail resolved", video.thumbnailUrl.startsWith("https://"));

  let lastProgress = { collected: 0, pagesFetched: 0, quotaUsed: 0 };
  const comments = await client.collectComments(videoId, {
    order: "time",
    maxComments: 120,
    includeReplies: true,
    onProgress: (p) => {
      lastProgress = p;
    },
  });

  console.log(`  collected ${comments.length}, quota ${client.quotaUsed} units`);
  ok("collected comments", comments.length > 0);
  ok("respected the cap", comments.length <= 120);
  ok("progress callback fired", lastProgress.pagesFetched > 0);
  ok("every comment has text and an id", comments.every((c) => c.commentId && c.text !== undefined));
  ok("replies are flagged and parented", comments.every((c) => c.isReply === (c.parentId !== null)));

  const withReplies = comments.filter((c) => c.isReply).length;
  console.log(`  top-level ${comments.length - withReplies}, replies ${withReplies}`);

  const kw = extractKeywords(
    comments.map((c) => ({ text: c.text, sentiment: "neutral" as const })),
    10,
  );
  console.log("  top terms:", kw.map((k) => `${k.term}(${k.count})`).join(" "));
}

main().catch((err) => {
  console.error("FAIL  unexpected error:", err);
  process.exit(1);
});
