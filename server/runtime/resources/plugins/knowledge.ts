// Knowledge: sources indexed by the index spec (load -> chunk -> embed ->
// enrich), searched by the retrieval pipeline. Sources are folders or globs
// under the knowledge root (MAS_KNOWLEDGE_DIR, default <data>/knowledge), or URLs.
import fs from "node:fs";
import path from "node:path";
import type { IndexSpec, PluginData, Step, SysEdge, SysNode } from "@/model/types";
import { defaultIndex, defaultRetrieval } from "@/model/pipelines";
import type { RunCtx } from "../../context";
import { llmCall, runFn } from "../../functions";
import { Retriever, type Corpus, type Doc } from "../retrieval";
import { S, schema, type Resource, type RtTool } from "../types";
import { fetchText } from "../../tools/web";

const p = (s: Step, k: string) => s.params?.[k];
const TEXT_EXT = /\.(md|markdown|txt|rst|html?|json|ya?ml|csv|py|ts|js|tsx|jsx|java|go|rs|c|cpp|h|sql|toml|ini|xml)$/i;

export function knowledgeRoot(rc: RunCtx) {
  const dir = path.resolve(process.env.MAS_KNOWLEDGE_DIR ?? path.join(rc.config.dataDir, "knowledge"));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function globToRe(g: string) {
  const esc = g.trim().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, ".").replace(/\u0000/g, "(.*/)?");
  return new RegExp(`^${esc}$`);
}

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length > 5000) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out, depth + 1);
    else out.push(f);
  }
  return out;
}

const stripHtml = (s: string) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

