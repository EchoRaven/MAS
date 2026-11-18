import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { caseFromRecord } from "../../../src/run/evals";
import { buildProgram, extractCode, gradeCode, parseCodeSpec, runProgram } from "./code";

const PROMPT = `from typing import List\n\n\ndef add_all(xs: List[int]) -> int:\n    """Sum of xs."""\n`;
const TEST = `def check(candidate):\n    assert candidate([1, 2, 3]) == 6\n    assert candidate([]) == 0\n`;
const record = { task_id: "T/0", prompt: PROMPT, test: TEST, entry_point: "add_all" };

// a real run, not just "is docker installed": inside a sandbox with its own /tmp the daemon cannot see the program
const dockerWorks = await (async () => {
  try {
    execFileSync("docker", ["image", "inspect", "python:3.12-slim"], { stdio: "ignore", timeout: 10000 });
    return (await runProgram("pass", { docker: "docker" })).pass;
  } catch {
    return false;
  }
})();

describe("code grading", () => {
  it("reads HumanEval records as code cases", () => {
    const c = caseFromRecord(record)!;
    expect(c.input).toContain("def add_all");
    expect(parseCodeSpec(c.expected)).toMatchObject({ kind: "code", entry_point: "add_all", test: TEST });
    expect(parseCodeSpec("42")).toBeNull();
  });

  it("takes the last python block, else the whole reply", () => {
    expect(extractCode("Here:\n```python\nx = 1\n```\nand better:\n```python\nx = 2\n```")).toBe("x = 2");
    expect(extractCode("```\ny = 3\n```")).toBe("y = 3");
    expect(extractCode("z = 4")).toBe("z = 4");
  });

  it("gives a whole function the prompt's imports, and puts a bare body under the prompt", () => {
    const spec = parseCodeSpec(caseFromRecord(record)!.expected)!;
    const whole = buildProgram(spec, "```python\ndef add_all(xs: List[int]) -> int:\n    return sum(xs)\n```");
    expect(whole.startsWith("from typing import List")).toBe(true);
    expect(whole).toContain("check(add_all)");
    const body = buildProgram(spec, "```python\n    return sum(xs)\n```");
    expect(body).toContain(`${PROMPT}    return sum(xs)`);
  });

  it("takes only real imports from the prompt, at the top level (HumanEval/115 and /129)", () => {
    const prompt = '\ndef max_fill(grid, capacity):\n    import math\n    """\n    Each well has a bucket\n    from any cell, you can move\n    import the data as you like\n    """\n';
    const spec = { kind: "code" as const, prompt, test: "def check(f):\n    assert f([[1]], 1) == 1\n", entry_point: "max_fill" };
    const prog = buildProgram(spec, "```python\nimport math\n\ndef max_fill(grid, capacity):\n    return sum(math.ceil(sum(r) / capacity) for r in grid)\n```");
    expect(prog.startsWith("import math\n")).toBe(true);
    expect(prog).not.toMatch(/^\s+import math/);
    expect(prog).not.toContain("from any cell");
    expect(prog).not.toContain("import the data");
    // the forms an import can take still count
    const forms = ["import os", "import numpy as np, sys", "from typing import List, Tuple", "from collections import (Counter, deque)", "from math import *", "from . import util"];
    const all = buildProgram({ ...spec, prompt: forms.map((f) => `    ${f}`).join("\n") }, "```python\ndef max_fill(g, c):\n    return 1\n```");
    for (const f of forms) expect(all).toContain(`${f}\n`);
  });

  it.skipIf(!dockerWorks)("passes a right answer and fails a wrong one, a hang and a network call, in Docker", async () => {
    const expected = caseFromRecord(record)!.expected;
    const ok = await gradeCode(expected, "```python\ndef add_all(xs):\n    return sum(xs)\n```", "docker");
    expect(ok.pass).toBe(true);
    const wrong = await gradeCode(expected, "```python\ndef add_all(xs):\n    return 0 if not xs else 1\n```", "docker");
    expect(wrong).toMatchObject({ pass: false });
    expect(wrong.why).toContain("AssertionError");
    const net = await gradeCode(expected, "```python\nimport urllib.request\nurllib.request.urlopen('http://example.com', timeout=3)\ndef add_all(xs):\n    return sum(xs)\n```", "docker");
    expect(net.pass).toBe(false);
  }, 120000);
});
