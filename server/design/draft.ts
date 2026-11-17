// A system being designed. Every edit goes through here, so the architect
// cannot produce something the canvas could not: ids are checked, components
// are built from the platform's defaults, and ports and bindings are filled in
// the way the editor fills them.
import { conformSystem } from "@/model/conformance";
import { defaultAgent, defaultBinding, defaultData, defaultRoom, emptySystem, newId } from "@/model/defaults";
import { entryPoints } from "@/model/entry";
import { defaultPlugin } from "@/model/plugins";
import { interfaceOf, isResource, port, usesResources } from "@/model/ports";
import type { AgentData, DataType, EdgeKind, NodeData, NodeKind, PluginPreset, PortSpec, SysEdge, SysNode, SystemDoc } from "@/model/types";
import { RES_PORT } from "@/model/types";
import { validate, type Issue } from "@/model/validate";

const ID = /^[a-z][a-z0-9_]*$/;
const KINDS: NodeKind[] = ["agent", "model", "function", "human", "env", "plugin", "group"];

export class DraftError extends Error {}

/** Lays components out in a readable left-to-right flow as they are added. */
function place(doc: SystemDoc, parent?: string) {
  const siblings = doc.nodes.filter((n) => n.parent === parent);
  const col = siblings.length % 4;
  const row = Math.floor(siblings.length / 4);
  return { x: col * 320, y: row * 220 };
}

export class Draft {
  constructor(public doc: SystemDoc) {}

  static blank(name: string) {
    const doc = emptySystem(name);
    doc.id = newId("sys");
    return new Draft(doc);
  }

  private node(id: string): SysNode {
    const n = this.doc.nodes.find((x) => x.id === id);
    if (!n) throw new DraftError(`There is no component "${id}". Current: ${this.doc.nodes.map((x) => x.id).join(", ") || "none"}`);
    return n;
  }

  private freeId(id: string, what: string) {
    if (!ID.test(id)) throw new DraftError(`"${id}" is not a usable id for the ${what}: lowercase letters, digits and _ , starting with a letter`);
    if (this.doc.nodes.some((n) => n.id === id)) throw new DraftError(`"${id}" already exists. It is already on the canvas — connect to it, or pick a different id`);
    return id;
  }

  /** Add a component. `options` carries whatever that kind needs; unknown keys are ignored. */
  add(kind: string, id: string, name: string, options: Record<string, unknown> = {}): string {
    if (!KINDS.includes(kind as NodeKind)) throw new DraftError(`"${kind}" is not a component kind. Use one of: ${KINDS.join(", ")}`);
    this.freeId(id, "component");
    const parent = typeof options.group === "string" ? options.group : undefined;
    if (parent) {
      const g = this.node(parent);
      if (g.data.kind !== "group") throw new DraftError(`"${parent}" is not a group, so nothing can live inside it`);
    }
    let data: NodeData;
    switch (kind as NodeKind) {
      case "agent": {
        const a = defaultAgent(name);
        a.role = String(options.role ?? "");
        a.model = String(options.model ?? this.defaultModel());
        a.harness = { ...a.harness, instructions: String(options.instructions ?? ""), loop: (options.loop as AgentData["harness"]["loop"]) ?? "react" };
        if (Array.isArray(options.tools)) a.tools = options.tools.map(String).filter((t) => this.doc.tools.some((x) => x.id === t));
        if (options.loop === "single_shot") a.harness.max_steps = 1;
        data = a;
        break;
      }
      case "plugin":
        data = defaultPlugin((options.preset as PluginPreset) ?? "memory");
        data.name = name;
        if (Array.isArray(options.sources)) data.spec.sources = options.sources.map(String);
        break;
      case "env":
        if (options.env_kind === "room" || !options.env_kind) {
          data = defaultRoom(name);
          if (options.policy) data.room = { ...data.room!, policy: options.policy as NonNullable<typeof data.room>["policy"] };
        } else {
          data = { ...(defaultData("env") as Extract<NodeData, { kind: "env" }>), name, env_kind: options.env_kind as Extract<NodeData, { kind: "env" }>["env_kind"] };
          if (options.image) (data as Extract<NodeData, { kind: "env" }>).image = String(options.image);
        }
        break;
      case "function": {
        const f = { ...(defaultData("function") as Extract<NodeData, { kind: "function" }>), name };
        const code = String(options.code ?? "").trim();
        // a function with no code would not meet mas-function/1, so it starts as a pass-through
        f.fn = { lang: (options.lang as "js" | "python" | "template" | "jsonata" | "llm") ?? "js", code: code || "// what arrived, passed on unchanged\nreturn input;" };
        if (options.join === "all") f.join = "all";
        data = f;
        break;
      }
      case "model":
        data = { ...(defaultData("model") as Extract<NodeData, { kind: "model" }>), name, model: String(options.model ?? this.defaultModel()) };
        if (options.prompt) (data as Extract<NodeData, { kind: "model" }>).prompt = String(options.prompt);
        if (options.system_prompt) (data as Extract<NodeData, { kind: "model" }>).system_prompt = String(options.system_prompt);
        break;
      case "human":
        data = { ...(defaultData("human") as Extract<NodeData, { kind: "human" }>), name, role: String(options.role ?? ""), approves: !!options.approves };
        break;
      default:
        data = { ...(defaultData("group") as Extract<NodeData, { kind: "group" }>), name };
        if (typeof options.max_rounds === "number") {
          (data as Extract<NodeData, { kind: "group" }>).iterate = { max_rounds: options.max_rounds, until: options.until ? String(options.until) : null, feed: options.feed === "input_and_output" ? "input_and_output" : "output" };
        }
    }
    const node: SysNode = { id, position: place(this.doc, parent), data };
    if (parent) node.parent = parent;
    this.doc.nodes.push(node);
    return `Added ${kind} "${id}"${parent ? ` inside ${parent}` : ""}.`;
  }

