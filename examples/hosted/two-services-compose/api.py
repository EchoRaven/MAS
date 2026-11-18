"""The entry service: GET /health, and POST /tools/greet (a plugin backend tool) that asks the backend service by name."""
import json
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, text):
        body = text.encode()
        self.send_response(code)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(200, "ok") if self.path == "/health" else self._send(404, "not found")

    def do_POST(self):
        args = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        if self.path == "/tools/greet":
            name = str(args.get("input") or args.get("name") or "world")
            # the other service, by its compose name, on the project's internal network
            answer = urllib.request.urlopen(f"http://backend:9000/{name}", timeout=5).read().decode()
            return self._send(200, f"api asked backend, which said: {answer}")
        self._send(404, "not found")

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
