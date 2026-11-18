// Sandbox: a Docker container per run (or kept, for per_session /
// persistent lifecycles) with a work folder mounted at /work. No network
// unless the env lists egress. Without Docker, commands run on the host only
// when MAS_ALLOW_LOCAL_EXEC=1.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { EnvData, SysEdge, SysNode } from "@/model/types";
import type { RunCtx } from "../../context";
import { confine, hasWorkFolder, listFiles, sharedFolder } from "../plugins/workspace";
import { S, schema, type Resource, type RtTool } from "../types";

function exec(cmd: string, args: string[], opts: { timeout?: number; cwd?: string } = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout ?? 120_000, cwd: opts.cwd, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === "number" ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ code, out: `${stdout}${stderr ? (stdout ? "\n" : "") + stderr : ""}`.trim() });
    });
  });
}

/**
 * Python images often lack pytest, and a sandbox without network cannot
 * install it: then a minimal runner calls every test_* function in the test
 * files (plain asserts), so a test-and-fix loop still gets a real verdict.
 */
const PY_TESTS = `import glob, importlib.util, sys, traceback
sys.path.insert(0, ".")
files = sorted(set(glob.glob("test*.py") + glob.glob("*_test.py") + glob.glob("tests/test*.py")))
failed = passed = 0
for f in files:
    spec = importlib.util.spec_from_file_location(f[:-3].replace("/", "_"), f)
    m = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(m)
    except Exception:
        print("ERROR importing", f); traceback.print_exc(limit=3); failed += 1; continue
    for name in sorted(n for n in dir(m) if n.startswith("test") and callable(getattr(m, n))):
        try:
            getattr(m, name)(); passed += 1
        except Exception:
            failed += 1; print("FAILED", f + "::" + name); traceback.print_exc(limit=3)
print(f"{passed} passed, {failed} failed" if files else "no tests found")
sys.exit(1 if failed or not files else 0)
`;
// the output is kept to its tail, and the exit status is the tests' (a pipe into tail would hide it)
export const DEFAULT_TESTS = `if [ -n "$(ls *test*.py tests/*.py 2>/dev/null)" ]; then
if python -c "import pytest" 2>/dev/null; then python -m pytest -q > /tmp/mas-tests.out 2>&1; else python - > /tmp/mas-tests.out 2>&1 <<'PYTESTS'
${PY_TESTS}PYTESTS
fi; s=$?; tail -60 /tmp/mas-tests.out; exit $s
elif [ -f package.json ]; then npm test > /tmp/mas-tests.out 2>&1; s=$?; tail -40 /tmp/mas-tests.out; exit $s
else echo 'no tests found'; fi`;

export class SandboxEnv implements Resource {
  private container?: Promise<string | null>;
  readonly dir: string;
  constructor(
    private rc: RunCtx,
    private node: SysNode<EnvData>,
  ) {
    const keep = node.data.lifecycle !== "per_run";
    // a workspace plugin with source /work is this folder, so agents can write code there and run it here
    this.dir = hasWorkFolder(rc) ? sharedFolder(rc, "/work")! : keep ? rc.store.stateDir(rc.doc.id, node.id, "work") : rc.store.stateDir(rc.doc.id, node.id, "runs", rc.runId);
  }
  get id() {
    return this.node.id;
  }

  private start(): Promise<string | null> {
    this.container ??= (async () => {
      const image = this.node.data.image || "python:3.12-slim";
      const name = `mas-${this.rc.doc.id}-${this.node.id}-${this.node.data.lifecycle === "per_run" ? this.rc.runId : "keep"}`.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 120);
      const probe = await exec(this.rc.config.docker, ["version", "--format", "{{.Server.Version}}"], { timeout: 10_000 });
      if (probe.code !== 0) {
        if (!this.rc.config.allowLocalExec) throw new Error("Docker is not available and MAS_ALLOW_LOCAL_EXEC is off, so sandbox commands cannot run");
        this.rc.emit({ type: "log", node: this.id, level: "warn", text: "Docker unavailable: running sandbox commands on the host (MAS_ALLOW_LOCAL_EXEC=1)" });
        return null;
      }
      const running = await exec(this.rc.config.docker, ["inspect", "-f", "{{.State.Running}}", name], { timeout: 10_000 });
      if (running.code === 0 && running.out.trim() === "true") return name;
      if (running.code === 0) await exec(this.rc.config.docker, ["rm", "-f", name]);
      this.rc.emit({ type: "log", node: this.id, level: "info", text: `Starting sandbox ${image}` });
      const net = this.node.data.egress.length ? [] : ["--network", "none"];
      const r = await exec(this.rc.config.docker, ["run", "-d", "--name", name, ...net, "--memory", "2g", "--cpus", "2", "--pids-limit", "512", "-v", `${this.dir}:/work`, "-w", "/work", image, "sleep", "infinity"], { timeout: 600_000 });
      if (r.code !== 0) throw new Error(`Could not start the sandbox: ${r.out.slice(-400)}`);
      return name;
    })();
    return this.container;
  }

  async sh(command: string, timeoutMs = 120_000): Promise<string> {
    const c = await this.start();
    const r = c ? await exec(this.rc.config.docker, ["exec", "-w", "/work", c, "sh", "-lc", command], { timeout: timeoutMs }) : await exec("sh", ["-lc", command], { timeout: timeoutMs, cwd: this.dir });
    const out = r.out.length > 30_000 ? `${r.out.slice(0, 15_000)}\n…\n${r.out.slice(-15_000)}` : r.out;
    return `exit ${r.code}\n${out}`;
  }

  async tools(edge: SysEdge): Promise<RtTool[]> {
    const ro = edge.access === "read";
    const all: RtTool[] = [
      { name: "bash", description: `Run a shell command in ${this.node.data.name} (cwd /work)`, input_schema: schema({ command: S }), effect: "write", source: this.id, run: async (a) => this.sh(String(a.command)) },
      { name: "edit_file", description: "Read or write a file under /work. Omit content to read.", input_schema: schema({ path: S, content: S }, ["path"]), effect: "write", source: this.id, run: async (a) => {
        const f = confine(this.dir, String(a.path).replace(/^\/work\/?/, ""));
        if (a.content == null) return fs.existsSync(f) ? fs.readFileSync(f, "utf8").slice(0, 50_000) : `no such file: ${a.path}`;
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, String(a.content));
        return `Wrote ${a.path}`;
      } },
      { name: "run_tests", description: "Run the tests in /work. With no command: pytest when it is installed, else every test_* function in test*.py / *_test.py is called (plain asserts); npm test for a package.json", input_schema: schema({ command: S }, []), effect: "read", source: this.id, run: async (a) => this.sh(String(a.command || DEFAULT_TESTS), 600_000) },
      { name: "list_work", description: "List files under /work", input_schema: schema({}), effect: "read", source: this.id, run: async () => listFiles(this.dir).join("\n") || "(empty)" },
    ];
    return all.filter((t) => !ro || t.effect === "read");
  }

  async close() {
    if (this.node.data.lifecycle !== "per_run" || !this.container) return;
    const c = await this.container.catch(() => null);
    if (c) await exec(this.rc.config.docker, ["rm", "-f", c], { timeout: 30_000 });
  }
}
