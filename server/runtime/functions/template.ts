// A small Handlebars-like template language:
//   {{path}}  {{#each path}}…{{this.x}}…{{/each}}  {{#if path}}…{{else}}…{{/if}}
//   subexpressions call helpers from the scope: {{#each (search input.text 8)}}
//   with positional args (paths or literals) and key=value args.
// Paths resolve against the scope; a string asked for `.text` is itself, so
// "{{input.text}}" works whether the input is a message or plain text.

export function lookup(scope: unknown, path: string): unknown {
  if (path === "" || path === "this") return scope;
  let cur: unknown = scope;
  for (const key of path.replace(/^this\./, "").split(".")) {
    if (cur == null) return undefined;
    if (typeof cur === "string" && (key === "text" || key === "content")) continue;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function show(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && "text" in (v as object) && typeof (v as { text: unknown }).text === "string") return (v as { text: string }).text;
  return JSON.stringify(v);
}

type Node = { t: "text"; v: string } | { t: "var"; path: string } | { t: "each" | "if"; path: string; body: Node[]; alt: Node[] };

function parse(src: string): Node[] {
  const root: Node[] = [];
  const stack: { node: Node & { t: "each" | "if" }; inAlt: boolean }[] = [];
  const out = () => {
    const top = stack[stack.length - 1];
    return top ? (top.inAlt ? top.node.alt : top.node.body) : root;
  };
  const re = /\{\{\s*([#/]?)\s*([^}]*?)\s*\}\}/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) out().push({ t: "text", v: src.slice(last, m.index) });
    last = re.lastIndex;
    const [, sigil, body] = m;
    const word = /^\w+/.exec(body)?.[0] ?? "";
    if (sigil === "#" && (word === "each" || word === "if")) {
      const node = { t: word, path: body.slice(word.length).trim(), body: [], alt: [] } as Node & { t: "each" | "if" };
      out().push(node);
      stack.push({ node, inAlt: false });
    } else if (sigil === "/") stack.pop();
    else if (!sigil && body === "else" && stack.length) stack[stack.length - 1].inAlt = true;
    else out().push({ t: "var", path: body.trim() });
  }
  if (last < src.length) out().push({ t: "text", v: src.slice(last) });
  return root;
}

function tokens(s: string): string[] {
  return s.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
}

function literal(tok: string, scope: Record<string, unknown>, self: unknown): unknown {
  if (/^["'].*["']$/.test(tok)) return tok.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok);
  if (tok === "true" || tok === "false") return tok === "true";
  if (tok === "null") return null;
  return tok.startsWith("this") ? lookup(self, tok) : lookup(scope, tok);
}

/** A path, or a helper call in parentheses. */
async function value(expr: string, scope: Record<string, unknown>, self: unknown): Promise<unknown> {
  const e = expr.trim();
  if (e.startsWith("(") && e.endsWith(")")) {
    const [name, ...args] = tokens(e.slice(1, -1));
    const fn = scope[name];
    if (typeof fn !== "function") return undefined;
    const pos: unknown[] = [];
    const named: Record<string, unknown> = {};
    for (const a of args) {
      const eq = a.indexOf("=");
      if (eq > 0 && !/^["']/.test(a)) named[a.slice(0, eq)] = literal(a.slice(eq + 1), scope, self);
      else pos.push(literal(a, scope, self));
    }
    return await (fn as (...a: unknown[]) => unknown)(...pos, named);
  }
  return e.startsWith("this") ? lookup(self, e) : lookup(scope, e);
}

async function render(nodes: Node[], scope: Record<string, unknown>, self: unknown): Promise<string> {
  let s = "";
  for (const n of nodes) {
    if (n.t === "text") s += n.v;
    else if (n.t === "var") s += show(await value(n.path, scope, self));
    else {
      const v = await value(n.path, scope, self);
      if (n.t === "if") s += await render(v && !(Array.isArray(v) && !v.length) ? n.body : n.alt, scope, self);
      else if (Array.isArray(v) && v.length) {
        for (let i = 0; i < v.length; i++) s += await render(n.body, { ...scope, "@index": i }, v[i]);
      } else s += await render(n.alt, scope, self);
    }
  }
  return s;
}

export function renderTemplate(src: string, scope: Record<string, unknown>): Promise<string> {
  return render(parse(src), scope, scope);
}
