// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Builder, native } from "@/model/builder";
import { port } from "@/model/ports";
import { type EvalRecord, repeatStats } from "@/run/evals";
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
function echo(script: unknown[] = ["Answer: {{input}}"], model = "echo") {
  const b = new Builder("Echo", "");
  b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
    .agent("a", 200, 0, { name: "Echo", model, harness: { ...native(), loop: "single_shot", instructions: "" } })
    .edge("me", "a", "message")
    .edge("a", "me", "message");
  b.doc.models.push({ id: model, provider: "mock", model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
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

  it("regrades stored outputs without running anything again", async () => {
    const done = await finish(evals.start(echo(), { grader: "answer", cases: [{ input: "Paris", expected: "the capital is Paris" }] }).id);
    expect(done.cases[0].pass).toBe(false);
    const runsBefore = store.listRuns().length;
    const again = evals.regrade(done.id, "contains");
    expect(again.grader).toBe("contains");
    expect(again.cases[0].pass).toBe(false);
    expect(evals.regrade(done.id, "answer").passed).toBe(0);
    expect(store.listRuns().length).toBe(runsBefore);
    expect(() => evals.regrade(done.id, "llm" as never)).toThrow(/would call a model/);
  });

  it("repeats every question, and reports each repeat's accuracy and their spread", async () => {
    // the echo alternates right and wrong across calls: repeat 1 and repeat 2 differ
    // its own model id: a mock's place in its script is kept per model across runs
    const doc = echo(["Answer: 1", "Answer: 2"], "alternating");
    const done = await finish(evals.start(doc, { grader: "number", repeats: 2, concurrency: 1, cases: [{ input: "q", expected: "1" }] }).id);
    expect(done.repeats).toBe(2);
    expect(done.cases.map((c) => [c.case, c.repeat])).toEqual([[0, 0], [0, 1]]);
    const st = repeatStats(done);
    expect(st.per.length).toBe(2);
    expect(st.mean).toBe(0.5);
    expect(st.byCase.get(0)).toEqual({ passed: 1, graded: 2 });
  });

  it("stops early when every run fails with the same account error, and says so", async () => {
    // a provider with a key that is refused: openai_compatible against a server that answers 401
    const http = await import("node:http");
    const server = http.createServer((_q, res) => res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "The bound service account is deleted or disabled." } })));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const doc = echo();
    doc.models = [{ id: "echo", provider: "openai_compatible", model: "x", api: { base_url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` }, price_in: 0, price_out: 0, modalities: ["text"] }];
    try {
      const done = await finish(evals.start(doc, { grader: "number", concurrency: 1, cases: Array.from({ length: 10 }, (_, i) => ({ input: String(i), expected: String(i) })) }).id);
      expect(done.status).toBe("stopped");
      expect(done.cases.filter((c) => c.run_id).length).toBe(3);
      expect(done.cases[0].why).toMatch(/^no output: .*401/);
      expect(done.stop_reason).toMatch(/same account error/);
    } finally {
      server.close();
    }
  });

  it("refuses to start when a model the system calls has no key, naming it and who uses it", () => {
    const doc = echo();
    doc.models = [{ id: "echo", provider: "anthropic", model: "x", api: { key_env: "NO_SUCH_KEY_FOR_TEST" }, price_in: 0, price_out: 0, modalities: ["text"] }];
    const before = store.listEvals().length;
    expect(() => evals.start(doc, { grader: "number", cases: [{ input: "1", expected: "1" }] })).toThrow(/Model "echo" needs NO_SUCH_KEY_FOR_TEST \(used by a\).*on_model/);
    expect(store.listEvals().length).toBe(before);
    // a mock evaluation calls no model, so it may start
    expect(evals.start(doc, { grader: "number", mock: true, cases: [{ input: "1", expected: "1" }] }).id).toMatch(/^eval_/);
  });

  it("starts every run with the evaluation's variables", async () => {
    const b = new Builder("Vars", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .node("f", "function", 200, 0, { name: "Reads x", fn: { lang: "js", code: 'return "Answer: " + ctx.vars.x;' }, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } })
      .edge("me", "f", "message")
      .edge("f", "me", "message");
    const done = await finish(evals.start({ ...b.doc, id: "sys_vars" }, { grader: "number", vars: { x: 7 }, cases: [{ input: "?", expected: "7" }] }).id);
    expect(done.vars).toEqual({ x: 7 });
    expect(done.cases[0]).toMatchObject({ pass: true, output: "Answer: 7" });
  });

  it("runs queued evaluations one at a time, in order, and can stop one before its turn", async () => {
    const cases = [{ input: "4", expected: "4" }, { input: "5", expected: "5" }];
    const a = evals.start(echo(), { grader: "number", cases }, true);
    const b = evals.start(echo(), { grader: "number", cases }, true);
    const c = evals.start(echo(), { grader: "number", cases }, true);
    expect([a.status, b.status, c.status]).toEqual(["queued", "queued", "queued"]);
    expect(evals.stop(c.id)).toBe(true);
    expect(evals.get(c.id)).toMatchObject({ status: "stopped" });
    const [da, db] = [await finish(a.id), await finish(b.id)];
    expect([da.status, db.status, da.passed, db.passed]).toEqual(["finished", "finished", 2, 2]);
    // b started after a was done: never two at once
    expect(new Date(db.started_at).getTime()).toBeGreaterThanOrEqual(new Date(da.finished_at!).getTime());
    const dc = await finish(c.id);
    expect(dc.status).toBe("stopped");
    expect(dc.cases.every((x) => x.status === "pending" && !x.run_id)).toBe(true);
  });

  it("gives each run the evaluation's time limit instead of the system's, and refuses one out of range", async () => {
    const rec = evals.start(echo(), { grader: "number", cases: [{ input: "4", expected: "4" }], time_limit_min: 30 });
    expect(rec.time_limit_min).toBe(30);
    expect((await finish(rec.id)).passed).toBe(1);
    expect(() => evals.start(echo(), { grader: "number", cases: [{ input: "4", expected: "4" }], time_limit_min: 500 })).toThrow(/1 to 120/);
  });

  it("marks evaluations a restart cut off as stopped", () => {
    store.putEval({ id: "eval_cut", system_id: "s", system_name: "S", grader: "answer", mock: false, status: "running", started_at: new Date().toISOString(), cases: [{ input: "x", expected: "y", status: "running" }], passed: 0, graded: 0, usd: 0 });
    evals.recover();
    expect(store.getEval("eval_cut")).toMatchObject({ status: "stopped", cases: [{ status: "error", why: "the server restarted" }] });
  });
});
