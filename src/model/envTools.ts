// What an env gives the agents connected to it, as the canvas and the
// inspector show it: the names of its tools, its network, and who uses it.
// Mirrors what the server's resources expose (server/runtime/resources/envs).
import type { EnvData, SystemDoc } from "./types";

export const SANDBOX_TOOLS = ["bash", "edit_file", "run_tests", "list_work"];

/** The tools an agent with read-write access gets from this env. */
export function envToolNames(e: EnvData, id: string): string[] {
  if (e.manifest?.exposes.mcp) return [...e.manifest.exposes.mcp.tools];
  if (e.env_kind === "room") return [`read_${id}`];
  if (e.env_kind === "sandbox") return SANDBOX_TOOLS;
  if (e.env_kind === "database") {
    const db = e.db;
    if (!db) return ["run_sql"];
    if (db.mode === "templates") return db.templates.map((t) => t.name);
    if (db.mode === "text_to_sql") return ["ask_database", "run_sql"];
    if (db.mode === "custom") return ["query_database"];
    return ["run_sql"];
  }
  return [];
}

/** The network as one phrase: "no network", or the hosts it may reach. */
export function envNetwork(e: EnvData): string {
  if (e.env_kind === "room") return "";
  if (!e.egress.length) return "no network";
  return e.egress.length <= 2 ? `only ${e.egress.join(", ")}` : `only ${e.egress.slice(0, 2).join(", ")} +${e.egress.length - 2}`;
}

export const LIFECYCLE_LABEL: Record<EnvData["lifecycle"], string> = { per_run: "new each run", per_session: "per session", persistent: "kept" };

/** Who is connected to an env or plugin through access edges, with what access. */
export function usersOf(doc: SystemDoc, id: string): { id: string; name: string; access: "read" | "read_write" }[] {
  return doc.edges
    .filter((e) => e.kind === "access" && e.target === id)
    .map((e) => {
      const n = doc.nodes.find((x) => x.id === e.source);
      return { id: e.source, name: n && "name" in n.data ? String(n.data.name) : e.source, access: e.access === "read" ? ("read" as const) : ("read_write" as const) };
    });
}
