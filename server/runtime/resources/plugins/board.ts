// Task board: shared tasks with an owner and a state.
import type { PluginData, SysEdge, SysNode } from "@/model/types";
import type { RunCtx } from "../../context";
import { nameOf } from "../../context";
import { S, schema, type Resource, type RtTool } from "../types";
import { readState, scopeKey, stateFile, uid, writeState } from "./common";

interface Task {
  id: string;
  title: string;
  owner?: string;
  state: "open" | "doing" | "done" | "blocked";
  notes?: string;
  created_by: string;
  ts: number;
}

export class BoardPlugin implements Resource {
  constructor(
    private rc: RunCtx,
    private node: SysNode<PluginData>,
  ) {}
  get id() {
    return this.node.id;
  }
  private file(agent: string) {
    return stateFile(this.rc, this.node.id, `tasks-${scopeKey(this.rc, this.node, agent).replace(/[^\w.-]/g, "_")}.json`);
  }
  list(agent: string): Task[] {
    return readState<Task[]>(this.file(agent), []);
  }
  private save(agent: string, tasks: Task[]) {
    writeState(this.file(agent), tasks);
  }
  private show = (t: Task) => `#${t.id} [${t.state}] ${t.title}${t.owner ? ` (owner: ${nameOf(this.rc, t.owner)})` : ""}${t.notes ? ` — ${t.notes}` : ""}`;

  async tools(edge: SysEdge): Promise<RtTool[]> {
    const owner = (v: unknown) => {
      const s = String(v ?? "");
      return this.rc.doc.nodes.find((n) => n.id === s || ("name" in n.data && n.data.name.toLowerCase() === s.toLowerCase()))?.id ?? (s || undefined);
    };
    const all: RtTool[] = [
      { name: "task_list", description: "List tasks, optionally by state or owner", input_schema: schema({ state: S, owner: S }, []), effect: "read", source: this.id, run: async (a, c) => {
        const tasks = this.list(c.node).filter((t) => (!a.state || t.state === a.state) && (!a.owner || t.owner === owner(a.owner)));
        return tasks.map(this.show).join("\n") || "No tasks.";
      } },
      { name: "task_create", description: "Create a task", input_schema: schema({ title: S, owner: S, notes: S }, ["title"]), effect: "write", source: this.id, run: async (a, c) => {
        const tasks = this.list(c.node);
        const t: Task = { id: uid().slice(0, 5), title: String(a.title), owner: owner(a.owner), state: "open", notes: a.notes ? String(a.notes) : undefined, created_by: c.node, ts: Date.now() };
        tasks.push(t);
        this.save(c.node, tasks);
        return `Created ${this.show(t)}`;
      } },
      { name: "task_update", description: "Update a task's state, owner or notes", input_schema: { type: "object", properties: { id: S, state: { type: "string", enum: ["open", "doing", "done", "blocked"] }, owner: S, notes: S }, required: ["id"] }, effect: "write", source: this.id, run: async (a, c) => {
        const tasks = this.list(c.node);
        const t = tasks.find((x) => x.id === String(a.id).replace(/^#/, ""));
        if (!t) throw new Error(`no task ${a.id}`);
        if (a.state) t.state = a.state as Task["state"];
        if (a.owner) t.owner = owner(a.owner);
        if (a.notes) t.notes = String(a.notes);
        this.save(c.node, tasks);
        return `Updated ${this.show(t)}`;
      } },
    ];
    const declared = new Set(this.node.data.spec.tools.map((t) => t.name));
    return all.filter((t) => declared.has(t.name) && (edge.access !== "read" || t.effect === "read"));
  }

  async beforeTurn(turn: { node: string }) {
    const mine = this.list(turn.node).filter((t) => t.state !== "done" && (!t.owner || t.owner === turn.node));
    return mine.length ? `Open tasks on ${this.node.data.name}:\n${mine.map(this.show).join("\n")}` : null;
  }
}
