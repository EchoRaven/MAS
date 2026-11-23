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

  it("marks an evaluation invalid with a reason, keeps it, and clears the mark", async () => {
    const done = await finish(evals.start(echo(), { grader: "number", cases: [{ input: "4", expected: "4" }] }).id);
    const bad = evals.markInvalid(done.id, "  the scratchpad was shared across runs  ");
    expect(bad.invalid?.reason).toBe("the scratchpad was shared across runs");
    expect(evals.get(done.id)?.invalid?.reason).toBe("the scratchpad was shared across runs");
    expect(evals.get(done.id)?.passed).toBe(1); // nothing else changes
    expect(evals.markInvalid(done.id, null).invalid).toBeNull();
    expect(evals.markInvalid(done.id, "   ").invalid).toBeNull(); // an empty reason is no mark
    expect(() => evals.markInvalid("eval_nope", "x")).toThrow(/No such evaluation/);
  });

  it("regrades stored outputs without running anything again", async () => {
    const done = await finish(evals.start(echo(), { grader: "answer", cases: [{ input: "Paris", expected: "the capital is Paris" }] }).id);
    expect(done.cases[0].pass).toBe(false);
    const runsBefore = store.listRuns().length;
    const again = await evals.regrade(done.id, "contains");
    expect(again.grader).toBe("contains");
    expect(again.cases[0].pass).toBe(false);
    expect((await evals.regrade(done.id, "answer")).passed).toBe(0);
    expect(store.listRuns().length).toBe(runsBefore);
    await expect(evals.regrade(done.id, "llm" as never)).rejects.toThrow(/would call a model/);
    // code is graded by running it against tests the cases carry: a text answer cannot switch to it
    await expect(evals.regrade(done.id, "code")).rejects.toThrow(/cannot switch/);
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

  it("checks each answer against what the evaluation expects: an unmarked answer is flagged, its grade kept", async () => {
    const doc = echo(["{{input}}"]);
    const done = await finish(evals.start(doc, { grader: "number", expect: { type: "number", marked: true }, cases: [{ input: "Answer: 4", expected: "4" }, { input: "checked: 5", expected: "5" }] }).id);
    expect(done.expect).toEqual({ type: "number", marked: true });
    expect(done.cases.map((c) => [c.pass, c.result_ok])).toEqual([[true, true], [true, false]]);
  });

  it("tells a miss the team had and lost from one nobody found", async () => {
    // the agent answers with its input; a function after it throws that away and answers 0
    const b = new Builder("Loser", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 200, 0, { name: "Solver", model: "echo_l", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .node("f", "function", 400, 0, { name: "Lose", fn: { lang: "js", code: 'return "Answer: 0";' } })
      .edge("me", "a", "message")
      .edge("a", "f", "message")
      .edge("f", "me", "message");
    b.doc.models.push({ id: "echo_l", provider: "mock", model: "mock", api: { params: { script: ["Answer: {{input}}"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const doc = { ...b.doc, id: "sys_loser" };
    store.putSystem(doc);
    const done = await finish(evals.start(doc, { grader: "number", concurrency: 1, cases: [{ input: "7", expected: "7" }, { input: "5", expected: "6" }] }).id);
    expect(done.cases.map((c) => c.pass)).toEqual([false, false]);
    expect(done.cases[0].reached).toEqual(["Solver"]); // the solver said 7; the team answered 0
    expect(done.cases[1].reached).toEqual([]); // nobody said 6
    // an evaluation from before this was recorded gets it by regrading, from the runs' logs
    const old = store.getEval(done.id)!;
    for (const c of old.cases) delete c.reached;
    store.putEval(old);
    const again = await evals.regrade(done.id);
    expect(again.cases.map((c) => c.reached)).toEqual([["Solver"], []]);
  });

  it("asks the judge about the misses only, and leaves the grades alone", async () => {
    // a function that writes 0.5 where the key says 1/2 (a grader would have to know), and 7 where it says 8
    const b = new Builder("Halves", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .node("f", "function", 200, 0, { name: "F", fn: { lang: "js", code: 'const q = String(input?.text ?? input);\nreturn q === "half" ? "Answer: one half" : q === "two" ? "Answer: 2" : "Answer: 7";' } })
      .edge("me", "f", "message")
      .edge("f", "me", "message");
    b.doc.models.push({ id: "judge_a", provider: "mock", model: "mock", api: { params: { script: ["PASS: one half is 1/2", "FAIL: 7 is not 8"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const doc = { ...b.doc, id: "sys_halves" };
    store.putSystem(doc);
    const done = await finish(evals.start(doc, { grader: "answer", cases: [{ input: "half", expected: "1/2" }, { input: "two", expected: "2" }, { input: "seven", expected: "8" }] }).id);
    expect(done.cases.map((c) => c.pass)).toEqual([false, true, false]);
    const checked = await evals.audit(done.id, "judge_a");
    expect(checked.cases.map((c) => c.audit?.pass)).toEqual([true, undefined, false]); // the right answer is not asked about
    expect(checked.cases.map((c) => c.pass)).toEqual([false, true, false]); // grades stand
    expect(checked.passed).toBe(1);
  });

  it("keeps open-ended outputs ungraded, and judges two systems pairwise in both orders", async () => {
    const writer = (id: string, text: string) => {
      const b = new Builder(id, "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .node("f", "function", 200, 0, { name: "W", fn: { lang: "js", code: `return ${JSON.stringify(text)} + " on " + String(input?.text ?? input);` } })
        .edge("me", "f", "message")
        .edge("f", "me", "message");
      // the judge answers in order: q1 a-first "1" (a), b-first "2" (a); q2 a-first "1" (a), b-first "1" (b)
      b.doc.models.push({ id: "judge_p", provider: "mock", model: "mock", api: { params: { script: ["fine. Better: 1", "fine. Better: 2", "fine. Better: 1", "fine. Better: 1"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
      return { ...b.doc, id };
    };
    const [da, db] = [writer("sys_wa", "A careful story"), writer("sys_wb", "A story")];
    store.putSystem(da);
    store.putSystem(db);
    const cases = [{ input: "a fox", expected: "" }, { input: "a river", expected: "" }];
    const ea = await finish(evals.start(da, { grader: "none", cases }).id);
    const eb = await finish(evals.start(db, { grader: "none", cases }).id);
    expect(ea.cases.map((c) => c.pass)).toEqual([undefined, undefined]); // nothing graded
    expect(ea.cases[0].output).toContain("A careful story on a fox");
    const r = await evals.pairwise(ea.id, eb.id, "judge_p");
    expect(r.per.map((p) => [p.first, p.second, p.verdict])).toEqual([["a", "a", "a"], ["a", "b", "tie"]]);
    expect([r.a_wins, r.b_wins, r.ties]).toEqual([1, 0, 1]);
    expect(evals.pairwiseOf(eb.id).map((x) => x.a)).toEqual([ea.id]);
  });

  it("lists a pairwise judgement while it runs, then only its result", async () => {
    const writer = (id: string, text: string) => {
      const b = new Builder(id, "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .node("f", "function", 200, 0, { name: "W", fn: { lang: "js", code: `return ${JSON.stringify(text)};` } })
        .edge("me", "f", "message")
        .edge("f", "me", "message");
      b.doc.models.push({ id: "judge_q", provider: "mock", model: "mock", api: { params: { script: ["ok. Better: 1"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
      return { ...b.doc, id };
    };
    const cases = [{ input: "a bird", expected: "" }, { input: "a stone", expected: "" }];
    const da = writer("sys_qa", "one");
    store.putSystem(da);
    const ea = await finish(evals.start(da, { grader: "none", cases }).id);
    const eb = await finish(evals.start(writer("sys_qb", "two"), { grader: "none", cases }).id);
    const job = evals.pairwise(ea.id, eb.id, "judge_q");
    expect(evals.judgingOf(ea.id)).toMatchObject([{ a: ea.id, b: eb.id, judge: "judge_q", total: 2 }]);
    await job;
    expect(evals.judgingOf(ea.id)).toEqual([]);
    // a request that cannot start fails before its first await
    const bad = evals.pairwise(ea.id, "eval_nope", "judge_q");
    await expect(Promise.race([bad, Promise.resolve("started")])).rejects.toThrow(/No such evaluation/);
  });

  it("shows the judge a long answer to its end (a 20,000-character list is not cut at 12,000)", async () => {
    const writer = (id: string, text: string) => {
      const b = new Builder(id, "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .node("f", "function", 200, 0, { name: "W", fn: { lang: "js", code: `return ${JSON.stringify(text)};` } })
        .edge("me", "f", "message")
        .edge("f", "me", "message");
      // the judge repeats its prompt, so its reply shows what it was given
      b.doc.models.push({ id: "judge_echo", provider: "mock", model: "mock", api: { params: { script: ["{{input}} Better: 1"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
      return { ...b.doc, id };
    };
    const long = "x".repeat(20_000) + " ZZEND";
    const cases = [{ input: "list", expected: "" }];
    const da = writer("sys_la", "short answer");
    store.putSystem(da);
    const ea = await finish(evals.start(da, { grader: "none", cases }).id);
    const eb = await finish(evals.start(writer("sys_lb", long), { grader: "none", cases }).id);
    expect(eb.cases[0].output).toContain("ZZEND"); // the run's answer is whole
    const r = await evals.pairwise(ea.id, eb.id, "judge_echo");
    expect(r.per[0].why?.[0]).toContain("ZZEND"); // a first, b second: the end of b reached the judge
  });

  it("keeps one judge's verdicts under different criteria apart", async () => {
    const writer = (id: string, text: string) => {
      const b = new Builder(id, "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .node("f", "function", 200, 0, { name: "W", fn: { lang: "js", code: `return ${JSON.stringify(text)};` } })
        .edge("me", "f", "message")
        .edge("f", "me", "message");
      b.doc.models.push({ id: "judge_c", provider: "mock", model: "mock", api: { params: { script: ["ok. Better: 1"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
      return { ...b.doc, id };
    };
    const cases = [{ input: "a moth", expected: "" }];
    const da = writer("sys_ca", "one");
    store.putSystem(da);
    const ea = await finish(evals.start(da, { grader: "none", cases }).id);
    const eb = await finish(evals.start(writer("sys_cb", "two"), { grader: "none", cases }).id);
    await evals.pairwise(ea.id, eb.id, "judge_c");
    await evals.pairwise(ea.id, eb.id, "judge_c", "Judge the content, not the length.");
    const kept = evals.pairwiseOf(ea.id);
    expect(kept.length).toBe(2);
    expect(kept.map((k) => k.criterion).sort()[0]).toBe("Judge the content, not the length.");
  });

  it("scores each output alone in pointwise mode, so order cannot sway it", async () => {
    const writer = (id: string, text: string) => {
      const b = new Builder(id, "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .node("f", "function", 200, 0, { name: "W", fn: { lang: "js", code: `return ${JSON.stringify(text)};` } })
        .edge("me", "f", "message")
        .edge("f", "me", "message");
      // scores in order: q1 a 8, q1 b 5; q2 a 6, q2 b 6
      b.doc.models.push({ id: "judge_s", provider: "mock", model: "mock", api: { params: { script: ["good. Score: 8", "weaker. Score: 5", "fine. Score: 6", "fine. Score: 6"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
      return { ...b.doc, id };
    };
    const cases = [{ input: "a cat", expected: "" }, { input: "a lake", expected: "" }];
    const da = writer("sys_sa", "one");
    store.putSystem(da);
    const ea = await finish(evals.start(da, { grader: "none", cases }).id);
    const eb = await finish(evals.start(writer("sys_sb", "two"), { grader: "none", cases }).id);
    const r = await evals.pairwise(ea.id, eb.id, "judge_s", undefined, undefined, true);
    expect(r.mode).toBe("pointwise");
    expect(r.judge).toBe("judge_s (pointwise)");
    expect(r.per.map((x) => [x.verdict, x.scores])).toEqual([["a", [8, 5]], ["tie", [6, 6]]]);
    expect([r.a_wins, r.b_wins, r.ties]).toEqual([1, 0, 1]);
    const { firstPicks } = await import("@/run/evals");
    expect(firstPicks(r.per, r.mode)).toEqual({ first: 0, picked: 0 });
  });

  it("lets a system judge pairwise (a referee panel), reading the verdict from its output", async () => {
    const writer = (id: string, text: string) => {
      const b = new Builder(id, "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .node("f", "function", 200, 0, { name: "W", fn: { lang: "js", code: `return ${JSON.stringify(text)};` } })
        .edge("me", "f", "message")
        .edge("f", "me", "message");
      return { ...b.doc, id };
    };
    const cases = [{ input: "a fox", expected: "" }];
    const ea = await finish(evals.start(writer("sys_pa", "first story"), { grader: "none", cases }).id);
    const eb = await finish(evals.start(writer("sys_pb", "second story"), { grader: "none", cases }).id);
    // a panel that always prefers whatever is shown first: the two orders disagree, so it is a tie
    const panel = writer("sys_panel", "We discussed it. Better: 1");
    store.putSystem(panel);
    const r = await evals.pairwise(ea.id, eb.id, undefined, undefined, "sys_panel");
    expect(r.per.map((p) => [p.first, p.second, p.verdict])).toEqual([["a", "b", "tie"]]);
    expect(r.judge).toContain(panel.name);
    // a panel's verdicts and a plain judge's sit side by side
    expect(evals.pairwiseOf(ea.id).map((x) => x.judge)).toEqual([r.judge]);
    await expect(evals.pairwise(ea.id, eb.id, undefined, undefined, "sys_none")).rejects.toThrow(/No such system/);
  });

  it("runs a case a provider failed in passing once more at the end", async () => {
    // the first call for "busy" meets an overloaded provider; the second answers
    const b = new Builder("Busy", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .node("f", "function", 200, 0, { name: "F", fn: { lang: "js", code: 'const q = String(input?.text ?? input);\nconst k = "busy_" + q;\nconst n = (ctx.state.get(k) ?? 0) + 1;\nctx.state.set(k, n);\nif (q === "busy" && n === 1) throw new Error("google 503: This model is currently overloaded");\nif (q === "broken") throw new Error("google 503: still overloaded");\nreturn "Answer: " + q;' } })
      .edge("me", "f", "message")
      .edge("f", "me", "message");
    const doc = { ...b.doc, id: "sys_busy" };
    store.putSystem(doc);
    const done = await finish(evals.start(doc, { grader: "contains", cases: [{ input: "busy", expected: "busy" }, { input: "calm", expected: "calm" }, { input: "broken", expected: "broken" }] }).id);
    expect(done.cases.map((c) => c.pass)).toEqual([true, true, false]); // a second failure stands
    expect(done.auto_retried).toBe(2);
    expect(done.status).toBe("finished");
  });

  it("retries only the cases that gave no answer, in place, and keeps the others", async () => {
    // a function that fails the first time it sees "flaky" (a dropped connection, say) and answers after that
    const b = new Builder("Flaky", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .node("f", "function", 200, 0, { name: "F", fn: { lang: "js", code: 'const q = String(input?.text ?? input);\nconst k = "seen_" + q;\nconst n = (ctx.state.get(k) ?? 0) + 1;\nctx.state.set(k, n);\nif (q === "flaky" && n === 1) throw new Error("connection dropped");\nreturn "Answer: " + q;' } })
      .edge("me", "f", "message")
      .edge("f", "me", "message");
    const doc = { ...b.doc, id: "sys_flaky" };
    store.putSystem(doc);
    const done = await finish(evals.start(doc, { grader: "contains", cases: [{ input: "steady", expected: "steady" }, { input: "flaky", expected: "flaky" }] }).id);
    expect(done.cases.map((c) => c.pass)).toEqual([true, false]);
    const steadyRun = done.cases[0].run_id;
    const again = await finish(evals.retry(done.id).id);
    expect(again.cases.map((c) => c.pass)).toEqual([true, true]);
    expect(again.cases[0].run_id).toBe(steadyRun); // the case that answered was not run again
    expect([again.passed, again.graded, again.status]).toEqual([2, 2, "finished"]);
    expect(() => evals.retry(done.id)).toThrow(/No case to retry/);
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

  it("gives each run the evaluation's spending limit instead of the system's budget, and refuses one out of range", async () => {
    const rec = evals.start(echo(), { grader: "number", cases: [{ input: "4", expected: "4" }], usd_limit: 0.25 });
    expect(rec.usd_limit).toBe(0.25);
    const done = await finish(rec.id);
    expect(done.passed).toBe(1);
    expect(store.getRunSystem(done.cases[0].run_id!)?.budget.usd).toBe(0.25);
    expect(() => evals.start(echo(), { grader: "number", cases: [{ input: "4", expected: "4" }], usd_limit: 0 })).toThrow(/usd_limit/);
    expect(() => evals.start(echo(), { grader: "number", cases: [{ input: "4", expected: "4" }], usd_limit: 500 })).toThrow(/usd_limit/);
  });

  it("stops starting cases once the evaluation has spent past its limit, and says so", async () => {
    const cases = Array.from({ length: 6 }, (_, i) => ({ input: String(i), expected: String(i) }));
    // a priced model, so each run costs something (the plain echo model is free)
    const priced = echo();
    priced.models = priced.models.map((m) => (m.id === "echo" ? { ...m, price_in: 1e6, price_out: 1e6 } : m));
    const rec = evals.start(priced, { grader: "number", cases, concurrency: 1, max_usd: 0.000001 });
    expect(rec.max_usd).toBe(0.000001);
    const done = await finish(rec.id);
    expect(done.usd).toBeGreaterThan(0.000001);
    expect(done.status).toBe("stopped");
    expect(done.stop_reason).toMatch(/past its limit of \$0\.000001/);
    expect(done.cases.filter((c) => c.status === "done")).toHaveLength(1);
    // without a limit, all six run
    expect((await finish(evals.start(priced, { grader: "number", cases, concurrency: 1 }).id)).cases.filter((c) => c.status === "done")).toHaveLength(6);
    expect(() => evals.start(echo(), { grader: "number", cases, max_usd: 0 })).toThrow(/max_usd/);
  });

  it("with a check grader, names the member who had a passing answer the team lost", async () => {
    const b = new Builder("Lost it", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("solver", 200, 0, { name: "Solver", model: "right", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .agent("editor", 400, 0, { name: "Editor", model: "wrong", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .edge("me", "solver", "message")
      .edge("solver", "editor", "message")
      .edge("editor", "me", "message");
    b.doc.models.push(
      { id: "right", provider: "mock", model: "mock", api: { params: { script: ["Final: (6 - 4) * (5 + 7)"] } }, price_in: 0, price_out: 0, modalities: ["text"] },
      { id: "wrong", provider: "mock", model: "mock", api: { params: { script: ["Final: 6 * 4"] } }, price_in: 0, price_out: 0, modalities: ["text"] },
    );
    const check = `const nums = expected.split(" ").map(Number).sort((a, b) => a - b);
const expr = answer.replace(/=.*$/, "").trim();
const used = (expr.match(/\\d+/g) || []).map(Number).sort((a, b) => a - b);
return used.join() === nums.join() && Math.abs(Function("return (" + expr + ")")() - 24) < 1e-9;`;
    const rec = evals.start({ ...b.doc, id: "sys_lost" }, { grader: "check", check, cases: [{ input: "Make 24 from 4 5 6 7", expected: "4 5 6 7" }] });
    const done = await finish(rec.id);
    expect(done.cases[0]).toMatchObject({ pass: false, reached: ["Solver"] });
  });

  it("with a check grader, reads a member's unmarked reply line by line (a proposer's expression mid-text)", async () => {
    const b = new Builder("Lost it, unmarked", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("p1", 200, 0, { name: "Proposer", model: "found", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .agent("p2", 200, 100, { name: "Guesser", model: "guess", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .agent("agg", 400, 0, { name: "Aggregator", model: "wrong", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .edge("me", "p1", "message")
      .edge("p1", "p2", "message")
      .edge("p2", "agg", "message")
      .edge("agg", "me", "message");
    b.doc.models.push(
      { id: "found", provider: "mock", model: "mock", api: { params: { script: ["Let me try a few.\n(6 - 4) * (5 + 7) = 24\nThat works."] } }, price_in: 0, price_out: 0, modalities: ["text"] },
      { id: "guess", provider: "mock", model: "mock", api: { params: { script: ["Maybe 6 * 4 = 24, using the 6 and the 4."] } }, price_in: 0, price_out: 0, modalities: ["text"] },
      { id: "wrong", provider: "mock", model: "mock", api: { params: { script: ["Final: No solution"] } }, price_in: 0, price_out: 0, modalities: ["text"] },
    );
    const check = `const nums = expected.split(" ").map(Number).sort((a, b) => a - b);
const expr = answer.replace(/=.*$/, "").trim();
if (!/^[\\d\\s+*\\/().-]+$/.test(expr)) return false;
const used = (expr.match(/\\d+/g) || []).map(Number).sort((a, b) => a - b);
return used.join() === nums.join() && Math.abs(Function("return (" + expr + ")")() - 24) < 1e-9;`;
    const rec = evals.start({ ...b.doc, id: "sys_lost2" }, { grader: "check", check, cases: [{ input: "Make 24 from 4 5 6 7", expected: "4 5 6 7" }] });
    expect((await finish(rec.id)).cases[0]).toMatchObject({ pass: false, reached: ["Proposer"] });
  });

  it("marks evaluations a restart cut off as stopped", () => {
    store.putEval({ id: "eval_cut", system_id: "s", system_name: "S", grader: "answer", mock: false, status: "running", started_at: new Date().toISOString(), cases: [{ input: "x", expected: "y", status: "running" }], passed: 0, graded: 0, usd: 0 });
    evals.recover();
    expect(store.getEval("eval_cut")).toMatchObject({ status: "stopped", cases: [{ status: "error", why: "the server restarted" }] });
  });
});
