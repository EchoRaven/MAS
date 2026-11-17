// Room: a shared conversation. Members (agents / humans with an access edge)
// see the transcript; what they post wakes the next speaker by the room's
// policy. history "persistent" keeps the transcript across runs.
import type { EnvData, SysEdge, SysNode } from "@/model/types";
import type { RunCtx } from "../../context";
import { nameOf } from "../../context";
import { readState, stateFile, writeState } from "../plugins/common";
import { schema, type Resource, type RtTool } from "../types";

export interface RoomPost {
  from: string;
  text: string;
  ts: number;
  run: string;
}

export class RoomEnv implements Resource {
  posts: RoomPost[];
  private rr = 0;
  constructor(
    private rc: RunCtx,
    readonly node: SysNode<EnvData>,
  ) {
    this.posts = this.persistent ? readState<RoomPost[]>(this.file, []) : [];
  }
  get id() {
    return this.node.id;
  }
  private get persistent() {
    return this.node.data.room?.history === "persistent" && this.node.data.lifecycle !== "per_run";
  }
  private get file() {
    return stateFile(this.rc, this.node.id, "room.json");
  }
  get policy() {
    return this.node.data.room?.policy ?? "free";
  }

  members(): string[] {
    return this.rc.doc.edges.filter((e) => e.kind === "access" && e.target === this.id).map((e) => e.source);
  }

  post(from: string, text: string) {
    this.posts.push({ from, text, ts: Date.now(), run: this.rc.runId });
    if (this.persistent) writeState(this.file, this.posts.slice(-500));
  }

  /** Round robin over members other than the last speaker. */
  nextRoundRobin(after: string): string | undefined {
    const ms = this.members().filter((m) => m !== after && this.rc.byId.get(m)?.data.kind === "agent");
    if (!ms.length) return undefined;
    return ms[this.rr++ % ms.length];
  }

  /** Members named with @ in the text. */
  mentioned(text: string): string[] {
    return this.members().filter((m) => {
      const name = nameOf(this.rc, m);
      return text.toLowerCase().includes(`@${name.toLowerCase()}`) || text.includes(`@${m}`);
    });
  }

  transcript(budgetChars = 32_000): string {
    let out = "";
    for (let i = this.posts.length - 1; i >= 0; i--) {
      const p = this.posts[i];
      const line = `${nameOf(this.rc, p.from)}: ${p.text}\n`;
      if (out.length + line.length > budgetChars) break;
      out = line + out;
    }
    return out.trim();
  }

  async tools(edge: SysEdge): Promise<RtTool[]> {
    if (edge.binding?.mode !== "tool") return [];
    return [
      { name: `read_${this.id}`, description: `Read the conversation in ${this.node.data.name}`, input_schema: schema({}), effect: "read", source: this.id, run: async () => this.transcript() || "(no messages yet)" },
    ];
  }

  async beforeTurn(turn: { edge: SysEdge }) {
    const budget = (turn.edge.binding?.read?.budget_tokens ?? 8000) * 4;
    const t = this.transcript(budget);
    return t ? `Conversation in ${this.node.data.name}:\n${t}` : null;
  }
}
