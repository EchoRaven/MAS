"""A plugin backend over HTTP, with no dependencies, in the shape MAS Studio
calls (mas-plugin/1, backend kind http):
  POST /tools/<name>        the tool's arguments as JSON; the reply is the result
  POST /hooks/before_turn   { agent, input, run_id } -> text added to the context
  GET  /health              200 when it is up"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, text):
        body = text.encode()
        self.send_response(code)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(200, "ok") if self.path == "/health" else self._send(404, "not found")

    def do_POST(self):
        args = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        if self.path == "/tools/count_words":
            text = str(args.get("input") or args.get("text") or "")
            return self._send(200, f"{len(text.split())} words, {len(text)} characters")
        if self.path == "/hooks/before_turn":
            return self._send(200, "Word counts come from the count_words tool; use it rather than counting yourself.")
        self._send(404, "not found")

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
