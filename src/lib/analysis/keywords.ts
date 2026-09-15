/**
 * Korean keyword extraction without a morphological analyzer.
 *
 * konlpy-class taggers need a JVM, which rules them out on Vercel. Comment
 * keywords do not need full POS tagging anyway: chunking on non-word
 * characters and stripping the common particles off the end recovers the noun
 * stems people actually search for, which is all the panel shows.
 */
import type { KeywordItem, Sentiment } from "@/lib/types";

/** Longest first, so "에서는" is stripped before "는". */
const PARTICLES = [
  "이라는", "라는", "이라고", "라고", "에서는", "에서도", "에게서", "한테서",
  "으로는", "으로도", "까지는", "부터는", "이라도", "밖에", "조차", "마저",
  "처럼", "보다", "에게", "한테", "에서", "으로", "이나", "께서", "이랑",
  "까지", "부터", "이며", "라며", "든지", "이란", "란",
  "은", "는", "이", "가", "을", "를", "에", "와", "과", "도", "만", "의",
  "로", "나", "께", "야", "랑", "든",
] as const;

/** Filler that dominates any raw Korean frequency count. */
const STOPWORDS = new Set([
  "그리고", "하지만", "그래서", "그런데", "근데", "그러면", "그럼", "또한",
  "진짜", "정말", "너무", "완전", "매우", "아주", "조금", "약간", "엄청",
  "이거", "저거", "그거", "이것", "저것", "그것", "여기", "저기", "거기",
  "이런", "저런", "그런", "어떤", "무슨", "이번", "저번", "지난",
  "사람", "때문", "경우", "정도", "생각", "느낌", "부분", "자체", "때문에",
  "있는", "없는", "같은", "같아요", "합니다", "입니다", "했어요", "해요",
  "하는", "되는", "라고", "오늘", "내일", "어제", "지금", "다음", "처음",
  "저는", "제가", "우리", "여러분", "구독", "감사", "안녕", "ㅋㅋ", "ㅎㅎ",
  // Adverbs and fragments that survive particle stripping and otherwise
  // crowd out the real subject words.
  "그냥", "많이", "말이", "정말로", "진심", "보고", "봤는데", "같이", "다시",
  "역시", "그리", "이제", "아직", "더욱", "가장", "제일", "무조건", "역시나",
]);

const MIN_HANGUL_LENGTH = 2;
const MIN_LATIN_LENGTH = 3;

/** Strip one trailing particle when a real stem is left behind. */
function stripParticle(token: string): string {
  for (const particle of PARTICLES) {
    if (token.length > particle.length + 1 && token.endsWith(particle)) {
      return token.slice(0, -particle.length);
    }
  }
  return token;
}

function tokenize(text: string): string[] {
  // Split on everything that is not Hangul, Latin or a digit. Emoji and
  // punctuation are separators, never tokens.
  const chunks = text.split(/[^\p{Script=Hangul}A-Za-z0-9]+/u).filter(Boolean);
  const tokens: string[] = [];

  for (const chunk of chunks) {
    const isHangul = /[\p{Script=Hangul}]/u.test(chunk);

    if (isHangul) {
      const stem = stripParticle(chunk);
      if (stem.length >= MIN_HANGUL_LENGTH && !STOPWORDS.has(stem)) {
        tokens.push(stem);
      }
      continue;
    }

    // Anything with a digit in it is an id, a timestamp or a random handle
    // fragment ("d8t", "cc5qs"), never a keyword.
    if (!/^[A-Za-z]+$/.test(chunk)) continue;

    const lower = chunk.toLowerCase();
    if (lower.length >= MIN_LATIN_LENGTH && !STOPWORDS.has(lower)) {
      tokens.push(lower);
    }
  }

  return tokens;
}

export interface KeywordSource {
  text: string;
  sentiment: Sentiment;
}

/**
 * Count keywords and record the sentiment mix each one appeared in, which is
 * what tints the bars. A term is counted once per comment so a single ranting
 * comment cannot dominate the chart by repetition.
 */
export function extractKeywords(
  comments: KeywordSource[],
  limit = 16,
): KeywordItem[] {
  const total = new Map<string, number>();
  const positive = new Map<string, number>();
  const negative = new Map<string, number>();

  for (const comment of comments) {
    const seen = new Set(tokenize(comment.text));
    for (const term of seen) {
      total.set(term, (total.get(term) ?? 0) + 1);
      if (comment.sentiment === "positive") {
        positive.set(term, (positive.get(term) ?? 0) + 1);
      } else if (comment.sentiment === "negative") {
        negative.set(term, (negative.get(term) ?? 0) + 1);
      }
    }
  }

  return [...total.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .slice(0, limit)
    .map(([term, count]) => {
      const pos = positive.get(term) ?? 0;
      const neg = negative.get(term) ?? 0;
      const polar = pos + neg;
      const positiveRatio = polar === 0 ? 0.5 : pos / polar;

      // Only call a term positive or negative when that context clearly
      // dominates; otherwise it reads as mixed on the chart.
      let context: KeywordItem["context"] = "mixed";
      if (polar >= 3 && positiveRatio >= 0.65) context = "positive";
      else if (polar >= 3 && positiveRatio <= 0.35) context = "negative";

      return { term, count, positiveRatio, context };
    });
}
