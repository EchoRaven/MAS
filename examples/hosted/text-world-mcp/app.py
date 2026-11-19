"""A small shared world over MCP (HTTP), with no dependencies: places, things,
the people in them, what was said where, and a clock that moves with every
action. Agents act in it through tools; each call names who is acting.

It is how a system brings in a world of its own (Generative Agents' town,
a game, a simulated office): the world is a hosted service, every agent
connected to it sees the same state, and the state lasts between calls.

Tools: look, move, take, drop, say, wait, time, reset.
MCP: JSON-RPC 2.0 over POST /mcp (plain JSON replies); GET /health.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

MAP = {
    "cafe": {"about": "Hobbs Cafe: tables by the window, a counter, the smell of coffee.", "exits": ["park", "library"]},
    "park": {"about": "Johnson Park: a pond, benches, an old oak.", "exits": ["cafe", "library"]},
    "library": {"about": "The town library: quiet rows of shelves and a reading desk.", "exits": ["cafe", "park"]},
}
START_THINGS = {"cafe": ["menu", "coffee cup"], "park": ["frisbee"], "library": ["town history book"]}

lock = Lock()
state = {}


def reset():
    state.clear()
    state.update({"minute": 8 * 60, "where": {}, "things": {k: list(v) for k, v in START_THINGS.items()}, "carrying": {}, "heard": {k: [] for k in MAP}})
    return "The world starts over: 08:00, everyone outside it."


reset()


def clock():
    m = state["minute"]
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


def tick(minutes=10):
    state["minute"] += minutes


def place_of(who):
    if who not in state["where"]:
        state["where"][who] = "cafe"  # newcomers arrive at the cafe
    return state["where"][who]


def look(who):
    p = place_of(who)
    people = sorted(w for w, q in state["where"].items() if q == p and w != who)
    heard = state["heard"][p][-5:]
    return "\n".join([
        f"{clock()} at the {p}. {MAP[p]['about']}",
        f"Here: {', '.join(people) or 'nobody else'}.",
        f"Things: {', '.join(state['things'][p]) or 'none'}.",
        f"You carry: {', '.join(state['carrying'].get(who, [])) or 'nothing'}.",
        f"Exits: {', '.join(MAP[p]['exits'])}.",
        "Said here lately: " + (" | ".join(heard) if heard else "nothing"),
    ])


def act(name, a):
    who = str(a.get("who", "")).strip()
    if name == "reset":
        return reset()
    if name == "time":
        return clock()
    if not who:
        raise ValueError("say who is acting: give who")
    p = place_of(who)
    if name == "look":
        return look(who)
    if name == "move":
        to = str(a.get("to", "")).strip().lower()
        if to not in MAP[p]["exits"]:
            raise ValueError(f"from the {p} you can go to: {', '.join(MAP[p]['exits'])}")
        state["where"][who] = to
        tick(10)
        return look(who)
    if name == "take":
        item = str(a.get("item", "")).strip().lower()
        if item not in state["things"][p]:
            raise ValueError(f"no {item} here")
        state["things"][p].remove(item)
        state["carrying"].setdefault(who, []).append(item)
        tick(1)
        return f"{who} takes the {item}."
    if name == "drop":
        item = str(a.get("item", "")).strip().lower()
        if item not in state["carrying"].get(who, []):
            raise ValueError(f"{who} is not carrying a {item}")
        state["carrying"][who].remove(item)
        state["things"][p].append(item)
        tick(1)
        return f"{who} puts down the {item} at the {p}."
    if name == "say":
        text = str(a.get("text", "")).strip()[:500]
        state["heard"][p].append(f"{clock()} {who}: {text}")
        tick(2)
        return f"{who} says at the {p}: {text}"
    if name == "wait":
        tick(int(a.get("minutes", 30)))
        return look(who)
    raise KeyError(name)


WHO = {"type": "string", "description": "the name of the one acting"}
TOOLS = [
    {"name": "look", "description": "What the place you are in holds: time, people, things, exits, what was said", "inputSchema": {"type": "object", "properties": {"who": WHO}, "required": ["who"]}},
    {"name": "move", "description": "Go to a neighbouring place (10 minutes)", "inputSchema": {"type": "object", "properties": {"who": WHO, "to": {"type": "string"}}, "required": ["who", "to"]}},
    {"name": "take", "description": "Pick up a thing here", "inputSchema": {"type": "object", "properties": {"who": WHO, "item": {"type": "string"}}, "required": ["who", "item"]}},
    {"name": "drop", "description": "Put down a thing you carry", "inputSchema": {"type": "object", "properties": {"who": WHO, "item": {"type": "string"}}, "required": ["who", "item"]}},
    {"name": "say", "description": "Say something; whoever is here, now or later, hears it", "inputSchema": {"type": "object", "properties": {"who": WHO, "text": {"type": "string"}}, "required": ["who", "text"]}},
    {"name": "wait", "description": "Let time pass (30 minutes unless given)", "inputSchema": {"type": "object", "properties": {"who": WHO, "minutes": {"type": "integer"}}, "required": ["who"]}},
    {"name": "time", "description": "The time in the world", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "reset", "description": "Start the world over (08:00, nobody in it)", "inputSchema": {"type": "object", "properties": {}}},
]


def handle(msg):
    method, id_ = msg.get("method"), msg.get("id")
    if id_ is None:
        return None  # a notification
    if method == "initialize":
        result = {"protocolVersion": msg.get("params", {}).get("protocolVersion", "2025-03-26"), "capabilities": {"tools": {}}, "serverInfo": {"name": "text-world", "version": "1.0"}}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        p = msg.get("params", {})
        try:
            with lock:
                text = act(p.get("name"), p.get("arguments") or {})
            result = {"content": [{"type": "text", "text": text}]}
        except KeyError:
            return {"jsonrpc": "2.0", "id": id_, "error": {"code": -32601, "message": f"no tool {p.get('name')}"}}
        except ValueError as e:
            result = {"content": [{"type": "text", "text": str(e)}], "isError": True}
    elif method == "ping":
        result = {}
    else:
        return {"jsonrpc": "2.0", "id": id_, "error": {"code": -32601, "message": f"unknown method {method}"}}
    return {"jsonrpc": "2.0", "id": id_, "result": result}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body=None, kind="application/json"):
        data = b"" if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        self.send_response(code)
        self.send_header("content-type", kind)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "time": clock()})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/mcp":
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("content-length") or 0)
        msg = json.loads(self.rfile.read(n) or b"{}")
        out = [r for r in (handle(m) for m in msg) if r] if isinstance(msg, list) else handle(msg)
        if out is None or out == []:
            return self._send(202)
        self._send(200, out)

    def do_DELETE(self):
        self._send(200, {"ok": True})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
