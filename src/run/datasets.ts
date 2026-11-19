// Datasets: question sets an evaluation runs on, kept as first-class things.
// A dataset says where its questions came from (and under what licence), how
// raw records were turned into cases, how answers are graded, and which
// version it is, so an evaluation can say exactly what it ran.
import { type EvalCase, type Grader, SAMPLE_SETS, parseCases } from "./evals";

/** How raw records become cases: guessed from their shape, or a named benchmark format, or a function. */
export type DatasetFormat = "auto" | "gsm8k" | "mcq" | "qa" | "custom";

export interface DatasetSource {
  /** where the questions came from: a URL, a paper, "pasted" */
  origin?: string;
  license?: string;
  citation?: string;
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  source: DatasetSource;
  format: DatasetFormat;
  /** for format "custom": JS run on each raw record (`record`), returning {input, expected} or null to skip it */
  adapter?: string;
  /** the grader that suits it, offered by default */
  grader: Grader;
  /** a hash of the cases: a changed dataset is a new version */
  version: string;
  created_at: string;
  /** built in to the app: read-only */
  builtin?: boolean;
  cases: EvalCase[];
}

/** A question marked as broken: its key cannot be right, or it has no sensible answer. Compare leaves it out. */
export interface DatasetFlag {
  input: string;
  reason: string;
  at: string;
}

export type DatasetSummary = Omit<Dataset, "cases" | "adapter"> & { total: number };

/** A short hash of the cases, as the dataset's version. */
export function datasetVersion(cases: EvalCase[]): string {
  let h = 0x811c9dc5;
  const text = cases.map((c) => `${c.input}\u0000${c.expected}`).join("\u0001");
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `v${(h >>> 0).toString(36)}`;
}

/** A seeded random number generator (mulberry32): the same seed gives the same sample everywhere. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` cases drawn at random with `seed`, in their original order. The whole set when n is missing or not smaller. */
export function sampleCases<T>(cases: T[], n?: number, seed = 1): T[] {
  if (!n || n >= cases.length) return cases;
  const next = rng(seed);
  const idx = cases.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx
    .slice(0, n)
    .sort((a, b) => a - b)
    .map((i) => cases[i]);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The sample sets shipped with the app, as read-only datasets. */
export function builtinDatasets(): Dataset[] {
  return SAMPLE_SETS.map((s) => {
    const cases = parseCases(s.text).cases;
    return {
      id: `builtin-${slug(s.name)}`,
      name: s.name,
      description: "A sample set shipped with MAS Studio; answers computed by program or checked by hand.",
      source: { origin: "MAS Studio" },
      format: "qa" as const,
      grader: s.grader,
      version: datasetVersion(cases),
      created_at: "2026-11-17T00:00:00.000Z",
      builtin: true,
      cases,
    };
  });
}

export const summarize = ({ cases, adapter: _a, ...rest }: Dataset): DatasetSummary => ({ ...rest, total: cases.length });
