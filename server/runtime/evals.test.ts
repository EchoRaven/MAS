// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Builder, native } from "@/model/builder";
import type { EvalRecord } from "@/run/evals";
import type { Config } from "../config";
import { Store } from "../store/files";
import { Secrets } from "../store/secrets";
import { EvalManager } from "./evals";
import { RunManager } from "./runs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-evals-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const config: Config = { host: "127.0.0.1", port: 0, dataDir: dir, token: "t", allowLocalExec: false, docker: "/x", parallelism: 2 };
const store = new Store(dir);
const runs = new RunManager(store, new Secrets(dir), config);
const evals = new EvalManager(store, runs, new Secrets(dir));

// an agent that answers with its input: the grades are known in advance
function echo(script: unknown[] = ["Answer: {{input}}"]) {
  const b = new Builder("Echo", "");
  b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
    .agent("a", 200, 0, { name: "Echo", model: "echo", harness: { ...native(), loop: "single_shot", instructions: "" } })
    .edge("me", "a", "message")
    .edge("a", "me", "message");
  b.doc.models.push({ id: "echo", provider: "mock", model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
  return { ...b.doc, id: "sys_echo" };
}

async function finish(id: string): Promise<EvalRecord> {
  for (let i = 0; i < 1000 && evals.isActive(id); i++) await new Promise((r) => setTimeout(r, 10));
  return evals.get(id)!;
}

describe("evaluations", () => {
  it("runs every case as a run and grades it", async () => {
    const rec = evals.start(echo(), { grader: "number", concurrency: 2, cases: [{ input: "4", expected: "4" }, { input: "5", expected: "6" }, { input: "7", expected: "7" }] });
    const done = await finish(rec.id);
    expect(done.status).toBe("finished");
    expect(done.cases.map((c) => c.pass)).toEqual([true, false, true]);
    expect([done.passed, done.graded]).toEqual([2, 3]);
    expect(done.cases[1].why).toBe("5 ≠ 6");
    // each case is an ordinary run that can be replayed
    expect(done.cases.every((c) => c.run_id && runs.get(c.run_id)?.status === "finished")).toBe(true);
    expect(store.listEvals("sys_echo").map((e) => e.id)).toContain(rec.id);
  });

  it("grades with a judge model for the llm grader", async () => {
    const doc = echo();
    doc.models.push({ id: "judge", provider: "mock", model: "mock", api: { params: { script: ["PASS: same answer"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const done = await finish(evals.start(doc, { grader: "llm", judge: "judge", cases: [{ input: "four", expected: "4" }] }).id);
    expect(done.cases[0]).toMatchObject({ pass: true, why: "judge: PASS: same answer" });
  });

  it("marks evaluations a restart cut off as stopped", () => {
    store.putEval({ id: "eval_cut", system_id: "s", system_name: "S", grader: "answer", mock: false, status: "running", started_at: new Date().toISOString(), cases: [{ input: "x", expected: "y", status: "running" }], passed: 0, graded: 0, usd: 0 });
    evals.recover();
    expect(store.getEval("eval_cut")).toMatchObject({ status: "stopped", cases: [{ status: "error", why: "the server restarted" }] });
  });
});
