// MacNet: agents on a network. Each node is an assistant that writes a
// solution; each edge is an instructor that reviews the solution coming
// from the node before it. A node with predecessors refines from what they
// produced and what their instructors said; the sink's solution is the
// answer. The topology (chain, tree, star, mesh) and the number of nodes are
// run variables, so an evaluation can sweep them, as the paper does.
import { Builder, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

// the whole protocol: build the network, then run it layer by layer (the nodes of one layer at once)
const NETWORK = `const question = String(input?.text ?? input ?? "");
const n = Math.max(2, Math.min(16, Math.floor(Number(ctx.vars.n ?? 4)) || 4));
const topology = ["chain", "tree", "star", "mesh"].includes(ctx.vars.topology) ? ctx.vars.topology : "chain";
// predecessors of each node; the sink (the last node) gives the answer
const preds = Array.from({ length: n }, () => []);
for (let j = 1; j < n; j++) {
  if (topology === "chain") preds[j].push(j - 1);
  else if (topology === "mesh") for (let i = 0; i < j; i++) preds[j].push(i);
  else if (topology === "star" && j === n - 1) for (let i = 0; i < j; i++) preds[j].push(i);
}
if (topology === "tree") {
  // a binary tree drawn toward its root: node k's children are 2k+1 and 2k+2 (numbered from the root, the sink)
  const id = (k) => n - 1 - k;
  for (let k = 0; k < n; k++) for (const c of [2 * k + 1, 2 * k + 2]) if (c < n) preds[id(k)].push(id(c));
}
const layer = Array(n).fill(0);
for (let j = 0; j < n; j++) for (const i of preds[j]) layer[j] = Math.max(layer[j], layer[i] + 1);
const ANSWER = " End with a last line 'Answer: X' when the question asks for one value.";
const sol = Array(n);
const depth = Math.max(...layer);
for (let L = 0; L <= depth; L++) {
  const nodes = [...Array(n).keys()].filter((j) => layer[j] === L);
  await Promise.all(nodes.map(async (j) => {
    if (!preds[j].length) {
      sol[j] = await ctx.llm("You are agent " + (j + 1) + " of a team. Solve the question step by step." + ANSWER, question);
      return;
    }
    // each incoming edge: an instructor reviews the predecessor's solution
    const reviews = await Promise.all(preds[j].map((i) => ctx.llm("You are an instructor. Review this solution to the question: find any mistake, check each step, and say concretely what to fix. Do not write a new solution.", "Question:\\n" + question + "\\n\\nSolution from agent " + (i + 1) + ":\\n" + sol[i])));
    const seen = preds[j].map((i, k) => "## Solution from agent " + (i + 1) + "\\n" + sol[i] + "\\n\\n## Its instructor's review\\n" + reviews[k]).join("\\n\\n");
    sol[j] = await ctx.llm("You are agent " + (j + 1) + " of a team. Write an improved solution to the question from the solutions and reviews you are given: keep what is right, fix what the reviews show is wrong." + ANSWER, "Question:\\n" + question + "\\n\\n" + seen);
  }));
}
ctx.log(topology + " of " + n + " nodes, " + (depth + 1) + " layers, " + preds.flat().length + " edges");
return sol[n - 1];`;

function build(): SystemDoc {
  const b = new Builder(
    "MacNet",
    "Agents on a network: each node writes a solution, each edge is an instructor reviewing the solution from the node before it, and a node refines from its predecessors' solutions and reviews. The sink's solution is the answer. Topology (chain, tree, star, mesh) and size are run variables (topology, n).",
  );
  b.node("asker", "human", 0, 60, { name: "Asker", role: "Poses the question", approves: false })
    .node("network", "function", 300, 40, { name: "Network", fn: { lang: "js", code: NETWORK, timeout_ms: 30 * 60_000 } })
    .edge("asker", "network", "message", { label: "Question" })
    .edge("network", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 5, max_rounds: 20, wallclock_min: 30 };
  b.doc.result = { type: "text", description: "the sink's solution, ending with 'Answer: X'" };
  return b.doc;
}

export const macnet: TemplateInfo = {
  id: "paper-macnet",
  name: "MacNet",
  summary: "agents on a network · instructors on edges · chain / tree / star / mesh · size from a run variable",
  build,
  paper: { title: "Scaling Large-Language-Model-based Multi-Agent Collaboration", authors: "Qian et al.", year: 2025, url: "https://arxiv.org/abs/2406.07155" },
  notes: {
    mapped: [
      "The network is protocol as code: one function builds the topology from the run variables topology (chain, tree, star, mesh) and n (2–16 nodes), then runs it layer by layer, the nodes of a layer at once.",
      "Each node is an assistant (a model call) and each edge an instructor (a model call) reviewing the solution that flows along it; a node with several predecessors refines from all their solutions and reviews, as the paper's aggregation does.",
      "The sink's solution is the answer; an evaluation sweeps n and topology with run variables, as the paper's scaling study does.",
    ],
    differs: [
      "Agents are model calls inside one function, not separate components: the network's size changes per run, which wired components cannot.",
      "The paper also reports irregular (small-world, scale-free) topologies and larger networks; here four regular ones up to 16 nodes.",
      "Instructors review once per edge; the paper's instructor–assistant pairs can exchange several turns.",
    ],
  },
};
