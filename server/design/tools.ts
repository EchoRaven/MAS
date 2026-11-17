// The architect's tools: everything it can do to a draft, as tool definitions
// a model can call. Each one returns what happened, or what was wrong with the
// attempt, so the architect can correct itself.
import type { ToolDef } from "../runtime/models";
import { Draft, DraftError } from "./draft";

const S = { type: "string" } as const;
const PORTS = {
  type: "array",
  description: "Ports, in order. Types: message, text, json, file, event, any. Default message.",
  items: { type: "object", properties: { id: S, type: S }, required: ["id"] },
} as const;

export const DESIGN_TOOLS: ToolDef[] = [
  {
    name: "add",
    description:
      "Add a component.\n" +
      "· agent: options role, instructions (its system prompt, be specific), model, loop (react | single_shot | plan_execute | reflexion), tools, group\n" +
      "· human: options role, approves (true when they approve actions)\n" +
      "· model: a bare model call; options prompt ({{input}} is what arrives), system_prompt\n" +
      "· function: deterministic code. Always give options.code: JavaScript, with `input` arriving and whatever you return going out. With join 'all' it waits for every input port and `input` is { port: value }. Options: code, lang, join\n" +
      "· env: options env_kind (room | sandbox | database | browser | app | service), policy for a room (free | round_robin | selector | mention), image\n" +
      "· plugin: options preset (memory | knowledge | workspace | board), sources\n" +
      "· group: a sub-system on its own canvas; options max_rounds, until (an expression over `output`), feed. Put members in it with options.group on them.",
    input_schema: { type: "object", properties: { kind: S, id: { ...S, description: "lower_snake_case, unique" }, name: S, options: { type: "object" } }, required: ["kind", "id", "name"] },
  },
  {
    name: "set_ports",
    description: "Replace a component's input and output ports. Give an agent several outputs only when something routes between them.",
    input_schema: { type: "object", properties: { id: S, inputs: PORTS, outputs: PORTS }, required: ["id", "inputs", "outputs"] },
  },
  {
    name: "connect",
    description:
      "Connect two components.\n" +
      "· message: send and carry on\n" +
      "· call: ask and wait for the reply (the caller gets it as a tool)\n" +
      "· handoff: pass the work on; options carry 'full' sends the whole conversation\n" +
      "· access: an agent or human uses an env or plugin (they must be on the same canvas); options access 'read'\n" +
      "Options: from_port, to_port, label, filter (an expression over `input`), transform (a template over {{input}}).\n" +
      "Give the ends as source and target.",
    // "source"/"target", not "from"/"to": some providers rename a parameter called `from`
    input_schema: { type: "object", properties: { source: S, target: S, kind: S, options: { type: "object" } }, required: ["source", "target", "kind"] },
  },
  {
    name: "update",
    description:
      "Change a component in place; its connections stay. Give only what changes. Agent: name, role, instructions, model, loop, tools. Function: code, lang, join. Model: prompt, system_prompt, model. Human: role, approves. Group: max_rounds, until, feed. Room: policy. Prefer this to remove and add.",
    input_schema: { type: "object", properties: { id: S, options: { type: "object" } }, required: ["id", "options"] },
  },
  { name: "remove", description: "Remove a component and everything connected to it.", input_schema: { type: "object", properties: { id: S }, required: ["id"] } },
  { name: "set_entry", description: "Choose where a run's input arrives. Use it when more than one component could start the run.", input_schema: { type: "object", properties: { id: S }, required: ["id"] } },
  { name: "describe", description: "Name the system and say in one or two sentences what it does.", input_schema: { type: "object", properties: { name: S, description: S }, required: ["name", "description"] } },
  { name: "review", description: "Look at the whole system as YAML, where a run starts, and everything still wrong with it. Call this before you finish.", input_schema: { type: "object", properties: {} } },
];

/** Run one tool call against the draft. Errors come back as text for the model to read. */
export async function runDesignTool(draft: Draft, name: string, args: Record<string, unknown>): Promise<string> {
  try {
    const options = (args.options ?? {}) as Record<string, unknown>;
    switch (name) {
      case "add":
        return draft.add(String(args.kind), String(args.id), String(args.name), options);
      case "set_ports":
        return draft.setPorts(String(args.id), (args.inputs ?? []) as { id: string }[], (args.outputs ?? []) as { id: string }[]);
      case "connect": {
        // accept whatever the provider called the ends
        const pick = (...keys: string[]) => keys.map((k) => args[k]).find((v) => typeof v === "string" && v);
        const source = pick("source", "from", "from1_", "start");
        const target = pick("target", "to", "to1_", "end");
        if (!source || !target) return `Not done: connect needs source and target. It was given ${JSON.stringify(args).slice(0, 200)}`;
        return draft.connect(String(source), String(target), String(args.kind ?? "message"), options);
      }
      case "update":
        return draft.update(String(args.id), options);
      case "remove":
        return draft.remove(String(args.id));
      case "set_entry":
        return draft.setEntry(String(args.id));
      case "describe":
        return draft.describe(String(args.name), String(args.description));
      case "review":
        return draft.review();
      default:
        return `There is no tool called ${name}.`;
    }
  } catch (e) {
    if (e instanceof DraftError) return `Not done: ${e.message}`;
    return `Not done: ${(e as Error).message}`;
  }
}
