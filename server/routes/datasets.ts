// Datasets: question sets kept on the server, plus the ones shipped with the app.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { builtinDatasets, type Dataset, type DatasetFlag, type DatasetFormat, datasetVersion, sampleCases, summarize } from "@/run/datasets";
import { type EvalCase, type Grader, parseCases } from "@/run/evals";
import type { Router } from "../http";
import { runJs } from "../runtime/functions/sandbox";
import { HttpError, type Store } from "../store/files";

const FORMATS: DatasetFormat[] = ["auto", "gsm8k", "mcq", "qa", "custom"];
const GRADERS: Grader[] = ["answer", "contains", "number", "math", "llm", "code"];
const MAX_CASES = 20_000;

/** A dataset by id: one shipped with the app, or one stored here. */
export function findDataset(store: Store, id: string): Dataset | null {
  return builtinDatasets().find((d) => d.id === id) ?? store.getDataset(id);
}

/** Cases from raw text: a custom adapter run on each JSON line, or the formats parseCases reads. */
async function casesFrom(text: string, format: DatasetFormat, adapter?: string): Promise<{ cases: EvalCase[]; skipped: number }> {
  if (format !== "custom") return parseCases(text);
  if (!adapter?.trim()) throw new HttpError(400, "A custom format needs an adapter: JS run on each record, returning {input, expected}");
  const cases: EvalCase[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const out = (await runJs(adapter, record, {}, 2000, { record })) as Partial<EvalCase> | null;
    if (out && out.input != null && out.expected != null) cases.push({ input: String(out.input), expected: String(out.expected) });
    else skipped++;
    if (cases.length > MAX_CASES) throw new HttpError(413, `More than ${MAX_CASES} cases; sample the file first`);
  }
  return { cases, skipped };
}

export function datasetRoutes(r: Router, store: Store) {
  r.on("GET", "/api/datasets", () => ({ datasets: [...builtinDatasets(), ...store.listDatasets()].map(summarize) }));
  r.on("GET", "/api/datasets/:id", (req) => {
    const d = findDataset(store, req.params.id);
    if (!d) throw new HttpError(404, "No such dataset");
    return d;
  });
  r.on("POST", "/api/datasets", async (req) => {
    const b = (await req.body()) as { name?: string; description?: string; text?: string; format?: DatasetFormat; adapter?: string; grader?: Grader; source?: Dataset["source"]; sample?: { n?: number; seed?: number } };
    const name = String(b.name ?? "").trim();
    if (!name) throw new HttpError(400, "Give the dataset a name");
    if (typeof b.text !== "string" || !b.text.trim()) throw new HttpError(400, "Give the questions as text: JSON lines, CSV with a header, or 'question | answer' lines");
    const format = b.format ?? "auto";
    if (!FORMATS.includes(format)) throw new HttpError(400, `format must be one of ${FORMATS.join(", ")}`);
    const grader = b.grader ?? "number";
    if (!GRADERS.includes(grader)) throw new HttpError(400, `grader must be one of ${GRADERS.join(", ")}`);
    const parsed = await casesFrom(b.text, format, b.adapter);
    if (!parsed.cases.length) throw new HttpError(400, `No cases could be read (${parsed.skipped} lines skipped)`);
    const n = Number(b.sample?.n) || undefined;
    const seed = Number(b.sample?.seed ?? 1) || 1;
    const cases = sampleCases(parsed.cases, n, seed);
    const d: Dataset = {
      id: `ds_${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "set"}_${crypto.randomBytes(3).toString("hex")}`,
      name,
      description: String(b.description ?? "") + (n && n < parsed.cases.length ? `${b.description ? " " : ""}(${cases.length} of ${parsed.cases.length}, drawn with seed ${seed})` : ""),
      source: b.source ?? {},
      format,
      ...(format === "custom" ? { adapter: b.adapter } : {}),
      grader,
      version: datasetVersion(cases),
      created_at: new Date().toISOString(),
      cases,
    };
    store.putDataset(d);
    return { ...summarize(d), skipped: parsed.skipped };
  });
  // Questions flagged as broken (a key that cannot be right, a question with no sensible answer): a note on the
  // dataset, not a change to it, so its version and every evaluation of it stay as they are; Compare leaves
  // flagged questions out of scores
  const flagsFile = (id: string) => path.join(store.stateDir("_datasets", id), "flags.json");
  const readFlags = (id: string): DatasetFlag[] => {
    try {
      return JSON.parse(fs.readFileSync(flagsFile(id), "utf8")) as DatasetFlag[];
    } catch {
      return [];
    }
  };
  r.on("GET", "/api/datasets/:id/flags", (req) => {
    if (!findDataset(store, req.params.id)) throw new HttpError(404, "No such dataset");
    return { flags: readFlags(req.params.id) };
  });
  r.on("PUT", "/api/datasets/:id/flags", async (req) => {
    const d = findDataset(store, req.params.id);
    if (!d) throw new HttpError(404, "No such dataset");
    const b = ((await req.body()) ?? {}) as { input?: string; reason?: string | null };
    const input = String(b.input ?? "");
    if (!d.cases.some((c) => c.input === input)) throw new HttpError(400, "That question is not in this dataset");
    const rest = readFlags(d.id).filter((f) => f.input !== input);
    const flags = b.reason == null || !String(b.reason).trim() ? rest : [...rest, { input, reason: String(b.reason).trim().slice(0, 300), at: new Date().toISOString() }];
    fs.writeFileSync(flagsFile(d.id), JSON.stringify(flags, null, 1));
    return { flags };
  });
  r.on("DELETE", "/api/datasets/:id", (req) => {
    if (req.params.id.startsWith("builtin-")) throw new HttpError(400, "A built-in dataset cannot be deleted");
    store.deleteDataset(req.params.id);
    return { ok: true };
  });
}
