// Multi-Agent Verification (MAV): best-of-n where the choice is made by
// several aspect verifiers, each approving or rejecting every candidate; the
// candidate with the most approvals wins. Scaling the number of verifiers,
// not only the number of samples: the comparison is the majority vote over
// the same samples (Agent Forest) and a single reader (Corex).
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const ASPECTS: { id: string; name: string; aspect: string }[] = [
  { id: "v_math", name: "Verifier · arithmetic", aspect: "Redo every calculation in the attempt yourself. Approve only if every number it computes is right." },
  { id: "v_logic", name: "Verifier · reasoning", aspect: "Check that each step follows from the question and the steps before it, and that the method answers what was asked (units, rounding, the quantity requested). Approve only if the approach is sound." },
  { id: "v_answer", name: "Verifier · answer", aspect: "Solve the question yourself, briefly, then compare your result with the attempt's final answer. Approve only if they agree." },
];

const verifyPrompt = (aspect: string) => `You are one of several verifiers, each checking a different aspect. Your aspect: ${aspect}

Question:
{{vars.input}}

Judge each attempt on its own, not by how many agree.
{{#each input}}
## Attempt {{@index}}
{{this}}

{{/each}}
End with one line per attempt, in order, exactly: 'Attempt <number>: APPROVE' or 'Attempt <number>: REJECT'.`;

const PICK = `// the most approved candidate wins; ties go to the answer more candidates share
const cands = Array.isArray(input.candidates) ? input.candidates : [];
const finalOf = (t) => ((String(t).match(/Final:\\s*(.+)/) ?? [])[1] ?? String(t).trim().split("\\n").pop() ?? "").replace(/\\*\\*(.+?)\\*\\*/g, "$1").replace(/^\\*+|\\*+$/g, "").trim();
const norm = (a) => /\\d\\s*[-+*/]\\s*[\\d(]|\\)\\s*[-+*/]/.test(a) ? a.replace(/\\s+/g, "") : a.toLowerCase().replace(/(\\d),(?=\\d{3})/g, "$1").replace(/[^a-z0-9./-]+/g, " ").trim().replace(/\\.+$/, "");
const votes = cands.map(() => 0);
const verifiers = Object.keys(input).filter((k) => k !== "candidates");
for (const k of verifiers) {
  for (const m of String(input[k]).matchAll(/Attempt\\s*#?(\\d+)\\s*:\\s*\\**\\s*(APPROVE|REJECT)/gi)) {
    const i = Number(m[1]);
    if (i >= 0 && i < cands.length && m[2].toUpperCase() === "APPROVE") votes[i]++;
  }
}
const share = {};
for (const c of cands) { const k = norm(finalOf(c)); share[k] = (share[k] ?? 0) + 1; }
if (!cands.length) return "No candidate.";
const order = cands.map((c, i) => i).sort((a, b) => votes[b] - votes[a] || share[norm(finalOf(cands[b]))] - share[norm(finalOf(cands[a]))] || a - b);
const best = order[0];
return "Approvals (" + verifiers.length + " verifiers): " + cands.map((c, i) => finalOf(c) + " " + votes[i]).join(", ") + "\\nFinal: " + finalOf(cands[best]);`;

function build(): SystemDoc {
  const b = new Builder(
    "Multi-Agent Verification",
    "Best-of-n with several verifiers: one model component samples n candidates (a run variable, 5 by default); three verifiers, each checking a different aspect (arithmetic, reasoning, the answer itself), approve or reject every candidate; the candidate with the most approvals wins.",
  );
  b.node("asker", "human", 0, 160, { name: "Asker", role: "Poses the question", approves: false })
    .node("candidates", "model", 260, 160, {
      name: "Candidates",
      model: "sonnet",
      system_prompt: "",
      prompt: "Solve the question step by step, showing your reasoning, and end with 'Final: <answer>'.\n\n{{input}}",
      temperature: 0.8,
      max_tokens: null,
      replicas: "{{vars.n ?? 5}}",
      interface: { inputs: [port("in", "text")], outputs: [port("out", "json")] },
    });
  ASPECTS.forEach((a, i) =>
    b.node(a.id, "model", 560, i * 160, {
      name: a.name,
      model: "sonnet",
      system_prompt: "",
      prompt: verifyPrompt(a.aspect),
      temperature: null,
      max_tokens: null,
      interface: { inputs: [port("in", "json")], outputs: [port("out", "text")] },
    }),
  );
  b.node("pick", "function", 860, 160, {
    name: "Most approved",
    join: "all",
    fn: { lang: "js", code: PICK },
    interface: { inputs: [port("candidates", "json", { required: true }), ...ASPECTS.map((a) => port(a.id, "text", { required: true }))], outputs: [port("out", "text")] },
  });
  b.edge("asker", "candidates", "message", { label: "Question" }).edge("candidates", "pick", "message", { target_port: "candidates", label: "Candidates" });
  for (const a of ASPECTS) b.edge("candidates", a.id, "message").edge(a.id, "pick", "message", { target_port: a.id });
  b.edge("pick", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 2, max_rounds: 10, wallclock_min: 15 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  b.doc.result = { type: "text", description: "the approvals per candidate, ending with 'Final: X'" };
  return b.doc;
}

export const mav: TemplateInfo = {
  id: "paper-mav",
  name: "Multi-Agent Verification",
  summary: "n candidates · three aspect verifiers approve or reject each · most approvals wins",
  build,
  paper: { title: "Multi-Agent Verification: Scaling Test-Time Compute with Multiple Verifiers", authors: "Lifshitz et al.", year: 2025, url: "https://arxiv.org/abs/2502.20379" },
  notes: {
    mapped: [
      "The candidates are one model component sampled n times (replicas, the run variable n, 5 by default): the paper's best-of-n generator.",
      "Each aspect verifier is a model component with its own aspect in its prompt, giving a binary approval per candidate; a function counts the approvals and returns the most approved candidate's answer, as the paper's BoN-MAV.",
    ],
    differs: [
      "The paper asks each verifier about each candidate in a separate call; here each verifier reads all candidates in one call and judges them one by one, n times fewer calls.",
      "The paper picks aspects from a larger pool per domain and can mix verifier models; here three fixed aspects on one model (map the model per evaluation to mix them). Ties go to the answer more candidates share.",
    ],
  },
};
