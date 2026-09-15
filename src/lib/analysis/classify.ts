/**
 * Per-comment classification: sentiment, the one-line reason shown under every
 * comment in the explorer, and whether it is a question.
 *
 * Korean comment threads lean hard on sarcasm, slang and 초성체, which is
 * exactly where dictionary scoring fails — "자막 진짜 잘 만들었네요^^" is a
 * complaint. Asking the model to state its reason keeps that call auditable.
 */
import type { Sentiment } from "@/lib/types";

import { getOpenAI, CLASSIFICATION_MODEL } from "./openai";

/** 8,412 comments over 80 per batch is the "배치 n / 106" counter on 1c. */
export const BATCH_SIZE = 80;

/** Concurrent in-flight batches. Enough to keep throughput up without
 *  tripping rate limits on a small account. */
const CONCURRENCY = 6;

/** Above this share of failed batches the run is abandoned rather than
 *  reported as a finished analysis full of neutral placeholders. */
const FAILURE_THRESHOLD = 0.2;

export interface ClassifyInput {
  commentId: string;
  text: string;
}

export interface ClassifyOutput {
  commentId: string;
  sentiment: Sentiment;
  sentimentReason: string;
  isQuestion: boolean;
}

const SYSTEM_PROMPT = `너는 한국어 유튜브 댓글을 분류한다.

각 댓글에 대해 판단할 것:
- sentiment: positive | negative | neutral — 영상/제작자에 대한 시청자의 태도.
  * 비꼼과 반어를 반드시 잡아라. "자막 진짜 잘 만들었네요^^" 같은 문장은 negative다.
  * 단순 정보 질문, 인사, 무의미한 문자열은 neutral이다.
  * 제3자(다른 댓글 작성자)를 향한 공격은 영상 평가가 아니므로 neutral로 둔다.
- reason: 그렇게 판단한 근거를 한국어 한 줄(40자 이내)로. 근거가 되는 표현을 직접 인용하면 좋다.
- isQuestion: 제작자나 다른 시청자에게 답을 구하는 댓글이면 true. 수사의문문은 false.

입력의 모든 항목에 대해, 입력과 같은 순서로, 같은 개수의 결과를 반환하라.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "sentiment", "reason", "isQuestion"],
        properties: {
          index: { type: "integer" },
          sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
          reason: { type: "string" },
          isQuestion: { type: "boolean" },
        },
      },
    },
  },
} as const;

interface BatchResult {
  index: number;
  sentiment: Sentiment;
  reason: string;
  isQuestion: boolean;
}

async function classifyBatch(batch: ClassifyInput[]): Promise<ClassifyOutput[]> {
  const openai = getOpenAI();

  // Comments can be enormous; the tail rarely changes the sentiment call and
  // costs tokens on every batch.
  const payload = batch.map((c, i) => ({ index: i, text: c.text.slice(0, 600) }));

  const completion = await openai.chat.completions.create({
    model: CLASSIFICATION_MODEL,
    // Temperature is deliberately left at the model default: newer OpenAI
    // models reject any explicit value, and the JSON schema already pins the
    // shape of what comes back.
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(payload) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "comment_classification", strict: true, schema: SCHEMA },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("분류 응답이 비어 있습니다.");

  const parsed = JSON.parse(raw) as { results: BatchResult[] };
  const byIndex = new Map(parsed.results.map((r) => [r.index, r]));

  // A short or reordered response must not shift labels onto the wrong
  // comments, so every result is matched back by index.
  return batch.map((c, i) => {
    const r = byIndex.get(i);
    return {
      commentId: c.commentId,
      sentiment: r?.sentiment ?? "neutral",
      sentimentReason: r?.reason ?? "",
      isQuestion: r?.isQuestion ?? false,
    };
  });
}

export interface ClassifyProgress {
  analyzed: number;
  batchesDone: number;
  batchesTotal: number;
}

/**
 * Classify every comment. Failures fall back to neutral for that batch only —
 * one bad batch should not lose an entire collection run.
 */
export async function classifyAll(
  comments: ClassifyInput[],
  onProgress?: (p: ClassifyProgress) => void | Promise<void>,
): Promise<ClassifyOutput[]> {
  const batches: ClassifyInput[][] = [];
  for (let i = 0; i < comments.length; i += BATCH_SIZE) {
    batches.push(comments.slice(i, i + BATCH_SIZE));
  }

  const results: ClassifyOutput[][] = new Array(batches.length);
  let done = 0;
  let analyzed = 0;
  let next = 0;
  let failed = 0;
  let firstError: unknown = null;

  async function worker() {
    while (true) {
      const mine = next++;
      if (mine >= batches.length) return;

      try {
        results[mine] = await classifyBatch(batches[mine]);
      } catch (err) {
        failed++;
        firstError ??= err;
        results[mine] = batches[mine].map((c) => ({
          commentId: c.commentId,
          sentiment: "neutral" as const,
          sentimentReason: "",
          isQuestion: false,
        }));
      }

      done++;
      analyzed += batches[mine].length;
      await onProgress?.({
        analyzed,
        batchesDone: done,
        batchesTotal: batches.length,
      });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker),
  );

  // Falling back to neutral keeps one flaky batch from losing a whole
  // collection, but past a threshold the "analysis" is just an empty result
  // wearing a finished job's clothes — and a bad key fails every batch.
  if (batches.length > 0 && failed / batches.length > FAILURE_THRESHOLD) {
    throw new Error(
      `분류 배치 ${batches.length}개 중 ${failed}개가 실패했습니다. ` +
        `원인: ${firstError instanceof Error ? firstError.message : String(firstError)}`,
    );
  }

  return results.flat();
}

export function batchCount(total: number): number {
  return Math.ceil(total / BATCH_SIZE);
}
