// Room: a shared conversation. Members (agents / humans with an access edge)
// see the transcript; what they post wakes the next speaker by the room's
// policy. history "persistent" keeps the transcript across runs.
import type { EnvData, SysEdge, SysNode } from "@/model/types";
import type { RunCtx } from "../../context";
import { nameOf } from "../../context";
import { testExpr } from "../../functions/sandbox";
import { readState, stateFile, writeState } from "../plugins/common";
import { schema, type Resource, type RtTool } from "../types";

export interface RoomPost {
  from: string;
  text: string;
  /** message type, from the poster's edge (binding.write.tag) */
  cause_by?: string;
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

  post(from: string, text: string, cause_by?: string) {
    this.posts.push({ from, text, ts: Date.now(), run: this.rc.runId, cause_by });
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

  /** What a post looks like to a subscription filter: msg.from, msg.from_name, msg.text, msg.cause_by. */
  msg(p: RoomPost) {
    return { from: p.from, from_name: nameOf(this.rc, p.from), text: p.text, cause_by: p.cause_by ?? "message" };
  }

  /** Does this member's subscription (binding.read.filter on its edge) accept the post? */
  accepts(member: string, p: RoomPost): boolean {
    const edge = this.rc.doc.edges.find((e) => e.kind === "access" && e.source === member && e.target === this.id);
    const filter = edge?.binding?.read?.filter;
    return !filter || testExpr(filter, { msg: this.msg(p) }).ok;
  }

  transcript(budgetChars = 32_000, member?: string): string {
    let out = "";
    for (let i = this.posts.length - 1; i >= 0; i--) {
      const p = this.posts[i];
      if (member && p.from !== member && !this.accepts(member, p)) continue;
      const line = `${nameOf(this.rc, p.from)}${p.cause_by ? ` [${p.cause_by}]` : ""}: ${p.text}\n`;
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

  async beforeTurn(turn: { node: string; edge: SysEdge }) {
    const budget = (turn.edge.binding?.read?.budget_tokens ?? 8000) * 4;
    const t = this.transcript(budget, turn.node);
    return t ? `Conversation in ${this.node.data.name}:\n${t}` : null;
  }
}
