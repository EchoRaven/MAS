// Grading code by running it: the model's code and the benchmark's tests go
// into one program, run in a throwaway Docker container with no network,
// little memory and a time limit. It passes when the program exits cleanly.
import { SECCOMP_PROFILE } from "../isolation";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** What a code case's `expected` holds (as JSON): the tests to run against the answer. */
export interface CodeSpec {
  kind: "code";
  /** the problem as given (HumanEval: signature and docstring, with its imports) */
  prompt?: string;
  /** test code; HumanEval defines check(candidate) */
  test: string;
  /** the function under test: HumanEval calls check(entry_point) */
  entry_point?: string;
  /**
   * stdin/stdout tests (competitive programming: LiveCodeBench, AtCoder): the answer is a whole program, run once
   * per test with the input on stdin; its output must equal the expected one, token by token. `test` is then unused.
   */
  io?: { input: string; output: string }[];
  /** seconds for the whole run (default 10); with io, each test also has its own limit (per_test, default 6) */
  seconds?: number;
  per_test?: number;
}

export function parseCodeSpec(expected: string): CodeSpec | null {
  try {
    const s = JSON.parse(expected) as CodeSpec;
    return s && s.kind === "code" && (typeof s.test === "string" || Array.isArray(s.io)) ? s : null;
  } catch {
    return null;
  }
}

/** The code in a reply: the last ```python block, else the last ``` block, else the whole reply. */
export function extractCode(output: string): string {
  const blocks = [...output.matchAll(/```(?:python|py)?[^\n]*\n([\s\S]*?)```/gi)].map((m) => m[1]);
  // keep the first line's indentation: a bare function body is indented
  return (blocks.length ? blocks[blocks.length - 1] : output).replace(/^\s*\n/, "").trimEnd();
}

/**
 * The program to run. When the answer defines the function itself, it gets the
 * prompt's imports in front; when it is only a body, it is appended to the
 * prompt. Then the tests, and the call that runs them.
 */
const NAME = String.raw`[A-Za-z_][\w.]*`;
const IMPORT_LINE = new RegExp(String.raw`^(?:import\s+${NAME}(?:\s+as\s+\w+)?(?:\s*,\s*${NAME}(?:\s+as\s+\w+)?)*|from\s+(?:\.+(?:${NAME})?|${NAME})\s+import\s+(?:\*|\(?\s*\w+(?:\s+as\s+\w+)?(?:\s*,\s*\w+(?:\s+as\s+\w+)?)*\s*,?\s*\)?))\s*(?:#.*)?$`);

/**
 * A program that runs a whole-program answer on each stdin test: the answer's source is exec'd fresh per test with
 * stdin and stdout redirected (as __main__, so a main guard runs), under a per-test alarm; the first wrong output
 * or error fails it, naming the test.
 */
function ioProgram(spec: CodeSpec, code: string): string {
  return `import io, json, signal, sys
SRC = ${JSON.stringify(code)}
TESTS = json.loads(${JSON.stringify(JSON.stringify(spec.io))})
def _alarm(signum, frame):
    raise TimeoutError("over ${spec.per_test ?? 6}s")
signal.signal(signal.SIGALRM, _alarm)
code = compile(SRC, "<answer>", "exec")
for i, t in enumerate(TESTS):
    sys.stdin = io.StringIO(t["input"])
    out, real = io.StringIO(), sys.stdout
    sys.stdout = out
    signal.alarm(${spec.per_test ?? 6})
    try:
        exec(code, {"__name__": "__main__"})
    except SystemExit:
        pass
    finally:
        signal.alarm(0)
        sys.stdout = real
    if out.getvalue().split() != t["output"].split():
        got = " ".join(out.getvalue().split())[:60]
        print(f"test {i + 1} of {len(TESTS)}: wrong output ({got!r})")
        sys.exit(1)
print(f"{len(TESTS)} tests pass")
`;
}

export function buildProgram(spec: CodeSpec, answer: string): string {
  const code = extractCode(answer);
  if (spec.io) return ioProgram(spec, code);
  const prompt = spec.prompt ?? "";
  const definesIt = spec.entry_point ? new RegExp(`^\\s*def\\s+${spec.entry_point}\\s*\\(`, "m").test(code) : true;
  // only real import statements, moved to the top level: one inside the prompt's function ("    import math")
  // would be an indentation error up there, and a docstring line ("    from any cell, …") is not an import at all
  const imports = prompt
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => IMPORT_LINE.test(l))
    .join("\n");
  const solution = definesIt ? `${imports}\n\n${code}` : `${prompt}${code.startsWith("    ") || code.startsWith("\t") ? "" : "\n"}${code}`;
  return `${solution}\n\n${spec.test}\n${spec.entry_point ? `\ncheck(${spec.entry_point})\n` : ""}`;
}

const run = (file: string, args: string[], timeout: number) =>
  new Promise<{ code: number; out: string }>((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 1_000_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 124) : 0;
      resolve({ code, out: `${stdout}${stderr}`.trim() });
    });
  });

/**
 * Runs a program in a fresh container and says whether it passed. No network,
 * 512 MB, one CPU, 128 processes, a read-only file system but for /tmp, and
 * `seconds` to finish.
 */
export async function runProgram(program: string, opts: { docker: string; image?: string; seconds?: number }): Promise<{ pass: boolean; why: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-code-"));
  try {
    fs.writeFileSync(path.join(dir, "prog.py"), program);
    fs.chmodSync(dir, 0o755);
    const seconds = opts.seconds ?? 10;
    const r = await run(
      opts.docker,
      ["run", "--rm", "--network", "none", "--memory", "512m", "--cpus", "1", "--pids-limit", "128", "--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--security-opt", `seccomp=${SECCOMP_PROFILE}`, "--user", `${process.getuid?.() ?? 65534}:${process.getgid?.() ?? 65534}`, "-e", "HOME=/tmp", "-v", `${dir}:/work:ro`, opts.image ?? "python:3.12-slim", "timeout", String(seconds), "python", "/work/prog.py"],
      (seconds + 30) * 1000,
    );
    if (r.code === 0) return { pass: true, why: "the tests pass" };
    if (r.code === 124) return { pass: false, why: `timed out after ${seconds}s` };
    const last = r.out.split("\n").filter(Boolean).slice(-1)[0] ?? `exit ${r.code}`;
    return { pass: false, why: `tests fail: ${last.slice(0, 200)}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Grades one answer against a code case. */
export async function gradeCode(expected: string, output: string, docker: string): Promise<{ pass: boolean; answer: string; why: string }> {
  const spec = parseCodeSpec(expected);
  if (!spec) return { pass: false, answer: "", why: "this case has no tests to run (its expected value is not a code spec)" };
  const answer = extractCode(output);
  const r = await runProgram(buildProgram(spec, output), { docker, seconds: spec.seconds });
  return { ...r, answer: answer.split("\n").find((l) => l.trim()) ?? "" };
}
