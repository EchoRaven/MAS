// JavaScript evaluation for user code and expressions. node:vm separates
// globals, not privileges: this is for code written by the people who own
// the server (every /api call is authenticated), not for untrusted input.
import vm from "node:vm";

const BASE = { JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, Map, Set, Promise, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent };

/** Evaluate an expression such as `output.text.includes("<INFO>")` or `input.verdict == "approve"`. */
export function evalExpr(expr: string, scope: Record<string, unknown>, timeoutMs = 200): unknown {
  const ctx = vm.createContext({ ...BASE, ...scope });
  return new vm.Script(`(${expr})`).runInContext(ctx, { timeout: timeoutMs });
}

/** Truthiness of an expression; a broken expression counts as false and is reported. */
export function testExpr(expr: string, scope: Record<string, unknown>): { ok: boolean; error?: string } {
  try {
    return { ok: !!evalExpr(expr, scope) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Run a function body as `async (input, ctx) => { <code> }`. */
export async function runJs(code: string, input: unknown, ctx: Record<string, unknown>, timeoutMs = 10_000, named: Record<string, unknown> = {}): Promise<unknown> {
  const context = vm.createContext({ ...BASE, console: { log: (...a: unknown[]) => (ctx.log as ((s: string) => void) | undefined)?.(a.map(String).join(" ")) } });
  // a body without `return` that is a single expression still works
  const body = /\breturn\b/.test(code) || code.includes(";") || code.includes("\n") ? code : `return (${code});`;
  // the names a slot's signature promises (lists, hits, records, event, model, tools…) are locals
  const names = Object.keys(named).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== "input" && k !== "ctx" && !new RegExp(`\\b(const|let|var|function)\\s+${k}\\b`).test(code));
  const prelude = names.length ? `const { ${names.join(", ")} } = __named;\n` : "";
  const fn = new vm.Script(`(async function (input, ctx, __named) {\n${prelude}${body}\n})`).runInContext(context, { timeout: timeoutMs }) as (i: unknown, c: unknown, n: unknown) => Promise<unknown>;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(input, ctx, named),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
