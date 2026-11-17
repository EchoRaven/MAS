// @vitest-environment node
// The MCP client against real servers: the example notes server over stdio,
// and the platform's own /mcp endpoint over HTTP. And the rule that a server
// started as a command needs the local-exec opt-in.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Builder, native } from "@/model/builder";
import type { RunEvent } from "@/run/events";
import type { Config } from "../../config";
import { Store } from "../../store/files";
import { Secrets } from "../../store/secrets";
import { expose, handleMcp } from "../mcpProxy";
import { RunManager } from "../runs";
import { McpClient } from "./client";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const NOTES = `${process.execPath} ${path.join(ROOT, "examples/mcp/notes-server.mjs")}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-mcp-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("MCP client", () => {
  it("talks to a stdio server: lists its tools and calls them", async () => {
    const c = new McpClient({ command: NOTES });
    try {
      expect((await c.tools()).map((t) => t.name)).toEqual(["add_note", "list_notes"]);
      expect((await c.call("add_note", { text: "buy milk" })).text).toBe("Noted (1 in the notebook).");
      expect((await c.call("list_notes", {})).text).toBe("1. buy milk");
      expect((await c.call("add_note", {})).error).toBe(true);
    } finally {
      await c.close();
    }
  });

  it("talks to an HTTP server: the platform's own /mcp endpoint", async () => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", async () => {
        const out = await handleMcp((req.headers.authorization ?? "").replace(/^Bearer /, ""), JSON.parse(body || "{}"));
        if (out === null) return res.writeHead(202).end();
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const ex = expose("run-x", "agent-x", [{ name: "echo", description: "Echo", input_schema: { type: "object" }, effect: "pure", source: "x", run: async (a) => `echo: ${a.text}` }], `http://127.0.0.1:${port}`);
    const c = new McpClient({ url: ex.url, headers: { authorization: `Bearer ${ex.token}` } });
    try {
      expect((await c.tools()).map((t) => t.name)).toEqual(["echo"]);
      expect((await c.call("echo", { text: "hi" })).text).toBe("echo: hi");
    } finally {
      await c.close();
      server.close();
    }
  });
});

describe("a plugin backed by an MCP server", () => {
  const doc = () => {
    const b = new Builder("Notes", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 200, 0, { name: "Clerk", model: "clerk", harness: { ...native(), instructions: "" } })
      .plugin("notes", "custom", 200, 200, { name: "Notebook", backend: { kind: "mcp", command: NOTES }, tools: [] })
      .edge("me", "a", "message")
      .edge("a", "me", "message")
      .edge("a", "notes", "access", { access: "read_write" });
    b.doc.models.push({
      id: "clerk",
      provider: "mock",
      model: "mock",
      api: { params: { script: [{ tool: "add_note", input: { text: "call the plumber" } }, { tool: "list_notes", input: {} }, "Done: {{input}}"] } },
      price_in: 0,
      price_out: 0,
      modalities: ["text"],
    });
    return b.doc;
  };
  const runIt = async (allowLocalExec: boolean) => {
    const config: Config = { host: "127.0.0.1", port: 0, dataDir: dir, token: "t", allowLocalExec, docker: "/x", parallelism: 2 };
    const store = new Store(dir);
    const runs = new RunManager(store, new Secrets(dir), config);
    const rec = runs.start(doc(), { input: "note it" });
    for (let i = 0; i < 500 && runs.isActive(rec.id); i++) await new Promise((r) => setTimeout(r, 10));
    return store.events(rec.id) as RunEvent[];
  };

  it("gives the agent the server's tools, and they work", async () => {
    const events = await runIt(true);
    const tools = events.filter((e): e is Extract<RunEvent, { type: "tool" }> => e.type === "tool");
    expect(tools.map((t) => [t.tool, t.result, !!t.error])).toEqual([
      ["add_note", "Noted (1 in the notebook).", false],
      ["list_notes", "1. call the plumber", false],
    ]);
  });

  it("will not start the server without the local-exec opt-in, and says why", async () => {
    const events = await runIt(false);
    expect(events.some((e) => e.type === "log" && /MAS_ALLOW_LOCAL_EXEC/.test(e.text))).toBe(true);
    expect(events.some((e) => e.type === "tool" && !e.error)).toBe(false);
  });
});
