import OpenAI from "openai";

/**
 * One knob for both chat steps. Per-step overrides win, so classification can
 * be moved to a cheaper model than the summary without touching the other.
 */
const DEFAULT_CHAT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/** Named on the results screen next to the AI summary. */
export const CLASSIFICATION_MODEL =
  process.env.OPENAI_CLASSIFICATION_MODEL ?? DEFAULT_CHAT_MODEL;

/** The summary is the most-read text in the product; give it the better model
 *  when one is configured. */
export const SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL ?? DEFAULT_CHAT_MODEL;

/** Named next to the topic-cluster panel. Must be an embedding model, so it
 *  never falls back to OPENAI_MODEL. */
export const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

let cached: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (cached) return cached;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local, or run `vercel env pull`.",
    );
  }

  cached = new OpenAI({ apiKey, maxRetries: 4 });
  return cached;
}