  /** Change a component in place; its connections stay. Only the keys given change. */
  update(id: string, options: Record<string, unknown>): string {
    const n = this.node(id);
    const d = n.data as unknown as Record<string, unknown>;
    const changed: string[] = [];
    const str = (k: string) => typeof options[k] === "string";
    if (str("name")) (d.name = options.name, changed.push("name"));
    switch (n.data.kind) {
      case "agent": {
        const a = n.data;
        if (str("role")) (a.role = String(options.role), changed.push("role"));
        if (str("instructions")) (a.harness.instructions = String(options.instructions), changed.push("instructions"));
        if (str("model")) {
          if (!this.doc.models.some((m) => m.id === options.model)) throw new DraftError(`There is no model "${options.model}". Models: ${this.doc.models.map((m) => m.id).join(", ")}`);
          a.model = String(options.model);
          changed.push("model");
        }
        if (str("loop")) (a.harness.loop = options.loop as AgentData["harness"]["loop"], changed.push("loop"));
        if (Array.isArray(options.tools)) {
          const unknown = options.tools.map(String).filter((t) => !this.doc.tools.some((x) => x.id === t));
          if (unknown.length) throw new DraftError(`Unknown tools: ${unknown.join(", ")}. Tools: ${this.doc.tools.map((t) => t.id).join(", ")}`);
          a.tools = options.tools.map(String);
          changed.push("tools");
        }
        break;
      }
      case "function":
        if (str("code")) (n.data.fn = { ...n.data.fn, code: String(options.code) }, changed.push("code"));
        if (str("lang")) (n.data.fn = { ...n.data.fn, lang: options.lang as typeof n.data.fn.lang }, changed.push("lang"));
        if (options.join === "all" || options.join === "any") (n.data.join = options.join, changed.push("join"));
        break;
      case "model":
        if (str("prompt")) (n.data.prompt = String(options.prompt), changed.push("prompt"));
        if (str("system_prompt")) (n.data.system_prompt = String(options.system_prompt), changed.push("system_prompt"));
        if (str("model")) (n.data.model = String(options.model), changed.push("model"));
        break;
      case "human":
        if (str("role")) (n.data.role = String(options.role), changed.push("role"));
        if (typeof options.approves === "boolean") (n.data.approves = options.approves, changed.push("approves"));
        break;
      case "group":
        if (typeof options.max_rounds === "number") {
          n.data.iterate = { max_rounds: options.max_rounds, until: str("until") ? String(options.until) : (n.data.iterate?.until ?? null), feed: options.feed === "input_and_output" ? "input_and_output" : (n.data.iterate?.feed ?? "output") };
          changed.push("iterate");
        } else if (str("until") && n.data.iterate) (n.data.iterate.until = String(options.until), changed.push("until"));
        break;
      case "env":
        if (str("policy") && n.data.room) (n.data.room = { ...n.data.room, policy: options.policy as NonNullable<typeof n.data.room>["policy"] }, changed.push("policy"));
        if (str("image")) (n.data.image = String(options.image), changed.push("image"));
        break;
      default:
        break;
    }
    if (!changed.length) throw new DraftError(`Nothing to change on ${id} (a ${n.data.kind}) from ${JSON.stringify(options).slice(0, 160)}`);
    return `Updated ${id}: ${changed.join(", ")}.`;
  }