export function chunkText(text: string, s: Step): string[] {
  const size = Number(p(s, "size") ?? p(s, "max") ?? 500) * 4;
  const overlap = Number(p(s, "overlap") ?? 0) * 4;
  if (s.use === "none") return [text];
  if (s.use === "headings") {
    const parts = text.split(/\n(?=#{1,6}\s)/).filter((x) => x.trim());
    return parts.flatMap((part) => (part.length > size ? chunkText(part, { use: "recursive", params: { size: size / 4, overlap: 0 } }) : [part]));
  }
  if (s.use === "fixed") {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += Math.max(1, size - overlap)) out.push(text.slice(i, i + size));
    return out;
  }
  // recursive (and semantic, which falls back to it): paragraphs, then sentences
  const out: string[] = [];
  let cur = "";
  const pieces = text.split(/\n{2,}/).flatMap((para) => (para.length > size ? para.split(/(?<=[.!?。！？])\s+/) : [para]));
  for (const piece of pieces) {
    if ((cur + "\n\n" + piece).length > size && cur) {
      out.push(cur);
      cur = overlap ? cur.slice(-overlap) + "\n\n" + piece : piece;
    } else cur = cur ? `${cur}\n\n${piece}` : piece;
  }
  if (cur.trim()) out.push(cur);
  return out.flatMap((c) => (c.length > size * 1.5 ? chunkText(c, { use: "fixed", params: { size: size / 4, overlap: overlap / 4 } }) : [c]));
}

export class KnowledgePlugin implements Resource {
  private corpus?: Promise<Corpus>;
  constructor(
    private rc: RunCtx,
    private node: SysNode<PluginData>,
  ) {}
  get id() {
    return this.node.id;
  }
  private get index(): IndexSpec {
    return this.node.data.spec.index ?? defaultIndex();
  }

  private async load(): Promise<Doc[]> {
    const rc = this.rc;
    const s = this.index.load;
    const sources = this.node.data.spec.sources ?? [];
    if (s.use === "custom") return (await Promise.all(sources.map(async (src) => (await runFn(s.fn!, src, rc, { node: this.id, named: { source: src } })) as Doc[]))).flat();
    if (s.use === "web" || sources.some((x) => /^https?:/.test(x))) {
      const urls = [...String(p(s, "urls") ?? "").split(","), ...sources].map((u) => u.trim()).filter((u) => /^https?:/.test(u));
      const docs: Doc[] = [];
      for (const u of urls.slice(0, 50)) {
        try {
          docs.push({ id: u, text: await fetchText(u), source: u });
        } catch (e) {
          rc.emit({ type: "log", node: this.id, level: "warn", text: `Could not load ${u}: ${(e as Error).message}` });
        }
      }
      if (s.use === "web") return docs;
    }
    const root = knowledgeRoot(rc);
    const globs = String(p(s, "globs") ?? "**/*").split(",").map((g) => g.trim()).filter(Boolean).map(globToRe);
    const docs: Doc[] = [];
    for (const src of sources.filter((x) => !/^https?:/.test(x))) {
      const base = path.resolve(root, src.replace(/^\/+/, ""));
      if (!base.startsWith(root) || !fs.existsSync(base)) {
        rc.emit({ type: "log", node: this.id, level: "warn", text: `Source ${src} not found under the knowledge folder` });
        continue;
      }
      const files = fs.statSync(base).isDirectory() ? walk(base) : [base];
      for (const f of files) {
        const rel = path.relative(base, f) || path.basename(f);
        if (!TEXT_EXT.test(f) || !globs.some((g) => g.test(rel) || g.test(path.basename(f)))) continue;
        if (fs.statSync(f).size > 5_000_000) continue;
        let text = fs.readFileSync(f, "utf8");
        if (/\.html?$/i.test(f)) text = stripHtml(text);
        docs.push({ id: path.relative(root, f), text, source: path.relative(root, f), ts: fs.statSync(f).mtimeMs });
      }
    }
    return docs;
  }

  private async build(): Promise<Corpus> {
    const rc = this.rc;
    const docs = await this.load();
    const idx = this.index;
    const chunks: Doc[] = [];
    for (const d of docs) {
      const parts = idx.chunk.use === "custom" ? ((await runFn(idx.chunk.fn!, d, rc, { node: this.id, named: { doc: d } })) as { text: string }[]).map((c) => c.text) : chunkText(d.text, idx.chunk);
      parts.forEach((text, i) => chunks.push({ id: `${d.id}#${i}`, text, source: d.source, ts: d.ts, meta: { ...(d.meta ?? {}), doc: d.id } }));
    }
    if (idx.enrich.use === "llm" || idx.enrich.use === "custom") {
      for (const c of chunks.slice(0, 200)) {
        const meta = idx.enrich.use === "custom" ? await runFn(idx.enrich.fn!, c, rc, { node: this.id, named: { chunk: c } }) : await llmCall(rc, this.id, `Give a one-line title and summary for this passage:\n\n${c.text.slice(0, 2000)}`, (p(idx.enrich, "model") as string) || null);
        c.meta = { ...c.meta, ...(typeof meta === "object" && meta ? meta : { summary: String(meta) }) };
      }
    }
    rc.emit({ type: "transform", at: this.id, label: `index · ${this.node.data.name}`, detail: `${docs.length} document${docs.length === 1 ? "" : "s"}, ${chunks.length} chunks` });
    return { docs: async () => chunks };
  }

  async search(agent: string, query: string, edge?: SysEdge) {
    this.corpus ??= this.build();
    const spec = this.node.data.spec.retrieval ?? defaultRetrieval("knowledge");
    return new Retriever(this.rc, agent).run(spec, query, await this.corpus, { override: edge?.binding?.read?.retrieval, topK: edge?.binding?.read?.top_k });
  }

  async tools(edge: SysEdge): Promise<RtTool[]> {
    const declared = this.node.data.spec.tools.map((t) => t.name);
    return declared.map((name) => ({
      name,
      description: this.node.data.spec.tools.find((t) => t.name === name)?.description || `Search ${this.node.data.name}`,
      input_schema: schema({ query: S }),
      effect: "read" as const,
      source: this.id,
      run: async (a, c) => (await this.search(c.node, String(a.query ?? ""), edge)).text || "Nothing relevant found.",
    }));
  }

  async beforeTurn(turn: { node: string; input: string; edge: SysEdge }) {
    const r = await this.search(turn.node, turn.input, turn.edge);
    return r.hits.length ? `From ${this.node.data.name}:\n${r.text}` : null;
  }
}
