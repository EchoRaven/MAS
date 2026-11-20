// Sandbox: a box per run (or kept, for per_session / persistent lifecycles)
// with a work folder mounted at /work, from an isolation backend (Docker
// today: not root, no capabilities, seccomp, read-only root). No network
// unless the env lists egress hosts, and then only those, through the egress
// proxy. With share: per_agent each agent gets its own box and folder.
// Without a backend, commands run on the host only when MAS_ALLOW_LOCAL_EXEC=1.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { EnvData, SysEdge, SysNode } from "@/model/types";
import type { RunCtx } from "../../context";
import { confine, hasWorkFolder, listFiles, sharedFolder } from "../plugins/workspace";
import { type Box, DockerBackend, type SandboxBackend } from "../../isolation";
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

/** One agent's (or every agent's, when shared) machine: a work folder and the box it is mounted in. */
interface Seat {
  dir: string;
  box?: Promise<Box | null>;
}

export class SandboxEnv implements Resource {
  private seats = new Map<string, Seat>();
  private backend: SandboxBackend;
  /** the shared seat's folder (with share: per_agent, each agent's is a folder under it) */
  readonly dir: string;
  constructor(
    private rc: RunCtx,
    private node: SysNode<EnvData>,
    backend?: SandboxBackend,
  ) {
    const keep = node.data.lifecycle !== "per_run";
    // a workspace plugin with source /work is this folder, so agents can write code there and run it here
    this.dir = hasWorkFolder(rc) ? sharedFolder(rc, "/work")! : keep ? rc.store.stateDir(rc.doc.id, node.id, "work") : rc.store.stateDir(rc.doc.id, node.id, "runs", rc.runId);
    this.backend = backend ?? new DockerBackend(rc.config.docker, rc.hosted?.egressGrant);
  }
  get id() {
    return this.node.id;
  }

  /** Each agent its own machine (share: per_agent), or one for all of them. */
  private seat(agent?: string): { key: string; seat: Seat } {
    const own = this.node.data.share === "per_agent" && agent;
    const key = own ? agent : "shared";
    let seat = this.seats.get(key);
    if (!seat) {
      seat = { dir: own ? path.join(this.dir, "agents", agent.replace(/[^a-zA-Z0-9_.-]/g, "-")) : this.dir };
      fs.mkdirSync(seat.dir, { recursive: true });
      // the run's input as a file, so a program reads it instead of the agent typing it out again (a 44,000-character
      // ledger cost 21,000 output tokens an answer to paste into code)
      if (this.rc.input) fs.writeFileSync(path.join(seat.dir, "input.txt"), this.rc.input);
      this.seats.set(key, seat);
    }
    return { key, seat };
  }

  private start(agent?: string): { seat: Seat; box: Promise<Box | null> } {
    const { key, seat } = this.seat(agent);
    seat.box ??= (async () => {
      const avail = await this.backend.available();
      if (!avail.ok) {
        if (!this.rc.config.allowLocalExec) throw new Error(`${avail.why}; MAS_ALLOW_LOCAL_EXEC is off, so sandbox commands cannot run`);
        this.rc.emit({ type: "log", node: this.id, level: "warn", text: `${avail.why}: running sandbox commands on the host, without isolation (MAS_ALLOW_LOCAL_EXEC=1)` });
        return null;
      }
      const d = this.node.data;
      const scope = d.lifecycle === "per_run" ? this.rc.runId : "keep";
      const name = `mas-${this.rc.doc.id}-${this.node.id}-${key === "shared" ? "" : `${key}-`}${scope}`.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 120);
      const box = await this.backend.start({ name, image: d.image || "python:3.12-slim", workDir: seat.dir, egress: d.egress, labels: { "mas.system": this.rc.doc.id, "mas.env": this.node.id, "mas.run": this.rc.runId },
        onEgress: (a) => this.rc.emit({ type: "log", node: this.id, level: a.allowed ? "info" : "warn", text: `egress: ${a.target} ${a.allowed ? "allowed" : `refused (${a.why})`}` }),
      });
      this.rc.emit({ type: "log", node: this.id, level: "info", text: `Sandbox ${d.image || "python:3.12-slim"}${key === "shared" ? "" : ` for ${key}`}: ${box.isolation}` });
      return box;
    })();
    return { seat, box: seat.box };
  }

  /** A shell command in the agent's machine (or the shared one). */
  async sh(command: string, timeoutMs = 120_000, agent?: string): Promise<string> {
    const { seat, box: pending } = this.start(agent);
    const box = await pending;
    const r = box ? await this.backend.exec(box, command, timeoutMs) : await exec("sh", ["-lc", command], { timeout: timeoutMs, cwd: seat.dir });
    const out = r.out.length > 30_000 ? `${r.out.slice(0, 15_000)}\n…\n${r.out.slice(-15_000)}` : r.out;
    return `exit ${r.code}\n${out}`;
  }

  async tools(edge: SysEdge): Promise<RtTool[]> {
    const ro = edge.access === "read";
    const agent = edge.source;
    const dir = () => this.seat(agent).seat.dir;
    const all: RtTool[] = [
      { name: "bash", description: `Run a shell command in ${this.node.data.name} (cwd /work). The run's input, as given, is in /work/input.txt: read it from there rather than copying it into a command`, input_schema: schema({ command: S }), effect: "write", source: this.id, run: async (a) => this.sh(String(a.command), 120_000, agent) },
      { name: "edit_file", description: "Read or write a file under /work. Omit content to read.", input_schema: schema({ path: S, content: S }, ["path"]), effect: "write", source: this.id, run: async (a) => {
        const f = confine(dir(), String(a.path).replace(/^\/work\/?/, ""));
        if (a.content == null) return fs.existsSync(f) ? fs.readFileSync(f, "utf8").slice(0, 50_000) : `no such file: ${a.path}`;
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, String(a.content));
        return `Wrote ${a.path}`;
      } },
      { name: "run_tests", description: "Run the tests in /work. With no command: pytest when it is installed, else every test_* function in test*.py / *_test.py is called (plain asserts); npm test for a package.json", input_schema: schema({ command: S }, []), effect: "read", source: this.id, run: async (a) => this.sh(String(a.command || DEFAULT_TESTS), 600_000, agent) },
      { name: "list_work", description: "List files under /work", input_schema: schema({}), effect: "read", source: this.id, run: async () => listFiles(dir()).join("\n") || "(empty)" },
    ];
    return all.filter((t) => !ro || t.effect === "read");
  }

  async close() {
    if (this.node.data.lifecycle !== "per_run") return;
    await Promise.all(
      [...this.seats.values()].map(async (seat) => {
        const box = await seat.box?.catch(() => null);
        if (box) await this.backend.stop(box);
      }),
    );
  }
}
