"""An agent program for MAS Studio's custom-stdio protocol, with no dependencies.

Each turn the platform writes one JSON line to stdin:
  {"type": "deliver", "input": ..., "context": ..., "session": ..., "mcp": {"url": ..., "token": ...}}
and reads JSON lines from stdout: {"type": "log"|"output"|"session"|"usage", ...}.
The platform's tools for this agent are an MCP server at mcp.url (JSON-RPC over
HTTP, the token as a bearer). This one lists them, calls the first that takes
no arguments (or none), and replies with what it found."""
import json
import sys
import urllib.request


def say(**msg):
    print(json.dumps(msg), flush=True)


def mcp(url, token, method, params=None, id_=1):
    body = json.dumps({"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}}).encode()
    req = urllib.request.Request(url, data=body, headers={"content-type": "application/json", "authorization": f"Bearer {token}"})
    return json.load(urllib.request.urlopen(req, timeout=30)).get("result", {})


msg = json.loads(sys.stdin.readline())
reply = f"I was asked: {msg['input'][:200]}"
m = msg.get("mcp")
if m:
    mcp(m["url"], m["token"], "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "tool-lister", "version": "1"}})
    tools = mcp(m["url"], m["token"], "tools/list", id_=2).get("tools", [])
    say(type="log", text=f"{len(tools)} platform tools: {', '.join(t['name'] for t in tools)}")
    reply += f"\nThe platform gives me {len(tools)} tools: {', '.join(t['name'] for t in tools) or 'none'}."
say(type="output", text=reply)
say(type="session", id=str(int(msg.get("session") or 0) + 1))
