// Live resources of one run, created on first use and closed at the end.
import type { EnvData, PluginData, SysEdge, SysNode } from "@/model/types";
import type { RunCtx } from "../context";
import { DatabaseEnv } from "./envs/database";
import { McpEnv } from "./envs/mcpEnv";
import { RoomEnv } from "./envs/room";
import { SandboxEnv } from "./envs/sandbox";
import { createPlugin } from "./plugins";
import type { Resource, RtTool } from "./types";

class PlainEnv implements Resource {
  constructor(readonly id: string) {}
  async tools(_edge: SysEdge): Promise<RtTool[]> {
    return [];
  }
}

export class Hub {
  private live = new Map<string, Resource>();
  constructor(private rc: RunCtx) {}

  get(id: string): Resource {
    let r = this.live.get(id);
    if (r) return r;
    const node = this.rc.byId.get(id);
    if (!node) throw new Error(`No component ${id}`);
    const d = node.data;
    if (d.kind === "plugin") r = createPlugin(this.rc, node as SysNode<PluginData>);
    else if (d.kind === "env") {
      const env = node as SysNode<EnvData>;
      if (d.env_kind === "room") r = new RoomEnv(this.rc, env);
      else if (d.manifest?.exposes.mcp) r = new McpEnv(this.rc, env);
      else if (d.env_kind === "sandbox") r = new SandboxEnv(this.rc, env);
      else if (d.env_kind === "database") r = new DatabaseEnv(this.rc, env);
      else r = new PlainEnv(id);
    } else throw new Error(`${id} is not an env or plugin`);
    this.live.set(id, r);
    return r;
  }

  room(id: string): RoomEnv | null {
    const r = this.get(id);
    return r instanceof RoomEnv ? r : null;
  }

  async closeAll() {
    await Promise.all([...this.live.values()].map((r) => r.close?.().catch(() => undefined)));
    this.live.clear();
  }
}