  private defaultModel() {
    return this.doc.models.find((m) => (m.kind ?? "chat") === "chat")?.id ?? "sonnet";
  }

  /** Give a component its ports. Replaces whatever it had. */
  setPorts(id: string, inputs: { id: string; type?: string }[], outputs: { id: string; type?: string }[]): string {
    const n = this.node(id);
    if (!("interface" in n.data)) throw new DraftError(`"${id}" has no ports: envs and plugins are reached with access connections`);
    const make = (ps: { id: string; type?: string }[], what: string): PortSpec[] =>
      ps.map((p) => {
        if (!ID.test(p.id)) throw new DraftError(`"${p.id}" is not a usable ${what} port name on ${id}`);
        return port(p.id, (p.type ?? "message") as DataType);
      });
    const ins = make(inputs, "input");
    const outs = make(outputs, "output");
    const seen = new Set<string>();
    for (const p of [...ins, ...outs]) {
      if (seen.has(p.id)) throw new DraftError(`${id} would have two ports named "${p.id}": names must be unique across inputs and outputs`);
      seen.add(p.id);
    }
    (n.data as { interface: { inputs: PortSpec[]; outputs: PortSpec[] } }).interface = { inputs: ins, outputs: outs };
    return `${id} now has inputs [${ins.map((p) => `${p.id}:${p.type}`).join(", ")}] and outputs [${outs.map((p) => `${p.id}:${p.type}`).join(", ")}].`;
  }

  /** Connect two components. Ports default to the first that fits, as on the canvas. */
  connect(from: string, to: string, kind: string, options: Record<string, unknown> = {}): string {
    const s = this.node(from);
    const t = this.node(to);
    let k = (kind || "message") as EdgeKind;
    if (!["message", "call", "handoff", "access"].includes(k)) throw new DraftError(`"${kind}" is not a connection kind. Use message, call, handoff or access`);
    const edge: SysEdge = { id: `e${this.doc.edges.length + 1}`, source: from, target: to, source_port: RES_PORT, target_port: RES_PORT, kind: k };
    if (isResource(t.data.kind) || k === "access") {
      if (!usesResources(s.data.kind)) throw new DraftError(`Only an agent or a human can use ${to}`);
      if (!isResource(t.data.kind)) throw new DraftError(`${to} is not an env or a plugin, so it cannot be used with an access connection`);
      if (s.parent !== t.parent) throw new DraftError(`${from} and ${to} are on different canvases: put the env or plugin in the same group`);
      edge.kind = k = "access";
      edge.access = options.access === "read" ? "read" : "read_write";
      edge.binding = defaultBinding(t.data);
      if (edge.access === "read" && edge.binding.write) edge.binding.write = { when: "never" };
    } else {
      const sourcePorts = s.data.kind === "group" && t.parent === s.id ? interfaceOf(s.data).inputs : interfaceOf(s.data).outputs;
      const targetPorts = t.data.kind === "group" && s.parent === t.id ? interfaceOf(t.data).outputs : interfaceOf(t.data).inputs;
      const sp = options.from_port ? sourcePorts.find((p) => p.id === options.from_port) : sourcePorts[0];
      const tp = options.to_port ? targetPorts.find((p) => p.id === options.to_port) : targetPorts[0];
      if (!sp) throw new DraftError(`${from} has no output port${options.from_port ? ` "${options.from_port}"` : ""}. It has: ${sourcePorts.map((p) => p.id).join(", ") || "none"}`);
      if (!tp) throw new DraftError(`${to} has no input port${options.to_port ? ` "${options.to_port}"` : ""}. It has: ${targetPorts.map((p) => p.id).join(", ") || "none"}`);
      edge.source_port = sp.id;
      edge.target_port = tp.id;
      if (options.label) edge.label = String(options.label);
      if (k === "handoff") edge.carry = options.carry === "full" ? "full" : "summary";
      if (options.filter) edge.filter = String(options.filter);
      if (options.transform) edge.transform = { lang: "template", code: String(options.transform) };
    }
    this.doc.edges.push(edge);
    return `Connected ${from} → ${to} (${edge.kind}${edge.source_port !== RES_PORT ? `, ${edge.source_port} → ${edge.target_port}` : ""}).`;
  }

