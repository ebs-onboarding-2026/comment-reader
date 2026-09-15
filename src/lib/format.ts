/** Display helpers shared by the screens. */

/** 41.2만, 1.3억 — how Korean UIs show large counts. */
export function compactKo(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  if (n >= 100_000_000) return `${trim(n / 100_000_000)}억`;
  if (n >= 10_000) return `${trim(n / 10_000)}만`;
  return n.toLocaleString("ko-KR");
}

function trim(v: number): string {
  return v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
}

export function num(n: number | null | undefined): string {
  return n === null || n === undefined ? "-" : n.toLocaleString("ko-KR");
}

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

/** 2026.08.29 */
export function dateKo(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/** 2026.09.15 14:02 */
export function dateTimeKo(iso: string): string {
  const d = new Date(iso);
  return `${dateKo(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 3분 전, 2일 전 */
export function agoKo(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "방금";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}일 전`;
  return dateKo(iso);
}

/** 2분 04초 */
export function durationKo(seconds: number | null): string {
  if (seconds === null) return "-";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}분 ${String(s).padStart(2, "0")}초` : `${s}초`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export const SENTIMENT_LABEL = {
  positive: "긍정",
  negative: "부정",
  neutral: "중립",
} as const;

export const SENTIMENT_COLOR = {
  positive: "var(--color-positive)",
  negative: "var(--color-negative)",
  neutral: "var(--color-neutral)",
} as const;

export const SENTIMENT_TINT = {
  positive: "var(--color-positive-tint)",
  negative: "var(--color-accent-tint)",
  neutral: "var(--color-sunken)",
} as const;

export const ACTION_LABEL = {
  use_next: "다음 편에 쓸 것",
  fix: "고쳐야 할 것",
  disclose: "밝혀야 할 것",
} as const;

export const TONE_LABEL = {
  mostly_positive: "대체로 긍정",
  mostly_negative: "대체로 부정",
  mixed: "찬반 혼재",
  neutral: "중립",
} as const;
