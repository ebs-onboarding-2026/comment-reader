/**
 * Embedding + k-means, used twice: once to group comments into the topic
 * panel, and once to fold differently-worded questions into one row.
 *
 * Embeddings are cheap enough that every comment gets one — no sampling.
 */
import { getOpenAI, EMBEDDING_MODEL } from "./openai";

/** The embeddings endpoint accepts large arrays; this keeps each request
 *  comfortably inside the per-request token ceiling. */
const EMBED_BATCH = 256;

export async function embedAll(
  texts: string[],
  onProgress?: (done: number, total: number) => void | Promise<void>,
): Promise<Float32Array[]> {
  const openai = getOpenAI();
  const out: Float32Array[] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const slice = texts.slice(i, i + EMBED_BATCH);
    const resp = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      // The API rejects empty strings, and a blank comment has no topic anyway.
      input: slice.map((t) => t.slice(0, 2000) || " "),
    });

    resp.data.forEach((d, j) => {
      out[i + j] = Float32Array.from(d.embedding);
    });

    await onProgress?.(Math.min(i + EMBED_BATCH, texts.length), texts.length);
  }

  return out;
}

/** Cosine distance on already-normalized vectors reduces to the dot product,
 *  and OpenAI returns unit vectors — so this is just 1 - dot. */
function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return 1 - dot;
}

function meanVector(vectors: Float32Array[], dim: number): Float32Array {
  const acc = new Float64Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) acc[i] += v[i];
  }

  const out = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    out[i] = acc[i] / vectors.length;
    norm += out[i] * out[i];
  }

  // Re-normalize so centroids stay comparable to the unit-length inputs.
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) out[i] /= norm;
  }
  return out;
}

/** Deterministic PRNG so the same collection always produces the same
 *  clusters — a dashboard that reshuffles its topics on reload is not
 *  trustworthy. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ClusterResult {
  /** Cluster index per input vector. */
  assignments: number[];
  /** Member indices per cluster, largest cluster first. */
  clusters: number[][];
}

/**
 * k-means++ initialization then Lloyd's algorithm. Small and dependency-free;
 * at a few thousand vectors this runs in well under a second.
 */
export function kmeans(
  vectors: Float32Array[],
  k: number,
  { maxIterations = 40, seed = 42 } = {},
): ClusterResult {
  const n = vectors.length;
  if (n === 0) return { assignments: [], clusters: [] };

  const effectiveK = Math.max(1, Math.min(k, n));
  const dim = vectors[0].length;
  const rand = mulberry32(seed);

  // k-means++ seeding: spread the initial centroids by squared distance.
  const centroids: Float32Array[] = [vectors[Math.floor(rand() * n)]];
  while (centroids.length < effectiveK) {
    const d2 = vectors.map((v) => {
      let best = Infinity;
      for (const c of centroids) best = Math.min(best, cosineDistance(v, c));
      return best * best;
    });

    const total = d2.reduce((a, b) => a + b, 0);
    if (total === 0) {
      centroids.push(vectors[Math.floor(rand() * n)]);
      continue;
    }

    let target = rand() * total;
    let picked = n - 1;
    for (let i = 0; i < n; i++) {
      target -= d2[i];
      if (target <= 0) {
        picked = i;
        break;
      }
    }
    centroids.push(vectors[picked]);
  }

  const assignments = new Array<number>(n).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    let moved = false;

    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const dist = cosineDistance(vectors[i], centroids[c]);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        moved = true;
      }
    }

    if (!moved && iter > 0) break;

    for (let c = 0; c < centroids.length; c++) {
      const members = vectors.filter((_, i) => assignments[i] === c);
      // An emptied cluster gets re-seeded rather than left to collapse.
      centroids[c] = members.length
        ? meanVector(members, dim)
        : vectors[Math.floor(rand() * n)];
    }
  }

  const clusters: number[][] = Array.from({ length: centroids.length }, () => []);
  assignments.forEach((c, i) => clusters[c].push(i));

  const ordered = clusters
    .map((members, id) => ({ id, members }))
    .filter((c) => c.members.length > 0)
    .sort((a, b) => b.members.length - a.members.length);

  // Renumber so cluster 0 is the largest, which is the order the UI shows.
  const remap = new Map(ordered.map((c, newId) => [c.id, newId]));
  return {
    assignments: assignments.map((c) => remap.get(c) ?? 0),
    clusters: ordered.map((c) => c.members),
  };
}

/**
 * Pick a cluster count from the corpus size. Comment threads do not have a
 * clean elbow, and a stable, explainable rule beats an unstable search:
 * roughly sqrt(n/12), held between 4 and 12.
 */
export function suggestClusterCount(n: number): number {
  if (n < 20) return Math.max(1, Math.floor(n / 5));
  return Math.max(4, Math.min(12, Math.round(Math.sqrt(n / 12))));
}

/** The members closest to their centroid — the best comments to show as
 *  examples of what a cluster is about. */
export function representativeIndices(
  vectors: Float32Array[],
  members: number[],
  count: number,
): number[] {
  if (members.length === 0) return [];

  const dim = vectors[0].length;
  const centroid = meanVector(
    members.map((i) => vectors[i]),
    dim,
  );

  return [...members]
    .sort(
      (a, b) =>
        cosineDistance(vectors[a], centroid) - cosineDistance(vectors[b], centroid),
    )
    .slice(0, count);
}