  remove(id: string): string {
    this.node(id);
    const inside = this.doc.nodes.filter((n) => n.parent === id).map((n) => n.id);
    const gone = new Set([id, ...inside]);
    this.doc.nodes = this.doc.nodes.filter((n) => !gone.has(n.id));
    this.doc.edges = this.doc.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target));
    if (this.doc.entry && gone.has(this.doc.entry.node)) this.doc.entry = null;
    return `Removed ${id}${inside.length ? ` and what was inside it (${inside.join(", ")})` : ""}.`;
  }

  setEntry(id: string): string {
    const n = this.node(id);
    if (n.parent) throw new DraftError(`${id} is inside a group; a run starts at the top level`);
    this.doc.entry = { node: id };
    return `A run now starts at ${id}.`;
  }

  describe(name: string, description: string): string {
    this.doc.name = name || this.doc.name;
    this.doc.description = description || this.doc.description;
    return `Named "${this.doc.name}".`;
  }

  /**
   * Everything wrong with the draft. A finished design is held to a higher bar
   * than a canvas someone is still building on: a component nobody talks to,
   * or a run with no way to deliver its answer, counts as an error here.
   */
  problems(): { errors: string[]; warnings: string[] } {
    const issues: Issue[] = validate(this.doc);
    const label = (i: Issue) => i.message;
    const conformance = conformSystem(this.doc)
      .filter((c) => !c.report.passed)
      .map((c) => `${c.name} does not meet ${c.report.contract}: ${c.report.rules.filter((r) => !r.ok && r.severity === "error").map((r) => r.label).join("; ")}`);
    const design: string[] = [];
    const touched = (id: string) => this.doc.edges.some((e) => e.source === id || e.target === id);
    for (const n of this.doc.nodes) {
      const name = "name" in n.data ? n.data.name : n.id;
      // a spawn template is run by its parent, not wired to it
      const isTemplate = this.doc.nodes.some((x) => x.data.kind === "agent" && (x.data as AgentData).spawn?.template === n.id);
      if (!touched(n.id) && !isTemplate) design.push(`"${name}" (${n.id}) is not connected to anything. Connect it, or remove it`);
    }
    if (this.doc.nodes.length > 1 && !this.doc.edges.length) design.push("Nothing is connected yet: use connect to wire the components together");
    const starts = entryPoints(this.doc).map((e) => e.node);
    const reaches = (from: string) => {
      const seen = new Set([from]);
      for (const queue = [from]; queue.length; ) {
        const id = queue.shift()!;
        for (const e of this.doc.edges.filter((x) => x.source === id && x.kind !== "access")) if (!seen.has(e.target)) (seen.add(e.target), queue.push(e.target));
      }
      return seen;
    };
    for (const s of starts) {
      const reached = reaches(s);
      const stranded = this.doc.nodes.filter((n) => !n.parent && !isResource(n.data.kind) && !reached.has(n.id) && touched(n.id) && !this.doc.edges.some((e) => e.target === n.id && e.kind !== "access"));
      for (const n of stranded) design.push(`Nothing ever reaches "${"name" in n.data ? n.data.name : n.id}" from ${s}, so it never runs`);
    }
    return {
      errors: [...issues.filter((i) => i.severity === "error").map(label), ...conformance, ...design],
      warnings: issues.filter((i) => i.severity === "warning").map(label),
    };
  }

  /**
   * What the architect sees when it looks at its work: the shape of the system
   * and what is still wrong with it. Deliberately compact — it is re-sent with
   * every later step, so the full YAML would cost more than it tells.
   */
  review(): string {
    const { errors, warnings } = this.problems();
    const start = entryPoints(this.doc).map((e) => e.node);
    const ports = (id: string) => {
      const n = this.doc.nodes.find((x) => x.id === id)!;
      if (!("interface" in n.data)) return "";
      const i = interfaceOf(n.data);
      return ` [in ${i.inputs.map((p) => p.id).join("/") || "–"} | out ${i.outputs.map((p) => p.id).join("/") || "–"}]`;
    };
    const components = this.doc.nodes.map((n) => `  ${n.id}: ${n.data.kind}${n.parent ? ` in ${n.parent}` : ""}${ports(n.id)}`);
    const links = this.doc.edges.map((e) => `  ${e.source} → ${e.target} (${e.kind}${e.kind === "access" ? "" : `, ${e.source_port}→${e.target_port}`})`);
    return [
      `${this.doc.name}: ${this.doc.description || "(no description yet)"}`,
      `Components (${this.doc.nodes.length}):\n${components.join("\n") || "  none"}`,
      `Connections (${this.doc.edges.length}):\n${links.join("\n") || "  none"}`,
      `Starts at: ${start.join(", ") || "nothing"}`,
      errors.length ? `MUST FIX (${errors.length}):\n- ${errors.join("\n- ")}` : "No errors.",
      warnings.length ? `Worth checking:\n- ${warnings.slice(0, 6).join("\n- ")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}
