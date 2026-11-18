// What a system says its run returns (SystemDoc.result), and the check of a
// finished run's answer against it. Three rebuilt papers returned the wrong
// thing on coding tasks (a test verdict, a printed value, a summary) and each
// looked like the method failing; a declared result type catches that on the
// first run, and lets the Evaluate page warn when a system's result does not
// fit a dataset's grader.
import type { ResultSpec, ResultType } from "@/model/types";
import type { Grader } from "./evals";
import { answerNumber, finalAnswer, parseNumber } from "./evals";

export type { ResultSpec, ResultType };

export const RESULT_TYPES: { value: ResultType; label: string; hint: string }[] = [
  { value: "text", label: "Text", hint: "Any non-empty answer" },
  { value: "number", label: "A number", hint: "The final answer contains a number" },
  { value: "code", label: "Code", hint: "The answer contains a ```python block (or a function definition)" },
  { value: "json", label: "JSON", hint: "The answer is a JSON value, bare or in a ```json block" },
  { value: "choice", label: "A choice", hint: "The final answer is one of the allowed options (a letter by default)" },
];

/** Whether a run's answer is what the system says it returns, and why not. */
export function checkResult(spec: ResultSpec, output: string): { ok: boolean; why: string } {
  const text = output.trim();
  if (!text) return { ok: false, why: "the run gave no answer" };
  switch (spec.type) {
    case "text":
      return { ok: true, why: "an answer" };
    case "number": {
      const n = answerNumber(finalAnswer(text)) ?? parseNumber(finalAnswer(text));
      return n === null ? { ok: false, why: `no number in the final answer ("${finalAnswer(text).slice(0, 80)}")` } : { ok: true, why: `the number ${n}` };
    }
    case "code": {
      if (/```(?:python|py)?[^\n]*\n[\s\S]*?```/i.test(text) || /^\s*(?:async\s+)?def\s+\w+\s*\(/m.test(text)) return { ok: true, why: "code" };
      return { ok: false, why: `no code block in the answer ("${text.split("\n").find((l) => l.trim())?.slice(0, 80) ?? ""}")` };
    }
    case "json": {
      const fenced = /```json\s*\n([\s\S]*?)```/i.exec(text)?.[1];
      for (const candidate of [fenced, text].filter((x): x is string => !!x)) {
        try {
          JSON.parse(candidate);
          return { ok: true, why: "JSON" };
        } catch {
          /* try the next form */
        }
      }
      return { ok: false, why: "the answer is not JSON" };
    }
    case "choice": {
      const fin = finalAnswer(text).replace(/\*+/g, "").trim();
      if (spec.choices?.length) {
        const hit = spec.choices.find((c) => fin.toLowerCase() === c.toLowerCase() || fin.toLowerCase().startsWith(`${c.toLowerCase()} `) || fin.toLowerCase().startsWith(`${c.toLowerCase()}.`));
        return hit ? { ok: true, why: `the choice ${hit}` } : { ok: false, why: `"${fin.slice(0, 60)}" is not one of ${spec.choices.join(", ")}` };
      }
      return /^\(?[A-Ja-j]\)?(?:[.):\s]|$)/.test(fin) ? { ok: true, why: `the choice ${fin[0].toUpperCase() === "(" ? fin[1] : fin[0]}` } : { ok: false, why: `"${fin.slice(0, 60)}" does not start with an option letter` };
    }
  }
}

/** The result type a grader expects, if it expects one. */
export function resultTypeFor(grader: Grader): ResultType | null {
  return grader === "number" ? "number" : grader === "code" ? "code" : null; // math answers are expressions: no single type
}
