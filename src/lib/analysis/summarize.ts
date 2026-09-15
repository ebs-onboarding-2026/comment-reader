/**
 * The written layer: cluster labels, question-group labels, the summary
 * paragraph with its three action tags, and the representative comments.
 *
 * Four model calls total, each over a condensed view of the corpus rather than
 * the raw comments, so cost stays flat as a video grows.
 */
import type { ActionItem, Sentiment } from "@/lib/types";

import { getOpenAI, SUMMARY_MODEL } from "./openai";

function jsonSchema(name: string, schema: Record<string, unknown>) {
  return {
    type: "json_schema" as const,
    json_schema: { name, strict: true, schema },
  };
}

async function complete(
  system: string,
  user: unknown,
  responseFormat: ReturnType<typeof jsonSchema>,
): Promise<string> {
  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: SUMMARY_MODEL,
    // See classify.ts — some models accept only the default temperature.
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: typeof user === "string" ? user : JSON.stringify(user),
      },
    ],
    response_format: responseFormat,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("빈 응답을 받았습니다.");
  return raw;
}

/* ----------------------------------------------------------- topic labels */

export interface ClusterForLabeling {
  id: number;
  count: number;
  samples: string[];
}

export interface TopicLabel {
  id: number;
  label: string;
  summary: string;
}

export async function labelTopics(
  clusters: ClusterForLabeling[],
): Promise<TopicLabel[]> {
  if (clusters.length === 0) return [];

  const raw = await complete(
    `유튜브 댓글을 의미로 묶은 군집들이다. 각 군집에 이름을 붙여라.

- label: 이 묶음이 무엇에 대한 것인지 한국어 명사구로 짧게 (12자 이내). 예: "자막 오타 지적", "촬영지 문의", "색감 칭찬"
- summary: 이 묶음의 댓글들이 실제로 무슨 말을 하는지 한 문장으로 (60자 이내).

샘플만 보고 판단하되, 샘플에 없는 내용을 지어내지 마라.`,
    clusters.map((c) => ({
      id: c.id,
      count: c.count,
      samples: c.samples.map((s) => s.slice(0, 300)),
    })),
    jsonSchema("topic_labels", {
      type: "object",
      additionalProperties: false,
      required: ["topics"],
      properties: {
        topics: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "summary"],
            properties: {
              id: { type: "integer" },
              label: { type: "string" },
              summary: { type: "string" },
            },
          },
        },
      },
    }),
  );

  const parsed = JSON.parse(raw) as { topics: TopicLabel[] };
  const byId = new Map(parsed.topics.map((t) => [t.id, t]));

  return clusters.map((c) => ({
    id: c.id,
    label: byId.get(c.id)?.label ?? `묶음 ${c.id + 1}`,
    summary: byId.get(c.id)?.summary ?? "",
  }));
}

/* -------------------------------------------------------- question labels */

export interface QuestionClusterForLabeling {
  id: number;
  count: number;
  samples: string[];
}

export interface QuestionLabel {
  id: number;
  representativeText: string;
  category: string;
}

export async function labelQuestionGroups(
  clusters: QuestionClusterForLabeling[],
): Promise<QuestionLabel[]> {
  if (clusters.length === 0) return [];

  const raw = await complete(
    `같은 것을 묻는 시청자 질문들을 묶었다. 각 묶음을 대표하는 질문 하나를 뽑아라.

- representativeText: 이 묶음의 질문을 가장 명확하게 표현한 한 문장. 샘플 중 하나를 골라도 되고, 여러 표현을 합쳐 자연스럽게 다듬어도 된다. 물음표로 끝낼 것.
- category: 질문의 분류를 2~5자 한국어로. 예: "촬영지", "음악", "장비", "여행 정보", "채널"

샘플에 없는 질문을 지어내지 마라.`,
    clusters.map((c) => ({
      id: c.id,
      count: c.count,
      samples: c.samples.map((s) => s.slice(0, 200)),
    })),
    jsonSchema("question_labels", {
      type: "object",
      additionalProperties: false,
      required: ["groups"],
      properties: {
        groups: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "representativeText", "category"],
            properties: {
              id: { type: "integer" },
              representativeText: { type: "string" },
              category: { type: "string" },
            },
          },
        },
      },
    }),
  );

  const parsed = JSON.parse(raw) as { groups: QuestionLabel[] };
  const byId = new Map(parsed.groups.map((g) => [g.id, g]));

  return clusters.map((c) => ({
    id: c.id,
    representativeText: byId.get(c.id)?.representativeText ?? c.samples[0] ?? "",
    category: byId.get(c.id)?.category ?? "기타",
  }));
}

