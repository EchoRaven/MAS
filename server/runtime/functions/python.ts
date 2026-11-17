// Python functions: the body runs as `def f(input, ctx):` in a fresh
// python3 process; input and ctx go in as JSON, the return value comes back
// as JSON. ctx here is data only (no llm helper).
import { spawn } from "node:child_process";

const WRAPPER = `
import json, sys
_data = json.loads(sys.stdin.read())
def f(input, ctx):
{BODY}
_out = f(_data["input"], _data["ctx"])
sys.stdout.write("\\n__MAS_RESULT__" + json.dumps(_out, default=str))
`;

export function runPython(code: string, input: unknown, ctx: Record<string, unknown>, timeoutMs = 20_000, python = process.env.MAS_PYTHON ?? "python3"): Promise<unknown> {
  const body = code
    .split("\n")
    .map((l) => "    " + l)
    .join("\n");
  const src = WRAPPER.replace("{BODY}", body.trim() ? body : "    return input");
  return new Promise((resolve, reject) => {
    const p = spawn(python, ["-I", "-c", src], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`python timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      const i = out.lastIndexOf("__MAS_RESULT__");
      if (code !== 0 || i < 0) return reject(new Error(err.trim().split("\n").slice(-3).join("\n") || `python exited with ${code}`));
      try {
        resolve(JSON.parse(out.slice(i + "__MAS_RESULT__".length)));
      } catch (e) {
        reject(e);
      }
    });
    const safeCtx = Object.fromEntries(Object.entries(ctx).filter(([, v]) => typeof v !== "function"));
    p.stdin.end(JSON.stringify({ input, ctx: safeCtx }));
  });
}
