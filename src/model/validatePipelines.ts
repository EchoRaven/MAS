// Checks for registry steps: pipelines on plugins and edges, agent loops and
// hooks, database query settings.
import { stepsOf } from "./pipelines";
import { optionFor, type Slot, type Step } from "./steps";
import type { SystemDoc } from "./types";
import type { Issue, Severity } from "./validate";

type Add = (severity: Severity, message: string, at?: { nodeId?: string; edgeId?: string }) => void;

function checkStep(doc: SystemDoc, slot: Slot, s: Step, where: string, add: (sev: Severity, msg: string) => void) {
  if (s.use === "custom") {
    if (!s.fn?.code.trim()) add("warning", `${where}: custom code is empty`);
    return;
  }
  const o = optionFor(slot, s.use);
  if (!o) {
    add("error", `${where}: unknown method "${s.use}"`);
    return;
  }
  for (const p of o.params.filter((x) => x.type === "model")) {
    const id = s.params?.[p.key];
    if (id == null || id === "") continue;
    const m = doc.models.find((x) => x.id === id);
    if (!m) add("error", `${where}: model ${String(id)} is not in the catalog`);
    else if ((m.kind ?? "chat") !== (p.modelKind ?? "chat")) add("error", `${where}: ${m.id} is a ${m.kind ?? "chat"} model, ${p.label.toLowerCase()} needs ${p.modelKind}`);
  }
}

export function validatePipelines(doc: SystemDoc, add: Add) {
  for (const n of doc.nodes) {
    const name = "name" in n.data ? `"${n.data.name}"` : n.id;
    const at = { nodeId: n.id };
    const here = (sev: Severity, msg: string) => add(sev, `${name} ${msg}`, at);
    if (n.data.kind === "plugin") {
      const sp = n.data.spec;
      for (const { slot, step, where } of stepsOf({ ...(sp.retrieval ?? {}), ...(sp.index ?? {}), ...(sp.memory ?? {}) })) checkStep(doc, slot, step, `· ${where}`, here);
      if (sp.retrieval && sp.retrieval.search.length === 0) here("error", "· retrieval has no search step");
    }
    if (n.data.kind === "agent") {
      const h = n.data.harness;
      if (h.tier === "native" && h.loop === "custom" && !h.loop_fn?.code.trim()) here("warning", "· custom loop has no code");
      if (h.tier === "native" && h.loop && h.loop !== "custom") checkStep(doc, "loop", { use: h.loop, params: h.loop_params }, "· loop", here);
      for (const [k, fn] of Object.entries(n.data.hooks ?? {})) if (fn && !fn.code.trim()) here("warning", `· hook ${k} is empty`);
    }
    if (n.data.kind === "env" && n.data.env_kind === "database" && n.data.db) {
      const db = n.data.db;
      if (db.mode === "templates" && db.templates.length === 0) here("warning", "has no query templates, so agents cannot query it");
      if (db.mode === "templates") for (const t of db.templates) if (!/^\s*(select|with|insert|update|delete)\b/i.test(t.sql)) here("warning", `· template ${t.name} does not look like SQL`);
      if (db.mode === "templates" && db.read_only && db.templates.some((t) => /^\s*(insert|update|delete)\b/i.test(t.sql))) here("warning", "is read-only but has write templates");
      if (db.mode === "text_to_sql" && db.tables.length === 0) here("warning", "lets an LLM write SQL against every table; list the allowed ones");
      if (db.mode === "custom" && !db.fn?.code.trim()) here("warning", "· custom query handler is empty");
    }
  }
  for (const e of doc.edges) {
    const ov = e.binding?.read?.retrieval;
    if (!ov) continue;
    const here = (sev: Severity, msg: string) => add(sev, `Retrieval override ${msg}`, { edgeId: e.id });
    for (const { slot, step, where } of stepsOf(ov)) checkStep(doc, slot, step, `· ${where}`, here);
  }
}

export type { Issue };