/* --------------------------------------------------------------- narrative */

export interface NarrativeInput {
  videoTitle: string;
  totalComments: number;
  sentiment: { positive: number; negative: number; neutral: number };
  topics: { label: string; count: number; summary: string }[];
  questions: { representativeText: string; count: number; category: string }[];
  topNegativeSamples: string[];
  topPositiveSamples: string[];
  /** Set when one stretch of the timeline holds a clear excess of negative
   *  comments; null when reaction was evenly spread. */
  negativeWindow: { fromHour: number; toHour: number; negativeShare: number } | null;
}

export interface Narrative {
  summary: string;
  actionItems: ActionItem[];
  timelineInsight: string | null;
}

export async function writeNarrative(input: NarrativeInput): Promise<Narrative> {
  const raw = await complete(
    `유튜브 영상의 댓글 분석 결과를 제작자에게 보고한다.

- summary: 댓글 전체에서 읽히는 것을 3~5문장 한국어로. 가장 많이 반복된 요구를 먼저 쓰고, 영상 평가, 그다음 불만 순으로. 구체적인 숫자와 표현을 인용하라. 일반론("시청자들이 좋아합니다")은 쓰지 마라.
- actionItems: 제작자가 실제로 할 일 2~3개.
  * kind "use_next": 다음 편에 반영할 것
  * kind "fix": 고쳐야 할 것
  * kind "disclose": 밝히거나 공지해야 할 것
  * text는 15자 이내 명사구. 예: "촬영지 목록 고정", "자막 검수 + 노출 시간"
  * 근거가 데이터에 없으면 그 항목은 넣지 마라.
- timelineInsight: negativeWindow가 주어졌을 때만, 그 구간에 무슨 일이 있었는지 한 문장으로. 없으면 null.

주어진 데이터에 없는 사실을 지어내지 마라.`,
    input,
    jsonSchema("narrative", {
      type: "object",
      additionalProperties: false,
      required: ["summary", "actionItems", "timelineInsight"],
      properties: {
        summary: { type: "string" },
        actionItems: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "text"],
            properties: {
              kind: { type: "string", enum: ["use_next", "fix", "disclose"] },
              text: { type: "string" },
            },
          },
        },
        timelineInsight: { type: ["string", "null"] },
      },
    }),
  );

  return JSON.parse(raw) as Narrative;
}

/* --------------------------------------------------------- representatives */

export interface RepresentativeCandidate {
  commentId: string;
  text: string;
  sentiment: Sentiment;
  topicLabel: string;
}

export interface RepresentativeLabel {
  commentId: string;
  label: string;
  reason: string;
}

export async function labelRepresentatives(
  candidates: RepresentativeCandidate[],
): Promise<RepresentativeLabel[]> {
  if (candidates.length === 0) return [];

  const raw = await complete(
    `각 댓글이 어떤 반응을 대표하는지 설명하라.

- label: 이 댓글이 대표하는 반응을 6자 이내 한국어로. 예: "색감 칭찬", "자막 불만", "촬영지 문의"
- reason: 왜 이 댓글이 그 반응을 대표하는지 한 줄(35자 이내). 댓글의 표현을 인용하면 좋다.`,
    candidates.map((c) => ({
      commentId: c.commentId,
      text: c.text.slice(0, 400),
      sentiment: c.sentiment,
      topic: c.topicLabel,
    })),
    jsonSchema("representatives", {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["commentId", "label", "reason"],
            properties: {
              commentId: { type: "string" },
              label: { type: "string" },
              reason: { type: "string" },
            },
          },
        },
      },
    }),
  );

  const parsed = JSON.parse(raw) as { items: RepresentativeLabel[] };
  const byId = new Map(parsed.items.map((i) => [i.commentId, i]));

  return candidates.map((c) => ({
    commentId: c.commentId,
    label: byId.get(c.commentId)?.label ?? c.topicLabel,
    reason: byId.get(c.commentId)?.reason ?? "",
  }));
}
