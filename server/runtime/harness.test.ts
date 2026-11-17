// @vitest-environment node
// A process harness reaches the platform's tools over the run's MCP endpoint.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Builder, native } from "@/model/builder";
import type { RunEvent } from "@/run/events";
import type { Config } from "../config";
import { Store } from "../store/files";
import { Secrets } from "../store/secrets";
import { handleMcp } from "./mcpProxy";
import { RunManager } from "./runs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-harness-"));
let server: http.Server;
let runs: RunManager;
let store: Store;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const out = await handleMcp((req.headers.authorization ?? "").replace(/^Bearer /, ""), JSON.parse(body || "{}"));
      if (out === null) return res.writeHead(202).end();
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const config: Config = { host: "127.0.0.1", port, dataDir: dir, token: "t", allowLocalExec: true, docker: "/nonexistent", parallelism: 2 };
  store = new Store(dir);
  runs = new RunManager(store, new Secrets(dir), config);
});
afterAll(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// a "harness": reads the deliver line, lists the MCP tools, calls write_file, prints its output
const PROGRAM = `
const line = require("fs").readFileSync(0, "utf8").split("\\n")[0];
const msg = JSON.parse(line);
const rpc = (method, params, id) => fetch(msg.mcp.url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + msg.mcp.token }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }).then((r) => r.json());
(async () => {
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }, 1);
  const list = await rpc("tools/list", {}, 2);
  const names = list.result.tools.map((t) => t.name).sort().join(",");
  const call = await rpc("tools/call", { name: "write_file", arguments: { path: "notes.txt", content: msg.input } }, 3);
  console.log(JSON.stringify({ type: "output", text: names + " | " + call.result.content[0].text }));
})();
`;

describe("process harness over MCP", () => {
  it("lists and calls the agent's platform tools", async () => {
    const script = path.join(dir, "harness.cjs");
    fs.writeFileSync(script, PROGRAM);
    const b = new Builder("Harness", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 300, 0, { name: "Prog", model: "sonnet", harness: { ...native(), tier: "process", runner: "custom-stdio", loop: undefined, command: `${process.execPath} ${script}`, instructions: "" } })
      .plugin("ws", "workspace", 300, 200, { name: "Files", scope: "system" })
      .edge("me", "a", "message")
      .edge("a", "me", "message")
      .edge("a", "ws", "access", { access: "read_write" });
    const rec = runs.start(b.doc, { input: "hello from the harness" });
    for (let i = 0; i < 1000 && runs.isActive(rec.id); i++) await new Promise((r) => setTimeout(r, 10));
    const events: RunEvent[] = store.events(rec.id);
    const errors = events.filter((e) => e.type === "log" && e.level === "error");
    expect(errors).toEqual([]);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toBe("list_files,read_file,write_file | Wrote notes.txt (22 chars)");
    // the call went through the agent's tool path: it is in the event stream
    expect(events.some((e) => e.type === "tool" && e.tool === "write_file" && e.node === "a")).toBe(true);
    expect(fs.readFileSync(path.join(dir, "state", b.doc.id, "fs", "work", "notes.txt"), "utf8")).toBe("hello from the harness");
  });
});
