// Values that travel on edges, and the built-in coercion between port types
// (the same rules the editor's `compat` check promises).
import type { DataType } from "@/model/types";
import { show } from "./functions/template";

/** A chat message on a `message` port. `content` mirrors `text` for code written against { role, content }. */
export interface Msg {
  role: "user" | "assistant";
  text: string;
  content?: string;
  /** component id of the sender */
  from?: string;
  meta?: Record<string, unknown>;
}

export const isMsg = (v: unknown): v is Msg => !!v && typeof v === "object" && typeof (v as Msg).text === "string" && "role" in (v as object);

export const asText = (v: unknown): string => show(v);

/** The first JSON value in a text: the whole thing, a fenced block, or the first {...} / [...]. */
export function parseJsonLoose(s: string): unknown {
  const t = s.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fall through */
    }
  }
  const start = t.search(/[[{]/);
  if (start >= 0) {
    const open = t[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        try {
          return JSON.parse(t.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error("no JSON value found in the text");
}

export function coerce(v: unknown, type: DataType | undefined, from?: string): unknown {
  switch (type) {
    case "text":
      return asText(v);
    case "message":
      if (isMsg(v)) return { ...v, content: v.text };
      if (v && typeof v === "object" && typeof (v as { content?: unknown }).content === "string") return { role: "user", ...(v as object), text: (v as { content: string }).content, from } as Msg;
      return { role: "user", text: asText(v), content: asText(v), from } satisfies Msg;
    case "json":
      if (typeof v === "string") {
        try {
          return parseJsonLoose(v);
        } catch {
          return v;
        }
      }
      if (isMsg(v)) {
        try {
          return parseJsonLoose(v.text);
        } catch {
          return v.text;
        }
      }
      return v;
    default:
      return v;
  }
}

/**
 * A long text cut to about n characters for the log, keeping its beginning (what it is) and, at twice the length,
 * its end: an answer, a result, a conclusion is at the end. (Keeping only the beginning lost long-thinking
 * models' final answers, and graded them wrong.)
 */
export const clip = (s: string, n = 4000) => {
  if (s.length <= n) return s;
  const head = Math.floor(n / 3);
  const tail = n - head;
  return `${s.slice(0, head)}… (${s.length - n} chars cut) …${s.slice(s.length - tail)}`;
};

/** After user code changed a message: whichever of text / content it edited wins. */
export function syncMsg(before: unknown, after: unknown): unknown {
  if (!after || typeof after !== "object" || Array.isArray(after)) return after;
  const a = after as Msg;
  const b = (before && typeof before === "object" ? before : {}) as Partial<Msg>;
  if (typeof a.content === "string" && a.content !== b.content) return { ...a, text: a.content };
  if (typeof a.text === "string" && a.text !== b.text) return { ...a, content: a.text };
  return after;
}

/**
 * A value as conditions see it. A message reads as its text too, so both
 * `output.text.includes("X")` and `output.includes("X")` work, as do its fields
 * (`output.role`, `output.from`). Anything else is passed as it is.
 */
export function exprValue(v: unknown): unknown {
  if (typeof v === "string") return v;
  if (isMsg(v)) return Object.assign(new String(v.text), v);
  return v;
}
