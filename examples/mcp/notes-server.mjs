#!/usr/bin/env node
// A minimal MCP server over stdio: a notebook with two tools. It is the
// smallest real thing a custom plugin can point at (backend: mcp, command:
// node examples/mcp/notes-server.mjs), and the runtime's tests talk to it.
//
// Newline-delimited JSON-RPC 2.0: initialize, tools/list, tools/call.
import readline from "node:readline";

const notes = [];

const TOOLS = [
  {
    name: "add_note",
    description: "Add a note to the notebook",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "list_notes",
    description: "List every note in the notebook, oldest first",
    inputSchema: { type: "object", properties: {} },
  },
];

function handle(msg) {
  switch (msg.method) {
    case "initialize":
      return { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "notes", version: "1.0.0" } };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const { name, arguments: args = {} } = msg.params ?? {};
      if (name === "add_note") {
        if (!args.text) return { content: [{ type: "text", text: "text is required" }], isError: true };
        notes.push(String(args.text));
        return { content: [{ type: "text", text: `Noted (${notes.length} in the notebook).` }] };
      }
      if (name === "list_notes") return { content: [{ type: "text", text: notes.map((n, i) => `${i + 1}. ${n}`).join("\n") || "(the notebook is empty)" }] };
      return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true };
    }
    default:
      throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 });
  }
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // a notification: nothing to answer
  try {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: handle(msg) }) + "\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: e.code ?? -32603, message: e.message } }) + "\n");
  }
});
