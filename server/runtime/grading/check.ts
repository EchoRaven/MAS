// Grader "check": JS kept with the dataset decides whether an output passes. For answers with no single form, which
// no comparison with an expected string can grade: a Game of 24 expression, a list that must meet constraints. The
// code runs in the same sandbox as functions and dataset adapters, for at most two seconds per output.
import { finalAnswer } from "@/run/evals";
import { runJs } from "../functions/sandbox";

/**
 * Runs a check on one output. In scope: `output` (the whole output), `answer` (its final answer, as the other graders
 * read it), `expected` and `question`. It returns true / false, or {pass, why}. An error or a timeout fails the case
 * with the reason.
 */
export async function gradeCheck(code: string, output: string, expected: string, question: string): Promise<{ pass: boolean; answer: string; why: string }> {
  const answer = finalAnswer(output);
  const scope = { output, answer, expected, question };
  try {
    const r = (await runJs(code, scope, {}, 2000, scope)) as unknown;
    if (r && typeof r === "object" && "pass" in r) {
      const o = r as { pass: unknown; why?: unknown };
      return { pass: !!o.pass, answer, why: String(o.why ?? (o.pass ? "the check passed" : "the check failed")) };
    }
    return { pass: !!r, answer, why: r ? "the check passed" : "the check failed" };
  } catch (e) {
    return { pass: false, answer, why: `the check could not run: ${(e as Error).message}` };
  }
}
