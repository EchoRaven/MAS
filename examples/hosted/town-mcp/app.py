"""A small town over MCP (HTTP), with no dependencies, for Generative Agents-style systems: six places joined by
paths, the people in them, what was said where, and a clock that moves with every action. It is the text world
(examples/hosted/text-world-mcp) grown enough for news to have to travel: people start in different places, and what
is said is heard only by whoever is there, then or a little later.

It also keeps what the paper measures: who heard what (every line said where someone was, or found there on arrival),
and where everyone was over the day, so `report` can count who heard of something and who came to a place in a time
window (information diffusion and party attendance in Generative Agents).

Tools: look, move, say, wait, time, enter, report, advance, reset.
MCP: JSON-RPC 2.0 over POST /mcp (plain JSON replies); GET /health.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

MAP = {
    "cafe": {"about": "Hobbs Cafe: tables by the window, a counter, the smell of coffee.", "exits": ["park", "store", "college"]},
    "park": {"about": "Johnson Park: a pond, benches, an old oak.", "exits": ["cafe", "library", "houses"]},
    "library": {"about": "The town library: quiet rows of shelves and a reading desk.", "exits": ["park", "college"]},
    "college": {"about": "Oak Hill College: lecture rooms and a busy lawn.", "exits": ["cafe", "library"]},
    "store": {"about": "Harvey Oak Supply Store: shelves of everything, a cashier by the door.", "exits": ["cafe", "houses"]},
    "houses": {"about": "The residential street: front gardens and quiet porches.", "exits": ["park", "store"]},
}
SEEN = 5  # lines said at a place that someone arriving there still hears

lock = Lock()
state = {}


def reset(driven=False):
    state.clear()
    # driven: the clock moves only when the one running the simulation calls advance, so everyone acts in the same
    # step (the paper's game clock), instead of every action moving it
    state.update({"minute": 8 * 60, "where": {}, "said": {k: [] for k in MAP}, "heard": {}, "visits": {}, "driven": bool(driven)})
    return "The town starts over: 08:00, nobody in it." + (" The clock moves in steps." if driven else "")


reset()


def clock(m=None):
    m = state["minute"] if m is None else m
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


def minutes(hhmm):
    h, m = str(hhmm).split(":")
    return int(h) * 60 + int(m)


def tick(n):
    if not state.get("driven"):
        state["minute"] += n


def hear(who, line):
    """who hears one line said at a place (each line once)"""
    got = state["heard"].setdefault(who, [])
    if line not in got:
        got.append(line)


def arrive(who, place):
    state["where"][who] = place
    state["visits"].setdefault(who, []).append((state["minute"], place))
    for line in state["said"][place][-SEEN:]:
        hear(who, line)


def place_of(who):
    if who not in state["where"]:
        arrive(who, "houses")  # someone who never entered starts on the residential street
    return state["where"][who]


def look(who):
    p = place_of(who)
    for line in state["said"][p][-SEEN:]:
        hear(who, line)
    people = sorted(w for w, q in state["where"].items() if q == p and w != who)
    said = state["said"][p][-SEEN:]
    return "\n".join([
        f"{clock()} at the {p}. {MAP[p]['about']}",
        f"Here: {', '.join(people) or 'nobody else'}.",
        f"Exits: {', '.join(MAP[p]['exits'])}.",
        "Said here lately: " + (" | ".join(f"{clock(t)} {w}: {x}" for t, w, x in said) if said else "nothing"),
    ])


def report(a):
    """who heard a keyword (besides those who said it first), and who was at a place in a time window"""
    key = str(a.get("keyword", "")).strip().lower()
    place = str(a.get("place", "")).strip().lower()
    out = {"time": clock(), "people": sorted(state["visits"])}
    if key:
        speakers = {w for p in MAP for (t, w, x) in state["said"][p] if key in x.lower()}
        first = min(((t, w) for p in MAP for (t, w, x) in state["said"][p] if key in x.lower()), default=(None, None))[1]
        heard = sorted(who for who, lines in state["heard"].items() if any(key in x.lower() for (t, w, x) in lines if w != who))
        out["keyword"] = {"word": key, "first_said_by": first, "said_by": sorted(speakers), "heard_by": heard,
                          "heard_by_others": [w for w in heard if w != first]}
    if place:
        lo, hi = minutes(a.get("from", "00:00")), minutes(a.get("to", "23:59"))
        came = []
        for who, visits in state["visits"].items():
            # where each was from each move until the next: present in the window if any stay overlaps it
            stays = visits + [(state["minute"] + 1, None)]
            if any(p == place and t < hi and stays[i + 1][0] > lo for i, (t, p) in enumerate(stays[:-1])):
                came.append(who)
        out["place"] = {"place": place, "from": clock(lo), "to": clock(hi), "there": sorted(came)}
    return json.dumps(out)


def act(name, a):
    if name == "reset":
        return reset(a.get("driven", False))
    if name == "advance":
        state["minute"] += max(1, min(240, int(a.get("minutes", 30))))
        return clock()
    if name == "time":
        return clock()
    if name == "report":
        return report(a)
    who = str(a.get("who", "")).strip()
    if not who:
        raise ValueError("say who is acting: give who")
    if name == "enter":
        to = str(a.get("place", "houses")).strip().lower()
        if to not in MAP:
            raise ValueError(f"no place {to}: {', '.join(MAP)}")
        if who in state["where"]:
            return f"{who} is already in town, at the {state['where'][who]}."
        arrive(who, to)
        return look(who)
    p = place_of(who)
    if name == "look":
        return look(who)
    if name == "move":
        to = str(a.get("to", "")).strip().lower()
        if to not in MAP[p]["exits"]:
            raise ValueError(f"from the {p} you can go to: {', '.join(MAP[p]['exits'])}")
        tick(10)
        arrive(who, to)
        return look(who)
    if name == "say":
        text = str(a.get("text", "")).strip()[:500]
        line = (state["minute"], who, text)
        state["said"][p].append(line)
        for w, q in state["where"].items():
            if q == p and w != who:
                hear(w, line)
        tick(5)
        return f"{who} says at the {p}: {text}"
    if name == "wait":
        tick(max(5, min(120, int(a.get("minutes", 30)))))
        return look(who)
    raise KeyError(name)


WHO = {"type": "string", "description": "the name of the one acting"}
TOOLS = [
    {"name": "look", "description": "Where you are: time, people, exits, what was said here lately", "inputSchema": {"type": "object", "properties": {"who": WHO}, "required": ["who"]}},
    {"name": "move", "description": "Walk to a neighbouring place (10 minutes)", "inputSchema": {"type": "object", "properties": {"who": WHO, "to": {"type": "string"}}, "required": ["who", "to"]}},
    {"name": "say", "description": "Say something where you are; whoever is here, or arrives soon after, hears it (5 minutes)", "inputSchema": {"type": "object", "properties": {"who": WHO, "text": {"type": "string"}}, "required": ["who", "text"]}},
    {"name": "wait", "description": "Let time pass where you are (30 minutes unless given, 5 to 120)", "inputSchema": {"type": "object", "properties": {"who": WHO, "minutes": {"type": "integer"}}, "required": ["who"]}},
    {"name": "time", "description": "The time in town", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "enter", "description": "Put someone in town at a place, once, at the start", "inputSchema": {"type": "object", "properties": {"who": WHO, "place": {"type": "string"}}, "required": ["who", "place"]}},
    {"name": "report", "description": "Who heard a keyword, and who was at a place between two times (HH:MM), as JSON", "inputSchema": {"type": "object", "properties": {"keyword": {"type": "string"}, "place": {"type": "string"}, "from": {"type": "string"}, "to": {"type": "string"}}}},
    {"name": "advance", "description": "Move the clock on (the one running the simulation, between steps)", "inputSchema": {"type": "object", "properties": {"minutes": {"type": "integer"}}}},
    {"name": "reset", "description": "Start the town over (08:00, nobody in it); driven: the clock moves only by advance", "inputSchema": {"type": "object", "properties": {"driven": {"type": "boolean"}}}},
]


def handle(msg):
    method, id_ = msg.get("method"), msg.get("id")
    if id_ is None:
        return None  # a notification
    if method == "initialize":
        result = {"protocolVersion": msg.get("params", {}).get("protocolVersion", "2025-03-26"), "capabilities": {"tools": {}}, "serverInfo": {"name": "town", "version": "1.0"}}
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
