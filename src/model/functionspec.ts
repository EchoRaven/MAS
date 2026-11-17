// Importing functions: a mas-function/1 manifest, or a bare code file whose
// language comes from its extension (.js .py .jsonata .hbs .prompt).
import YAML from "yaml";
import { defaultInterface } from "./ports";
import type { FnLang, FunctionNodeData, Interface } from "./types";

export const FUNCTION_CONTRACT = "mas-function/1" as const;

export class FunctionImportError extends Error {}

const BY_EXT: Record<string, FnLang> = { js: "js", mjs: "js", ts: "js", py: "python", jsonata: "jsonata", hbs: "template", handlebars: "template", prompt: "llm", md: "llm" };

export function parseFunctionFile(text: string, filename = "function.yaml"): { fn: FunctionNodeData; detected: string } {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (BY_EXT[ext]) {
    const name = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    return { fn: { kind: "function", name: name || "Imported function", fn: { lang: BY_EXT[ext], code: text.trim() }, join: "any", interface: defaultInterface("function") }, detected: `${BY_EXT[ext]} source file` };
  }
  let raw: unknown;
  try {
    raw = text.trim().startsWith("{") ? JSON.parse(text) : YAML.parse(text);
  } catch (err) {
    throw new FunctionImportError(`Could not parse: ${(err as Error).message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new FunctionImportError("Expected a mapping (mas-function/1) or a .js / .py / .jsonata / .hbs file");
  const r = raw as Record<string, unknown>;
  if (r.contract && r.contract !== FUNCTION_CONTRACT) throw new FunctionImportError(`Unsupported contract ${String(r.contract)}; expected ${FUNCTION_CONTRACT}`);
  const fn = (r.fn ?? { lang: r.lang, code: r.code }) as FunctionNodeData["fn"];
  return {
    fn: {
      kind: "function",
      name: String(r.name ?? "Imported function"),
      fn: { lang: fn.lang, code: String(fn.code ?? ""), ...(fn.model ? { model: fn.model } : {}) },
      join: (r.join as FunctionNodeData["join"]) ?? "any",
      interface: (r.interface as Interface) ?? defaultInterface("function"),
    },
    detected: FUNCTION_CONTRACT,
  };
}

export const FUNCTION_EXAMPLE = `contract: mas-function/1
name: Route by priority
join: any
interface:
  inputs:  [{ id: ticket, type: json }]
  outputs: [{ id: urgent, type: json }, { id: normal, type: json }]
fn:
  lang: js
  code: |
    return input.priority >= 3 ? { urgent: input } : { normal: input };
`;
