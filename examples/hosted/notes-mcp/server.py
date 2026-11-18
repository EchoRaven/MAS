"""A minimal MCP server on stdio, with no dependencies: newline-delimited
JSON-RPC 2.0, tools add_note and list_notes. Notes live as long as the
connection (a hosted mcp-stdio service gets a fresh container each time)."""
import json
import sys

notes: list[str] = []

TOOLS = [
    {"name": "add_note", "description": "Save a short note", "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}},
    {"name": "list_notes", "description": "All notes saved so far", "inputSchema": {"type": "object", "properties": {}}},
]


def reply(id_, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": id_}
    if error:
        msg["error"] = {"code": -32601, "message": error}
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def call(name, args):
    if name == "add_note":
        notes.append(str(args.get("text", "")))
        return f"Saved note {len(notes)}."
    if name == "list_notes":
        return "\n".join(f"{i + 1}. {n}" for i, n in enumerate(notes)) or "No notes yet."
    raise KeyError(name)


for line in sys.stdin:
    if not line.strip():
        continue
    msg = json.loads(line)
    method, id_ = msg.get("method"), msg.get("id")
    if id_ is None:  # a notification
        continue
    if method == "initialize":
        reply(id_, {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "notes", "version": "1.0"}})
    elif method == "tools/list":
        reply(id_, {"tools": TOOLS})
    elif method == "tools/call":
        p = msg.get("params", {})
        try:
            reply(id_, {"content": [{"type": "text", "text": call(p.get("name"), p.get("arguments") or {})}]})
        except KeyError:
            reply(id_, {"content": [{"type": "text", "text": f"No tool {p.get('name')}"}], "isError": True})
    else:
        reply(id_, error=f"No method {method}")
